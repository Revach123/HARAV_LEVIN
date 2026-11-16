// גרסת נתונים לבדיקת עדכונים בדפדפן: { biz: { v, s }, docs: { v, s } }
// v = מונה שעולה בכל שינוי דרך ה-API (app_meta). s נשאר ריק (תאימות לדפדפן).
export const GROUPS = {
  biz: p => /^\/api\/businesses(\/|$)/.test(p) || /^\/api\/sync-tase/.test(p),
  docs: p => /^\/api\/(permit-docs|permit-ext|permit-review|approved-bonds)(\/|$|\?)/.test(p),
};
const META = "CREATE TABLE IF NOT EXISTS app_meta (k TEXT PRIMARY KEY, v INTEGER NOT NULL DEFAULT 0)";

export async function bump(env, group) {
  await env.DB.batch([env.DB.prepare(META), env.DB.prepare("INSERT INTO app_meta (k, v) VALUES (?, 1) ON CONFLICT(k) DO UPDATE SET v = v + 1").bind(group)]);
}

export async function dataVersion(env) {
  // רק המונים (שורה לכל קבוצה). קודם נוספה "חתימה" מהנתונים עצמם (COUNT/MAX/TOTAL(LENGTH) על שלוש טבלאות)
  // כדי לתפוס שינויים ישירים ב-D1 - כל בדיקה קראה את הטבלאות במלואן (כ-1.8 מיליון שורות ביום מדף ניהול פתוח).
  // כל כתיבה עוברת דרך ה-API (המונה עולה ב-_middleware), והסקריפט היחיד שכותב ישירות (registry_refresh) מעלה את המונה בעצמו.
  let m = [];
  try { m = (await env.DB.prepare("SELECT k, v FROM app_meta").all()).results || []; } catch { m = []; }
  const mv = k => Number((m.find(x => x.k === k) || {}).v || 0);
  return { biz: { v: mv("biz"), s: "" }, docs: { v: mv("docs"), s: "" } };
}
