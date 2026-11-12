// ============================================================================
//  functions/api/ivr-fax-test.js — בדיקה מהירה (זמנית) של אישור הצטרפות בפקס, בלי תהליך ההצטרפות
//
//  המתקשר מקיש מספר פקס, מאשר, ונרשם אישור הצטרפות לדוגמה (פרטים בדויים, בלי רישום מצטרף) בתור של אישורי הפקס.
//  משם הוא עובר אותו מסלול כמו אישור אמיתי: GitHub Actions מפיק PDF, והאתר שולח לספק (functions/api/fax-confirm.js).
//  שימוש זמני: בהגדרות שלוחה 1 בימות מחליפים את api_link ל-https://harav-levin.pages.dev/api/ivr-fax-test (אותם api_add_0=sk=..., api_add_1=bk=/),
//  ואחרי הבדיקה מחזירים את הקישור ל-/api/ivr-join. אפשר למחוק את הקובץ הזה אחרי הבדיקה.
// ============================================================================
import { folderParam, parseYemot, readTap, secretOk } from './_shared/ivr-auth.js';
import { unit, ttsClean } from './_shared/ivr_phrases.js';
import MANIFEST from './_shared/ivr_audio_manifest.js';
import { jerusalemNow } from './_shared/join-common.js';
import { normalizeFax } from './ivr-join.js';
import { queueFaxConfirmation } from './_shared/join-fax-confirm.js';

const EMPTY = 'NONE';
const has = (v, k) => Object.prototype.hasOwnProperty.call(v, k);
const text = (body) => new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });

export async function onRequest({ request, env, waitUntil }) {
  const v = await parseYemot(request);
  if (!secretOk(env, v.sk)) return text('id_list_message=t-שגיאת הרשאה&');
  if (v.hangup === 'yes') return text('');
  const P = (key) => unit(key, String(env.IVR_AUDIO_OFF || '') === '1' ? {} : MANIFEST);
  const bk = folderParam(v, 'bk', env.IVR_BACK_FOLDER || '/');
  const done = (...keys) => text(`id_list_message=${keys.map(P).join('.')}&go_to_folder=${bk}&`);
  const call = String(v.ApiCallId || 'x').replace(/\W/g, '');

  // מספר פקס בהקשה (ספרות + סולמית), הקראה חוזרת: 1 = אישור, 2 = הקשה מחדש. כל ניסיון במשתנה חדש (fx_<n>).
  let fax = '';
  for (let n = 0; n < 20 && !fax; n++) {
    const key = `fx_${n}`, ck = `fx_c${n}`;
    const ask = (pre = '') => text(readTap(`${n === 0 ? `${T('בדיקת שליחת אישור הצטרפות לפקס')}.` : ''}${pre}${P('join:askFax')}`, key, null, { max: 11, min: 9, empty: EMPTY }));
    if (!has(v, key) || !v[key] || v[key] === EMPTY) return ask();
    const val = normalizeFax(v[key]);
    if (!val) { if (!has(v, `fx_${n + 1}`)) return text(readTap(`${P('join:badFax')}.${P('join:askFax')}`, `fx_${n + 1}`, null, { max: 11, min: 9, empty: EMPTY })); continue; }
    if (v[ck] === '1') { fax = val; break; }
    if (v[ck] === '2') { if (!has(v, `fx_${n + 1}`)) return text(readTap(P('join:askFax'), `fx_${n + 1}`, null, { max: 11, min: 9, empty: EMPTY })); continue; }
    return text(readTap(`${T(val.split('').join(' '))}.${P('join:confirm')}`, ck, ['1', '2'], { empty: EMPTY }));
  }
  if (!fax) return done('join:error');

  const conf = { first: 'ישראל', last: 'לדוגמה', id: '000000000', date: jerusalemNow().slice(0, 10).split('-').reverse().join('/'), all: true, companies: [], origin: new URL(request.url).origin };
  const queued = await queueFaxConfirmation(env, waitUntil, `test${call}`, fax, conf, '');
  return done(queued ? 'join:faxQueued' : 'join:error', ...(queued ? ['join:thanks'] : []));
}
const T = (txt) => `t-${ttsClean(txt)}`;
