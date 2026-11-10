// ============================================================================
//  functions/api/news.js — תיבת העדכונים באתר (news-embed.js): עדכונים ידניים + אוטומטיים
//
//  GET  /api/news            -> { ok, updated, items: [...] }   ציבורי (CORS פתוח, מטמון 5 דקות)
//       כל פריט: { id, cat: "companies"|"bonds"|"funds"|"other", title, text, link, date, pinned, auto }
//       title = השורה הראשונה (למשל "חברה חדשה - היתר עיסקא פרטי"), text = השורה השנייה (שם החברה / האג"ח / נוסח העדכון)
//       - ידניים: מהטבלה site_news (נכתבים מדף הניהול news-admin.html). רק פעילים ובטווח התאריכים.
//       - אוטומטיים: חברות שנוספו בחודש האחרון (לפי created_at, בלי ימי ייבוא גדולים - 300 ומעלה ביום),
//         ואג"ח חדשות בשלושת השבועות האחרונים (הנפקה חדשה / אישור חדש / נוספה) - אותו כלל כמו התגיות ברשימות (display.html),
//         ושינויים ברשימת הקרנות והמסלולים (funds.html): מסלולים שסומנו "חדש" או "הוסר" בניהול, לפי תאריך השמירה האחרונה של הרשימה.
//  GET  /api/news?all=1      -> כל הפריטים הידניים (גם כבויים / שפג תוקפם) + settings, לניהול. דורש מנהל.
//  POST /api/news {action:"settings", co_days, bond_days, tag_co_days, tag_bond_days}  -> דורש מנהל. בימים (1-365):
//       co_days / bond_days = כמה זמן מוצגים עדכונים אוטומטיים של חברות / אג"ח בתיבה;
//       tag_co_days / tag_bond_days = כמה זמן חברה / אג"ח מסומנת "חדש" ברשימות עצמן (display.html).
//  GET  /api/news?tags=1     -> { tag_co_days, tag_bond_days } ציבורי, לסימון "חדש" ברשימות.
//  POST /api/news {id?, cat, title, text, link, start_date, end_date, pinned, active}  -> הוספה / עדכון. דורש מנהל.
//  POST /api/news {action:"approve", id}  -> אישור עדכון שנשלח מהאתר (מפורסם מיד). דורש מנהל.
//  POST /api/news (multipart/form-data: submit=1, cat, text, link, name, contact, files)  -> שליחת עדכון מהאתר (כפתור "שליחת עדכון"). ציבורי.
//       נשמר כ"ממתין לאישור" (pending=1, לא מוצג) ומופיע בדף הניהול לאישור / עריכה / מחיקה. עד 5 שליחות ביום מאותה כתובת IP.
//       קבצים מצורפים: עד 3, עד 5MB כל אחד (PDF, תמונות, Word, Excel), בדלי R2 הפרטי (PERMITS) תחת news/<id>/.
//  GET  /api/news?file=news/<id>/...  -> קובץ מצורף: למנהל תמיד; לציבור רק של עדכון מאושר ומוצג (מופיע כקישור בחלון העדכונים).
//  DELETE /api/news?id=N     -> מחיקה. דורש מנהל.
//  הטבלה נוצרת בפעם הראשונה ששומרים עדכון (migrations/0024_site_news.sql - אותו מבנה). לפני כן יש רק עדכונים אוטומטיים.
// ============================================================================
import { checkAdmin } from './_shared/auth.js';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
const json = (data, status = 200, extra = {}) => new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8', ...extra } });
const CATS = ['companies', 'bonds', 'funds', 'other'];
const ymd = (d) => d.toISOString().slice(0, 10);
const daysAgo = (n) => ymd(new Date(Date.now() - n * 864e5));
const clean = (s, max) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, max);
const DEF_TITLE = { companies: 'עדכון בחברות', bonds: 'עדכון באג"ח', funds: 'עדכון בקרנות ובמסלולים', other: 'עדכון' };
const NEW_CO_DAYS = 30, NEW_BOND_DAYS = 21, BULK_DAY = 300;          // ברירות מחדל; המנהל משנה בדף הניהול (טבלת site_news_meta)
const META = "CREATE TABLE IF NOT EXISTS site_news_meta (k TEXT PRIMARY KEY, v TEXT NOT NULL DEFAULT '')";
const days = (v, d) => { const n = Math.floor(Number(v)); return n >= 1 && n <= 365 ? n : d; };
async function settings(env) {
  try {
    const rows = (await env.DB.prepare("SELECT k, v FROM site_news_meta WHERE k IN ('co_days','bond_days','tag_co_days','tag_bond_days')").all()).results || [];
    const m = Object.fromEntries(rows.map((r) => [r.k, r.v]));
    return { co_days: days(m.co_days, NEW_CO_DAYS), bond_days: days(m.bond_days, NEW_BOND_DAYS), tag_co_days: days(m.tag_co_days, NEW_CO_DAYS), tag_bond_days: days(m.tag_bond_days, NEW_BOND_DAYS) };
  } catch { return { co_days: NEW_CO_DAYS, bond_days: NEW_BOND_DAYS, tag_co_days: NEW_CO_DAYS, tag_bond_days: NEW_BOND_DAYS }; }          // הטבלה עוד לא נוצרה
}

