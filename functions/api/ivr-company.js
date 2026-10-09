// ============================================================================
//  functions/api/ivr-company.js — חיפוש עסק בקול, לשלוחת ימות המשיח 5/8
//
//  Pages Function (מנותבת אוטומטית ל-/api/ivr-company). שלוחה נפרדת לגמרי:
//  אין שום תלות בשלוחה 5 או בהודעת הפתיחה שלה.
//
//  זרימה (בלי מצב בשרת - הכול נגזר מהמשתנים שימות מחזירה בכל קריאה):
//    1. s1..s3  - "אמרו את שם העסק" (דיבור). שני מצבים:
//                 * הקלטה + זיהוי חיצוני (Azure) - כשמוגדרים AZURE_SPEECH_KEY ו-YEMOT_TOKEN (או YEMOT_TTS)
//                 * ימות מחזירה טקסט מזוהה - כשמוגדר רק env.IVR_VOICE_READ_OPTS
//                 כל ניסיון: חיפוש -> אישור מועמד אחר מועמד (k<a>_<i>: 1 = כן, 2 = הבא).
//    0. m       - תפריט פותח (רק כשיש זיהוי דיבור): 1 = לפי ח.פ. (מומלץ), 2 = לפי שם.
//    2. h       - הקשת ח.פ. (מסלול 1, או אחרי שלושה ניסיונות לפי שם, או כשאין זיהוי דיבור).
//    3. נבחר עסק -> onSelected() (כאן יתווסף שליחת הפקס) וחזרה לתפריט.
//
//  דרישות: env.IVR_SECRET, binding DB (טבלת businesses).
//  זיהוי חיצוני: AZURE_SPEECH_KEY, AZURE_SPEECH_REGION, YEMOT_TOKEN (או YEMOT_TTS).
//  אופציונלי: IVR_VOICE_READ_OPTS, IVR_REC_FOLDER (תיקיית ההקלטות, ברירת מחדל /6),
//             IVR_BACK_FOLDER (ברירת מחדל /5).
// ============================================================================

import { searchBusinesses } from './_shared/voice-match.js';
import { loadBusinesses } from './_shared/businesses-cache.js';
import { sttConfigured, transcribeRecording } from './_shared/stt-azure.js';
import { sttGet, sttPut } from './_shared/stt-cache.js';

const CFG = {
  TOKEN_PARAM: 'sk',       // api_add_0=sk=<secret> בהגדרת השלוחה
  BACK_FOLDER: '/5',       // לאן חוזרים בסיום (env.IVR_BACK_FOLDER דורס)
  MAX_SPEECH_ATTEMPTS: 3,
  EMPTY_VAL: 'NONE',       // הערך שימות מחזירה כשלא נאמר/הוקש כלום
  SEC_WAIT: 7,
};

export async function onRequest({ request, env }) {
  const raw = await parseYemot(request);

  // trim: רווח/שורה חדשה בסוף הסוד (הדבקה בדשבורד או ב-ext.ini) לא אמור לשבור את ההשוואה
  const sent = String(raw[CFG.TOKEN_PARAM] || '').trim();
  const expected = String(env.IVR_SECRET || '').trim();
  if (sent !== expected) {
    // אבחון בלי לחשוף ערכים: האם הסוד מוגדר בכלל, ומה האורכים
    console.log(`ivr-company auth fail: IVR_SECRET ${expected ? 'set' : 'NOT SET'} (len ${expected.length}), sk ${sent ? 'sent' : 'MISSING'} (len ${sent.length})`);
    return text('id_list_message=t-שגיאת הרשאה&');
  }
  if (raw.hangup === 'yes') return text('');

  try {
    const rows = await loadBusinesses(env);
    return text(await route(raw, env, rows));
  } catch (e) {
    return text(`id_list_message=t-אירעה שגיאה&go_to_folder=${back(env)}&`);
  }
}

