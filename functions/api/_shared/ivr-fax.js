// ============================================================================
//  functions/api/_shared/ivr-fax.js — שליחת שטר היתר העסקה בפקס מהקו הטלפוני (ivr-company.js)
//
//  ספק הפקס: שחקים (shchakim.live). בקשת POST אחת (multipart): api_key, recipient_fax, pdf_file.
//  סודות / הגדרות (Cloudflare Pages -> Settings -> Variables and Secrets):
//    FAX_API_KEY     (סוד, חובה)  מפתח ה-API מחברת הפקס. בלעדיו האפשרות לא מוצעת בטלפון בכלל.
//    FAX_API_URL     (רשות)       ברירת מחדל https://shchakim.live/shch/api/ApiSendFaxShchakim
//    FAX_DAILY_MAX   (רשות)       כמה פקסים ביום בסך הכול (ברירת מחדל 50)
//    FAX_OFF=1       (רשות)       כיבוי זמני בלי למחוק את המפתח
//  מגבלות: עד 3 פקסים לשיחה, עד 5 ביום לאותו מספר פקס, ו-FAX_DAILY_MAX ביום בסך הכול.
//  רק שטרות שמוצגים באתר (_shared/permit-links.js): השטר של החברה, שטרות מיוחדים, שטרות לאג"ח ותתי-שורות.
//  כל שליחה נרשמת בטבלה ivr_fax_log (נוצרת לבד): מתי, ח.פ., איזה שטר, מספר הפקס, המתקשר, התוצאה.
// ============================================================================

const DEFAULT_URL = 'https://shchakim.live/shch/api/ApiSendFaxShchakim';
const PER_CALL = 3, PER_FAX_DAY = 5, DAILY_DEFAULT = 50;

export const faxEnabled = (env) => !!String(env.FAX_API_KEY || '').trim() && String(env.FAX_OFF || '') !== '1' && !!env.PERMITS;

// מספר פקס ישראלי: 0 ואחריו 8-9 ספרות (02-1234567, 072-1234567, 153-...). מחזיר ספרות בלבד או ''.
export function normFax(s) {
  const d = String(s || '').replace(/\D/g, '');
  if (/^0\d{8,9}$/.test(d)) return d;
  if (/^153\d{7,8}$/.test(d)) return d;                 // קידומת 153 (פקס לטלפון): ספק הפקס מקבל כמו שהוא
  if (/^972\d{8,9}$/.test(d)) return '0' + d.slice(3);
  return '';
}

import { publicLinks } from './permit-links.js';

// כל השטרות הציבוריים של החברה - אותה רשימה שמוצגת באתר (_shared/permit-links.js), במטמון לדקה
let LINKS = { at: 0, list: null };
export const clearLinksCache = () => { LINKS = { at: 0, list: null }; };          // לבדיקות
async function linksOf(env) {
  if (LINKS.list && Date.now() - LINKS.at < 60000) return LINKS.list;
  let list = [];
  try { list = await publicLinks(env); } catch { /* לפני טבלאות המסמכים */ }
  LINKS = { at: Date.now(), list };
  return list;
}

/** השטרות של החברה לפי הח.פ., בסדר ההקראה, כל שטר פעם אחת: [{ id, label }]
 *  1. השטר של החברה (כללי + פרטי בנפרד כשיש שניהם), 2. שטרות מיוחדים, 3. שטרות לאג"ח, 4. תתי-שורות (למשל "מסלול הלכה"), כל אחת באותו סדר. */
export async function docListFor(env, chp) {
  const k = String(chp || '').trim().replace(/^0+/, '');
  if (!k) return [];
  const mine = (await linksOf(env)).filter((l) => String(l.chp || '').trim().replace(/^0+/, '') === k);
  const out = [], seen = new Set();
  const add = (id, label) => { if (id && !seen.has(String(id))) { seen.add(String(id)); out.push({ id: String(id), label }); } };
  const entry = (l, of) => {
    if (l.general && l.private && l.general !== l.private) { add(l.general, `לשטר היתר העסקה הכללי של ${of}`); add(l.private, `לשטר היתר העסקה הפרטי של ${of}`); }
    else add(l.general || l.private, `לשטר של ${of}`);
    for (const x of l.specials || []) add(x.id, `לשטר ${x.title}${l.sub ? ` של ${of}` : ''}`);
    for (const x of l.bond_docs || []) add(x.id, `לשטר ל${x.label}${l.sub ? ` של ${of}` : ''}`);
  };
  const main = mine.find((l) => !l.sub);
  if (main) entry(main, 'החברה');
  for (const l of mine.filter((x) => x.sub)) entry(l, String(l.sub));
  return out;
}

