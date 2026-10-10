// ============================================================================
//  functions/api/ivr-company.js — חיפוש חברה בקול, לשלוחת ימות המשיח 6
//
//  Pages Function (מנותבת אוטומטית ל-/api/ivr-company). שלוחה נפרדת לגמרי:
//  אין שום תלות בשלוחה 5 או בהודעת הפתיחה שלה.
//
//  מחפשת בכל מאגר הרישום (חברות, שותפויות, עמותות) - ראו _shared/registry-search.js.
//  לכל תוצאה מקריאים: סוג (חברה פרטית/ציבורית, שותפות מוגבלת, עמותה...), שם (בלי בע"מ),
//  ומצב היתר העסקה (פרטי / כללי / לא קיים). כל התוצאות מוקראות ברצף, כל אחת בהודעה נפרדת.
//
//  זרימה (בלי מצב בשרת - הכול נגזר מהמשתנים שימות מחזירה בכל קריאה). כל "סבב" חיפוש
//  מקבל מספר r, והמשתנים שלו נושאים אותו כסיומת:
//    m<r>        תפריט פותח (רק כשיש זיהוי דיבור): 1 = לפי ח.פ. (מומלץ), 2 = לפי שם
//    h<r>        הקשת ח.פ.
//    s<r>_<a>    דיבור, ניסיון a (עד 3): הקלטה + Azure, או טקסט מזוהה מימות
//    nx<r>       אחרי ההקראה: 1 = חיפוש נוסף (סבב חדש), 2 = סיום
//
//  דרישות: env.IVR_SECRET, binding DB (טבלת businesses - מצב היתר העסקה).
//  מאגר הרישום: binding DB1 = company-info-db (בלעדיו נופלים לטבלת businesses בלבד).
//  זיהוי חיצוני: AZURE_SPEECH_KEY, AZURE_SPEECH_REGION, YEMOT_TOKEN (או YEMOT_TTS).
//  אופציונלי: IVR_VOICE_READ_OPTS, IVR_REC_FOLDER (ברירת מחדל /6), IVR_REC_MAX_SEC (8),
//             IVR_REC_MIN_SEC (1), IVR_BACK_FOLDER (ברירת מחדל /5).
// ============================================================================

import { loadBusinesses } from './_shared/businesses-cache.js';
import { sttConfigured, transcribeRecording } from './_shared/stt-azure.js';
import { sttGet, sttPut } from './_shared/stt-cache.js';
import { MAX_LIST, describe, permitIndex, searchByChp, searchByName } from './_shared/registry-search.js';

const CFG = {
  TOKEN_PARAM: 'sk',       // api_add_0=sk=<secret> בהגדרת השלוחה
  BACK_FOLDER: '/5',       // לאן חוזרים בסיום (env.IVR_BACK_FOLDER דורס)
  MAX_SPEECH_ATTEMPTS: 3,
  MAX_ROUNDS: 6,
  EMPTY_VAL: 'NONE',       // הערך שימות מחזירה כשלא נאמר/הוקש כלום
  SEC_WAIT: 7,             // כמה שניות ממתינים להקשה
  REC_MIN_SEC: 1,          // הקלטה: מינימום / מקסימום שניות (נדרסים ב-env)
  REC_MAX_SEC: 8,
};

const TOO_MANY_MSG = 'הרבה מדי אפשרויות. אנא אמרו את השם המלא, או חפשו לפי מספר ח פ. לאמירת השם המלא הקישו 1. לחיפוש לפי ח פ הקישו 2';
const MENU_MSG = 'מומלץ לחפש לפי ח פ של החברה. במידה שיש לכם את מספר הח פ, הקישו 1. אם לא, הקישו 2 לחיפוש לפי שם החברה';

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
    const ctx = { v: raw, env, rows, permitOf: permitIndex(rows), record: sttConfigured(env) };
    ctx.voice = ctx.record || !!env.IVR_VOICE_READ_OPTS;
    return text(await route(ctx));
  } catch (e) {
    console.log(`ivr-company error: ${e && e.message}`);
    return text(`id_list_message=t-אירעה שגיאה&go_to_folder=${back(env)}&`);
  }
}