// ----------------------------------------------------------------------------
//  מכונת מצבים: הפעולה הבאה נקבעת לפי אילו משתנים כבר קיימים
// ----------------------------------------------------------------------------
async function route(v, env, rows) {
  const record = sttConfigured(env);
  const voice = record || !!env.IVR_VOICE_READ_OPTS;

  // בלי זיהוי דיבור אין מה לבחור: ח.פ. בלבד.
  if (!voice) return (await chpPath(v, env, rows, '')).body;

  // תפריט פותח: 1 = לפי ח.פ. (מומלץ), 2 = לפי שם.
  if (!has(v, 'm')) return readTap(MENU_MSG, 'm', ['1', '2']);

  let note = '';
  if (v.m === '1') {
    const c = await chpPath(v, env, rows, '');
    if (c.body) return c.body;
    note = c.note;                                  // ח.פ. לא נמצא / נדחה -> ממשיכים לחיפוש לפי שם
  }

  const n = await namePath(v, env, rows, note, record);
  if (n.body) return n.body;

  // כל הניסיונות לפי שם נכשלו: אם עוד לא ניסו ח.פ., מציעים אותו; אחרת מסיימים.
  if (!has(v, 'h')) return (await chpPath(v, env, rows, n.note)).body;
  return `id_list_message=t-לא נמצא עסק מתאים&go_to_folder=${back(env)}&`;
}

const MENU_MSG = 'מומלץ לחפש לפי ח פ של החברה. במידה שיש לכם את מספר הח פ, הקישו 1. אם לא, הקישו 2 לחיפוש לפי שם החברה';

// חיפוש לפי ח.פ. מחזיר {body} (פקודה להחזיר לימות) או {note} (להמשיך לחיפוש לפי שם).
async function chpPath(v, env, rows, note) {
  if (!has(v, 'h')) {
    return { body: readDigits(env, 'h', note + 'הקישו את מספר הח פ, תשע ספרות, ואחריו סולמית') };
  }
  const chp = String(v.h).replace(/\D/g, '');
  const biz = chp ? rows.find((r) => String(r.chp_number || '').replace(/\D/g, '') === chp) : null;
  const voice = sttConfigured(env) || !!env.IVR_VOICE_READ_OPTS;
  if (!biz) {
    return voice ? { note: 'לא נמצא עסק במספר הזה. ' }
                 : { body: `id_list_message=t-לא נמצא עסק במספר הזה&go_to_folder=${back(env)}&` };
  }
  const hit = { id: biz.id, chp_number: biz.chp_number, name: biz.registrar_name || biz.permit_name };
  if (!has(v, 'kh')) return { body: readConfirm('kh', hit.name) };
  if (v.kh === '1') return { body: await finish(env, hit) };
  return voice ? { note: '' } : { body: `id_list_message=t-בסדר&go_to_folder=${back(env)}&` };
}

// חיפוש לפי שם (דיבור): עד MAX_SPEECH_ATTEMPTS ניסיונות, בכל אחד אישור מועמד אחר מועמד.
async function namePath(v, env, rows, note, record) {
  for (let a = 1; a <= CFG.MAX_SPEECH_ATTEMPTS; a++) {
    const sKey = `s${a}`;
    if (!has(v, sKey)) {
      return { body: readSpeech(env, v, a, record, note + (a === 1 ? 'אמרו את שם העסק' : 'אמרו שוב את שם העסק')) };
    }

    let spoken = String(v[sKey]);
    if (record && spoken !== CFG.EMPTY_VAL) spoken = await recognize(env, v, a, spoken);
    else if (looksLikeRecording(spoken)) {
      return { body: `id_list_message=t-זיהוי הדיבור עדיין לא הוגדר נכון&go_to_folder=${back(env)}&` };
    }
    if (!spoken || spoken === CFG.EMPTY_VAL) { note = 'לא הצלחתי להבין. '; continue; }
    const found = searchBusinesses(spoken, rows);
    if (!found.results.length) { note = 'לא נמצא עסק בשם הזה. '; continue; }

    for (let i = 0; i < found.results.length; i++) {
      const kKey = `k${a}_${i}`;
      const biz = found.results[i];
      if (!has(v, kKey)) return { body: readConfirm(kKey, biz.name) };
      if (v[kKey] === '1') return { body: await finish(env, biz) };
    }
    note = 'אלו כל התוצאות. ';
  }
  return { note };
}

