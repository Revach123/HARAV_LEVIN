// ============================================================================
//  functions/api/ivr-company.js — חיפוש חברה בקול, לשלוחת ימות המשיח 6
//
//  Pages Function (מנותבת אוטומטית ל-/api/ivr-company). שלוחה נפרדת לגמרי:
//  אין שום תלות בשלוחה 5 או בהודעת הפתיחה שלה.
//
//  מחפשת בכל מאגר הרישום (חברות, שותפויות, עמותות) - ראו _shared/registry-search.js.
//  לכל תוצאה מקריאים: סוג (חברה פרטית/ציבורית, שותפות מוגבלת, עמותה...), שם (בלי בע"מ),
//  ומצב היתר העסקה (רק פרטי / כללי / כללי וגם פרטי / לא קיים). כל התוצאות מוקראות ברצף, כל אחת בהודעה נפרדת.
//
//  זרימה (בלי מצב בשרת - הכול נגזר מהמשתנים שימות מחזירה בכל קריאה). כל "סבב" חיפוש
//  מקבל מספר r, והמשתנים שלו נושאים אותו כסיומת:
//    m<r>        תפריט פותח (רק כשיש זיהוי דיבור): 1 = לפי ח.פ. (מומלץ), 2 = לפי שם
//    h<r>        הקשת ח.פ.
//    s<r>_<a>    דיבור, ניסיון a (עד 5): הקלטה + Azure, או טקסט מזוהה מימות
//    c<r>_<a>    אחרי הקראת מה שזוהה: 1 = אישור וחיפוש, 2 = הקלטה נוספת (הניסיון הבא)
//    nx<r>       אחרי ההקראה: 0 = חיפוש נוסף (סבב חדש), * = חזרה לתפריט הראשי (bk), 9 = התוצאות הבאות (דף p: nx<r>p<p>),
//                1..8 = השטר בפקס לחברה שאחריה נאמר "לקבלת השטר לחברה זו הקישו k" (רק עם שטר שמוצג באתר ו-FAX_API_KEY)
//    פקס (_shared/ivr-fax.js): fd<r> בחירת שטר (כשיש לחברה כמה: כללי / פרטי, אג"ח, תתי-שורות),
//                fx<r>_<k> מספר הפקס (ניסיון k), fy<r>_<k> אישור (1) / שינוי (2), ns<r> אחרי השליחה: 0 = חיפוש נוסף, * = תפריט ראשי
//
//  דרישות: env.IVR_SECRET, binding DB (טבלת businesses - מצב היתר העסקה).
//  מאגר הרישום: binding DB1 = company-info-db (בלעדיו נופלים לטבלת businesses בלבד).
//  זיהוי חיצוני: AZURE_SPEECH_KEY, AZURE_SPEECH_REGION, YEMOT_TOKEN (או YEMOT_TTS).
//  סוד: IVR_SECRET (קו ישן) או IVR_SECRET_NEW (קו חדש). פרמטר אופציונלי מהשלוחה: bk=<תיקיית חזרה> (api_add_1=bk=/), rf=<תיקיית ההקלטות> (api_add_2=rf=/2).
//  אופציונלי: IVR_AUDIO_OFF=1 (בלי קבצי שמע של Azure), IVR_VOICE_READ_OPTS, IVR_REC_FOLDER (ברירת מחדל /6), IVR_REC_MAX_SEC (8),
//             IVR_REC_MIN_SEC (1), IVR_BACK_FOLDER (ברירת מחדל /5).
// ============================================================================

import { loadBusinesses } from './_shared/businesses-cache.js';
import { sttConfigured, transcribeRecording } from './_shared/stt-azure.js';
import { sttGet, sttPut } from './_shared/stt-cache.js';
import { MAX_LIST, describe, permitIndex, searchByChp, searchByName } from './_shared/registry-search.js';
import { ttsClean, unit } from './_shared/ivr_phrases.js';
import MANIFEST from './_shared/ivr_audio_manifest.js';
import { folderParam, parseYemot, secretOk } from './_shared/ivr-auth.js';
import { docListFor, faxEnabled, loadState, normFax, reserve, saveState, sendFax } from './_shared/ivr-fax.js';

