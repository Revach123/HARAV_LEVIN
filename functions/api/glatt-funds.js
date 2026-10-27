import { checkAdmin } from "./_shared/auth.js";
import { SEED, SEED_UPDATED } from "./_shared/glatt-funds-seed.js";
// רשימת מסלולים וקרנות גלאט הון (דף funds_test.html + ניהול ב-admin_test.html)
// GET  /api/glatt-funds → { updated, type_order: { pension: [...], savings: [...] }, rows: [{ id, tab, company, track, type, number, note, mark }] }   (ציבורי)
// mark: '' רגיל | 'new' = מסלול חדש (רקע צהוב, עד שהמנהל מבטל את הסימון) | 'del' = הוסר (רקע אדום וקו חוצה; נשאר עד מחיקה סופית)
// PUT  /api/glatt-funds   { updated, type_order, rows } → החלפה מלאה של הרשימה (מנהל בלבד)
// tab: pension / savings, או both = סוג מוצר שמופיע בשתי הרשימות (למשל קופת גמל להשקעה): שורה אחת שמוצגת בשתיהן
// הטבלה נוצרת וממולאת ברשימה ההתחלתית (מהתמונות) בפעם הראשונה; אין צורך במיגרציה ידנית.
const TABS = ["pension", "savings", "both"];
const CORS = { "Access-Control-Allow-Origin": "*" };