// ---- מצב לשיחה (מה הוקרא בכל סבב), כי ימות לא מחזירה את התוצאות עצמן ----
const STATE = 'CREATE TABLE IF NOT EXISTS ivr_fax_state (call_id TEXT NOT NULL, r INTEGER NOT NULL, data TEXT NOT NULL, at TEXT DEFAULT (datetime(\'now\')), PRIMARY KEY (call_id, r))';
export async function saveState(env, callId, r, data) {
  if (!callId) return;
  try {
    await env.DB.prepare(STATE).run();
    await env.DB.prepare('INSERT INTO ivr_fax_state (call_id, r, data) VALUES (?, ?, ?) ON CONFLICT(call_id, r) DO UPDATE SET data = excluded.data, at = datetime(\'now\')').bind(callId, r, JSON.stringify(data)).run();
    if (Math.random() < 0.05) await env.DB.prepare("DELETE FROM ivr_fax_state WHERE at < datetime('now','-2 days')").run();          // ניקוי מדי פעם
  } catch (e) { console.log(`ivr-fax state save: ${e && e.message}`); }
}
export async function loadState(env, callId, r) {
  try { const x = await env.DB.prepare('SELECT data FROM ivr_fax_state WHERE call_id = ? AND r = ?').bind(callId, r).first(); return x ? JSON.parse(x.data) : null; } catch { return null; }
}

// ---- יומן ומגבלות ----
const LOG = `CREATE TABLE IF NOT EXISTS ivr_fax_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT DEFAULT (datetime('now')), call_id TEXT, slot TEXT, caller TEXT,
  fax TEXT, chp TEXT, company TEXT, kind TEXT, doc_id TEXT, status TEXT DEFAULT 'pending', response TEXT DEFAULT '')`;

/** בודק מגבלות ורושם שליחה חדשה. מחזיר {id} לשליחה, {dup:true} אם כבר נרשמה (ימות שלחה שוב את אותה בקשה), או {limit:true}. */
export async function reserve(env, { callId, slot, caller, fax, chp, company, kind, docId }) {
  await env.DB.prepare(LOG).run();
  const dup = await env.DB.prepare('SELECT id FROM ivr_fax_log WHERE call_id = ? AND slot = ?').bind(callId, slot).first();
  if (dup) return { dup: true };
  const n = (sql, ...a) => (a.length ? env.DB.prepare(sql).bind(...a) : env.DB.prepare(sql)).first().then((x) => (x ? x.n : 0));
  const daily = Math.max(1, parseInt(env.FAX_DAILY_MAX, 10) || DAILY_DEFAULT);
  if (await n("SELECT COUNT(*) AS n FROM ivr_fax_log WHERE call_id = ? AND status != 'failed'", callId) >= PER_CALL) return { limit: true };
  if (await n("SELECT COUNT(*) AS n FROM ivr_fax_log WHERE fax = ? AND at >= datetime('now','-1 day') AND status != 'failed'", fax) >= PER_FAX_DAY) return { limit: true };
  if (await n("SELECT COUNT(*) AS n FROM ivr_fax_log WHERE at >= datetime('now','-1 day') AND status != 'failed'") >= daily) return { limit: true };
  const res = await env.DB.prepare('INSERT INTO ivr_fax_log (call_id, slot, caller, fax, chp, company, kind, doc_id) VALUES (?,?,?,?,?,?,?,?)')
    .bind(callId, slot, caller || '', fax, chp || '', company || '', kind || '', String(docId)).run();
  return { id: res && res.meta && res.meta.last_row_id };
}

/** שליחת השטר בפקס (ברקע, אחרי שהמתקשר כבר שמע "נשלח"). התוצאה נרשמת ביומן. */
export async function sendFax(env, logId, docId, fax) {
  let status = 'failed', response = '';
  try {
    const row = await env.DB.prepare('SELECT file_key, original_name FROM permit_docs WHERE id = ?').bind(docId).first();
    if (!row) throw new Error('document not found');
    // גרסת הפקס (docs-fax/, שחור-לבן חד 300dpi - scripts/fax_permit_pdfs.py) אם קיימת; אחרת הגרסה הקלה (docs-lite/), אחרת המקור
    const rel = row.file_key.startsWith('docs/') ? row.file_key.slice(5) : row.file_key;
    const obj = (await env.PERMITS.get('docs-fax/' + rel).catch(() => null)) || (await env.PERMITS.get('docs-lite/' + rel).catch(() => null)) || (await env.PERMITS.get(row.file_key));
    if (!obj) throw new Error('file missing in storage');
    const fd = new FormData();
    fd.append('api_key', String(env.FAX_API_KEY).trim());
    fd.append('recipient_fax', fax);
    fd.append('pdf_file', new Blob([await obj.arrayBuffer()], { type: 'application/pdf' }), String(row.original_name || 'permit.pdf').replace(/[^\w.\-]+/g, '_') || 'permit.pdf');
    const res = await fetch(env.FAX_API_URL || DEFAULT_URL, { method: 'POST', body: fd });
    response = (await res.text()).slice(0, 500);
    // התשובה של הספק לא מתועדת: הצלחה = HTTP תקין ובלי מילת שגיאה בתשובה
    status = res.ok && !/error|fail|invalid|שגיאה|נכשל/i.test(response) ? 'sent' : 'failed';
  } catch (e) { response = String(e && e.message || e).slice(0, 500); }
  try { await env.DB.prepare('UPDATE ivr_fax_log SET status = ?, response = ? WHERE id = ?').bind(status, response, logId).run(); } catch { /* ignore */ }
  console.log(`ivr-fax ${logId}: ${status}`);
  return status;
}