const CFG = {
  TOKEN_PARAM: 'sk',       // api_add_0=sk=<secret> בהגדרת השלוחה
  BACK_FOLDER: '/5',       // לאן חוזרים בסיום (env.IVR_BACK_FOLDER דורס)
  MAX_SPEECH_ATTEMPTS: 5,          // כולל "הקלטה נוספת" אחרי הקראת מה שזוהה
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

export async function onRequest({ request, env, waitUntil }) {
  MF = String(env.IVR_AUDIO_OFF || '') === '1' ? {} : MANIFEST;
  const raw = await parseYemot(request);

  const sent = String(raw[CFG.TOKEN_PARAM] || '').trim();
  if (!secretOk(env, sent)) {
    // אבחון בלי לחשוף ערכים: האם הסוד מוגדר בכלל, ומה האורכים
    const expected = String(env.IVR_SECRET || '').trim();
    console.log(`ivr-company auth fail: IVR_SECRET ${expected ? 'set' : 'NOT SET'} (len ${expected.length}), sk ${sent ? 'sent' : 'MISSING'} (len ${sent.length})`);
    return text('id_list_message=t-שגיאת הרשאה&');
  }
  if (raw.hangup === 'yes') return text('');

  try {
    const rows = await loadBusinesses(env);
    const ctx = { v: raw, env, rows, permitOf: permitIndex(rows), record: sttConfigured(env), waitUntil: waitUntil || ((p) => p) };
    ctx.voice = ctx.record || !!env.IVR_VOICE_READ_OPTS;
    return text(await route(ctx));
  } catch (e) {
    console.log(`ivr-company error: ${e && e.message}`);
    return text(`id_list_message=t-אירעה שגיאה&go_to_folder=${back(env, raw)}&`);
  }
}

// ----------------------------------------------------------------------------
//  מכונת מצבים
// ----------------------------------------------------------------------------
async function route(ctx) {
  const { v, env } = ctx;
  rounds: for (let r = 1; r <= CFG.MAX_ROUNDS; r++) {
    if (!has(v, pageVar(r, 1))) return await round(ctx, r);
    for (let p = 1; ; p++) {
      const nx = pageVar(r, p);
      if (!has(v, nx)) return await pageFromState(ctx, r, p);          // אחרי 9: הדף הבא
      if (v[nx] === '0') continue rounds;           // חיפוש נוסף -> הסבב הבא
      if (v[nx] === '*') return `go_to_folder=${back(env, v)}&`;          // חזרה לתפריט הראשי
      if (v[nx] === '9') continue;                  // התוצאות הבאות
      if (/^[1-8]$/.test(v[nx]) && faxEnabled(env)) {          // שטר בפקס לחברה k בדף הזה
        const ns = `ns${r}`;
        if (v[ns] === '0') continue rounds;
        if (v[ns] === '*') return `go_to_folder=${back(env, v)}&`;
        return await faxFlow(ctx, r, parseInt(v[nx], 10), p);
      }
      return p === 1 && !(await loadState(env, String(v.ApiCallId || ''), slot(r, 1))) ? readNext(r, []) : await pageFromState(ctx, r, p);          // שתיקה / ערך אחר: שואלים שוב
    }
  }
  return `id_list_message=${P('bye')}&go_to_folder=${back(env, v)}&`;
}

async function round(ctx, r) {
  const { v } = ctx;

  // בלי זיהוי דיבור אין מה לבחור: ח.פ. בלבד.
  if (!ctx.voice) return (await chpStep(ctx, r, '', false)).body;

  // תפריט פותח: 1 = לפי ח.פ. (מומלץ), 2 = לפי שם.
  const mKey = `m${r}`;
  if (v[mKey] !== '1' && v[mKey] !== '2') return readTapRaw(P('menu'), mKey, ['1', '2']);   // שתיקה: שואלים שוב

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
  if (!has(v, hKey) || v[hKey] === CFG.EMPTY_VAL) {     // לא הוקש כלום: שואלים שוב, בלי הגבלה
    return { body: readTapRaw(msg(notes(note), P('askChp')), hKey, null, { max: 10, min: 5 }) };
  }
  const items = await searchByChp(env, v[hKey], rows);
  if (items.length) return { body: await listing(ctx, r, items) };
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

    if (v[sKey] === CFG.EMPTY_VAL) {                   // לא נאמר / לא הוקלט כלום: שואלים שוב את אותה שאלה, בלי הגבלה
      return { body: readSpeech(env, v, r, a, msg(notes(['noHear']), P(a === 1 ? 'ask1' : 'ask2'))) };
    }
    let spoken = String(v[sKey]);
    if (record && spoken !== CFG.EMPTY_VAL) spoken = await recognize(env, v, r, a, spoken);
    else if (looksLikeRecording(spoken)) {
      return { body: `id_list_message=t-זיהוי הדיבור עדיין לא הוגדר נכון&go_to_folder=${back(env, v)}&` };
    }
    if (!spoken || spoken === CFG.EMPTY_VAL) { note = ['noHear']; continue; }
    // מקריאים את מה שזוהה ומבקשים אישור (1) או הקלטה נוספת (2)
    const cKey = `c${r}_${a}`;
    if (v[cKey] !== '1' && v[cKey] !== '2') return { body: readTapRaw(msg(P('heard'), say(spoken), P('heardOk')), cKey, ['1', '2']) };
    if (v[cKey] === '2') { note = []; continue; }

    const found = await searchByName(env, spoken, rows);
    if (!found.items.length) { note = ['noName']; continue; }
    if (found.tooMany) {
      // יותר מ-MAX_PAGED תוצאות (או חיפוש שנקטע): לא מקריאים. מציעים שם מלא יותר, או ח.פ.
      const tKey = `t${r}_${a}`;
      if (v[tKey] !== '1' && v[tKey] !== '2') return { body: readTapRaw(P('tooMany'), tKey, ['1', '2']) };
      if (v[tKey] === '2') return { goChp: true };
      note = [];
      continue;
    }
    return { body: await listing(ctx, r, found.items) };
  }
  return { note };
}

