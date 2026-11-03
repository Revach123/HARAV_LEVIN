// ============================================================================
//  functions/api/join-email.js — הצטרפות להיתר עיסקא פרטי במייל
//
//  מיילים שנשלחים לכתובת ההצטרפות מגיעים לכאן מ-CloudMailin (POST, פורמט JSON - Normalized).
//    1. מייל עם המילה "הצטרפות" בכותרת (ובלי טופס ממולא) -> תשובה אוטומטית אחת ובה הכל: טופס עם שדות קבועים
//       (ליד כל שדה מה מותר בו), כפתור שפותח תשובה עם הטופס מוכן למילוי, רשימת החברות הממוספרת ונוסח השטר המלא.
//    2. הטופס ממולא -> בדיקה. חסר / שגוי -> תשובה עם מה שחסר (והטופס עם מה שכבר מולא).
//       תקין -> נשמר ברשימת המצטרפים (src = email, אותה הצפנה כמו הטופס באתר) ונשלח מייל אישור.
//    3. קוד אימות של העברה מ-Gmail -> לתיבת ה-Gmail שביקשה את ההעברה. כל מייל אחר -> מועבר למכון (JOIN_EMAIL_ADMIN).
//  חברות: "כל החברות", או מספרים מהרשימה שבמייל (או שמות). הרשימה נשמרת לפי "קוד רשימה" (שורה בטופס), כך שמספרים
//  ממייל ישן מתפרשים לפי הרשימה שנשלחה בו גם אם הרשימה השתנתה מאז (טבלה join_email_lists).
//  השליחה דרך וורדפרס (WP_MAIL_URL), עם Reply-To לכתובת ההצטרפות (JOIN_EMAIL_REPLY_TO), כדי שהתשובות יחזרו לכאן.
//  אישור השטר: המילה "מאשר" בשורת "אישור השטר" (טעון אישור המכון).
//  הגנה: Authorization header (Bearer <סוד> או Basic עם הסיסמה) = JOIN_EMAIL_SECRET; עד 6 תשובות לשולח ביום, 300 ביום בסך הכול.
//  בלוגים לא נרשם שום פרט אישי.
// ============================================================================
import { sendMail, sendConfirmation, saveConfirmationFile, CANCEL_NOTIFY_TO } from './_shared/join-mail.js';
import { DEFAULT_LONG, getAgreement, isBold, plain } from './_shared/agreement.js';
import { importKeyForWrite, encryptPii, identHash } from './_shared/joiners-crypto.js';
import { normalizeId, normalizePhone, validEmail, clean, jerusalemNow, newRowId } from './_shared/join-common.js';
import { onRequestGet as listsGet } from './lists.js';
import { buildAmp, makeToken } from './_shared/join-amp.js';

const AGREEMENT_VERSION = 'מייל-1';
const PER_SENDER_DAY = 6, ALL_DAY = 300;

// שורות הטופס: [מפתח, כותרת, הנחיה (בסוגריים, לפני הנקודתיים), חובה]. הקריאה לפי הכותרת; ההנחיה לא חובה בתשובה.
export const FIELDS = [
  ['first', 'שם פרטי', '', true],
  ['last', 'שם משפחה', '', true],
  ['id', 'תעודת זהות', '9 ספרות', true],
  ['phone', 'טלפון', 'למשל 0501234567', true],
  ['phone2', 'טלפון נוסף', 'לא חובה', false],
  ['city', 'עיר', '', true],
  ['street', 'רחוב', '', true],
  ['house', 'מספר בית', 'לא חובה', false],
  ['fax', 'פקס', 'לא חובה', false],
  ['companies', 'חברות', 'כל החברות, או מספרים מהרשימה שלמטה מופרדים בפסיק', true],
  ['approve', 'אישור השטר', 'כתבו: מאשר', true],
  ['list', 'קוד רשימה', 'לא לשנות', false],
];
const ALIASES = { companies: ['בחירת חברות'] };
const APPROVE_RE = /מאשר|מאשרת/;
const lineOf = ([, label, hint]) => `${label}${hint ? ` (${hint})` : ''}:`;

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const ok = (body = 'ok', status = 200) => new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });

