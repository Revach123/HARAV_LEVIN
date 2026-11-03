// ============================================================================
//  functions/api/_shared/join-amp.js — טופס ההצטרפות כמייל AMP (טופס חי בתוך Gmail)
//
//  חלק ה-AMP (text/x-amp-html) נשלח לצד ה-HTML הרגיל. Gmail מציג אותו רק לשולח רשום ומאושר אצל Google
//  (או בחשבון שהפעיל "מצב מפתחים" לשולח הזה); כל השאר רואים את גרסת ה-HTML / הטקסט.
//  השליחה מהטופס: POST ל-/api/join-email-amp (functions/api/join-email-amp.js), עם token חתום שמזהה את הנמען.
// ============================================================================
import { AGREEMENT_BEFORE_CHOICE, AGREEMENT_AFTER_CHOICE } from './agreement.js';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const b64u = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64u(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data)))).slice(0, 32);
}
/** token לטופס: הכתובת שאליה נשלח + תוקף (30 יום), חתום ב-JOIN_EMAIL_SECRET */
export async function makeToken(env, email, days = 30) {
  const secret = String(env.JOIN_EMAIL_SECRET || '').trim();
  if (!secret) return '';
  const e = b64u(new TextEncoder().encode(email)), exp = String(Math.floor(Date.now() / 1000) + days * 86400);
  return `${e}.${exp}.${await hmac(secret, `${e}.${exp}`)}`;
}
/** הכתובת מתוך token תקין, או '' */
export async function readToken(env, token) {
  const secret = String(env.JOIN_EMAIL_SECRET || '').trim();
  const [e, exp, sig] = String(token || '').split('.');
  if (!secret || !e || !exp || !sig || Number(exp) * 1000 < Date.now()) return '';
  if ((await hmac(secret, `${e}.${exp}`)) !== sig) return '';
  try { return new TextDecoder().decode(fromB64u(e)); } catch { return ''; }
}

const CSS = `
body{margin:0;background:#eef2f2;font-family:Arial,Helvetica,sans-serif;color:#1f2d2d}
.wrap{max-width:640px;margin:0 auto;padding:14px}
.box{background:#fff;border:2px solid #1b6b52;border-radius:8px;padding:18px 20px}
h1{margin:0 0 6px;font-size:22px;color:#1b6b52}
.sub{margin:0 0 14px;font-size:14px;color:#555}
.row{margin:0 0 12px}
.lbl{display:block;font-weight:bold;font-size:15px;margin:0 0 4px}
.hint{font-weight:normal;color:#6b7b7b;font-size:13px}
.in{box-sizing:border-box;width:100%;padding:9px 10px;font-size:16px;border:1px solid #b7c9c4;border-radius:6px}
.two{display:flex;gap:10px}
.two .row{flex:1}
.err{color:#b3261e;font-size:13px}
.opt{display:block;padding:8px 10px;margin:0 0 6px;border:1px solid #cfdcdc;border-radius:6px;font-size:15px}
.list{max-height:320px;overflow:auto;border:1px solid #cfdcdc;border-radius:6px;padding:6px 8px;margin-top:6px}
.co{display:block;padding:4px 2px;font-size:14px;border-bottom:1px solid #f0f3f3}
.agr{font-size:14px;line-height:1.6}
.agr p{margin:0 0 8px}
.acc{background:#f7fbf9;border:1px solid #cfdcdc;padding:8px 10px;font-size:15px;font-weight:bold;color:#1b6b52}
.approve{display:block;background:#f7fbf9;border:1px solid #1b6b52;border-radius:6px;padding:10px;font-size:15px;font-weight:bold;margin:12px 0}
.btn{display:block;width:100%;background:#1b6b52;color:#fff;border:0;border-radius:8px;padding:13px;font-size:18px;font-weight:bold}
.okmsg{background:#e7f5ee;border:1px solid #1b6b52;border-radius:6px;padding:12px;font-size:16px;font-weight:bold;color:#1b6b52}
.badmsg{background:#fdecea;border:1px solid #e0a39c;border-radius:6px;padding:10px 12px;font-size:15px}
.foot{margin:14px 0 0;font-size:13px;color:#34504a;text-align:center}
`;