// ----------------------------------------------------------------------------
//  הקראת תוצאות: כל חברה בשלוש הודעות נפרדות (סוג, שם, מצב היתר), כולן ברצף,
//  אחרי כל חברה עם שטר שמוצג באתר: "לקבלת שטר היתר העסקה לחברה זו בפקס הקישו k". בסוף: 0 = חיפוש נוסף, * = תפריט ראשי.
// ----------------------------------------------------------------------------
// דף p של התוצאות (8 בכל דף): המשתנה nx<r> לדף הראשון, nx<r>p<p> לדפים הבאים. מצב הדף נשמר ב-slot(r, p).
const pageVar = (r, p) => (p === 1 ? `nx${r}` : `nx${r}p${p}`);
const slot = (r, p) => r * 100 + p;
async function pageFromState(ctx, r, p) {
  const st = await loadState(ctx.env, String(ctx.v.ApiCallId || ''), slot(r, Math.max(1, p - 1)));
  if (!st || !st.items) return readNext(r, []);
  return listing(ctx, r, st.items, p);
}

async function listing(ctx, r, all, p = 1) {
  const items = all.slice((p - 1) * MAX_LIST, p * MAX_LIST), more = all.length > p * MAX_LIST;
  const parts = p > 1 ? [] : [all.length === 1 ? P('found1') : say(`נמצאו ${all.length} חברות מתאימות`)], faxable = [];
  const fax = faxEnabled(ctx.env);
  for (const item of items) {
    const d = describe(item, ctx.permitOf);
    if (fax && !faxable.some((x) => x.chp === String(item.id))) {          // חברה עם שטר שמוצג באתר -> אפשר לשלוח בפקס (כל ח.פ. פעם אחת)
      const choices = await docListFor(ctx.env, item.id);
      if (choices.length) faxable.push({ chp: String(item.id), name: d.name, choices });
    }
    parts.push(P(`type:${d.type}`), say(d.name));              // שם החברה: TTS של ימות
    if (d.baam) parts.push(P('baam'));
    if (d.permit === 'private') parts.push(P('permit:private'), P('permit:private2'));
    else if (d.permit === 'both') parts.push(P('permit:alsoPrivate'));
    else parts.push(P(d.permit === 'general' ? 'permit:general' : 'permit:none'));
    const k = faxable.findIndex((x) => x.chp === String(item.id) && !x.said) + 1;
    if (k) { faxable[k - 1].said = true; parts.push(P('fax:forCo'), say(`הקישו ${k}`)); }
  }
  if (more) parts.push(P('more'));
  parts.push(P('next'));
  // מצב הדף (כל התוצאות + החברות עם שטר בדף הזה), לדף הבא ולפקס. נשמר רק כשצריך.
  if (faxable.length || more) {
    await saveState(ctx.env, String(ctx.v.ApiCallId || ''), slot(r, p), { items: all.map(({ kind, id, name, status, sub }) => ({ kind, id, name, status, sub })), list: faxable.map(({ said, ...x }) => x) });
  }
  return readTapRaw(parts.join('.'), pageVar(r, p), ['0', '*', ...(more ? ['9'] : []), ...faxable.map((_, i) => String(i + 1))]);
}

// ----------------------------------------------------------------------------
//  שטר בפקס לחברה k (נבחרה בהקראה) -> בחירת שטר (אם יש כמה) -> מספר פקס -> אישור -> שליחה ברקע
// ----------------------------------------------------------------------------
const afterFax = (r, keys) => readTapRaw(msg(notes(keys), P('next')), `ns${r}`, ['0', '*']);