// '' = מאושר; אחרת הסיבה (מוצגת ב-CloudMailin, בלי לחשוף את הסיסמה)
export function authProblem(request, env) {
  const s = String(env.JOIN_EMAIL_SECRET || '').trim();
  if (!s) return 'the site has no JOIN_EMAIL_SECRET (Cloudflare: add it to Production, then Retry deployment)';
  const h = String(request.headers.get('authorization') || '').trim();
  if (!h) return 'no Authorization header (CloudMailin: set username and password on the address page)';
  let given = null;
  if (/^bearer\s+/i.test(h)) given = h.replace(/^bearer\s+/i, '').trim();
  else if (/^basic\s+/i.test(h)) { try { const d = atob(h.replace(/^basic\s+/i, '').trim()); given = d.slice(d.indexOf(':') + 1).trim(); } catch { given = null; } }
  else if (/^(token|key)\s+/i.test(h)) given = h.replace(/^(token|key)\s+/i, '').trim();
  else if (!/\s/.test(h)) given = h;                                       // הסיסמה עצמה, בלי סוג
  if (given == null) return 'unsupported Authorization header (use Basic, Bearer, or just the password)';
  if (given !== s) return `password does not match JOIN_EMAIL_SECRET (lengths: sent ${given.length}, site ${s.length})`;
  return '';
}
export const authOk = (request, env) => !authProblem(request, env);

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

// קריאת הטופס מגוף המייל: "כותרת (הנחיה): ערך" בכל שורה (גם בתוך ציטוט, עם >). הערך הראשון שאינו ריק קובע
// (כך טופס ממולא מעל הציטוט גובר על הטופס הריק שבציטוט).
export function parseForm(text) {
  const out = {};
  const pats = FIELDS.map(([k, label]) => [k, new RegExp(`^(?:${[label, ...(ALIASES[k] || [])].map(reEsc).join('|')})\\s*(?:\\([^)]*\\))?\\s*[:：]\\s*(.*)$`)]);
  for (let line of String(text || '').split(/\r?\n/)) {
    line = line.replace(/[‎‏‪-‮⁦-⁩]/g, '').replace(/^[\s>]+/, '').replace(/\*/g, '');
    for (const [k, re] of pats) {
      if (out[k]) continue;
      const m = line.match(re);
      if (m && m[1].trim()) out[k] = m[1].trim();
    }
  }
  return out;
}

// ---- רשימת החברות (כמו בטופס באתר: /api/lists?type=companies-private) ושמירתה לפי קוד ----
const normName = (s) => String(s || '').replace(/בע"?מ|בע״מ|בע''מ/g, '').replace(/[^0-9a-zא-ת]/gi, '').toLowerCase();
async function currentCompanies(env, origin) {
  const res = await listsGet({ request: new Request(`${origin}/api/lists?type=companies-private`), env });
  const j = await res.json();
  return [...new Set((j.rows || []).map((r) => String(r.permit_name || '').replace(/\s+/g, ' ').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'he'));
}
let listReady = false;
async function listTable(env) {
  if (!listReady) { await env.DB.prepare('CREATE TABLE IF NOT EXISTS join_email_lists (code TEXT PRIMARY KEY, names TEXT, at INTEGER)').run(); listReady = true; }
}
async function codeOf(names) {
  const h = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(names.join('\n'))))];
  return String(h.slice(0, 4).reduce((n, b) => n * 256 + b, 0) % 9000000 + 1000000);          // 7 ספרות
}
/** הרשימה העדכנית + הקוד שלה (נשמרת בטבלה כדי לפרש מספרים בתשובה מאוחרת) */
export async function companyList(env, origin) {
  const names = await currentCompanies(env, origin), code = await codeOf(names);
  try {
    await listTable(env);
    await env.DB.prepare('INSERT OR IGNORE INTO join_email_lists (code, names, at) VALUES (?, ?, ?)').bind(code, JSON.stringify(names), Date.now()).run();
  } catch { /* בלי שמירה: מספרים יתפרשו לפי הרשימה העדכנית */ }
  return { names, code };
}
export async function listByCode(env, origin, code) {
  if (/^\d{7}$/.test(String(code || ''))) {
    try {
      await listTable(env);
      const r = await env.DB.prepare('SELECT names FROM join_email_lists WHERE code = ?').bind(String(code)).first();
      if (r) return { names: JSON.parse(r.names), code: String(code) };
    } catch { /* נופלים לרשימה העדכנית */ }
  }
  return companyList(env, origin);
}

