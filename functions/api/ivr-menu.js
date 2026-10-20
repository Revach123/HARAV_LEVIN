// ============================================================================
//  functions/api/ivr-menu.js — התפריט הראשי של הקו החדש בימות המשיח
//
//  שלוחת api בשורש הקו. מנגנת את ההודעה הראשית (ivr_phrases.js: mainMenu) ומעבירה:
//    1 = הצטרפות להיתר עסקה פרטי (שלוחת ivr-join, ברירת מחדל /1)
//    2 = חיפוש חברות (שלוחת ivr-company, ברירת מחדל /2)
//  ext.ini:
//    type=api
//    api_link=https://harav-levin.pages.dev/api/ivr-menu
//    api_add_0=sk=<IVR_SECRET_NEW>
//    api_add_1=join=/1        (אופציונלי)
//    api_add_2=search=/2      (אופציונלי)
//  בלי מצב בשרת: ניסיון מס' a מחזיר את הערך במשתנה mm (a=1), mm2, mm3. אחרי שלושה ניסיונות שגויים - ניתוק.
// ============================================================================
import { folderParam, parseYemot, readTap, secretOk } from './_shared/ivr-auth.js';
import { unit } from './_shared/ivr_phrases.js';
import MANIFEST from './_shared/ivr_audio_manifest.js';

const MAX_TRIES = 3;
const EMPTY = 'NONE';

export async function onRequest({ request, env }) {
  const v = await parseYemot(request);
  if (!secretOk(env, v.sk)) return text('id_list_message=t-שגיאת הרשאה&');
  if (v.hangup === 'yes') return text('');

  const mf = String(env.IVR_AUDIO_OFF || '') === '1' ? {} : MANIFEST;
  const P = (key) => unit(key, mf);
  const join = folderParam(v, 'join', '/1'), search = folderParam(v, 'search', '/2');

  for (let a = 1; a <= MAX_TRIES; a++) {
    const key = a === 1 ? 'mm' : `mm${a}`;
    if (!Object.prototype.hasOwnProperty.call(v, key)) return text(readTap(P('mainMenu'), key, ['1', '2'], { empty: EMPTY }));
    if (v[key] === '1') return text(`go_to_folder=${join}&`);
    if (v[key] === '2') return text(`go_to_folder=${search}&`);
  }
  return text(`id_list_message=${P('bye')}&hangup=yes&`);
}

const text = (body) => new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
