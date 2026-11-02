// ============================================================================
//  functions/api/join-email.js — הצטרפות להיתר עיסקא פרטי במייל
//
//  מיילים שנשלחים לכתובת ההצטרפות מגיעים לכאן מ-CloudMailin (POST, פורמט JSON - Normalized).
//    1. מייל עם המילה "הצטרפות" בכותרת (ובלי טופס ממולא) -> תשובה אוטומטית: הסבר, טופס למילוי ונוסח השטר המלא.
//    2. תשובה עם הטופס ממולא -> בדיקה. חסר / שגוי -> תשובה עם מה שחסר (והטופס עם מה שכבר מולא).
//       תקין -> נשמר ברשימת המצטרפים (src = email, אותה הצפנה כמו הטופס באתר) ונשלח מייל אישור.
//    3. כל מייל אחר (למשל קוד אימות של העברה מ-Gmail) -> מועבר למכון (JOIN_EMAIL_ADMIN).
//  השליחה דרך וורדפרס (WP_MAIL_URL), עם Reply-To לכתובת ההצטרפות (JOIN_EMAIL_REPLY_TO), כדי שהתשובות יחזרו לכאן.
//  אישור השטר: המילה "מאשר" בשורת "אישור השטר" (טעון אישור המכון).
//  הגנה: Authorization header (Bearer <סוד> או Basic עם הסיסמה) = JOIN_EMAIL_SECRET; עד 6 תשובות לשולח ביום, 300 ביום בסך הכול.
//  בלוגים לא נרשם שום פרט אישי.
// ============================================================================
import { sendMail, sendConfirmation, saveConfirmationFile, CANCEL_NOTIFY_TO } from './_shared/join-mail.js';
import { AGREEMENT_BEFORE_CHOICE, AGREEMENT_AFTER_CHOICE } from './_shared/agreement.js';
import { importKeyForWrite, encryptPii, identHash } from './_shared/joiners-crypto.js';
import { normalizeId, normalizePhone, validEmail, clean, jerusalemNow, newRowId } from './_shared/join-common.js';

const AGREEMENT_VERSION = 'מייל-1';
const PER_SENDER_DAY = 6, ALL_DAY = 300;

// שורות הטופס: [מפתח, כותרת השורה, חובה]
export const FIELDS = [
  ['first', 'שם פרטי', true], ['last', 'שם משפחה', true], ['id', 'תעודת זהות', true],
  ['phone', 'טלפון', true], ['phone2', 'טלפון נוסף', false],
  ['city', 'עיר', true], ['street', 'רחוב', true], ['house', 'מספר בית', false], ['fax', 'פקס', false],
  ['companies', 'בחירת חברות', true], ['approve', 'אישור השטר', true],
];
const APPROVE_RE = /מאשר|מאשרת/;

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const ok = (body = 'ok', status = 200) => new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });

export function authOk(request, env) {
  const s = String(env.JOIN_EMAIL_SECRET || '').trim();
  if (!s) return false;
  const h = String(request.headers.get('authorization') || '').trim();
  if (/^bearer\s+/i.test(h)) return h.replace(/^bearer\s+/i, '').trim() === s;
  if (/^basic\s+/i.test(h)) {
    try { const d = atob(h.replace(/^basic\s+/i, '').trim()); return d.slice(d.indexOf(':') + 1) === s; } catch { return false; }
  }
  return false;
}

// כותרת מהמייל (CloudMailin: headers.{subject,from,reply_to,...}; לא תלוי באותיות גדולות / מקפים)
function header(msg, name) {
  const want = name.toLowerCase().replace(/[-_]/g, '');
  for (const [k, val] of Object.entries((msg && msg.headers) || {})) {
    if (k.toLowerCase().replace(/[-_]/g, '') === want) return Array.isArray(val) ? String(val[0] || '') : String(val || '');
  }
  return '';
}
export function addressOf(raw) {
  const s = String(raw || ''), m = s.match(/<([^<>\s]+@[^<>\s]+)>/);
  const a = (m ? m[1] : s.split(',')[0]).trim().replace(/^mailto:/i, '').toLowerCase();
  return validEmail(a) ? a : '';
}
const htmlToText = (h) => String(h || '').replace(/<(br|\/p|\/div|\/li|\/tr|\/h\d)[^>]*>/gi, '\n').replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

