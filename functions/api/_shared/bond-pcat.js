// הקטגוריה "חברות מנפיקות אג"ח" ב"קטגוריה עבור רשימת השטרות" (businesses.permits_category) נקבעת אוטומטית:
//   חברה שרשום אצלה "יש אג"ח" (כולל אג"ח לא סחירות ואג"ח בהנפקה) - נכנסת לקטגוריה; חברה בלי אג"ח - יוצאת ממנה.
// שאר הקטגוריות נשארות כפי שנבחרו ידנית. החישוב נעשה בכל קריאה (‎/api/lists, ‎/api/businesses), כך שאין צורך לעדכן ידנית.
// מקורות "יש אג"ח" (אותו כלל של עמודת האג"ח ברשימות החברות, ועוד אג"ח לא סחירות):
//   tase_has_agch = 'יש' (הבורסה, ריצה לילית) | ח"פ ברשימת האג"ח (bonds_all) | ח"פ עם אג"ח לא סחירה פעילה
//   (nontradable_chps.json לכל החברות + bonds_institutional.json) | ח"פ עם הנפקה פתוחה / עתידית (offerings.json).
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

// ח"פים עם אג"ח לא סחירה פעילה (לכל החברות) - מהבנייה היומית; ריק אם הקובץ עוד לא נבנה
export async function loadNontradableChps(request, env) {
  const [all, inst] = await Promise.all([
    asset(request, env, "/data/bonds_list/nontradable_chps.json"),
    asset(request, env, "/data/bonds_list/bonds_institutional.json"),
  ]);
  return new Set([...((all && all.chps) || []).map(norm).filter(isChp), ...chpsOf(inst)]);
}

// כל הח"פים שנחשבים "יש אג"ח" מעבר לדגל tase_has_agch שבמסד
export async function loadBondChps(request, env) {
  const [listed, nontrad, off] = await Promise.all([
    asset(request, env, "/data/bonds_list/bonds_all.json"),
    loadNontradableChps(request, env),
    asset(request, env, "/data/bonds_list/offerings.json"),
  ]);
  const out = new Set([...chpsOf(listed), ...nontrad]);
  for (const o of [...((off && off.open) || []), ...((off && off.upcoming) || [])]) { const c = norm(o.chp_number); if (isChp(c)) out.add(c); }
  return out;
}

export const rowHasBonds = (row, bondChps) => norm(row.tase_has_agch) === "יש" || bondChps.has(norm(row.chp_number));

// מוסיף / מסיר את הקטגוריה לפי has, ושומר על שאר הקטגוריות (בלי קטגוריה = "שונות")
export function withBondPcat(value, has) {
  const cur = String(value || "").split("|").map(x => x.trim()).filter(x => x && x !== BOND_PCAT);
  if (has) cur.push(BOND_PCAT);
  return normalizePcat(cur.join("|"));
}

// שורות מהטבלה businesses (SELECT *): permits_category מחושב מחדש לפי הכלל
export async function applyBondPcatRows(request, env, rows) {
  if (!rows.length || !rows.some(r => "permits_category" in r)) return rows;
  const bondChps = await loadBondChps(request, env);
  for (const r of rows) if ("permits_category" in r) r.permits_category = withBondPcat(r.permits_category, rowHasBonds(r, bondChps));
  return rows;
}

// אחרי שמירת עסק (ואחרי עדכון דגל tase_has_agch): שומר במסד את הקטגוריה המחושבת, כדי שגם הערך השמור יתאים לכלל.
// לא זורק: כשל (למשל לפני מיגרציה 0019) לא מפריע לשמירה, והחישוב בקריאה ממשיך לתקן את התצוגה.
export async function syncBondPcatFor(request, env, id) {
  try {
    const r = await env.DB.prepare("SELECT chp_number, tase_has_agch, permits_category FROM businesses WHERE id = ?").bind(id).first();
    if (!r) return;
    const v = withBondPcat(r.permits_category, rowHasBonds(r, await loadBondChps(request, env)));
    if (v !== (r.permits_category || "")) await env.DB.prepare("UPDATE businesses SET permits_category = ? WHERE id = ?").bind(v, id).run();
  } catch { /* נשאר לחישוב בקריאה */ }
}