const TABLE = `CREATE TABLE IF NOT EXISTS site_news (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cat TEXT NOT NULL DEFAULT 'other',
  title TEXT DEFAULT '',
  text TEXT NOT NULL,
  link TEXT DEFAULT '',
  start_date TEXT DEFAULT '',
  end_date TEXT DEFAULT '',
  pinned INTEGER DEFAULT 0,
  active INTEGER DEFAULT 1,
  pending INTEGER DEFAULT 0,
  submitter TEXT DEFAULT '',
  contact TEXT DEFAULT '',
  ip_hash TEXT DEFAULT '',
  files TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
)`;
// עמודות שנוספו אחרי שהטבלה אולי כבר נוצרה
const COLS = ["title TEXT DEFAULT ''", "pending INTEGER DEFAULT 0", "submitter TEXT DEFAULT ''", "contact TEXT DEFAULT ''", "ip_hash TEXT DEFAULT ''", "files TEXT DEFAULT ''"];
async function ensureTable(env) {
  await env.DB.prepare(TABLE).run();
  for (const c of COLS) { try { await env.DB.prepare(`ALTER TABLE site_news ADD COLUMN ${c}`).run(); } catch {} }
}

const filesOf = (r) => { try { const f = JSON.parse(r.files || '[]'); return Array.isArray(f) ? f : []; } catch { return []; } };
const isLive = (r, today) => r.active && !r.pending && (!r.start_date || r.start_date <= today) && (!r.end_date || r.end_date >= today);

async function manualItems(env, all, origin = '') {
  try {
    const { results } = await env.DB.prepare('SELECT * FROM site_news ORDER BY pinned DESC, COALESCE(NULLIF(start_date,\'\'), substr(created_at,1,10)) DESC, id DESC').all();
    if (all) return results || [];
    const today = ymd(new Date());
    return (results || []).filter((r) => isLive(r, today))
      .map((r) => { const cat = CATS.includes(r.cat) ? r.cat : 'other'; return { id: 'm' + r.id, cat, title: clean(r.title, 120) || DEF_TITLE[cat], text: r.text, link: r.link || '', date: r.start_date || String(r.created_at || '').slice(0, 10), pinned: !!r.pinned, auto: false, files: filesOf(r).map((f) => ({ name: f.name, url: `${origin}/api/news?file=${encodeURIComponent(f.key)}` })) }; });
  } catch { return []; }          // הטבלה עוד לא נוצרה
}