// קריאת הטופס מגוף המייל: "כותרת: ערך" בכל שורה (גם בתוך ציטוט, עם >). הערך הראשון שאינו ריק קובע
// (כך טופס ממולא מעל הציטוט גובר על הטופס הריק שבציטוט).
export function parseForm(text) {
  const out = {};
  for (let line of String(text || '').split(/\r?\n/)) {
    line = line.replace(/[‎‏‪-‮⁦-⁩]/g, '').replace(/^[\s>]+/, '').replace(/\*/g, '');
    for (const [k, label] of FIELDS) {
      if (out[k]) continue;
      const m = line.match(new RegExp(`^${reEsc(label)}\\s*[:：]\\s*(.*)$`));
      if (m && m[1].trim()) out[k] = m[1].trim();
    }
  }
  return out;
}

export function checkForm(f) {
  const errors = [], v = {};
  v.first = clean(f.first, 40); v.last = clean(f.last, 40);
  v.id = normalizeId(f.id || ''); v.phone = normalizePhone(f.phone || ''); v.phone2 = f.phone2 ? normalizePhone(f.phone2) : '';
  v.city = clean(f.city, 60); v.street = clean(f.street, 80); v.house = clean(f.house, 12); v.fax = clean(f.fax, 30);
  const comp = clean(f.companies, 2000);
  v.all = /^כל(\s|$)|כל החברות/.test(comp);
  v.companies = v.all ? [] : [...new Set(comp.split(/\s*[,،;]\s*/).map((c) => clean(c, 120)).filter(Boolean))].slice(0, 300);
  v.approve = clean(f.approve, 60);
  if (v.first.length < 2) errors.push('שם פרטי');
  if (v.last.length < 2) errors.push('שם משפחה');
  if (!v.id) errors.push(f.id ? 'תעודת זהות (המספר אינו תקין)' : 'תעודת זהות');
  if (!v.phone) errors.push(f.phone ? 'טלפון (המספר אינו תקין)' : 'טלפון');
  if (f.phone2 && !v.phone2) errors.push('טלפון נוסף (המספר אינו תקין)');
  if (v.city.length < 2) errors.push('עיר');
  if (v.street.length < 2) errors.push('רחוב');
  if (!v.all && !v.companies.length) errors.push('בחירת חברות ("כל החברות" או שמות החברות)');
  if (!APPROVE_RE.test(v.approve)) errors.push('אישור השטר (יש לכתוב "מאשר")');
  return { errors, v };
}