// נקודת ההרחבה לשלב הבא: שליחת הפקס עם המסמך הקבוע של העסק.
async function finish(env, biz) {
  return `id_list_message=${say(`נבחר ${biz.name}`)}&go_to_folder=${back(env)}&`;
}

// ----------------------------------------------------------------------------
//  פקודות ימות
// ----------------------------------------------------------------------------
// מצב הקלטה: פקודת record של ימות, שמקליטה לקובץ בתיקיית ההקלטות. את הקובץ אנחנו קובעים
// (recFile), כך שאפשר להוריד אותו בלי להסתמך על הערך שימות מחזירה במשתנה.
// הזנב ניתן לדריסה ב-env.IVR_VOICE_READ_OPTS; {folder} ו-{file} מוחלפים.
// מצב טקסט (בלי Azure): הזנב הוא מה שימות מגדירים לקבלת טקסט מזוהה.
function readSpeech(env, v, a, record, msg) {
  const tail = (env.IVR_VOICE_READ_OPTS || 'no,record,{folder},{file},no,yes,no')
    .replace('{folder}', recFolder(env)).replace('{file}', recFile(v, a));
  return `read=${say(msg)}=s${a},${tail}`;
}

const recFolder = (env) => (env.IVR_REC_FOLDER || '/6').replace(/\/$/, '');
const recFile = (v, a) => `r${String(v.ApiCallId || 'x').replace(/\W/g, '')}_${a}`;

// הקלטה -> טקסט (עם מטמון לשיחה, כי כל שלב אישור הוא בקשה חדשה).
async function recognize(env, v, a, value) {
  const callId = String(v.ApiCallId || '');
  const cached = await sttGet(env, callId, a);
  if (cached !== null) return cached;
  const folder = recFolder(env), file = recFile(v, a);
  const { text } = await transcribeRecording(env, [
    ...(looksLikeRecording(value) ? [value] : []),
    `${folder}/${file}.wav`,
    `${folder}/${file}`,
  ]);
  await sttPut(env, callId, a, text);
  return text;
}

function readConfirm(valName, name) {
  return readTap(`האם התכוונתם ל${name}. להמשך הקישו אחת, לתוצאה הבאה הקישו שתיים`, valName, ['1', '2']);
}

function readDigits(env, valName, msg) {
  return readTap(msg, valName, null, { max: 9, min: 5 });
}

// כמו readTap ב-ivr.js של revach (אותו סדר פרמטרים שכבר עובד בשלוחות הקיימות).
function readTap(msg, valName, digitsAllowed, opts = {}) {
  const ops = [
    valName, 'no',
    opts.max != null ? opts.max : 1,
    opts.min != null ? opts.min : 1,
    CFG.SEC_WAIT, 'No', 'no', 'no', '',
    digitsAllowed ? digitsAllowed.join('.') : '',
    '', 'Ok', CFG.EMPTY_VAL, '',
  ];
  return `read=${say(msg)}=${ops.join(',')}`;
}

// ----------------------------------------------------------------------------
//  עזרים
// ----------------------------------------------------------------------------
// ימות מפרקת הודעות לפי = & , . ואין בה גרשיים בשמות - מנקים מהטקסט המוקרא.
function ttsClean(s) {
  return String(s || '')
    .replace(/בע["\u05f4]מ/g, 'בערבון מוגבל')
    .replace(/["'״׳“”]/g, '')
    .replace(/[=&,.\n\r]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
const say = (s) => 't-' + ttsClean(s);

const back = (env) => (env && env.IVR_BACK_FOLDER) || CFG.BACK_FOLDER;
const has = (v, k) => Object.prototype.hasOwnProperty.call(v, k);
const looksLikeRecording = (s) => /\.(wav|mp3|ogg)$/i.test(s) || /^\/.*\//.test(s);

function text(body) {
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}

// GET query / POST form / POST json. כפילויות -> ערך אחרון.
async function parseYemot(request) {
  const out = {};
  const url = new URL(request.url);
  for (const [k, val] of url.searchParams) out[k] = val;
  if (request.method === 'POST') {
    const ct = request.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      Object.assign(out, await request.json().catch(() => ({})));
    } else {
      const body = await request.text();
      for (const [k, val] of new URLSearchParams(body)) out[k] = val;
    }
  }
  return out;
}
