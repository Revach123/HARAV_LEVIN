// ============================================================================
//  functions/api/join-email-amp.js — קבלת טופס ההצטרפות שנשלח מתוך מייל AMP (Gmail)
//
//  POST (multipart/form-data) מ-amp-form. ה-token (חתום, ר' _shared/join-amp.js) מזהה את הכתובת שאליה נשלח הטופס.
//  בדיקה כמו בהצטרפות במייל (join-email.js checkForm); תקין -> נשמר ברשימת המצטרפים ונשלח מייל אישור.
//  תשובה: JSON {message} (200) או {message, errors} (400), עם כותרות ה-CORS ש-AMP למייל דורש.
// ============================================================================
import { readToken } from './_shared/join-amp.js';
import { checkForm, listByCode, save, underLimit } from './join-email.js';

function ampHeaders(request) {
  const h = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
  const sender = request.headers.get('AMP-Email-Sender');
  if (sender) h['AMP-Email-Allow-Sender'] = sender;                                   // CORS גרסה 2
  const src = new URL(request.url).searchParams.get('__amp_source_origin');          // CORS גרסה 1
  const origin = request.headers.get('Origin');
  if (src) {
    h['AMP-Access-Control-Allow-Source-Origin'] = src;
    h['Access-Control-Expose-Headers'] = 'AMP-Access-Control-Allow-Source-Origin';
    if (origin) { h['Access-Control-Allow-Origin'] = origin; h['Access-Control-Allow-Credentials'] = 'true'; }
  }
  return h;
}
const reply = (request, body, status = 200) => new Response(JSON.stringify(body), { status, headers: ampHeaders(request) });

export async function onRequestPost({ request, env }) {
  let fd;
  try { fd = await request.formData(); } catch { return reply(request, { message: 'הבקשה לא תקינה', errors: [] }, 400); }
  const g = (k) => String(fd.get(k) || '').trim();
  const email = await readToken(env, g('token'));
  if (!email) return reply(request, { message: 'תוקף הטופס פג. שלחו מייל חדש עם הכותרת "הצטרפות" ותקבלו טופס חדש.', errors: [] }, 400);
  try {
    if (!(await underLimit(env, `amp:${email}`))) return reply(request, { message: 'נשלחו יותר מדי טפסים היום. נסו שוב מחר.', errors: [] }, 400);
    const origin = new URL(request.url).origin;
    const ref = await listByCode(env, origin, g('list'));
    const picked = fd.getAll('c').map((x) => ref.names[Number(x) - 1]).filter(Boolean);
    const f = {
      first: g('first'), last: g('last'), id: g('id'), phone: g('phone'), phone2: g('phone2'),
      city: g('city'), street: g('street'), house: g('house'), fax: g('fax'),
      approve: g('approve') ? 'מאשר' : '',
    };
    const choice = g('choice');
    const { errors, v } = checkForm({ ...f, companies: choice === 'all' ? 'כל החברות' : '' }, ref.names);
    const errs = errors.filter((e) => !/^חברות/.test(e)).map((e) => e.replace('יש לכתוב "מאשר"', 'יש לסמן את תיבת האישור'));
    if (choice === 'list') { v.all = false; v.companies = [...new Set(picked)]; if (!v.companies.length) errs.push('חברות - יש לסמן לפחות חברה אחת ברשימה'); }
    else if (choice !== 'all') errs.push('בחירת חברות - כל החברות או בחירה מתוך רשימה');
    if (errs.length) return reply(request, { message: 'הטופס לא נשלח. יש לתקן:', errors: errs }, 400);
    v.approve = 'מאשר (סימון בטופס במייל)';
    await save(env, v, email, '', origin, 'מייל (טופס בתוך המייל)');
    return reply(request, { message: `תודה ${v.first}! ההצטרפות התקבלה, ונשלח אליך מייל אישור.` });
  } catch (e) {
    console.log(`join-email-amp error: ${e && e.message}`);
    return reply(request, { message: 'אירעה שגיאה. נסו שוב בעוד כמה דקות.', errors: [] }, 500);
  }
}