// ---- המייל שנשלח: הסבר, טופס ונוסח השטר ----
function formMail({ values = {}, errors = [] } = {}) {
  const p = (t, st = '') => `<p style="margin:0 0 8px;font-size:15px;line-height:1.6;${st}">${esc(t)}</p>`;
  const lines = FIELDS.map(([k, label]) => `<div style="font-size:16px;line-height:2">${esc(label)}: ${esc(values[k] || '')}</div>`).join('');
  const errBox = errors.length ? `<div style="background:#fdecea;border:1px solid #e0a39c;border-radius:6px;padding:10px 14px;margin:0 0 14px">
<b>הטופס לא נקלט. חסר או שגוי:</b><ul style="margin:6px 0 0">${errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div>` : '';
  const html = `<!doctype html><html lang="he" dir="rtl"><body style="margin:0;background:#eef2f2;font-family:Arial,Helvetica,sans-serif;color:#1f2d2d">
<div dir="rtl" style="max-width:660px;margin:0 auto;padding:16px"><div style="background:#fff;border:2px solid #1b6b52;border-radius:6px;padding:20px 22px">
<h2 style="margin:0 0 12px;color:#1b6b52">הצטרפות להיתר עיסקא פרטי - מכון היתר עיסקא למהדרין</h2>
${errBox}
${p('להצטרפות: השיבו למייל זה (השב / Reply), מלאו את הפרטים אחרי הנקודתיים בכל שורה, ושלחו.')}
${p('בשורה "בחירת חברות" כתבו "כל החברות" (כל החברות שנרשמו ושיירשמו בהמשך), או את שמות החברות, מופרדים בפסיק.')}
${p('בשורה "אישור השטר" כתבו "מאשר", לאחר קריאת נוסח שטר הרישום המלא שלמטה. זהו האישור על כל תנאי השטר.')}
${p('טלפון נוסף, מספר בית ופקס - לא חובה. כל השאר חובה.', 'color:#555')}
<div style="border:1px dashed #1b6b52;border-radius:6px;padding:10px 16px;margin:12px 0 16px;background:#f7fbf9">${lines}</div>
<div style="border-top:1px solid #cfdcdc;padding-top:12px"><h3 style="margin:0 0 8px">שטר רישום להיתר עיסקא פרטי</h3>
${AGREEMENT_BEFORE_CHOICE.map((t) => p(t)).join('')}${p('[לבחירת כל החברות שנרשמו וירשמו בהמשך / לבחירה מתוך רשימה - לפי מה שנכתב בשורה "בחירת חברות"]', 'color:#555')}${AGREEMENT_AFTER_CHOICE.map((t) => p(t)).join('')}</div>
<p style="margin:14px 0 0;font-size:14px;color:#34504a;text-align:center"><b>מכון היתר עיסקא למהדרין</b> · טלפון: <span dir="ltr">052-7117041</span></p>
</div></div></body></html>`;
  const text = [
    'הצטרפות להיתר עיסקא פרטי - מכון היתר עיסקא למהדרין', '',
    ...(errors.length ? ['הטופס לא נקלט. חסר או שגוי:', ...errors.map((e) => '- ' + e), ''] : []),
    'להצטרפות: השיבו למייל זה, מלאו את הפרטים אחרי הנקודתיים בכל שורה, ושלחו.',
    'בשורה "בחירת חברות" כתבו "כל החברות", או את שמות החברות מופרדים בפסיק.',
    'בשורה "אישור השטר" כתבו "מאשר", לאחר קריאת נוסח השטר המלא שלמטה.', '',
    ...FIELDS.map(([k, label]) => `${label}: ${values[k] || ''}`), '',
    'שטר רישום להיתר עיסקא פרטי', ...AGREEMENT_BEFORE_CHOICE, ...AGREEMENT_AFTER_CHOICE,
  ].join('\n');
  return { html, text };
}

// ---- הגבלת כמות תשובות ----
let logReady = false;
async function underLimit(env, sender) {
  try {
    if (!logReady) { await env.DB.prepare('CREATE TABLE IF NOT EXISTS join_email_log (day TEXT, who TEXT, n INTEGER, PRIMARY KEY (day, who))').run(); logReady = true; }
    const day = jerusalemNow().slice(0, 10);
    const who = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(sender)))].map((x) => x.toString(16).padStart(2, '0')).join('').slice(0, 32);
    const get = async (w) => ((await env.DB.prepare('SELECT n FROM join_email_log WHERE day = ? AND who = ?').bind(day, w).first()) || {}).n || 0;
    if ((await get(who)) >= PER_SENDER_DAY || (await get('*')) >= ALL_DAY) return false;
    for (const w of [who, '*']) await env.DB.prepare('INSERT INTO join_email_log (day, who, n) VALUES (?, ?, 1) ON CONFLICT(day, who) DO UPDATE SET n = n + 1').bind(day, w).run();
    await env.DB.prepare('DELETE FROM join_email_log WHERE day < ?').bind(jerusalemNow(new Date(Date.now() - 3 * 86400000)).slice(0, 10)).run();
    return true;
  } catch { return true; }
}

const replyTo = (env) => addressOf(env.JOIN_EMAIL_REPLY_TO || '');
const isAutomatic = (msg, sender) => /^(mailer-daemon|postmaster|no-?reply|bounce)/i.test(sender) || /^wordpress@/i.test(sender)
  || /auto-(replied|generated)/i.test(header(msg, 'auto_submitted')) || /bulk|junk|list/i.test(header(msg, 'precedence'));

