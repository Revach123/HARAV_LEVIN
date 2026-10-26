// גרסת נתונים לבדיקת עדכונים בדפדפן: { biz: { v, s }, docs: { v, s } }
// v = מונה שעולה בכל שינוי דרך ה-API (app_meta); s = חתימה מהנתונים עצמם (כמות + עדכון אחרון), כדי לתפוס גם שינויים שנעשו ישירות ב-D1.
export const GROUPS = {
  biz: p => /^\/api\/businesses(\/|$)/.test(p) || /^\/api\/sync-tase/.test(p),
  docs: p => /^\/api\/(permit-docs|permit-ext|permit-review|approved-bonds)(\/|$|\?)/.test(p),
};
const META = "CREATE TABLE IF NOT EXISTS app_meta (k TEXT PRIMARY KEY, v INTEGER NOT NULL DEFAULT 0)";

export async function bump(env, group) {
  await env.DB.batch([env.DB.prepare(META), env.DB.prepare("INSERT INTO app_meta (k, v) VALUES (?, 1) ON CONFLICT(k) DO UPDATE SET v = v + 1").bind(group)]);
}

export async function dataVersion(env) {
  const one = async (sql) => { try { return await env.DB.prepare(sql).first(); } catch { return null; } };
  const [m, b, d, l] = await Promise.all([
    (async () => { try { return (await env.DB.prepare("SELECT k, v FROM app_meta").all()).results || []; } catch { return []; } })(),
    one("SELECT COUNT(*) AS n, MAX(updated_at) AS u FROM businesses"),
    one("SELECT COUNT(*) AS n, MAX(updated_at) AS u FROM permit_docs"),
    one("SELECT COUNT(*) AS n, TOTAL(LENGTH(slot)) AS t FROM permit_doc_companies"),
  ]);
  const mv = k => Number((m.find(x => x.k === k) || {}).v || 0);
  return {
    biz: { v: mv("biz"), s: `${b ? b.n : ""}|${b ? b.u : ""}` },
    docs: { v: mv("docs"), s: `${d ? d.n : ""}|${d ? d.u : ""}|${l ? l.n : ""}|${l ? l.t : ""}` },
  };
}