// חברות שנוספו בחודש האחרון (בלי מחוסלות/מחוקות). "פרטי" = עסק מסומן פרטי.
async function companyItems(env, nDays = NEW_CO_DAYS) {
  const since = daysAgo(nDays);
  try {
    const q = (withStatus, withHeb) => `SELECT id, permit_name, visibility, substr(created_at,1,10) AS d${withHeb ? ', heb_name' : ''} FROM businesses
      WHERE substr(COALESCE(created_at,''),1,10) >= ?
        AND substr(created_at,1,10) NOT IN (SELECT substr(created_at,1,10) FROM businesses WHERE COALESCE(created_at,'') != '' GROUP BY 1 HAVING COUNT(*) >= ${BULK_DAY})${withStatus ? ` AND COALESCE(registry_status,'') NOT LIKE 'מחוסל%' AND COALESCE(registry_status,'') NOT LIKE 'חיסול%' AND COALESCE(registry_status,'') NOT LIKE 'מחוק%' AND COALESCE(registry_status,'') NOT LIKE 'נגרע%'` : ''}
      ORDER BY created_at DESC LIMIT 200`;
    let rows = null;
    for (const [s, h] of [[true, true], [true, false], [false, true], [false, false]]) {          // עמודה שעדיין לא נוספה למסד
      try { rows = (await env.DB.prepare(q(s, h)).bind(since).all()).results || []; break; } catch (e) { if (!/no such column/i.test(String(e.message))) throw e; }
    }
    return (rows || []).filter((r) => r.d && clean(r.permit_name, 200) && String(r.visibility || '') !== 'רק לאג"ח').map((r) => {          // "רק לאג"ח": לא ברשימת החברות
      const heb = clean(r.heb_name, 120), name = clean(r.permit_name, 160) + (heb && heb !== clean(r.permit_name, 160) ? ` (${heb})` : '');
      const priv = ['פרטי', 'רק פרטי'].includes(String(r.visibility || ''));
      return { id: 'c' + r.id, cat: 'companies', title: `חברה חדשה ברשימה - היתר עיסקא ${priv ? 'פרטי' : 'כללי'}`, text: name, link: '', date: r.d, pinned: false, auto: true, kind: priv ? 'private' : 'general' };
    });
  } catch { return []; }
}

// אג"ח חדשות (כמו markRecent ב-display.html): הנפקה חדשה / אישור חדש / נוספה לרשימה.
async function bondItems(request, env, nDays = NEW_BOND_DAYS) {
  try {
    const url = new URL('/data/bonds_list/bonds_all.json', request.url);
    const res = await (env.ASSETS ? env.ASSETS.fetch(url) : fetch(url));
    if (!res.ok) return [];
    const data = await res.json(), rows = data.rows || [], started = data.universe_started || '';
    const cnt = {};
    for (const r of rows) { const fs = r.first_seen || ''; cnt[fs] = (cnt[fs] || 0) + 1; }
    const base = Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a])[0] || '';
    const since = daysAgo(nDays), groups = new Map();
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
      const title = (n > 1 ? { issue: `הנפקה חדשה - ${n} אג"ח`, approval: `אישור חדש - ${n} אג"ח`, new: `אג"ח חדשות ברשימה - ${n}` } : { issue: 'הנפקת אג"ח חדשה', approval: 'אג"ח - אישור חדש', new: 'אג"ח חדשה ברשימה' })[g.kind] + (lists ? ` · היתר עיסקא ${lists}` : '');
      const what = n > 1 ? `${g.co}${g.co ? ': ' : ''}${g.names.join(', ')}` : `${g.names[0]}${g.co ? ` (${g.co})` : ''}`;
      out.push({ id: 'b' + g.ids.join('-').slice(0, 60), cat: 'bonds', title, text: what, link: '', date: g.date, pinned: false, auto: true, kind: g.kind });
    }
    return out;
  } catch { return []; }
}