/** "כל החברות" / מספרים / שמות -> { all, companies, bad } */
export function pickCompanies(value, names) {
  const v = clean(value, 3000);
  if (/^כל(\s|$)|כל החברות/.test(v)) return { all: true, companies: [], bad: [] };
  const out = [], bad = [];
  for (const tok of v.split(/\s*[,،;\n]\s*/).map((t) => t.trim()).filter(Boolean)) {
    const nums = tok.match(/^\d+(\s+\d+)*$/) ? tok.split(/\s+/) : null;          // "3 17 42" גם בלי פסיקים
    if (nums) {
      for (const n of nums) { const x = names[Number(n) - 1]; if (x) out.push(x); else bad.push(`מספר ${n} אינו ברשימה`); }
      continue;
    }
    const t = normName(tok);
    const exact = names.filter((n) => normName(n) === t), part = t.length >= 3 ? names.filter((n) => normName(n).includes(t)) : [];
    const hit = exact.length === 1 ? exact : part.length === 1 ? part : [];
    if (hit.length) out.push(hit[0]); else bad.push(`"${tok}" ${part.length > 1 ? 'מתאים לכמה חברות - נא לכתוב את המספר' : 'לא נמצא ברשימה'}`);
  }
  return { all: false, companies: [...new Set(out)].slice(0, 300), bad };
}

export function checkForm(f, names) {
  const errors = [], v = {};
  v.first = clean(f.first, 40); v.last = clean(f.last, 40);
  v.id = normalizeId(f.id || ''); v.phone = normalizePhone(f.phone || ''); v.phone2 = f.phone2 ? normalizePhone(f.phone2) : '';
  v.city = clean(f.city, 60); v.street = clean(f.street, 80); v.house = clean(f.house, 12); v.fax = clean(f.fax, 30);
  const pc = pickCompanies(f.companies || '', names);
  v.all = pc.all; v.companies = pc.companies;
  v.approve = clean(f.approve, 60);
  if (v.first.length < 2) errors.push('שם פרטי');
  if (v.last.length < 2) errors.push('שם משפחה');
  if (!v.id) errors.push(f.id ? 'תעודת זהות - המספר אינו תקין (9 ספרות)' : 'תעודת זהות');
  if (!v.phone) errors.push(f.phone ? 'טלפון - המספר אינו תקין' : 'טלפון');
  if (f.phone2 && !v.phone2) errors.push('טלפון נוסף - המספר אינו תקין');
  if (v.city.length < 2) errors.push('עיר');
  if (v.street.length < 2) errors.push('רחוב');
  if (f.house && !/^\d{1,4}\s*[א-ת]?$/.test(v.house)) errors.push('מספר בית - מספר בלבד (אפשר עם אות, למשל 12א)');
  for (const b of pc.bad) errors.push(`חברות - ${b}`);
  if (!v.all && !v.companies.length && !pc.bad.length) errors.push('חברות - כתבו "כל החברות" או מספרים מהרשימה');
  if (!APPROVE_RE.test(v.approve)) errors.push('אישור השטר - יש לכתוב "מאשר"');
  return { errors, v };
}

