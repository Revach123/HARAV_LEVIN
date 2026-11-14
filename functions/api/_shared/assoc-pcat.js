// הקטגוריה "עמותות" ב"קטגוריה עבור רשימת השטרות" (businesses.permits_category) - שיוך אוטומטי לעמותות חדשות.
//   * "חנויות ומוסדות" נקראת היום "עסקים" - הערך הישן מוחלף תמיד.
//   * עמותה *בלי קטגוריה שנבחרה* (ריק / "שונות") מקבלת "עמותות". קטגוריה שנבחרה ידנית בניהול לא נדרסת לעולם
//     (כך אפשר לשייך עמותה גם ל"עסקים", כמו קופות החולים).
//   * "חברות מנפיקות אג"ח" נשארת אוטומטית לפי bond-pcat.js.
// אותו כלל בדיוק בריצה הלילית: scripts/registry_refresh/refresh_businesses.py (with_assoc_pcat).
import { normalizePcat } from "./pcat.js";

export const ASSOC_PCAT = "עמותות";
export const BIZ_PCAT = "עסקים";
const OLD_BIZ_PCAT = "חנויות ומוסדות";

const digits = v => String(v ?? "").replace(/\D/g, "");

// עמותה: מספר עמותה (58...), רשומה ברשם העמותות, "(ע"ר)" בשם, או הערה "עמותה" (למשל "עמותה - לא חברה בע"מ")
export function isAssociation(row) {
  const name = `${row.permit_name || ""} ${row.registrar_name || ""}`;
  return /^58\d{7}$/.test(digits(row.chp_number)) || row.entity_type === "association"
    || /עמותה/.test(String(row.biz_type || "")) || /\(\s*ע["״']?ר\s*\)/.test(name) || /עמותה/.test(String(row.notes || ""));
}

export function withAssocPcat(value, row) {
  let cur = String(value || "").split("|").map(x => x.trim()).filter(Boolean).map(x => (x === OLD_BIZ_PCAT ? BIZ_PCAT : x));
  cur = [...new Set(cur)];
  const chosen = cur.filter(x => x !== "שונות" && x !== 'חברות מנפיקות אג"ח');
  if (!chosen.length && isAssociation(row)) cur = [ASSOC_PCAT, ...cur.filter(x => x !== "שונות")];
  return normalizePcat(cur.join("|"));
}

// אחרי שמירת עסק: מחשב ושומר את הקטגוריה. לא זורק - כשל לא מפריע לשמירה (הריצה הלילית משלימה).
export async function syncAssocPcatFor(env, id) {
  try {
    const r = await env.DB.prepare("SELECT chp_number, permit_name, registrar_name, entity_type, biz_type, notes, permits_category FROM businesses WHERE id = ?").bind(id).first();
    if (!r) return;
    const v = withAssocPcat(r.permits_category, r);
    if (v !== (r.permits_category || "")) await env.DB.prepare("UPDATE businesses SET permits_category = ? WHERE id = ?").bind(v, id).run();
  } catch { /* נשאר לריצה הלילית */ }
}
