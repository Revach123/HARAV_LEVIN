// ============================================================================
//  functions/api/news.js — תיבת העדכונים באתר (news-embed.js): עדכונים ידניים + אוטומטיים
//
//  GET  /api/news            -> { ok, updated, items: [...] }   ציבורי (CORS פתוח, מטמון 5 דקות)
//       כל פריט: { id, cat: "companies"|"bonds"|"other", text, link, date, pinned, auto }
//       - ידניים: מהטבלה site_news (נכתבים מדף הניהול news-admin.html). רק פעילים ובטווח התאריכים.
//       - אוטומטיים: חברות שנוספו בחודש האחרון (לפי created_at, בלי ימי ייבוא גדולים - 300 ומעלה ביום),
//         ואג"ח חדשות בשלושת השבועות האחרונים (הנפקה חדשה / אישור חדש / נוספה) - אותו כלל כמו התגיות ברשימות (display.html).
//  GET  /api/news?all=1      -> כל הפריטים הידניים (גם כבויים / שפג תוקפם), לניהול. דורש מנהל.
//  POST /api/news {id?, cat, text, link, start_date, end_date, pinned, active}  -> הוספה / עדכון. דורש מנהל.
//  DELETE /api/news?id=N     -> מחיקה. דורש מנהל.
//  הטבלה נוצרת בפעם הראשונה ששומרים עדכון (migrations/0024_site_news.sql - אותו מבנה). לפני כן יש רק עדכונים אוטומטיים.
// ============================================================================
import { checkAdmin } from './_shared/auth.js';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
const json = (data, status = 200, extra = {}) => new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8', ...extra } });
const CATS = ['companies', 'bonds', 'other'];
const ymd = (d) => d.toISOString().slice(0, 10);
const daysAgo = (n) => ymd(new Date(Date.now() - n * 864e5));
const clean = (s, max) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, max);
const NEW_CO_DAYS = 30, NEW_BOND_DAYS = 21, BULK_DAY = 300;

const TABLE = `CREATE TABLE IF NOT EXISTS site_news (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cat TEXT NOT NULL DEFAULT 'other',
  text TEXT NOT NULL,
  link TEXT DEFAULT '',
  start_date TEXT DEFAULT '',
  end_date TEXT DEFAULT '',
  pinned INTEGER DEFAULT 0,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
)`;

async function manualItems(env, all) {
  try {
    const { results } = await env.DB.prepare('SELECT * FROM site_news ORDER BY pinned DESC, COALESCE(NULLIF(start_date,\'\'), substr(created_at,1,10)) DESC, id DESC').all();
    if (all) return results || [];
    const today = ymd(new Date());
    return (results || []).filter((r) => r.active && (!r.start_date || r.start_date <= today) && (!r.end_date || r.end_date >= today))
      .map((r) => ({ id: 'm' + r.id, cat: CATS.includes(r.cat) ? r.cat : 'other', text: r.text, link: r.link || '', date: r.start_date || String(r.created_at || '').slice(0, 10), pinned: !!r.pinned, auto: false }));
  } catch { return []; }          // הטבלה עוד לא נוצרה
}

// חברות שנוספו בחודש האחרון (בלי מחוסלות/מחוקות). "פרטי" = עסק מסומן פרטי.
async function companyItems(env) {
  const since = daysAgo(NEW_CO_DAYS);
  try {
    const q = (withStatus, withHeb) => `SELECT id, permit_name, visibility, substr(created_at,1,10) AS d${withHeb ? ', heb_name' : ''} FROM businesses
      WHERE substr(COALESCE(created_at,''),1,10) >= ?
        AND substr(created_at,1,10) NOT IN (SELECT substr(created_at,1,10) FROM businesses WHERE COALESCE(created_at,'') != '' GROUP BY 1 HAVING COUNT(*) >= ${BULK_DAY})${withStatus ? ` AND COALESCE(registry_status,'') NOT LIKE 'מחוסל%' AND COALESCE(registry_status,'') NOT LIKE 'חיסול%' AND COALESCE(registry_status,'') NOT LIKE 'מחוק%' AND COALESCE(registry_status,'') NOT LIKE 'נגרע%'` : ''}
      ORDER BY created_at DESC LIMIT 200`;
    let rows = null;
    for (const [s, h] of [[true, true], [true, false], [false, true], [false, false]]) {          // עמודה שעדיין לא נוספה למסד
      try { rows = (await env.DB.prepare(q(s, h)).bind(since).all()).results || []; break; } catch (e) { if (!/no such column/i.test(String(e.message))) throw e; }
    }
    return (rows || []).filter((r) => r.d && clean(r.permit_name, 200)).map((r) => {
      const heb = clean(r.heb_name, 120), name = clean(r.permit_name, 160) + (heb && heb !== clean(r.permit_name, 160) ? ` (${heb})` : '');
      const priv = ['פרטי', 'רק פרטי'].includes(String(r.visibility || ''));
      return { id: 'c' + r.id, cat: 'companies', text: `נוספה לרשימת החברות${priv ? ' (היתר עיסקא פרטי)' : ''}: ${name}`, link: '', date: r.d, pinned: false, auto: true, kind: priv ? 'private' : 'general' };
    });
  } catch { return []; }
}

