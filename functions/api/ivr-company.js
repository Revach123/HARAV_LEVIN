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
//    2. h       - אחרי שלושה ניסיונות (או אם הדיבור לא מוגדר): הקשת ח.פ.
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

  if ((raw[CFG.TOKEN_PARAM] || '') !== (env.IVR_SECRET || '')) {
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
  let note = '';                                   // הודעה שתצורף לשאלה הבאה

  if (voice) {
    for (let a = 1; a <= CFG.MAX_SPEECH_ATTEMPTS; a++) {
      const sKey = `s${a}`;
      if (!has(v, sKey)) {
        return readSpeech(env, v, a, record, note + (a === 1 ? 'אמרו את שם העסק' : 'אמרו שוב את שם העסק'));
      }

      let spoken = String(v[sKey]);
      if (record && spoken !== CFG.EMPTY_VAL) spoken = await recognize(env, v, a, spoken);
      else if (looksLikeRecording(spoken)) {
        return `id_list_message=t-זיהוי הדיבור עדיין לא הוגדר נכון&go_to_folder=${back(env)}&`;
      }
      if (!spoken || spoken === CFG.EMPTY_VAL) { note = 'לא הצלחתי להבין. '; continue; }
      const found = searchBusinesses(spoken, rows);
      if (!found.results.length) { note = 'לא נמצא עסק בשם הזה. '; continue; }

      for (let i = 0; i < found.results.length; i++) {
        const kKey = `k${a}_${i}`;
        const biz = found.results[i];
        if (!has(v, kKey)) return readConfirm(kKey, biz.name);
        if (v[kKey] === '1') return await finish(env, biz);
      }
      note = 'אלו כל התוצאות. ';
    }
  }

  // ----- מסלול ח.פ. -----
  if (!has(v, 'h')) {
    return readDigits(env, 'h', note + 'הקישו את מספר החברה, תשע ספרות, ואחריו סולמית');
  }
  const chp = String(v.h).replace(/\D/g, '');
  const biz = chp ? rows.find((r) => String(r.chp_number || '').replace(/\D/g, '') === chp) : null;
  if (!biz) return `id_list_message=t-לא נמצא עסק במספר הזה&go_to_folder=${back(env)}&`;

  const hit = { id: biz.id, chp_number: biz.chp_number, name: biz.registrar_name || biz.permit_name };
  if (!has(v, 'kh')) return readConfirm('kh', hit.name);
  if (v.kh === '1') return await finish(env, hit);
  return `id_list_message=t-בסדר&go_to_folder=${back(env)}&`;
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
