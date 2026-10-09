// מטמון תמלול לשיחה: השלוחה חסרת מצב, וכל שלב אישור מתבצע בבקשה חדשה - בלי המטמון
// היינו מורידים ומתמללים את אותה הקלטה שוב בכל שלב. זיכרון ה-isolate קודם, אחריו D1.

const mem = new Map();
const TTL_MS = 6 * 3600 * 1000;
let ready = false;

async function ensure(env) {
  if (ready) return;
  await env.DB.prepare(
    'CREATE TABLE IF NOT EXISTS ivr_stt (call_id TEXT, attempt INTEGER, text TEXT, at INTEGER, PRIMARY KEY (call_id, attempt))'
  ).run();
  ready = true;
}

export async function sttGet(env, callId, attempt) {
  const k = `${callId}:${attempt}`;
  if (mem.has(k)) return mem.get(k);
  try {
    await ensure(env);
    const r = await env.DB.prepare('SELECT text FROM ivr_stt WHERE call_id = ? AND attempt = ?')
      .bind(callId, attempt).first();
    if (r) { mem.set(k, r.text); return r.text; }
  } catch (e) { /* בלי D1 - נתמלל שוב */ }
  return null;
}

export async function sttPut(env, callId, attempt, text) {
  mem.set(`${callId}:${attempt}`, text);
  try {
    await ensure(env);
    await env.DB.prepare('INSERT OR REPLACE INTO ivr_stt (call_id, attempt, text, at) VALUES (?, ?, ?, ?)')
      .bind(callId, attempt, text, Date.now()).run();
    await env.DB.prepare('DELETE FROM ivr_stt WHERE at < ?').bind(Date.now() - TTL_MS).run();
  } catch (e) { /* best-effort */ }
}