async function ensure(env) {
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS glatt_funds (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tab TEXT NOT NULL, sort INTEGER NOT NULL DEFAULT 0,
      company TEXT NOT NULL DEFAULT '', track TEXT NOT NULL DEFAULT '', type TEXT NOT NULL DEFAULT '',
      number TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '')`),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS glatt_funds_meta (k TEXT PRIMARY KEY, v TEXT NOT NULL DEFAULT '')"),
  ]);
  try { await env.DB.prepare("SELECT mark FROM glatt_funds LIMIT 1").first(); }
  catch { try { await env.DB.prepare("ALTER TABLE glatt_funds ADD COLUMN mark TEXT NOT NULL DEFAULT ''").run(); } catch { /* נוספה במקביל */ } }
  const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM glatt_funds").first();
  const seeded = await env.DB.prepare("SELECT v FROM glatt_funds_meta WHERE k = 'seeded'").first();
  if (!n.n && !seeded) await replaceAll(env, SEED, SEED_UPDATED, null, true);
  if (!(await env.DB.prepare("SELECT v FROM glatt_funds_meta WHERE k = 'shared_v1'").first())) await migrateShared(env);
  if (!(await env.DB.prepare("SELECT v FROM glatt_funds_meta WHERE k = 'fund_type_v1'").first())) {          // תיקון חד-פעמי של הרשימה הקיימת: סוג קרן סל / נאמנות לפי המספר
    const cur = await read(env);
    if (cur.rows.some(r => fundType(r.type, r.number) !== r.type)) await replaceAll(env, cur.rows, cur.updated, cur.type_order);
    await env.DB.prepare("INSERT INTO glatt_funds_meta (k, v) VALUES ('fund_type_v1', '1') ON CONFLICT(k) DO NOTHING").run();
  }
  if (!(await env.DB.prepare("SELECT v FROM glatt_funds_meta WHERE k = 'dedupe_v1'").first())) {          // חד-פעמי (לבקשת המנהל): 5134531 ו-5134549 הופיעו גם כקרן סל וגם כקרן נאמנות; אחרי תיקון הסוג - נשארת שורה אחת לכל אחת
    const cur = await read(env), seen = new Set();
    const rows = cur.rows.filter(r => { if (!["5134531", "5134549"].includes(String(r.number).trim())) return true; const k = [r.tab, fundType(r.type, r.number), r.company, r.track, r.number].join("|"); if (seen.has(k)) return false; seen.add(k); return true; });
    if (rows.length !== cur.rows.length) await replaceAll(env, rows, cur.updated, cur.type_order);
    await env.DB.prepare("INSERT INTO glatt_funds_meta (k, v) VALUES ('dedupe_v1', '1') ON CONFLICT(k) DO NOTHING").run();
  }
}

// העברה חד-פעמית: סוג מוצר שמופיע בשתי הרשימות נשמר פעם אחת (tab = both); סדר הסוגים נשמר לכל רשימה בנפרד.
// בנוסף: המסלול של הראל 13434 ("בטוח מנהלים" / "תוכנית חיסכון") מקבל סוג אחד "ביטוח מנהלים/תכנית חסכון"
async function migrateShared(env) {
  const cur = await read(env);
  const rows = cur.rows.map(r => ({ ...r }));
  for (const r of rows) if (r.company === "הראל" && String(r.number) === "13434" && /^(בטוח מנהלים|ביטוח מנהלים|תוכנית חיסכון)$/.test(r.type)) r.type = "ביטוח מנהלים/תכנית חסכון";
  const order = { pension: [], savings: [] };
  for (const r of rows) if (order[r.tab] && !order[r.tab].includes(r.type)) order[r.tab].push(r.type);
  const shared = new Set(order.pension.filter(t => order.savings.includes(t)));
  const out = [], byKey = new Map();
  for (const r of rows) {
    if (!shared.has(r.type) || r.tab === "both") { out.push(r); continue; }
    const k = [r.type, r.company, r.track, r.number].join("|");
    if (byKey.has(k)) continue;          // אותה שורה ברשימה השנייה: נשמרת פעם אחת (הגרסה מהרשימה הראשונה)
    const row = { ...r, tab: "both" }; byKey.set(k, row); out.push(row);
  }
  await replaceAll(env, out, cur.updated, order);
  await env.DB.prepare("INSERT INTO glatt_funds_meta (k, v) VALUES ('shared_v1', '1') ON CONFLICT(k) DO NOTHING").run();
}

// קרן סל / קרן נאמנות לפי מספר הקרן: מתחיל ב-1 = קרן סל, ב-5 = קרן נאמנות (רק בשורות שסוגן אחד משני אלה - שאר הסוגים לא נוגעים)
const FUND_TYPES = ["קרן סל", "קרן נאמנות"];
export function fundType(type, number) {
  const t = String(type || "").replace(/\s+/g, " ").trim(), d = String(number || "").replace(/\D/g, "")[0];
  if (!FUND_TYPES.includes(t)) return t;
  return d === "1" ? "קרן סל" : d === "5" ? "קרן נאמנות" : t;
}

function clean(r, i) {
  const s = (v, max) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, max);
  return { tab: TABS.includes(r.tab) ? r.tab : "pension", sort: i, company: s(r.company, 120), track: s(r.track, 300), type: fundType(s(r.type, 160), r.number), number: s(r.number, 60), note: s(r.note, 400), mark: r.mark === "new" || r.mark === "del" ? r.mark : "" };
}

async function replaceAll(env, rows, updated, typeOrder, seed) {
  const list = rows.map(clean);
  const stmts = [env.DB.prepare("DELETE FROM glatt_funds")];
  for (const r of list) stmts.push(env.DB.prepare("INSERT INTO glatt_funds (tab, sort, company, track, type, number, note, mark) VALUES (?,?,?,?,?,?,?,?)").bind(r.tab, r.sort, r.company, r.track, r.type, r.number, r.note, r.mark));
  stmts.push(env.DB.prepare("INSERT INTO glatt_funds_meta (k, v) VALUES ('updated', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").bind(String(updated || "").trim().slice(0, 60)));
  stmts.push(env.DB.prepare("INSERT INTO glatt_funds_meta (k, v) VALUES ('saved_at', datetime('now')) ON CONFLICT(k) DO UPDATE SET v = excluded.v"));
  if (typeOrder && typeof typeOrder === "object") {
    const o = {}; for (const t of ["pension", "savings"]) o[t] = (Array.isArray(typeOrder[t]) ? typeOrder[t] : []).map(x => String(x || "").replace(/\s+/g, " ").trim().slice(0, 160)).slice(0, 200);
    stmts.push(env.DB.prepare("INSERT INTO glatt_funds_meta (k, v) VALUES ('type_order', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").bind(JSON.stringify(o)));
  }
  if (seed) stmts.push(env.DB.prepare("INSERT INTO glatt_funds_meta (k, v) VALUES ('seeded', '1') ON CONFLICT(k) DO NOTHING"));
  await env.DB.batch(stmts);
}

async function read(env) {
  const rows = (await env.DB.prepare("SELECT id, tab, company, track, type, number, note, mark FROM glatt_funds ORDER BY CASE tab WHEN 'pension' THEN 0 ELSE 1 END, sort, id").all()).results || [];
  const meta = Object.fromEntries(((await env.DB.prepare("SELECT k, v FROM glatt_funds_meta").all()).results || []).map(x => [x.k, x.v]));
  let typeOrder = null; try { typeOrder = JSON.parse(meta.type_order || "null"); } catch { typeOrder = null; }
  return { updated: meta.updated || "", saved_at: meta.saved_at || "", type_order: typeOrder, rows };
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
    await replaceAll(env, rows, body.updated, body.type_order);
    return Response.json({ success: true, ...(await read(env)) });
  } catch (e) { return Response.json({ error: e.message }, { status: 500 }); }
}
