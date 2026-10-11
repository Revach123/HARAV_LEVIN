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
//  אופציונלי: IVR_AUDIO_OFF=1 (בלי קבצי שמע של Azure), IVR_VOICE_READ_OPTS, IVR_REC_FOLDER (ברירת מחדל /6), IVR_REC_MAX_SEC (8),
//             IVR_REC_MIN_SEC (1), IVR_BACK_FOLDER (ברירת מחדל /5).
// ============================================================================

import { loadBusinesses } from './_shared/businesses-cache.js';
import { sttConfigured, transcribeRecording } from './_shared/stt-azure.js';
import { sttGet, sttPut } from './_shared/stt-cache.js';
import { MAX_LIST, describe, permitIndex, searchByChp, searchByName } from './_shared/registry-search.js';
import { ttsClean, unit } from './_shared/ivr_phrases.js';
import MANIFEST from './_shared/ivr_audio_manifest.js';

const CFG = {
  TOKEN_PARAM: 'sk',       // api_add_0=sk=<secret> בהגדרת השלוחה
  BACK_FOLDER: '/5',       // לאן חוזרים בסיום (env.IVR_BACK_FOLDER דורס)
  MAX_SPEECH_ATTEMPTS: 3,
  MAX_ROUNDS: 6,
  EMPTY_VAL: 'NONE',       // הערך שימות מחזירה כשלא נאמר/הוקש כלום
  SEC_WAIT: 7,             // כמה שניות ממתינים להקשה
  REC_MIN_SEC: 1,          // הקלטה: מינימום / מקסימום שניות (נדרסים ב-env)
  REC_MAX_SEC: 6,
};

// ביטוי קבוע: קובץ שמע של Azure אם הופק (ivr_audio_manifest.js), אחרת TTS של ימות. הודעה = חלקים מחוברים ב-'.'
// env.IVR_AUDIO_OFF = '1' מכבה את קבצי השמע (הכול ב-TTS של ימות). מוגדר בתחילת כל בקשה (קבוע לכל הבקשות).
let MF = MANIFEST;
const P = (key) => unit(key, MF);
const msg = (...parts) => parts.flat().filter(Boolean).join('.');
const notes = (keys) => (keys || []).map(P);

export async function onRequest({ request, env }) {
  MF = String(env.IVR_AUDIO_OFF || '') === '1' ? {} : MANIFEST;
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
      return `id_list_message=${P('bye')}&go_to_folder=${back(env)}&`;
    }
    return await round(ctx, r);
  }
  return `id_list_message=${P('bye')}&go_to_folder=${back(env)}&`;
}

async function round(ctx, r) {
  const { v } = ctx;

  // בלי זיהוי דיבור אין מה לבחור: ח.פ. בלבד.
  if (!ctx.voice) return (await chpStep(ctx, r, '', false)).body;

  // תפריט פותח: 1 = לפי ח.פ. (מומלץ), 2 = לפי שם.
  const mKey = `m${r}`;
  if (!has(v, mKey)) return readTapRaw(P('menu'), mKey, ['1', '2']);

  let note = [];
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
  return readNext(r, ['noMatch']);
}

// חיפוש לפי ח.פ. מחזיר {body} (פקודה לימות) או {note} (להמשיך לחיפוש לפי שם).
async function chpStep(ctx, r, note, fallbackToName) {
  const { v, env, rows } = ctx;
  const hKey = `h${r}`;
  if (!has(v, hKey)) {
    return { body: readTapRaw(msg(notes(note), P('askChp')), hKey, null, { max: 9, min: 5 }) };
  }
  const items = v[hKey] === CFG.EMPTY_VAL ? [] : await searchByChp(env, v[hKey], rows);
  if (items.length) return { body: listing(ctx, r, items) };
  if (fallbackToName && ctx.voice) return { note: ['noChp'] };
  return { body: readNext(r, ['noChp']) };
}

// חיפוש לפי שם (דיבור): עד MAX_SPEECH_ATTEMPTS ניסיונות.
async function nameStep(ctx, r, note) {
  const { v, env, rows, record } = ctx;
  for (let a = 1; a <= CFG.MAX_SPEECH_ATTEMPTS; a++) {
    const sKey = `s${r}_${a}`;
    if (!has(v, sKey)) {
      return { body: readSpeech(env, v, r, a, msg(notes(note), P(a === 1 ? 'ask1' : 'ask2'))) };
    }

    let spoken = String(v[sKey]);
    if (record && spoken !== CFG.EMPTY_VAL) spoken = await recognize(env, v, r, a, spoken);
    else if (looksLikeRecording(spoken)) {
      return { body: `id_list_message=t-זיהוי הדיבור עדיין לא הוגדר נכון&go_to_folder=${back(env)}&` };
    }
    if (!spoken || spoken === CFG.EMPTY_VAL) { note = ['noHear']; continue; }

    const found = await searchByName(env, spoken, rows);
    if (!found.items.length) { note = ['noName']; continue; }
    if (found.tooMany) {
      // יותר מ-MAX_LIST תוצאות: לא מקריאים. מציעים שם מלא יותר, או ח.פ.
      const tKey = `t${r}_${a}`;
      if (!has(v, tKey)) return { body: readTapRaw(P('tooMany'), tKey, ['1', '2']) };
      if (v[tKey] === '2') return { goChp: true };
      note = [];
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
    const d = describe(item, ctx.permitOf);
    parts.push(P(`type:${d.type}`), say(d.name));              // שם החברה: TTS של ימות
    if (d.baam) parts.push(P('baam'));
    if (d.permit === 'private') parts.push(P('permit:private'), P('permit:private2'));
    else parts.push(P(d.permit === 'general' ? 'permit:general' : 'permit:none'));
  }
  parts.push(P('next'));
  return readTapRaw(parts.join('.'), `nx${r}`, ['1', '2']);
}

function readNext(r, noteKeys) {
  return readTapRaw(msg(notes(noteKeys), P('next')), `nx${r}`, ['1', '2']);
}

// ----------------------------------------------------------------------------
//  פקודות ימות
// ----------------------------------------------------------------------------
// מצב הקלטה: פקודת record של ימות, שמקליטה לקובץ בתיקיית ההקלטות. את הקובץ אנחנו קובעים
// (recFile), כך שאפשר להוריד אותו בלי להסתמך על הערך שימות מחזירה במשתנה.
// ברירת המחדל כוללת הגבלת זמן (מינימום,מקסימום שניות) כדי שלא ימתינו לדיבור בלי סוף.
// ניתן לדרוס את כל הזנב ב-env.IVR_VOICE_READ_OPTS; {folder} {file} {min} {max} מוחלפים.
// מצב טקסט (בלי Azure): הזנב הוא מה שימות מגדירים לקבלת טקסט מזוהה.
function readSpeech(env, v, r, a, msgParts) {
  const max = intEnv(env.IVR_REC_MAX_SEC, CFG.REC_MAX_SEC);
  const min = intEnv(env.IVR_REC_MIN_SEC, CFG.REC_MIN_SEC);
  const limits = max > 0 ? `,${min},${max}` : '';           // IVR_REC_MAX_SEC=0 -> בלי הגבלה
  const tail = (env.IVR_VOICE_READ_OPTS || `no,record,{folder},{file},no,yes,no${limits}`)
    .replace('{folder}', recFolder(env)).replace('{file}', recFile(v, r, a))
    .replace('{min}', String(min)).replace('{max}', String(max));
  return `read=${msgParts}=s${r}_${a},${tail}`;
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
