import { checkAdmin } from "./_shared/auth.js";
import { SEED, SEED_UPDATED } from "./_shared/glatt-funds-seed.js";
// רשימת מסלולים וקרנות גלאט הון (דף funds_test.html + ניהול ב-admin_test.html)
// GET  /api/glatt-funds → { updated, rows: [{ id, tab, company, track, type, number, note }] }   (ציבורי)
// PUT  /api/glatt-funds   { updated, rows } → החלפה מלאה של הרשימה (מנהל בלבד)
// הטבלה נוצרת וממולאת ברשימה ההתחלתית (מהתמונות) בפעם הראשונה; אין צורך במיגרציה ידנית.
const TABS = ["pension", "savings"];
const CORS = { "Access-Control-Allow-Origin": "*" };

async function ensure(env) {
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS glatt_funds (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tab TEXT NOT NULL, sort INTEGER NOT NULL DEFAULT 0,
      company TEXT NOT NULL DEFAULT '', track TEXT NOT NULL DEFAULT '', type TEXT NOT NULL DEFAULT '',
      number TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '')`),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS glatt_funds_meta (k TEXT PRIMARY KEY, v TEXT NOT NULL DEFAULT '')"),
  ]);
  const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM glatt_funds").first();
  const seeded = await env.DB.prepare("SELECT v FROM glatt_funds_meta WHERE k = 'seeded'").first();
  if (!n.n && !seeded) await replaceAll(env, SEED, SEED_UPDATED, true);
}

function clean(r, i) {
  const s = (v, max) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, max);
  return { tab: TABS.includes(r.tab) ? r.tab : "pension", sort: i, company: s(r.company, 120), track: s(r.track, 300), type: s(r.type, 160), number: s(r.number, 60), note: s(r.note, 400) };
}

async function replaceAll(env, rows, updated, seed) {
  const list = rows.map(clean);
  const stmts = [env.DB.prepare("DELETE FROM glatt_funds")];
  for (const r of list) stmts.push(env.DB.prepare("INSERT INTO glatt_funds (tab, sort, company, track, type, number, note) VALUES (?,?,?,?,?,?,?)").bind(r.tab, r.sort, r.company, r.track, r.type, r.number, r.note));
  stmts.push(env.DB.prepare("INSERT INTO glatt_funds_meta (k, v) VALUES ('updated', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").bind(String(updated || "").trim().slice(0, 60)));
  stmts.push(env.DB.prepare("INSERT INTO glatt_funds_meta (k, v) VALUES ('saved_at', datetime('now')) ON CONFLICT(k) DO UPDATE SET v = excluded.v"));
  if (seed) stmts.push(env.DB.prepare("INSERT INTO glatt_funds_meta (k, v) VALUES ('seeded', '1') ON CONFLICT(k) DO NOTHING"));
  await env.DB.batch(stmts);
}

async function read(env) {
  const rows = (await env.DB.prepare("SELECT id, tab, company, track, type, number, note FROM glatt_funds ORDER BY CASE tab WHEN 'pension' THEN 0 ELSE 1 END, sort, id").all()).results || [];
  const meta = Object.fromEntries(((await env.DB.prepare("SELECT k, v FROM glatt_funds_meta").all()).results || []).map(x => [x.k, x.v]));
  return { updated: meta.updated || "", saved_at: meta.saved_at || "", rows };
}

export async function onRequestGet({ env }) {
  try { await ensure(env); return Response.json(await read(env), { headers: { ...CORS, "Cache-Control": "public, max-age=60" } }); }
  catch (e) { return Response.json({ error: e.message }, { status: 500, headers: CORS }); }
}

export async function onRequestPut({ request, env }) {
  if (!(await checkAdmin(request, env))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    await ensure(env);
    const body = await request.json();
    if (!Array.isArray(body.rows)) return Response.json({ error: "חסרה רשימה" }, { status: 400 });
    if (body.rows.length > 1000) return Response.json({ error: "יותר מדי שורות" }, { status: 400 });
    const rows = body.rows.filter(r => r && [r.company, r.track, r.type, r.number, r.note].some(v => String(v || "").trim()));
    await replaceAll(env, rows, body.updated);
    return Response.json({ success: true, ...(await read(env)) });
  } catch (e) { return Response.json({ error: e.message }, { status: 500 }); }
}