// אג"ח חדשות (כמו markRecent ב-display.html): הנפקה חדשה / אישור חדש / נוספה לרשימה.
async function bondItems(request, env) {
  try {
    const url = new URL('/data/bonds_list/bonds_all.json', request.url);
    const res = await (env.ASSETS ? env.ASSETS.fetch(url) : fetch(url));
    if (!res.ok) return [];
    const data = await res.json(), rows = data.rows || [], started = data.universe_started || '';
    const cnt = {};
    for (const r of rows) { const fs = r.first_seen || ''; cnt[fs] = (cnt[fs] || 0) + 1; }
    const base = Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a])[0] || '';
    const since = daysAgo(NEW_BOND_DAYS), groups = new Map();
    for (const r of rows) {
      const fs = r.first_seen || '', ls = r.listed_first_seen || '', dated = !!r.redemption_date;
      const iss = !!(started && ls && ls > started && ls >= since && dated);
      const appr = !iss && !!(fs && fs >= since && fs !== base && dated);
      if (!iss && !appr) continue;
      const kind = iss ? 'issue' : started && fs > started ? 'approval' : 'new', date = iss ? ls : fs;
      const co = clean(r.company || r.issuer_name, 100), list = String(r.list || '');
      const k = `${kind}|${date}|${co}`;          // כמה אג"ח של אותה חברה באותו יום ובאותו סוג = עדכון אחד
      if (!groups.has(k)) groups.set(k, { kind, date, co, ids: [], names: [], priv: false, gen: false });
      const g = groups.get(k);
      g.ids.push(r.security_id); g.names.push(clean(r.security_name, 80));
      g.priv = g.priv || list.includes('פרטי'); g.gen = g.gen || list.includes('כללי');
    }
    const out = [];
    for (const g of groups.values()) {
      const n = g.names.length, lists = g.priv && g.gen ? 'פרטי וכללי' : g.priv ? 'פרטי' : g.gen ? 'כללי' : '';
      const label = n > 1 ? { issue: `הנפקת ${n} אג"ח חדשות`, approval: `אושרו ${n} אג"ח`, new: `נוספו ${n} אג"ח לרשימה` }[g.kind] : { issue: 'הנפקת אג"ח חדשה', approval: 'אושרה אג"ח', new: 'נוספה אג"ח לרשימה' }[g.kind];
      const what = n > 1 ? `${g.co}${g.co ? ' - ' : ''}${g.names.join(', ')}` : `${g.names[0]}${g.co ? ` (${g.co})` : ''}`;
      out.push({ id: 'b' + g.ids.join('-').slice(0, 60), cat: 'bonds', text: `${label}: ${what}${lists ? ` · היתר עיסקא ${lists}` : ''}`, link: '', date: g.date, pinned: false, auto: true, kind: g.kind });
    }
    return out;
  } catch { return []; }
}

export async function onRequestOptions() { return new Response(null, { status: 204, headers: { ...CORS, 'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' } }); }

export async function onRequestGet({ request, env }) {
  const all = new URL(request.url).searchParams.get('all') === '1';
  if (all) {
    if (!(await checkAdmin(request, env))) return json({ ok: false, error: 'Unauthorized' }, 401);
    return json({ ok: true, items: await manualItems(env, true) }, 200, { 'Cache-Control': 'no-store' });
  }
  const [manual, cos, bonds] = await Promise.all([manualItems(env, false), companyItems(env), bondItems(request, env)]);
  const byDate = (a, b) => String(b.date).localeCompare(String(a.date));
  const items = [...manual.filter((x) => x.pinned), ...[...manual.filter((x) => !x.pinned), ...cos, ...bonds].sort(byDate)];
  return json({ ok: true, updated: new Date().toISOString(), items }, 200, { 'Cache-Control': 'public, max-age=300, stale-while-revalidate=3600' });
}

export async function onRequestPost({ request, env }) {
  if (!(await checkAdmin(request, env))) return json({ ok: false, error: 'Unauthorized' }, 401);
  let b; try { b = await request.json(); } catch { return json({ ok: false, error: 'bad_json' }, 400); }
  const text = clean(b.text, 400), link = clean(b.link, 500), cat = CATS.includes(b.cat) ? b.cat : 'other';
  const date = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) ? String(s) : '');
  if (!text) return json({ ok: false, error: 'חסר נוסח העדכון' }, 400);
  if (link && !/^https?:\/\//i.test(link)) return json({ ok: false, error: 'הקישור צריך להתחיל ב-https://' }, 400);
  const vals = [cat, text, link, date(b.start_date), date(b.end_date), b.pinned ? 1 : 0, b.active === false || b.active === 0 ? 0 : 1];
  await env.DB.prepare(TABLE).run();
  const id = Number(b.id) || 0;
  if (id) await env.DB.prepare("UPDATE site_news SET cat=?, text=?, link=?, start_date=?, end_date=?, pinned=?, active=?, updated_at=datetime('now') WHERE id=?").bind(...vals, id).run();
  else await env.DB.prepare('INSERT INTO site_news (cat, text, link, start_date, end_date, pinned, active) VALUES (?,?,?,?,?,?,?)').bind(...vals).run();
  return json({ ok: true });
}

export async function onRequestDelete({ request, env }) {
  if (!(await checkAdmin(request, env))) return json({ ok: false, error: 'Unauthorized' }, 401);
  const id = Number(new URL(request.url).searchParams.get('id')) || 0;
  if (!id) return json({ ok: false, error: 'missing id' }, 400);
  try { await env.DB.prepare('DELETE FROM site_news WHERE id=?').bind(id).run(); } catch {}
  return json({ ok: true });
}
