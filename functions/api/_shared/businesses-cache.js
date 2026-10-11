// טעינת רשימת העסקים (id, ח.פ., שמות) מ-D1 עם מטמון קצר בזיכרון ה-isolate.
// משותף ל-/api/voice-search ול-/api/ivr-company.

const CACHE_MS = 60 * 1000;
let cache = { at: 0, rows: null };

export async function loadBusinesses(env) {
  if (cache.rows && Date.now() - cache.at < CACHE_MS) return cache.rows;
  let res;
  try {
    res = await env.DB
      .prepare("SELECT id, chp_number, entity_type, registrar_name, permit_name, visibility FROM businesses")
      .all();
  } catch (e) {                                   // סכמה ישנה בלי visibility/entity_type
    res = await env.DB.prepare("SELECT id, chp_number, registrar_name, permit_name FROM businesses").all();
  }
  cache = { at: Date.now(), rows: res.results ?? [] };
  return cache.rows;
}
