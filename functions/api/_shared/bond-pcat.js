// "יש אג"ח כולל לא סחיר" (businesses.has_agch_any, migrations/0022) והקטגוריה "חברות מנפיקות אג"ח" ב"קטגוריה עבור רשימת השטרות".
//   has_agch_any = 'יש' כשלחברה יש אג"ח סחירה (tase_has_agch = 'יש', או ח"פ ברשימת האג"ח bonds_all) או אג"ח לא סחירה פעילה
//   (nontradable_chps.json - כל החברות במאיה, נבנה יומית - ו-bonds_institutional.json). אחרת 'אין'.
//   נפרד בכוונה מ-tase_has_agch: רשימות החברות ממשיכות להציג "יש אג"ח" רק לפי אג"ח סחירות.
// הקטגוריה: has_agch_any = 'יש' - החברה בקטגוריה; 'אין' - יוצאת ממנה. שאר הקטגוריות נשארות כפי שנבחרו ידנית.
// מתעדכן בשמירת עסק (syncBondFlagsFor) ובריצה הלילית (scripts/registry_refresh/refresh_businesses.py),
// ובכל קריאה (‎/api/lists, ‎/api/businesses) הקטגוריה מוצגת לפי העמודה, כך שהיא תמיד תואמת לה.
import { normalizePcat } from "./pcat.js";

export const BOND_PCAT = 'חברות מנפיקות אג"ח';

const norm = v => String(v ?? "").trim();
const isChp = c => /^\d{6,10}$/.test(c);

async function asset(request, env, path) {
  try {
    const url = new URL(path, request.url), res = await (env.ASSETS ? env.ASSETS.fetch(url) : fetch(url));
    return res.ok ? await res.json() : null;
  } catch { return null; }
}
const chpsOf = d => (Array.isArray(d) ? d : (d && d.rows) || []).map(r => norm(r.chp_number)).filter(isChp);

// ח"פים עם אג"ח שאינם נספרים בדגל tase_has_agch: ברשימת האג"ח (סריקת מאיה) או עם אג"ח לא סחירה פעילה
export async function loadAnyBondChps(request, env) {
  const [listed, nontrad, inst] = await Promise.all([
    asset(request, env, "/data/bonds_list/bonds_all.json"),
    asset(request, env, "/data/bonds_list/nontradable_chps.json"),
    asset(request, env, "/data/bonds_list/bonds_institutional.json"),
  ]);
  return new Set([...chpsOf(listed), ...((nontrad && nontrad.chps) || []).map(norm).filter(isChp), ...chpsOf(inst)]);
}

// יש אג"ח כולל לא סחיר? לפי העמודה; לפני המיגרציה / לפני הבדיקה הראשונה (ריק) - לפי הדגל של האג"ח הסחירות
export function rowHasAnyBonds(row) {
  const a = norm(row.has_agch_any);
  return a ? a === "יש" : norm(row.tase_has_agch) === "יש";
}

// מוסיף / מסיר את הקטגוריה לפי has, ושומר על שאר הקטגוריות (בלי קטגוריה = "שונות")
export function withBondPcat(value, has) {
  const cur = String(value || "").split("|").map(x => x.trim()).filter(x => x && (has || x !== BOND_PCAT));          // הסדר הקיים נשמר
  if (has && !cur.includes(BOND_PCAT)) cur.push(BOND_PCAT);
  return normalizePcat(cur.join("|"));
}

// שורות שכוללות permits_category ו-has_agch_any / tase_has_agch: הקטגוריה מוצגת לפי הכלל
export function applyBondPcatRows(rows) {
  for (const r of rows) if ("permits_category" in r) r.permits_category = withBondPcat(r.permits_category, rowHasAnyBonds(r));
  return rows;
}

// אחרי שמירת עסק (ואחרי עדכון tase_has_agch מהבורסה): מחשב ושומר has_agch_any ואת הקטגוריה.
// לא זורק: כשל (למשל לפני מיגרציה 0022) לא מפריע לשמירה.
export async function syncBondFlagsFor(request, env, id) {
  try {
    const r = await env.DB.prepare("SELECT chp_number, tase_has_agch, permits_category FROM businesses WHERE id = ?").bind(id).first();
    if (!r) return;
    const chp = norm(r.chp_number);
    const any = norm(r.tase_has_agch) === "יש" || (isChp(chp) && (await loadAnyBondChps(request, env)).has(chp));
    try { await env.DB.prepare("UPDATE businesses SET has_agch_any = ? WHERE id = ?").bind(any ? "יש" : "אין", id).run(); }
    catch (e) { if (!/no such column: has_agch_any/i.test(String(e.message))) throw e; }
    const v = withBondPcat(r.permits_category, any);
    if (v !== (r.permits_category || "")) await env.DB.prepare("UPDATE businesses SET permits_category = ? WHERE id = ?").bind(v, id).run();
  } catch { /* נשאר לריצה הלילית */ }
}
