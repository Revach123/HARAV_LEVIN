// ============================================================================
//  functions/api/join-email-cm-test.js — בדיקת שליחה דרך CloudMailin (בלי וורדפרס), כולל הטופס החי (AMP)
//
//  https://harav-levin.pages.dev/api/join-email-cm-test : דף ניהול (סיסמת הניהול, או מכשיר מורשה).
//  שולח את מייל טופס ההצטרפות - בדיוק כמו שמצטרף מקבל, עם חלק ה-AMP - לכתובת שמזינים, דרך CloudMailin.
//  "בדיקה בלבד" (test_mode): CloudMailin בודק את המייל ולא שולח.
//  לא משנה את ההתנהגות הרגילה: מיילים אחרים ממשיכים לצאת דרך וורדפרס, אלא אם MAIL_PROVIDER = "cloudmailin".
//  דורש: CLOUDMAILIN_SMTP_URL, CLOUDMAILIN_FROM (ר' _shared/cloudmailin.js), JOIN_EMAIL_SECRET.
// ============================================================================
import { checkAdmin, checkPassword } from './_shared/auth.js';
import { sendCloudMailin } from './_shared/cloudmailin.js';
import { companyList, formMail, ampPart, addressOf } from './join-email.js';
import { getAgreement } from './_shared/agreement.js';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const page = (body) => new Response(`<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>בדיקת שליחה דרך CloudMailin</title><style>body{font-family:Arial,sans-serif;max-width:620px;margin:24px auto;padding:0 16px;color:#1f2d2d;line-height:1.6}
h1{color:#1b6b52;font-size:22px}label{display:block;margin:12px 0 4px;font-weight:bold}input[type=password],input[type=email]{box-sizing:border-box;width:100%;padding:9px;font-size:16px;border:1px solid #b7c9c4;border-radius:6px}
button{margin-top:16px;background:#1b6b52;color:#fff;border:0;border-radius:8px;padding:12px 20px;font-size:17px;font-weight:bold}.ok{background:#e7f5ee;border:1px solid #1b6b52;border-radius:8px;padding:12px}
.bad{background:#fdecea;border:1px solid #e0a39c;border-radius:8px;padding:12px}code,pre{background:#f1f4f4;padding:1px 5px;border-radius:4px;direction:ltr;text-align:left}pre{white-space:pre-wrap;word-break:break-all;padding:8px}</style></head><body>${body}</body></html>`,
  { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });

const formPage = (env, msg = '') => page(`<h1>בדיקת שליחה דרך CloudMailin</h1>
${msg}
<p>שולח את מייל טופס ההצטרפות, עם הטופס החי (AMP), מ-<code>${esc(env.CLOUDMAILIN_FROM || 'CLOUDMAILIN_FROM לא מוגדר')}</code> לכתובת שתזינו.</p>
<form method="post">
<label>סיסמת הניהול</label><input type="password" name="pw" autocomplete="current-password">
<label>לאן לשלוח (כתובת ה-Gmail שלכם)</label><input type="email" name="to" dir="ltr" required>
<label><input type="checkbox" name="test" value="1"> בדיקה בלבד - CloudMailin בודק ולא שולח (test_mode)</label>
<button type="submit">שליחה</button></form>`);

export async function onRequestGet({ env }) { return formPage(env); }

export async function onRequestPost({ request, env }) {
  const fd = await request.formData().catch(() => null);
  if (!fd) return formPage(env, '<p class="bad">הבקשה לא תקינה</p>');
  const ok = (await checkAdmin(request, env)) || (await checkPassword(String(fd.get('pw') || ''), env));
  if (!ok) return formPage(env, '<p class="bad">סיסמת הניהול שגויה</p>');
  const to = addressOf(String(fd.get('to') || ''));
  if (!to) return formPage(env, '<p class="bad">הכתובת אינה תקינה</p>');
  const testMode = fd.get('test') === '1';
  const origin = new URL(request.url).origin;
  const rt = addressOf(env.JOIN_EMAIL_REPLY_TO || '') || '';
  const { names, code } = await companyList(env, origin);
  const amp = await ampPart(env, origin, to, names, code);
  const agr = await getAgreement(env);
  const res = await sendCloudMailin(env, { to, subject: 'הצטרפות להיתר עיסקא פרטי - טופס למילוי',
    ...formMail({ names, code, to: rt, agreement: agr.long, agreementTitle: agr.longTitle }), amp, replyTo: rt }, { testMode });
  const box = `<p><b>תשובת CloudMailin:</b> ${res.status || 'אין'}</p><pre>${esc(res.body)}</pre>`;
  if (!res.ok) return formPage(env, `<div class="bad"><p>השליחה נכשלה.</p>${box}</div>`);
  return page(`<h1>${testMode ? 'נבדק ✓ (לא נשלח)' : 'נשלח ✓'}</h1><div class="ok">
<p>${testMode ? 'CloudMailin קיבל ובדק את המייל, בלי לשלוח.' : `המייל נשלח ל-<code>${esc(to)}</code>.`}
${amp ? 'כולל הטופס החי (AMP).' : '<b>בלי</b> הטופס החי - חסר JOIN_EMAIL_SECRET או ש-JOIN_EMAIL_AMP כבוי.'}</p>${box}</div>
<h2 style="font-size:18px">מה בודקים ב-Gmail</h2><ol>
<li>שהמייל הגיע (ולא לספאם), ובהצגת המקור: SPF, DKIM ו-DMARC במצב PASS.</li>
<li>הטופס החי מוצג רק לשולח מאושר ב-Google, או אם ב-Gmail שלכם הופעל "מצב מפתחים" לכתובת <code>${esc(env.CLOUDMAILIN_FROM || '')}</code>
(Gmail ← הגדרות ← כללי ← אימייל דינמי ← הגדרות מפתחים). אחרת מוצג ה-HTML הרגיל - גם זו תוצאה תקינה.</li>
<li>שליחת הטופס החי צריכה להגיע לרשימת המצטרפים כמו מהטופס במייל.</li></ol>`);
}