// ---- המייל שנשלח: טופס, כפתור מילוי, רשימת החברות ונוסח השטר ----
export function formMail({ values = {}, errors = [], names = [], code = '', to = '', agreement = DEFAULT_LONG } = {}) {
  const vals = { ...values, list: code };
  const formText = FIELDS.map((f) => `${lineOf(f)} ${vals[f[0]] || ''}`).join('\n');
  const p = (t, st = '') => `<p style="margin:0 0 8px;font-size:15px;line-height:1.6;${st}">${esc(t)}</p>`;
  const lines = FIELDS.map((f) => `<div style="font-size:16px;line-height:2"><b>${esc(f[1])}</b>${f[2] ? ` <span style="color:#6b7b7b;font-size:13px">(${esc(f[2])})</span>` : ''}: ${esc(vals[f[0]] || '')}</div>`).join('');
  const mailto = to ? `mailto:${encodeURIComponent(to).replace(/%40/g, '@')}?subject=${encodeURIComponent('הצטרפות - טופס ממולא')}&body=${encodeURIComponent(formText + '\n')}` : '';
  const errBox = errors.length ? `<div style="background:#fdecea;border:1px solid #e0a39c;border-radius:6px;padding:10px 14px;margin:0 0 14px">
<b>הטופס לא נקלט. יש לתקן:</b><ul style="margin:6px 0 0">${errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div>` : '';
  const list = names.map((n, i) => `${i + 1}. ${esc(n)}`).join('<br>');
  const html = `<!doctype html><html lang="he" dir="rtl"><body style="margin:0;background:#eef2f2;font-family:Arial,Helvetica,sans-serif;color:#1f2d2d">
<div dir="rtl" style="max-width:660px;margin:0 auto;padding:16px"><div style="background:#fff;border:2px solid #1b6b52;border-radius:6px;padding:20px 22px">
<h2 style="margin:0 0 12px;color:#1b6b52">טופס הצטרפות להיתר עיסקא פרטי</h2>
${errBox}
${p('איך ממלאים: לוחצים על הכפתור (או משיבים למייל זה), כותבים את הפרטים אחרי הנקודתיים בכל שורה, ושולחים. הכל במייל אחד.')}
${mailto ? `<p style="margin:10px 0 14px"><a href="${esc(mailto)}" style="display:inline-block;background:#1b6b52;color:#fff;text-decoration:none;font-weight:bold;font-size:17px;padding:10px 22px;border-radius:6px">✉ לחצו כאן למילוי הטופס</a></p>` : ''}
<div style="border:1px dashed #1b6b52;border-radius:6px;padding:10px 16px;margin:0 0 14px;background:#f7fbf9">${lines}</div>
${p('חברות: כתבו "כל החברות" (כל החברות שנרשמו ושיירשמו בהמשך), או את המספרים של החברות מהרשימה שלמטה, מופרדים בפסיק (למשל: 3, 17, 42).')}
${p('אישור השטר: כתבו "מאשר", לאחר קריאת נוסח שטר הרישום המלא שלמטה. זהו האישור על כל תנאי השטר.')}
${p('את השורה "קוד רשימה" אין לשנות.', 'color:#6b7b7b;font-size:13px')}
<div style="border-top:1px solid #cfdcdc;padding-top:12px;margin-top:6px"><h3 style="margin:0 0 8px">שטר רישום להיתר עיסקא פרטי</h3>
${agreement.map((t) => (isBold(t) ? p(plain(t), 'font-weight:bold') : p(t))).join('')}${p('[לבחירת כל החברות שנרשמו וירשמו בהמשך / לבחירה מתוך רשימה - לפי מה שנכתב בשורה "חברות"]', 'color:#555')}</div>
${names.length ? `<div style="border-top:1px solid #cfdcdc;padding-top:12px;margin-top:6px"><h3 style="margin:0 0 8px">רשימת החברות (קוד רשימה ${esc(code)})</h3><div style="font-size:14px;line-height:1.7">${list}</div></div>` : ''}
<p style="margin:14px 0 0;font-size:14px;color:#34504a;text-align:center"><b>מכון היתר עיסקא למהדרין</b> · טלפון: <span dir="ltr">052-7117041</span></p>
</div></div></body></html>`;
  const text = [
    'טופס הצטרפות להיתר עיסקא פרטי', '',
    ...(errors.length ? ['הטופס לא נקלט. יש לתקן:', ...errors.map((e) => '- ' + e), ''] : []),
    'איך ממלאים: משיבים למייל זה, כותבים את הפרטים אחרי הנקודתיים בכל שורה, ושולחים. הכל במייל אחד.', '',
    formText, '',
    'חברות: "כל החברות", או המספרים מהרשימה שלמטה מופרדים בפסיק. אישור השטר: "מאשר", לאחר קריאת נוסח השטר. את "קוד רשימה" אין לשנות.', '',
    'שטר רישום להיתר עיסקא פרטי', ...agreement.map(plain), '',
    ...(names.length ? [`רשימת החברות (קוד רשימה ${code})`, ...names.map((n, i) => `${i + 1}. ${n}`)] : []),
  ].join('\n');
  return { html, text };
}