/** מסמך AMP4EMAIL של טופס ההצטרפות */
export function buildAmp({ action, token, names = [], code = '' }) {
  const field = (name, label, { hint = '', req = true, pattern = '', min = 0, max = 60, mode = '', msg = '' } = {}) => `
<div class="row"><label class="lbl" for="f-${name}">${esc(label)}${hint ? ` <span class="hint">(${esc(hint)})</span>` : ''}</label>
<input class="in" id="f-${name}" name="${name}" type="${mode === 'tel' ? 'tel' : 'text'}"${req ? ' required' : ''}${pattern ? ` pattern="${esc(pattern)}"` : ''}${min ? ` minlength="${min}"` : ''} maxlength="${max}">
${req ? `<span class="err" visible-when-invalid="valueMissing" validation-for="f-${name}">שדה חובה</span>` : ''}
${pattern ? `<span class="err" visible-when-invalid="patternMismatch" validation-for="f-${name}">${esc(msg)}</span>` : ''}</div>`;
  const search = names.length && names.length <= 800;
  const cos = names.map((n, i) => `<label class="co"${search ? ` [hidden]="q &amp;&amp; s.n[${i}].indexOf(q) &lt; 0"` : ''}><input type="checkbox" name="c" value="${i + 1}"> ${esc(n)}</label>`).join('\n');
  const state = search ? `<amp-state id="s"><script type="application/json">${JSON.stringify({ n: names }).replace(/</g, '\\u003c')}</script></amp-state>` : '';
  return `<!doctype html>
<html ⚡4email data-css-strict lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<script async src="https://cdn.ampproject.org/v0.js"></script>
<script async custom-element="amp-form" src="https://cdn.ampproject.org/v0/amp-form-0.1.js"></script>
<script async custom-element="amp-bind" src="https://cdn.ampproject.org/v0/amp-bind-0.1.js"></script>
<script async custom-element="amp-accordion" src="https://cdn.ampproject.org/v0/amp-accordion-0.1.js"></script>
<script async custom-template="amp-mustache" src="https://cdn.ampproject.org/v0/amp-mustache-0.2.js"></script>
<style amp4email-boilerplate>body{visibility:hidden}</style>
<style amp-custom>${CSS}</style>
</head>
<body>
${state}
<div class="wrap"><div class="box">
<h1>טופס הצטרפות להיתר עיסקא פרטי</h1>
<p class="sub">ממלאים כאן, בתוך המייל, ולוחצים "שליחת הטופס". שדות שלא כתוב לידם "לא חובה" - חובה.</p>
<form method="post" action-xhr="${esc(action)}" custom-validation-reporting="show-all-on-submit">
<input type="hidden" name="token" value="${esc(token)}">
<input type="hidden" name="list" value="${esc(code)}">
<div class="two">${field('first', 'שם פרטי', { min: 2, max: 40 })}${field('last', 'שם משפחה', { min: 2, max: 40 })}</div>
${field('id', 'תעודת זהות', { hint: '9 ספרות', pattern: '[0-9]{5,9}', max: 9, mode: 'numeric', msg: 'מספר תעודת זהות - ספרות בלבד' })}
<div class="two">${field('phone', 'טלפון', { pattern: '0[0-9\\-\\s]{8,11}', max: 14, mode: 'tel', msg: 'מספר טלפון ישראלי, למשל 0501234567' })}${field('phone2', 'טלפון נוסף', { hint: 'לא חובה', req: false, pattern: '0[0-9\\-\\s]{8,11}', max: 14, mode: 'tel', msg: 'מספר טלפון ישראלי' })}</div>
<div class="two">${field('city', 'עיר', { min: 2 })}${field('street', 'רחוב', { min: 2, max: 80 })}</div>
<div class="two">${field('house', 'מספר בית', { hint: 'לא חובה', req: false, pattern: '[0-9]{1,4}[א-ת]?', max: 5, msg: 'מספר בלבד (אפשר עם אות, למשל 12א)' })}${field('fax', 'פקס', { hint: 'לא חובה', req: false, max: 20, mode: 'tel' })}</div>

<div class="row"><span class="lbl">בחירת חברות</span>
<label class="opt"><input type="radio" name="choice" value="all" required on="change:AMP.setState({choice: 'all'})"> כל החברות שנרשמו וירשמו בהמשך</label>
<label class="opt"><input type="radio" name="choice" value="list" on="change:AMP.setState({choice: 'list'})"> בחירה מתוך רשימה</label>
<div hidden [hidden]="choice != 'list'">
${search ? `<input class="in" type="text" placeholder="חיפוש חברה..." on="input-debounced:AMP.setState({q: event.value})">` : ''}
<div class="list">${cos}</div>
</div></div>

<amp-accordion><section>
<h4 class="acc">נוסח שטר הרישום (לחצו לקריאה)</h4>
<div class="agr">${[...AGREEMENT_BEFORE_CHOICE, ...AGREEMENT_AFTER_CHOICE, '[לבחירת כל החברות / לבחירה מתוך רשימה - לפי הבחירה למעלה]'].map((t) => `<p>${esc(t)}</p>`).join('')}</div>
</section></amp-accordion>

<label class="approve"><input type="checkbox" name="approve" value="1" required> קראתי את נוסח השטר, ואני מאשר את כל תנאיו</label>
<button class="btn" type="submit">שליחת הטופס</button>

<div submit-success><template type="amp-mustache"><p class="okmsg">{{message}}</p></template></div>
<div submit-error><template type="amp-mustache"><div class="badmsg"><b>{{message}}</b><ul>{{#errors}}<li>{{.}}</li>{{/errors}}</ul></div></template></div>
</form>
<p class="foot"><b>מכון היתר עיסקא למהדרין</b> · טלפון 052-7117041</p>
</div></div>
</body>
</html>`;
}
