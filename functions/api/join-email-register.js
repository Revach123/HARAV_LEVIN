// ============================================================================
//  functions/api/join-email-register.js — שליחת מייל הטופס (עם הטופס החי, AMP) ל-Google לרישום השולח
//
//  https://harav-levin.pages.dev/api/join-email-register : דף קטן לניהול (סיסמת הניהול, או מכשיר מורשה).
//  שולח את מייל טופס ההצטרפות, כמו שמצטרף מקבל, ישר ל-ampforemail.whitelisting@gmail.com, עם עותק (Cc) לכתובת
//  שמזינים - כדי לראות בעותק את השעה ואת מזהה המייל (Message-ID) למילוי טופס הרישום של Google.
//  דורש את גרסת wp-mail-endpoint.php שמכירה cc.
// ============================================================================
import { checkAdmin, checkPassword } from './_shared/auth.js';
import { sendMail } from './_shared/join-mail.js';
import { companyList, formMail, ampPart, addressOf } from './join-email.js';
import { jerusalemNow } from './_shared/join-common.js';
import { getAgreement } from './_shared/agreement.js';

const GOOGLE = 'ampforemail.whitelisting@gmail.com';
const FORM = 'https://docs.google.com/forms/d/e/1FAIpQLSdso95e7UDLk_R-bnpzsAmuUMDQEMUgTErcfGGItBDkghHU2A/viewform';
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const page = (body) => new Response(`<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>רישום הטופס החי ב-Google</title><style>body{font-family:Arial,sans-serif;max-width:620px;margin:24px auto;padding:0 16px;color:#1f2d2d;line-height:1.6}
h1{color:#1b6b52;font-size:22px}label{display:block;margin:12px 0 4px;font-weight:bold}input{box-sizing:border-box;width:100%;padding:9px;font-size:16px;border:1px solid #b7c9c4;border-radius:6px}
button{margin-top:16px;background:#1b6b52;color:#fff;border:0;border-radius:8px;padding:12px 20px;font-size:17px;font-weight:bold}.ok{background:#e7f5ee;border:1px solid #1b6b52;border-radius:8px;padding:12px}
.bad{background:#fdecea;border:1px solid #e0a39c;border-radius:8px;padding:12px}code{background:#f1f4f4;padding:1px 5px;border-radius:4px;direction:ltr;display:inline-block}</style></head><body>${body}</body></html>`,
  { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });

const formPage = (msg = '') => page(`<h1>רישום הטופס החי ב-Google</h1>
${msg}
<p>שולח את מייל טופס ההצטרפות (עם הטופס החי) ישר ל-<code>${GOOGLE}</code>, עם עותק אליכם. מהעותק לוקחים את השעה ואת מזהה המייל למילוי טופס הרישום של Google.</p>
<form method="post">
<label>סיסמת הניהול</label><input type="password" name="pw" autocomplete="current-password">
<label>כתובת לעותק (שלכם, ב-Gmail)</label><input type="email" name="cc" dir="ltr" required>
<button type="submit">שליחה ל-Google</button></form>`);

export async function onRequestGet() { return formPage(); }

export async function onRequestPost({ request, env }) {
  const fd = await request.formData().catch(() => null);
  if (!fd) return formPage('<p class="bad">הבקשה לא תקינה</p>');
  const ok = (await checkAdmin(request, env)) || (await checkPassword(String(fd.get('pw') || ''), env));
  if (!ok) return formPage('<p class="bad">סיסמת הניהול שגויה</p>');
  const cc = addressOf(String(fd.get('cc') || ''));
  if (!cc) return formPage('<p class="bad">כתובת העותק אינה תקינה</p>');
  const origin = new URL(request.url).origin;
  const rt = addressOf(env.JOIN_EMAIL_REPLY_TO || '') || '';
  const { names, code } = await companyList(env, origin);
  const amp = await ampPart(env, origin, GOOGLE, names, code);
  if (!amp) return formPage('<p class="bad">חלק הטופס החי לא נוצר (חסר JOIN_EMAIL_SECRET או ש-JOIN_EMAIL_AMP כבוי)</p>');
  const when = jerusalemNow();
  const sent = await sendMail(env, { to: GOOGLE, cc, subject: 'הצטרפות להיתר עיסקא פרטי - טופס למילוי', ...formMail({ names, code, to: rt, agreement: (await getAgreement(env)).long, agreementTitle: (await getAgreement(env)).longTitle }), amp, replyTo: rt });
  if (!sent) return formPage('<p class="bad">השליחה נכשלה (בדקו את WP_MAIL_URL / WP_MAIL_SECRET ואת קטע הקוד ב-WPCode)</p>');
  return page(`<h1>נשלח ✓</h1><div class="ok">
<p>מייל הטופס נשלח ל-<code>${GOOGLE}</code>, עם עותק ל-<code>${esc(cc)}</code>.</p>
<p><b>שעת השליחה (שעון ישראל):</b> ${esc(when)}<br><b>שעת השליחה (UTC):</b> ${esc(new Date().toISOString().replace('T', ' ').slice(0, 19))}</p></div>
<h2 style="font-size:18px">מה עכשיו</h2><ol>
<li>פתחו את העותק ב-Gmail. ודאו שמוצג בו הטופס החי.</li>
<li>אם צריך את מזהה המייל: בעותק ⋮ ← הצגת המקור ← השורה <code>Message ID</code>.</li>
<li>מלאו את <a href="${FORM}" target="_blank" rel="noopener">טופס הרישום של Google</a>: כתובת השולח <code>wordpress@iska.co.il</code>, הדומיין <code>iska.co.il</code>, ותאריך ושעת השליחה מלמעלה.</li></ol>`);
}