// ----------------------------------------------------------------------------
//  מכונת מצבים
// ----------------------------------------------------------------------------
async function route(ctx) {
  const { v, env } = ctx;
  for (let r = 1; r <= CFG.MAX_ROUNDS; r++) {
    const nx = `nx${r}`;
    if (has(v, nx)) {
      if (v[nx] === '1') continue;                  // חיפוש נוסף -> הסבב הבא
      return `id_list_message=t-תודה ולהתראות&go_to_folder=${back(env)}&`;
    }
    return await round(ctx, r);
  }
  return `id_list_message=t-תודה ולהתראות&go_to_folder=${back(env)}&`;
}

async function round(ctx, r) {
  const { v } = ctx;

  // בלי זיהוי דיבור אין מה לבחור: ח.פ. בלבד.
  if (!ctx.voice) return (await chpStep(ctx, r, '', false)).body;

  // תפריט פותח: 1 = לפי ח.פ. (מומלץ), 2 = לפי שם.
  const mKey = `m${r}`;
  if (!has(v, mKey)) return readTap(MENU_MSG, mKey, ['1', '2']);

  let note = '';
  if (v[mKey] === '1') {
    const c = await chpStep(ctx, r, '', true);
    if (c.body) return c.body;
    note = c.note;                                  // ח.פ. לא נמצא -> ממשיכים לחיפוש לפי שם
  }

  const n = await nameStep(ctx, r, note);
  if (n.body) return n.body;
  if (n.goChp) return (await chpStep(ctx, r, '', false)).body;

  // כל הניסיונות לפי שם נכשלו: אם עוד לא ניסו ח.פ., מציעים אותו; אחרת מסיימים.
  if (!has(v, `h${r}`)) return (await chpStep(ctx, r, n.note, false)).body;
  return readNext(r, 'לא נמצאה חברה מתאימה');
}

// חיפוש לפי ח.פ. מחזיר {body} (פקודה לימות) או {note} (להמשיך לחיפוש לפי שם).
async function chpStep(ctx, r, note, fallbackToName) {
  const { v, env, rows } = ctx;
  const hKey = `h${r}`;
  if (!has(v, hKey)) {
    return { body: readTap(note + 'הקישו את מספר הח פ, תשע ספרות, ואחריו סולמית', hKey, null, { max: 9, min: 5 }) };
  }
  const items = v[hKey] === CFG.EMPTY_VAL ? [] : await searchByChp(env, v[hKey], rows);
  if (items.length) return { body: listing(ctx, r, items) };
  if (fallbackToName && ctx.voice) return { note: 'לא נמצאה חברה במספר הזה. ' };
  return { body: readNext(r, 'לא נמצאה חברה במספר הזה') };
}

// חיפוש לפי שם (דיבור): עד MAX_SPEECH_ATTEMPTS ניסיונות.
async function nameStep(ctx, r, note) {
  const { v, env, rows, record } = ctx;
  for (let a = 1; a <= CFG.MAX_SPEECH_ATTEMPTS; a++) {
    const sKey = `s${r}_${a}`;
    if (!has(v, sKey)) {
      return { body: readSpeech(env, v, r, a, note + (a === 1 ? 'אמרו את שם החברה' : 'אמרו שוב את שם החברה')) };
    }

    let spoken = String(v[sKey]);
    if (record && spoken !== CFG.EMPTY_VAL) spoken = await recognize(env, v, r, a, spoken);
    else if (looksLikeRecording(spoken)) {
      return { body: `id_list_message=t-זיהוי הדיבור עדיין לא הוגדר נכון&go_to_folder=${back(env)}&` };
    }
    if (!spoken || spoken === CFG.EMPTY_VAL) { note = 'לא הצלחתי להבין. '; continue; }

    const found = await searchByName(env, spoken, rows);
    if (!found.items.length) { note = 'לא נמצאה חברה בשם הזה. '; continue; }
    if (found.tooMany) {
      // יותר מ-MAX_LIST תוצאות: לא מקריאים. מציעים שם מלא יותר, או ח.פ.
      const tKey = `t${r}_${a}`;
      if (!has(v, tKey)) return { body: readTap(TOO_MANY_MSG, tKey, ['1', '2']) };
      if (v[tKey] === '2') return { goChp: true };
      note = '';
      continue;
    }
    return { body: listing(ctx, r, found.items) };
  }
  return { note };
}