// שינויים ברשימת הקרנות והמסלולים (glatt_funds): mark = 'new' (מסלול חדש) / 'del' (הוסר). עדכון לכל מסלול:
//   שורה ראשונה: סוג השינוי + סוג המוצר ("מסלול חדש · קרן השתלמות"), שורה שנייה: החברה + המסלול + מספר ("מיטב · מסלול הלכה (1234)")
async function fundItems(env) {
  try {
    const rows = (await env.DB.prepare("SELECT id, tab, company, track, type, number, mark FROM glatt_funds WHERE mark IN ('new','del') ORDER BY sort, id").all()).results || [];
    if (!rows.length) return [];
    const at = await env.DB.prepare("SELECT v FROM glatt_funds_meta WHERE k = 'saved_at'").first().catch(() => null);
    const date = String((at && at.v) || '').slice(0, 10) || ymd(new Date());
    return rows.map((r) => {
      const del = r.mark === 'del', type = clean(r.type, 60), co = clean(r.company, 80), track = clean(r.track, 100), num = clean(r.number, 20);
      const change = del ? 'הוסר מהרשימה המאושרת' : 'מסלול חדש ברשימה המאושרת';
      return { id: 'f' + r.mark + r.id, cat: 'funds', title: `${change}${type ? ` · ${type}` : ''}`,
        text: [co, track ? (/^מסלול/.test(track) ? track : `מסלול ${track}`) : '', num ? `מס' ${num}` : ''].filter(Boolean).join(' · '), link: '', date, pinned: false, auto: true, kind: del ? 'removed' : 'new' };
    });
  } catch { return []; }          // הטבלה עוד לא קיימת
}