export async function onRequestPost({ request, env }) {
  if (!authOk(request, env)) return ok('unauthorized', 403);
  let msg;
  try { msg = await request.json(); } catch { return ok('bad request', 400); }
  const subject = header(msg, 'subject');
  const sender = addressOf(header(msg, 'reply_to')) || addressOf(header(msg, 'from')) || addressOf(msg.envelope && msg.envelope.from);
  const body = msg.plain || htmlToText(msg.html);
  const fields = parseForm(body);
  const filled = Object.keys(fields).length >= 3;
  try {
    if (!filled && !/הצטרפות/.test(subject)) {             // לא בקשת הצטרפות: מועבר למכון (למשל קוד אימות של העברה מ-Gmail)
      await sendMail(env, {
        to: env.JOIN_EMAIL_ADMIN || CANCEL_NOTIFY_TO, subject: `מייל שהתקבל בכתובת ההצטרפות: ${clean(subject, 120)}`,
        html: `<div dir="rtl" style="font-family:Arial,sans-serif"><p><b>מאת:</b> <span dir="ltr">${esc(header(msg, 'from'))}</span><br><b>נושא:</b> ${esc(subject)}</p><pre style="white-space:pre-wrap;font-family:inherit" dir="auto">${esc(String(body).slice(0, 20000))}</pre></div>`,
        text: `מאת: ${header(msg, 'from')}\nנושא: ${subject}\n\n${String(body).slice(0, 20000)}`,
      });
      return ok('forwarded');
    }
    if (!sender || isAutomatic(msg, sender)) return ok('ignored');
    if (!(await underLimit(env, sender))) return ok('limited');

    if (!filled) {                                           // בקשה ראשונה: שולחים את הטופס
      const m = formMail();
      await sendMail(env, { to: sender, subject: 'הצטרפות להיתר עיסקא פרטי - טופס למילוי', ...m, replyTo: replyTo(env) });
      return ok('form sent');
    }
    const { errors, v } = checkForm(fields);
    if (errors.length) {
      const m = formMail({ values: fields, errors });
      await sendMail(env, { to: sender, subject: 'הצטרפות להיתר עיסקא פרטי - חסרים פרטים', ...m, replyTo: replyTo(env) });
      return ok('missing');
    }
    await save(env, v, sender, header(msg, 'message_id'), new URL(request.url).origin);
    return ok('saved');
  } catch (e) {
    console.log(`join-email error: ${e && e.message}`);        // בלי פרטים אישיים
    return ok('error', 500);                                 // CloudMailin ינסה שוב
  }
}

async function save(env, v, email, messageId, origin) {
  const key = await importKeyForWrite(env);
  const ih = await identHash(env, v.id);
  const recent = await env.DB.prepare('SELECT id FROM joiners WHERE ident_hash = ? AND submitted_at >= ? LIMIT 1')
    .bind(ih, jerusalemNow(new Date(Date.now() - 3 * 60000))).first();
  if (recent) return;
  const rid = newRowId(), now = jerusalemNow();
  const address = [[v.street, v.house].filter(Boolean).join(' '), v.city].filter(Boolean).join(', ');
  const extra = {
    'ערוץ': 'מייל',
    ...(v.phone2 ? { 'טלפון נוסף': v.phone2 } : {}),
    ...(v.fax ? { 'פקס': v.fax } : {}),
    'כתובת': address, 'עיר': v.city, 'רחוב': v.street, ...(v.house ? { 'מספר בית': v.house } : {}),
    'גרסת שטר': AGREEMENT_VERSION,
    'אושרו התנאים': `כן (במייל חוזר: "${v.approve}")`,
    ...(messageId ? { 'מזהה הודעה': clean(messageId, 200) } : {}),
  };
  const payload = {
    first: v.first, last: v.last, phone: v.phone, email, id: v.id, ip: '',
    companies: v.companies.join(', '), all: v.all ? 'כן' : '',
    pdf: '', extra: JSON.stringify(extra), src: 'email',
  };
  const conf = { first: v.first, last: v.last, id: v.id, date: now.slice(0, 10).split('-').reverse().join('/'), all: v.all, companies: v.companies, origin };
  const sha = await saveConfirmationFile(env, conf);
  await env.DB.prepare("INSERT INTO joiners (id, submitted_at, cancelled_at, file_sha256, ident_hash, pii) VALUES (?, ?, '', ?, ?, ?)")
    .bind(rid, now, sha, ih, await encryptPii(key, rid, payload)).run();
  await sendConfirmation(env, email, conf);
}