// ---- הגבלת כמות תשובות ----
let logReady = false;
export async function underLimit(env, sender) {
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
// חלק ה-AMP (טופס חי בתוך Gmail). JOIN_EMAIL_AMP = "0" מכבה.
export async function ampPart(env, origin, to, names, code) {
  if (String(env.JOIN_EMAIL_AMP || '') === '0') return '';
  const token = await makeToken(env, to);
  return token ? buildAmp({ action: `${origin}/api/join-email-amp`, token, names, code, agreement: (await getAgreement(env)).long }) : '';
}
const isAutomatic = (msg, sender) => /^(mailer-daemon|postmaster|no-?reply|bounce)/i.test(sender) || /^wordpress@/i.test(sender)
  || /auto-(replied|generated)/i.test(header(msg, 'auto_submitted')) || /bulk|junk|list/i.test(header(msg, 'precedence'));

export async function onRequestPost({ request, env }) {
  const why = authProblem(request, env);
  if (why) return ok(`unauthorized: ${why}`, 403);
  let msg;
  try { msg = await request.json(); } catch { return ok('bad request', 400); }
  const origin = new URL(request.url).origin;
  const subject = header(msg, 'subject');
  const sender = addressOf(header(msg, 'reply_to')) || addressOf(header(msg, 'from')) || addressOf(msg.envelope && msg.envelope.from);
  const body = msg.plain || htmlToText(msg.html);
  const fields = parseForm(body);
  delete fields.list;
  const filled = Object.keys(fields).length >= 3;
  const list = parseForm(body).list;
  try {
    if (!filled && !/הצטרפות/.test(subject)) {             // לא בקשת הצטרפות: מועבר למכון
      // קוד אימות של העברה מ-Gmail: נשלח לתיבת ה-Gmail שביקשה את ההעברה (הכתובת שלה כתובה במייל האימות)
      let to = env.JOIN_EMAIL_ADMIN || CANCEL_NOTIFY_TO;
      if (/^forwarding-noreply@google\.com$/i.test(addressOf(header(msg, 'from')) || sender)) {
        const asker = (String(body).match(/[\w.+-]+@(?:gmail|googlemail)\.com/gi) || []).map((x) => x.toLowerCase()).find((x) => !/^forwarding-noreply@/.test(x));
        if (asker && (await underLimit(env, `fwd:${asker}`))) to = asker;
      }
      await sendMail(env, {
        to, subject: `מייל שהתקבל בכתובת ההצטרפות: ${clean(subject, 120)}`,
        html: `<div dir="rtl" style="font-family:Arial,sans-serif"><p><b>מאת:</b> <span dir="ltr">${esc(header(msg, 'from'))}</span><br><b>נושא:</b> ${esc(subject)}</p><pre style="white-space:pre-wrap;font-family:inherit" dir="auto">${esc(String(body).slice(0, 20000))}</pre></div>`,
        text: `מאת: ${header(msg, 'from')}\nנושא: ${subject}\n\n${String(body).slice(0, 20000)}`,
      });
      return ok('forwarded');
    }
    if (!sender || isAutomatic(msg, sender)) return ok('ignored');
    if (!(await underLimit(env, sender))) return ok('limited');

    // כתובת לתשובות ולכפתור המילוי: הכתובת שאליה נשלח המייל (למשל ה-Gmail שמעביר ל-CloudMailin), ואם נשלח ישר ל-CloudMailin - JOIN_EMAIL_REPLY_TO
    const toAddr = addressOf(header(msg, 'to'));
    const rt = toAddr && !/@cloudmailin\.net$/.test(toAddr) ? toAddr : replyTo(env);
    if (!filled) {                                           // בקשה ראשונה: שולחים את הטופס
      const { names, code } = await companyList(env, origin);
      await sendMail(env, { to: sender, subject: 'הצטרפות להיתר עיסקא פרטי - טופס למילוי', ...formMail({ names, code, to: rt, agreement: (await getAgreement(env)).long }), amp: await ampPart(env, origin, sender, names, code), replyTo: rt });
      return ok('form sent');
    }
    const ref = await listByCode(env, origin, list);
    const { errors, v } = checkForm(fields, ref.names);
    if (errors.length) {
      const cur = await companyList(env, origin);
      const values = { ...fields };
      if (!v.all && ref.code !== cur.code && v.companies.length) {          // הרשימה השתנתה: המספרים שנבחרו מתורגמים לרשימה החדשה
        values.companies = v.companies.map((n) => cur.names.indexOf(n) + 1).filter(Boolean).join(', ');
      }
      await sendMail(env, { to: sender, subject: 'הצטרפות להיתר עיסקא פרטי - יש לתקן את הטופס', ...formMail({ values, errors, names: cur.names, code: cur.code, to: rt, agreement: (await getAgreement(env)).long }), amp: await ampPart(env, origin, sender, cur.names, cur.code), replyTo: rt });
      return ok('missing');
    }
    await save(env, v, sender, header(msg, 'message_id'), origin);
    return ok('saved');
  } catch (e) {
    console.log(`join-email error: ${e && e.message}`);        // בלי פרטים אישיים
    return ok('error', 500);                                 // CloudMailin ינסה שוב
  }
}

export async function save(env, v, email, messageId, origin, channel = 'מייל') {
  const key = await importKeyForWrite(env);
  const ih = await identHash(env, v.id);
  const recent = await env.DB.prepare('SELECT id FROM joiners WHERE ident_hash = ? AND submitted_at >= ? LIMIT 1')
    .bind(ih, jerusalemNow(new Date(Date.now() - 3 * 60000))).first();
  if (recent) return;
  const rid = newRowId(), now = jerusalemNow();
  const address = [[v.street, v.house].filter(Boolean).join(' '), v.city].filter(Boolean).join(', ');
  const extra = {
    'ערוץ': channel,
    ...(v.phone2 ? { 'טלפון נוסף': v.phone2 } : {}),
    ...(v.fax ? { 'פקס': v.fax } : {}),
    'כתובת': address, 'עיר': v.city, 'רחוב': v.street, ...(v.house ? { 'מספר בית': v.house } : {}),
    'גרסת שטר': AGREEMENT_VERSION + '/' + (await getAgreement(env)).version,
    'אושרו התנאים': `כן (במייל: "${v.approve}")`,
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
