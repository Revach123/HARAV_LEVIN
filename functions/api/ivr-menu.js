// ============================================================================
//  functions/api/ivr-menu.js — התפריט הראשי של הקו החדש בימות המשיח
//
//  שלוחת api בשורש הקו. מנגנת את ההודעה הראשית (ivr_phrases.js: mainMenu) ומעבירה:
//    1 = הצטרפות להיתר עסקה פרטי (שלוחת ivr-join, ברירת מחדל /1)
//    2 = חיפוש חברות (שלוחת ivr-company, ברירת מחדל /2)
//    3 = הצטרפות בדיבור בלבד (שלוחת ivr-join-voice, ניסיון, ברירת מחדל /3)
//  ext.ini:
//    type=api
//    api_link=https://harav-levin.pages.dev/api/ivr-menu
//    api_add_0=sk=<IVR_SECRET_NEW>
//    api_add_1=join=/1        (אופציונלי)
//    api_add_2=search=/2      (אופציונלי)
//    api_add_3=voice=/3       (אופציונלי)
//  בלי מצב בשרת: הבחירה במשתנה mm. כל ערך אחר (שתיקה וכו') - השאלה נשאלת שוב, בלי הגבלה.
// ============================================================================
import { folderParam, parseYemot, readTap, secretOk } from './_shared/ivr-auth.js';
import { unit } from './_shared/ivr_phrases.js';
import MANIFEST from './_shared/ivr_audio_manifest.js';

const EMPTY = 'NONE';

export async function onRequest({ request, env }) {
  const v = await parseYemot(request);
  if (!secretOk(env, v.sk)) return text('id_list_message=t-שגיאת הרשאה&');
  if (v.hangup === 'yes') return text('');

  const mf = String(env.IVR_AUDIO_OFF || '') === '1' ? {} : MANIFEST;
  const P = (key) => unit(key, mf);
  const join = folderParam(v, 'join', '/1'), search = folderParam(v, 'search', '/2'), voice = folderParam(v, 'voice', '/3');

  // שאלה שלא נענתה (שתיקה / ערך אחר) נשאלת שוב ושוב, באותו משתנה, בלי הגבלה.
  if (v.mm === '1') return text(`go_to_folder=${join}&`);
  if (v.mm === '2') return text(`go_to_folder=${search}&`);
  if (v.mm === '3') return text(`go_to_folder=${voice}&`);
  return text(readTap(P('mainMenu'), 'mm', ['1', '2', '3'], { empty: EMPTY }));
}

const text = (body) => new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