async function faxFlow(ctx, r, pick, p = 1) {
  const { v, env } = ctx;
  const callId = String(v.ApiCallId || '');
  const st = callId ? await loadState(env, callId, slot(r, p)) : null;
  const list = (st && st.list) || [];
  if (!list.length) return afterFax(r, ['fax:none']);

  const co = list[pick - 1];
  if (!co) return readNext(r, []);          // מספר שלא הוצע: שואלים שוב

  let doc = co.choices[0];
  const nDocs = co.choices.length;
  if (nDocs > 1) {          // "לחברה יש N שטרות", ואחריו "לשטר ... הקישו k" לכל שטר
    const fd = `fd${r}`, j = parseInt(v[fd], 10);
    if (!(j >= 1 && j <= nDocs)) {
      const two = nDocs > 9;
      const opts = co.choices.map((c, i) => say(`${c.label} הקישו ${i + 1}`));
      return readTapRaw(msg(say(`לחברה יש ${nDocs} שטרות`), opts, two ? say('ואחרי המספר סולמית') : ''), fd,
        two ? null : co.choices.map((_, i) => String(i + 1)), two ? { max: 2, min: 1 } : {});
    }
    doc = co.choices[j - 1];
  }

  let note = [];
  for (let k = 1; k <= 5; k++) {
    const fx = `fx${r}_${k}`, fy = `fy${r}_${k}`;
    if (!has(v, fx) || v[fx] === CFG.EMPTY_VAL) return readTapRaw(msg(notes(note), P('fax:ask')), fx, null, { max: 11, min: 9 });
    const num = normFax(v[fx]);
    if (!num) { note = ['fax:bad']; continue; }
    if (v[fy] !== '1' && v[fy] !== '2') return readTapRaw(msg(P('fax:typed'), `d-${num}`, P('fax:confirm')), fy, ['1', '2']);
    if (v[fy] === '2') { note = []; continue; }
    // אושר: רישום (פעם אחת לכל ניסיון, גם אם ימות שולחת שוב) ושליחה ברקע
    const res = await reserve(env, { callId, slot: `${r}_${k}`, caller: v.ApiPhone || '', fax: num, chp: co.chp, company: co.name, kind: doc.label, docId: doc.id });
    if (res.limit) return afterFax(r, ['fax:limit']);
    if (res.id) ctx.waitUntil(sendFax(env, res.id, doc.id, num));
    return afterFax(r, ['fax:sent']);
  }
  return afterFax(r, ['fax:bad']);
}

function readNext(r, noteKeys) {
  return readTapRaw(msg(notes(noteKeys), P('next')), `nx${r}`, ['0', '*']);
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
    .replace('{folder}', recFolder(env, v)).replace('{file}', recFile(v, r, a))
    .replace('{min}', String(min)).replace('{max}', String(max));
  return `read=${msgParts}=s${r}_${a},${tail}`;
}

const intEnv = (val, dflt) => { const n = parseInt(val, 10); return Number.isFinite(n) ? n : dflt; };
const recFolder = (env, v) => folderParam(v || {}, 'rf', env.IVR_REC_FOLDER || '/6').replace(/\/$/, '');   // rf=<תיקייה> (api_add_2=rf=/2) דורס
const recFile = (v, r, a) => `r${String(v.ApiCallId || 'x').replace(/\W/g, '')}_${r}_${a}`;

// הקלטה -> טקסט (עם מטמון לשיחה, כי כל שלב הוא בקשה חדשה).
async function recognize(env, v, r, a, value) {
  const callId = String(v.ApiCallId || '');
  const slot = r * 10 + a;
  const cached = await sttGet(env, callId, slot);
  if (cached !== null) return cached;
  const folder = recFolder(env, v), file = recFile(v, r, a);
  const { text } = await transcribeRecording(env, [
    ...(looksLikeRecording(value) ? [value] : []),
    `${folder}/${file}.wav`,
    `${folder}/${file}`,
  ]);
  if (text) await sttPut(env, callId, slot, text);       // תוצאה ריקה לא נשמרת: שאלה חוזרת באותו משתנה תזוהה מחדש
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

const back = (env, v) => folderParam(v || {}, 'bk', (env && env.IVR_BACK_FOLDER) || CFG.BACK_FOLDER);
const has = (v, k) => Object.prototype.hasOwnProperty.call(v, k);
const looksLikeRecording = (s) => /\.(wav|mp3|ogg)$/i.test(s) || /^\/.*\//.test(s);

function text(body) {
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