export async function onRequestOptions() { return new Response(null, { status: 204, headers: { ...CORS, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' } }); }

// קובץ מצורף. המפתח news/<id>/...: לציבור רק אם העדכון מאושר ומוצג והקובץ רשום בו
async function serveFile(request, env, key) {
  if (!env.PERMITS || !/^news\/\d+\/[^/]+$/.test(key)) return json({ ok: false, error: 'not_found' }, 404);
  const admin = await checkAdmin(request, env);
  if (!admin) {
    const r = await env.DB.prepare('SELECT * FROM site_news WHERE id=?').bind(Number(key.split('/')[1])).first().catch(() => null);
    if (!r || !isLive(r, ymd(new Date())) || !filesOf(r).some((f) => f.key === key)) return json({ ok: false, error: 'not_found' }, 404);
  }
  const obj = await env.PERMITS.get(key);
  if (!obj) return json({ ok: false, error: 'not_found' }, 404);
  const name = key.split('/').pop().replace(/^[0-9a-f]{8}-/, '');
  return new Response(obj.body, { headers: { ...CORS, 'Content-Type': (obj.httpMetadata && obj.httpMetadata.contentType) || 'application/octet-stream',
    'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(name)}`, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': admin ? 'no-store' : 'public, max-age=300' } });
}

export async function onRequestGet({ request, env }) {
  const sp = new URL(request.url).searchParams;
  if (sp.get('file')) return serveFile(request, env, sp.get('file'));
  if (sp.get('tags')) { const st = await settings(env); return json({ ok: true, tag_co_days: st.tag_co_days, tag_bond_days: st.tag_bond_days }, 200, { 'Cache-Control': 'no-store' }); }          // בלי מטמון: שינוי בניהול נראה ברשימות מיד בטעינה הבאה
  const all = sp.get('all') === '1';
  if (all) {
    if (!(await checkAdmin(request, env))) return json({ ok: false, error: 'Unauthorized' }, 401);
    return json({ ok: true, items: await manualItems(env, true), settings: await settings(env) }, 200, { 'Cache-Control': 'no-store' });
  }
  const st = await settings(env);
  const [manual, cos, bonds, funds] = await Promise.all([manualItems(env, false, new URL(request.url).origin), companyItems(env, st.co_days), bondItems(request, env, st.bond_days), fundItems(env)]);
  const byDate = (a, b) => String(b.date).localeCompare(String(a.date));
  const items = [...manual.filter((x) => x.pinned), ...[...manual.filter((x) => !x.pinned), ...cos, ...bonds, ...funds].sort(byDate)];
  return json({ ok: true, updated: new Date().toISOString(), items }, 200, { 'Cache-Control': 'public, max-age=60' });          // שינוי בניהול מופיע בתיבה תוך דקה
}

async function readBody(request) {          // JSON (מהניהול) או טופס עם קבצים (מהאתר; שניהם בלי בקשת preflight)
  if (/multipart\/form-data/i.test(request.headers.get('Content-Type') || '')) {
    const fd = await request.formData().catch(() => null);
    if (!fd) return null;
    const b = { files: fd.getAll('files').filter((f) => f && typeof f === 'object' && f.size > 0) };
    for (const [k, v] of fd.entries()) if (typeof v === 'string') b[k] = v;
    return b;
  }
  try { return JSON.parse(await request.text()); } catch { return null; }
}
const FILE_TYPES = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
const MAX_FILES = 3, MAX_FILE = 5 * 1024 * 1024;
const safeName = (n) => String(n || 'file').replace(/[\\/:*?"<>|\x00-\x1f]+/g, '_').replace(/\s+/g, ' ').trim().slice(-80) || 'file';
const ipHash = async (request) => {
  const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || '';
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('news:' + ip));
  return [...new Uint8Array(h)].slice(0, 12).map((x) => x.toString(16).padStart(2, '0')).join('');
};
const PCORS = { ...CORS, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };

async function submit(request, env, b) {
  const pj = (d, st = 200) => new Response(JSON.stringify(d), { status: st, headers: { ...PCORS, 'Content-Type': 'application/json; charset=utf-8' } });
  if (clean(b.website, 10)) return pj({ ok: true });          // מלכודת לרובוטים (שדה מוסתר)
  const text = clean(b.text, 400), title = clean(b.title, 120), link = clean(b.link, 500), cat = CATS.includes(b.cat) ? b.cat : 'other';
  const name = clean(b.name, 80), contact = clean(b.contact, 120);
  if (text.length < 5) return pj({ ok: false, error: 'נא לכתוב את נוסח העדכון' }, 400);
  if (link && !/^https?:\/\//i.test(link)) return pj({ ok: false, error: 'הקישור צריך להתחיל ב-https://' }, 400);
  const files = b.files || [];
  if (files.length > MAX_FILES) return pj({ ok: false, error: `אפשר לצרף עד ${MAX_FILES} קבצים` }, 400);
  for (const f of files) {
    const ext = String(f.name || '').split('.').pop().toLowerCase();
    if (!FILE_TYPES[ext]) return pj({ ok: false, error: `סוג הקובץ ${safeName(f.name)} לא נתמך (PDF, תמונה, Word או Excel)` }, 400);
    if (f.size > MAX_FILE) return pj({ ok: false, error: `הקובץ ${safeName(f.name)} גדול מ-5MB` }, 400);
  }
  if (files.length && !env.PERMITS) return pj({ ok: false, error: 'צירוף קבצים אינו זמין כרגע' }, 503);
  await ensureTable(env);
  const ih = await ipHash(request);
  const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM site_news WHERE ip_hash = ? AND created_at >= datetime('now','-1 day')").bind(ih).first();
  if (n && n.n >= 5) return pj({ ok: false, error: 'נשלחו כבר כמה עדכונים היום. אפשר לנסות שוב מחר.' }, 429);
  const res = await env.DB.prepare('INSERT INTO site_news (cat, title, text, link, active, pending, submitter, contact, ip_hash) VALUES (?,?,?,?,0,1,?,?,?)').bind(cat, title, text, link, name, contact, ih).run();
  const id = res && res.meta && res.meta.last_row_id;
  if (files.length && id) {
    const saved = [];
    for (const f of files) {
      const ext = String(f.name).split('.').pop().toLowerCase(), nm = safeName(f.name);
      const key = `news/${id}/${[...crypto.getRandomValues(new Uint8Array(4))].map((x) => x.toString(16).padStart(2, '0')).join('')}-${nm}`;
      await env.PERMITS.put(key, await f.arrayBuffer(), { httpMetadata: { contentType: FILE_TYPES[ext] } });
      saved.push({ key, name: nm, size: f.size });
    }
    await env.DB.prepare('UPDATE site_news SET files=? WHERE id=?').bind(JSON.stringify(saved), id).run();
  }
  return pj({ ok: true, message: 'תודה! העדכון נשלח, ויפורסם אחרי אישור.' });
}

export async function onRequestPost({ request, env }) {
  const b = await readBody(request);
  if (!b) return json({ ok: false, error: 'bad_json' }, 400);
  if (b.submit) return submit(request, env, b);
  if (!(await checkAdmin(request, env))) return json({ ok: false, error: 'Unauthorized' }, 401);
  await ensureTable(env);
  const id = Number(b.id) || 0;
  if (b.action === 'settings') {
    const cur = await settings(env), keys = ['co_days', 'bond_days', 'tag_co_days', 'tag_bond_days'], next = {};
    for (const k of keys) { next[k] = b[k] == null ? cur[k] : days(b[k], 0); if (!next[k]) return json({ ok: false, error: 'נא לבחור בין יום אחד ל-365 ימים' }, 400); }
    await env.DB.prepare(META).run();
    await env.DB.batch(keys.map((k) => env.DB.prepare('INSERT INTO site_news_meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').bind(k, String(next[k]))));
    return json({ ok: true, settings: next });
  }
  if (b.action === 'approve') {
    if (!id) return json({ ok: false, error: 'missing id' }, 400);
    await env.DB.prepare("UPDATE site_news SET pending=0, active=1, start_date=CASE WHEN COALESCE(start_date,'')='' THEN date('now') ELSE start_date END, updated_at=datetime('now') WHERE id=?").bind(id).run();
    return json({ ok: true });
  }
  const text = clean(b.text, 400), title = clean(b.title, 120), link = clean(b.link, 500), cat = CATS.includes(b.cat) ? b.cat : 'other';
  const date = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) ? String(s) : '');
  if (!text) return json({ ok: false, error: 'חסר נוסח העדכון' }, 400);
  if (link && !/^https?:\/\//i.test(link)) return json({ ok: false, error: 'הקישור צריך להתחיל ב-https://' }, 400);
  const vals = [cat, title, text, link, date(b.start_date), date(b.end_date), b.pinned ? 1 : 0, b.active === false || b.active === 0 ? 0 : 1];
  if (id) {
    const pend = b.approve ? ', pending=0' : '';          // "שמירה ואישור" לעדכון שנשלח מהאתר
    await env.DB.prepare(`UPDATE site_news SET cat=?, title=?, text=?, link=?, start_date=?, end_date=?, pinned=?, active=?${pend}, updated_at=datetime('now') WHERE id=?`).bind(...vals, id).run();
  } else await env.DB.prepare('INSERT INTO site_news (cat, title, text, link, start_date, end_date, pinned, active) VALUES (?,?,?,?,?,?,?,?)').bind(...vals).run();
  return json({ ok: true });
}

export async function onRequestDelete({ request, env }) {
  if (!(await checkAdmin(request, env))) return json({ ok: false, error: 'Unauthorized' }, 401);
  const id = Number(new URL(request.url).searchParams.get('id')) || 0;
  if (!id) return json({ ok: false, error: 'missing id' }, 400);
  try {
    const r = await env.DB.prepare('SELECT files FROM site_news WHERE id=?').bind(id).first();
    if (r && env.PERMITS) for (const f of filesOf(r)) { try { await env.PERMITS.delete(f.key); } catch {} }          // גם הקבצים המצורפים
    await env.DB.prepare('DELETE FROM site_news WHERE id=?').bind(id).run();
  } catch {}
  return json({ ok: true });
}