// ----------------------------------------------------------------------------
//  הקראת תוצאות: כל חברה בשלוש הודעות נפרדות (סוג, שם, מצב היתר), כולן ברצף,
//  ובסוף שאלה: חיפוש נוסף / סיום. (בהמשך: הקשה לקבלת המסמך של החברה.)
// ----------------------------------------------------------------------------
function listing(ctx, r, items) {
  const parts = [];
  for (const item of items.slice(0, MAX_LIST)) {
    for (const piece of describe(item, ctx.permitOf)) parts.push(say(piece));
  }
  parts.push(say('לחיפוש נוסף הקישו 1. לסיום הקישו 2'));
  return readTapRaw(parts.join('.'), `nx${r}`, ['1', '2']);
}

function readNext(r, msg) {
  return readTap(`${msg}. לחיפוש נוסף הקישו 1. לסיום הקישו 2`, `nx${r}`, ['1', '2']);
}

// ----------------------------------------------------------------------------
//  פקודות ימות
// ----------------------------------------------------------------------------
// מצב הקלטה: פקודת record של ימות, שמקליטה לקובץ בתיקיית ההקלטות. את הקובץ אנחנו קובעים
// (recFile), כך שאפשר להוריד אותו בלי להסתמך על הערך שימות מחזירה במשתנה.
// ברירת המחדל כוללת הגבלת זמן (מינימום,מקסימום שניות) כדי שלא ימתינו לדיבור בלי סוף.
// ניתן לדרוס את כל הזנב ב-env.IVR_VOICE_READ_OPTS; {folder} {file} {min} {max} מוחלפים.
// מצב טקסט (בלי Azure): הזנב הוא מה שימות מגדירים לקבלת טקסט מזוהה.
function readSpeech(env, v, r, a, msg) {
  const max = intEnv(env.IVR_REC_MAX_SEC, CFG.REC_MAX_SEC);
  const min = intEnv(env.IVR_REC_MIN_SEC, CFG.REC_MIN_SEC);
  const limits = max > 0 ? `,${min},${max}` : '';           // IVR_REC_MAX_SEC=0 -> בלי הגבלה
  const tail = (env.IVR_VOICE_READ_OPTS || `no,record,{folder},{file},no,yes,no${limits}`)
    .replace('{folder}', recFolder(env)).replace('{file}', recFile(v, r, a))
    .replace('{min}', String(min)).replace('{max}', String(max));
  return `read=${say(msg)}=s${r}_${a},${tail}`;
}

const intEnv = (val, dflt) => { const n = parseInt(val, 10); return Number.isFinite(n) ? n : dflt; };
const recFolder = (env) => (env.IVR_REC_FOLDER || '/6').replace(/\/$/, '');
const recFile = (v, r, a) => `r${String(v.ApiCallId || 'x').replace(/\W/g, '')}_${r}_${a}`;

// הקלטה -> טקסט (עם מטמון לשיחה, כי כל שלב הוא בקשה חדשה).
async function recognize(env, v, r, a, value) {
  const callId = String(v.ApiCallId || '');
  const slot = r * 10 + a;
  const cached = await sttGet(env, callId, slot);
  if (cached !== null) return cached;
  const folder = recFolder(env), file = recFile(v, r, a);
  const { text } = await transcribeRecording(env, [
    ...(looksLikeRecording(value) ? [value] : []),
    `${folder}/${file}.wav`,
    `${folder}/${file}`,
  ]);
  await sttPut(env, callId, slot, text);
  return text;
}

// כמו readTap ב-ivr.js של revach (אותו סדר פרמטרים שכבר עובד בשלוחות הקיימות).
function readTap(msg, valName, digitsAllowed, opts = {}) {
  return readTapRaw(say(msg), valName, digitsAllowed, opts);
}

function readTapRaw(msgParts, valName, digitsAllowed, opts = {}) {
  const ops = [
    valName, 'no',
    opts.max != null ? opts.max : 1,
    opts.min != null ? opts.min : 1,
    CFG.SEC_WAIT, 'No', 'no', 'no', '',
    digitsAllowed ? digitsAllowed.join('.') : '',
    '', 'Ok', CFG.EMPTY_VAL, '',
  ];
  return `read=${msgParts}=${ops.join(',')}`;
}

// ----------------------------------------------------------------------------
//  עזרים
// ----------------------------------------------------------------------------
// ימות מפרקת הודעות לפי = & , . ואין בה גרשיים בשמות - מנקים מהטקסט המוקרא.
function ttsClean(s) {
  return String(s || '')
    .replace(/(^|[^א-ת])בע["״]?מ(?![א-ת])/g, '$1בֵּית עַיִן מֵם')   // בע"מ מוקרא בראשי תיבות
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
