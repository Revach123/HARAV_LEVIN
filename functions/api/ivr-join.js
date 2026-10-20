// ============================================================================
//  functions/api/ivr-join.js — הצטרפות להיתר עסקה פרטי בטלפון (ימות המשיח)
//
//  שלוחת api (ברירת מחדל /1). נרשם באותה טבלה ובאותה הצפנה כמו הטופס באתר (join.js), עם src = "ivr".
//  זרימה - כל השדות של הטופס באתר (join.html). כל משתנה ימות נשמר גם בשרת (מוצפן), כך שאם ימות מפעילה את השלוחה מחדש ממשיכים:
//    id        תעודת זהות (הקשה, בדיקת ספרת ביקורת)
//    fn, ln    שם פרטי, שם משפחה (שתי הקלטות)
//    pc / ph   אם מספר המתקשר זוהה: 1 = משתמשים בו, 2 = מקישים אחר (ph)
//    p2q / p2  טלפון נוסף (רשות)
//    ad        כתובת (הקלטה)
//    emq / em  אימייל (רשות, הקלטה)
//    fxq / fx  פקס (רשות)
//    ch, cl    1 = כל החברות, 2 = חברות מסוימות (cl = הקלטת השמות)
//    rd        1 = להקריא את נוסח השטר המלא (14 פסקאות), 2 = להמשיך
//    ag        הצהרה: 1 = מאשר ונרשם, 2 = שמיעה חוזרת של השטר המלא, 3 = ביטול
//  כל שאלה שלא נענתה נשאלת שוב ושוב (אותו משתנה), בלי הגבלת ניסיונות.
//  ההקלטות נשמרות בימות בתיקיית השלוחה (IVR_JOIN_REC_FOLDER, ברירת מחדל /1); נתיבן נשמר ברשומה (שדות "הקלטת ..." בהערות).
//  ext.ini:  type=api / api_link=https://harav-levin.pages.dev/api/ivr-join / api_add_0=sk=<IVR_SECRET_NEW> / api_add_1=bk=/
//  דרישות: IVR_SECRET (או IVR_SECRET_NEW), JOINERS_KEY, binding DB.
// ============================================================================
import { folderParam, parseYemot, readRecord, readTap, secretOk } from './_shared/ivr-auth.js';
import { AGREEMENT_KEYS, unit } from './_shared/ivr_phrases.js';
import MANIFEST from './_shared/ivr_audio_manifest.js';
import { importKeyForWrite, encryptPii, decryptPii, identHash } from './_shared/joiners-crypto.js';
import { normalizeId, normalizePhone, jerusalemNow, newRowId, clean } from './_shared/join-common.js';
import { azureTranscribe, downloadRecording, sttConfigured } from './_shared/stt-azure.js';
import { sendConfirmation } from './_shared/join-mail.js';
import { pickEmail, spokenEmail } from './_shared/spoken-email.js';

const EMPTY = 'NONE';
const REC_MIN = 1, REC_MAX = 8, REC_ADDR_MAX = 15, REC_LIST_MAX = 30;
const AGREEMENT_VERSION = 'טלפוני-1';

// ---- מצב שיחה מוצפן (ivr_join_state) ----
const STATE_KEYS = ['id', 'fn', 'ln', 'pc', 'ph', 'p2q', 'p2', 'ad', 'emq', 'emn', 'emok', 'emf', 'emskip', 'fxq', 'fx', 'ch', 'cl', 'rd', 'pl'];
const STATE_TTL_MS = 6 * 3600 * 1000;
let stateReady = false;
async function stateKey(env) { try { return await importKeyForWrite(env); } catch { return null; } }
async function ensureState(env) {
  if (stateReady) return;
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS ivr_join_state (call_id TEXT PRIMARY KEY, data TEXT, at INTEGER)').run();
  stateReady = true;
}
async function loadState(env, callId) {
  if (!callId) return {};
  try {
    const key = await stateKey(env);
    if (!key) return {};
    await ensureState(env);
    const r = await env.DB.prepare('SELECT data FROM ivr_join_state WHERE call_id = ?').bind(callId).first();
    return r ? await decryptPii(key, callId, r.data) : {};
  } catch (e) { console.log("state load error", e && e.message); return {}; }
}
async function saveState(env, callId, v) {
  if (!callId) return;
  try {
    await ensureState(env);
    if (v.finished) { await env.DB.prepare('DELETE FROM ivr_join_state WHERE call_id = ?').bind(callId).run(); return; }
    const key = await stateKey(env);
    if (!key) return;
    const keep = {};
    for (const k of STATE_KEYS) if (has(v, k) && !empty(v[k])) keep[k] = v[k];
    if (keep.id) keep.id = normalizeId(keep.id) || undefined;
    for (const k of ['ph', 'p2', 'fx']) if (keep[k]) keep[k] = normalizePhone(keep[k]) || undefined;
    for (const k of ['pc', 'p2q', 'emq', 'fxq', 'ch', 'rd']) if (keep[k] && keep[k] !== '1' && keep[k] !== '2') delete keep[k];
    await env.DB.prepare('INSERT OR REPLACE INTO ivr_join_state (call_id, data, at) VALUES (?, ?, ?)')
      .bind(callId, await encryptPii(key, callId, JSON.parse(JSON.stringify(keep))), Date.now()).run();
    await env.DB.prepare('DELETE FROM ivr_join_state WHERE at < ?').bind(Date.now() - STATE_TTL_MS).run();
  } catch (e) { console.log("state save error", e && e.message); }
}

export async function onRequest({ request, env }) {
  const raw = await parseYemot(request);
  if (!secretOk(env, raw.sk)) return text('id_list_message=t-שגיאת הרשאה&');
  if (raw.hangup === 'yes') return text('');

  // התקדמות השיחה נשמרת (מוצפנת) גם בשרת: אם ימות מפעילה את השלוחה מחדש באמצע (למשל אחרי שתיקה ארוכה),
  // ממשיכים מאותה נקודה ולא מההתחלה. מה שימות שולחת עכשיו גובר על מה ששמור.
  const callId = String(raw.ApiCallId || '').replace(/\W/g, '');
  const v = { ...(await loadState(env, callId)), ...raw };

  const mf = String(env.IVR_AUDIO_OFF || '') === '1' ? {} : MANIFEST;
  const P = (key) => unit(key, mf);
  const bk = folderParam(v, 'bk', env.IVR_BACK_FOLDER || '/');
  const done = (...keys) => (`id_list_message=${keys.map(P).join('.')}&go_to_folder=${bk}&`);

  try {
    const out = await step({ v, env, P, bk, done, origin: new URL(request.url).origin });
    await saveState(env, callId, v);
    return text(out);
  } catch (e) {
    console.log(`ivr-join error: ${e && e.message}`);   // בלי פרטים אישיים בלוג
    return text(done('join:error'));
  }
}

const has = (v, k) => Object.prototype.hasOwnProperty.call(v, k);
const empty = (x) => !x || x === EMPTY;

async function step({ v, env, P, done, origin }) {
  const folder = (env.IVR_JOIN_REC_FOLDER || '/1').replace(/\/$/, '');
  const call = String(v.ApiCallId || 'x').replace(/\W/g, '');
  const recFile = (tag) => `j${call}_${tag}`;
  const recPath = (tag) => `${folder}/${recFile(tag)}`;
  // כל שאלה שלא נענתה (שתיקה או ערך לא תקין) נשאלת שוב ושוב באותו משתנה, בלי הגבלת ניסיונות.
  // הערה לפני השאלה החוזרת (ערך לא תקין) רק כשהמתקשר אכן הקיש/אמר משהו.
  const again = (bad, key) => (has(v, key) && !empty(v[key]) ? `${P(bad)}.` : '');
  const yn = (key, phrase) => (v[key] === '1' || v[key] === '2' ? null : readTap(P(phrase), key, ['1', '2'], { empty: EMPTY }));
  const rec = (key, phrase, max = REC_MAX) => (has(v, key) && !empty(v[key]) ? null : readRecord(P(phrase), key, folder, recFile(key), REC_MIN, max));
  const digits = (key, phrase, bad, norm, max, min) => {
    const val = has(v, key) && !empty(v[key]) ? norm(v[key]) : '';
    return val ? { val } : { ask: readTap(again(bad, key) + P(phrase), key, null, { max, min, empty: EMPTY }) };
  };
  let o;

  // 1. תעודת זהות
  const idQ = digits('id', 'join:askId', 'join:badId', normalizeId, 10, 5);
  if (idQ.ask) return idQ.ask;
  const id = idQ.val;

  // 2. שם פרטי ושם משפחה (שתי הקלטות נפרדות)
  if ((o = rec('fn', 'join:askFirst'))) return o;
  if ((o = rec('ln', 'join:askLast'))) return o;

  // 3. טלפון: אם זוהה מספר המתקשר - בוחרים בו (1) או מקישים אחר (2)
  let phone = '';
  const callerPhone = normalizePhone(v.ApiPhone);
  if (callerPhone) {
    if ((o = yn('pc', 'join:phoneChoice'))) return o;
    if (v.pc === '1') phone = callerPhone;
  }
  if (!phone) {
    const q = digits('ph', 'join:askPhone', 'join:badPhone', normalizePhone, 11, 9);
    if (q.ask) return q.ask;
    phone = q.val;
  }

  // 4. טלפון נוסף (רשות)
  if ((o = yn('p2q', 'join:phone2Q'))) return o;
  let phone2 = '';
  if (v.p2q === '1') {
    const q = digits('p2', 'join:askPhone2', 'join:badPhone', normalizePhone, 11, 9);
    if (q.ask) return q.ask;
    phone2 = q.val;
  }

  // 5. כתובת (הקלטה)
  if ((o = rec('ad', 'join:askAddress', REC_ADDR_MAX))) return o;

  // 6. אימייל (רשות, הקלטה: אותיות בקול)
  if ((o = yn('emq', 'join:emailQ'))) return o;
  let email = '';
  if (v.emq === '1') {
    const q = await emailStep({ v, env, P, folder, recFile });
    if (q.ask) return q.ask;
    email = q.email || '';
  }

  // 7. פקס (רשות)
  if ((o = yn('fxq', 'join:faxQ'))) return o;
  let fax = '';
  if (v.fxq === '1') {
    const q = digits('fx', 'join:askFax', 'join:badPhone', normalizePhone, 11, 9);
    if (q.ask) return q.ask;
    fax = q.val;
  }

  // 8. כל החברות / חברות מסוימות
  if (v.ch !== '1' && v.ch !== '2') return readTap(P('join:choice'), 'ch', ['1', '2'], { empty: EMPTY });
  const all = v.ch === '1';
  if (!all && (o = rec('cl', 'join:askList', REC_LIST_MAX))) return o;

  // 9. הקראת השטר המלא (אופציונלית) והצהרה והסכמה
  if (v.rd !== '1' && v.rd !== '2') return readTap(P('join:askRead'), 'rd', ['1', '2'], { empty: EMPTY });
  if (v.ag !== '1' && v.ag !== '3') {
    // ag=2 = שמיעה חוזרת של השטר המלא (ואז שוב ההצהרה). שתיקה / ערך אחר: ההצהרה לבדה נשאלת שוב.
    // pl: השטר המלא כבר הושמע פעם אחת בשיחה הזו (נשמר גם בשרת) - לא משמיעים אותו שוב מעצמנו, רק בבקשה (2).
    const replay = v.ag === '2' || (!has(v, 'ag') && v.rd === '1' && v.pl !== '1');
    if (replay) v.pl = '1';
    const full = replay ? AGREEMENT_KEYS.map(P).join('.') + '.' : '';
    return readTap(full + P('join:declare'), 'ag', ['1', '2', '3'], { empty: EMPTY });
  }
  if (v.ag === '3') { v.finished = true; return done('join:cancelled'); }

  // הקלטות -> טקסט (Azure), לרישום באתר. ההקלטות עצמן נשמרות לבדיקה. בלי הגדרת Azure/ימות נשארות רק ההקלטות.
  // האימייל כבר אומת ונקלט בשלב emailStep (email); ההקלטה שלו נשמרת תחת emf.
  const texts = await transcribeAll(env, v, folder, recFile, { fn: true, ln: true, ad: true, cl: !all });
  const saved = await save(env, {
    id, phone, phone2, fax, all, texts, email, callId: String(v.ApiCallId || ''),
    files: {
      'הקלטת שם פרטי': recPath('fn'), 'הקלטת שם משפחה': recPath('ln'), 'הקלטת כתובת': recPath('ad'),
      ...(v.emq === '1' && (email || v.emf) ? { 'הקלטת אימייל': recPath(v.emf || 'em0') } : {}),
      ...(!all ? { 'הקלטת חברות': recPath('cl') } : {}),
    },
  });
  v.finished = true;
  // מייל אישור (כמו בטופס באתר) - רק לכתובת שאומתה; "נשלח אישור למייל" מוקרא רק אם המייל באמת נשלח.
  let mailSent = false;
  if (saved && email) {
    const companies = all ? [] : (texts.cl ? texts.cl.split(/\s*[,،]\s*|\s+ו(?=[א-ת])/).filter(Boolean) : ['(לפי ההקלטה)']);
    mailSent = await sendConfirmation(env, email, {
      first: texts.fn || '', last: texts.ln || '', id, date: jerusalemNow().slice(0, 10).split('-').reverse().join('/'),
      all, companies, origin,
    });
  }
  return mailSent ? done('join:received', 'join:mailSent', 'join:thanks') : done('join:done');
}

// אימייל: הקלטה ← Azure ← בדיקת תקינות. לא תקין: "מייל לא תקין" ושואלים שוב; אחרי שני ניסיונות כושלים מתווספת אפשרות להמשיך בלי אימייל.
// emn = מספר הניסיונות הכושלים (נשמר גם בשרת), em<n> = ההקלטה של ניסיון n, ems<n> = בחירה אחרי כישלון (1 = שוב, 2 = בלי אימייל).
async function emailStep({ v, env, P, folder, recFile }) {
  if (v.emok) return { email: v.emok };
  if (v.emskip === '1') return {};
  const rec = (key, prefix = '') => ({ ask: readRecord(prefix + P('join:askEmail'), key, folder, recFile(key), REC_MIN, REC_ADDR_MAX) });
  if (!sttConfigured(env)) {                       // אי אפשר לאמת: נשמרת ההקלטה בלבד
    if (!has(v, 'em0') || empty(v.em0)) return rec('em0');
    v.emf = 'em0';
    return {};
  }
  const n = Number(v.emn || 0);
  if (n >= 2) {
    const sk = `ems${n}`;
    if (v[sk] === '2') { v.emskip = '1'; return {}; }
    if (v[sk] !== '1') return { ask: readTap(P('join:emailRetry'), sk, ['1', '2'], { empty: EMPTY }) };
  }
  const key = `em${n}`;
  if (!has(v, key) || empty(v[key])) return rec(key);
  const email = pickEmail(await transcribeLangs(env, v, key, folder, recFile));
  if (email) { v.emok = email; v.emf = key; return { email }; }
  v.emn = String(n + 1);                           // לא תקין: "מייל לא תקין" ושואלים שוב (מהניסיון השני - עם אפשרות להמשיך בלי)
  if (n + 1 >= 2) return { ask: readTap(`${P('join:badEmail')}.${P('join:emailRetry')}`, `ems${n + 1}`, ['1', '2'], { empty: EMPTY }) };
  return rec(`em${n + 1}`, `${P('join:badEmail')}.`);
}

// הקלטה אחת מזוהה בכמה שפות (עברית + אנגלית אמריקאית + בריטית): אותיות באנגלית מזוהות רק בזיהוי האנגלי, מילים בעברית רק בעברית.
const EMAIL_LANGS = ['he-IL', 'en-US', 'en-GB'];
async function transcribeLangs(env, v, key, folder, recFile) {
  try {
    const value = String(v[key] || '');
    const rec = await downloadRecording(env, [
      ...(/\.(wav|mp3|ogg)$/i.test(value) || /^\/.*\//.test(value) ? [value] : []),
      `${folder}/${recFile(key)}.wav`, `${folder}/${recFile(key)}`,
    ]);
    if (!rec) return [];
    return await Promise.all(EMAIL_LANGS.map(async (l) => clean(await azureTranscribe(env, rec.bytes, l), 200).replace(/[,!?]+$/g, '').trim()));
  } catch { return []; }
}

// הקלטה -> טקסט, במקביל לכל ההקלטות. אין מחיקה של ההקלטה (בניגוד לחיפוש), כדי שאפשר יהיה לבדוק מול הטקסט שזוהה.
async function transcribeAll(env, v, folder, recFile, want) {
  const out = {};
  if (!sttConfigured(env)) return out;
  await Promise.all(Object.keys(want).filter((k) => want[k]).map(async (k) => {
    try {
      const value = String(v[k] || '');
      const rec = await downloadRecording(env, [
        ...(/\.(wav|mp3|ogg)$/i.test(value) || /^\/.*\//.test(value) ? [value] : []),
        `${folder}/${recFile(k)}.wav`, `${folder}/${recFile(k)}`,
      ]);
      if (rec) out[k] = clean(await azureTranscribe(env, rec.bytes), 200).replace(/[.,!?]+$/g, '').trim();
    } catch { /* נשארים עם ההקלטה בלבד */ }
  }));
  return out;
}

export { spokenEmail };

async function save(env, { id, phone, phone2, fax, all, files, texts = {}, email = '', callId }) {
  const key = await importKeyForWrite(env);
  const ih = await identHash(env, id);
  // הגנה מקריאה כפולה: אותה ת.ז. שנרשמה ב-3 הדקות האחרונות לא נרשמת שוב
  const recent = await env.DB.prepare('SELECT id FROM joiners WHERE ident_hash = ? AND submitted_at >= ? LIMIT 1')
    .bind(ih, jerusalemNow(new Date(Date.now() - 3 * 60000))).first();
  if (recent) return false;

  const rid = newRowId(), now = jerusalemNow();
  // אותם שדות כמו הטופס באתר (join.js). שמות, כתובת ואימייל נמסרים בקול, ולכן נשמרים כהקלטות (נתיב בימות).
  const extra = {
    'ערוץ': 'טלפון (ימות המשיח)',
    ...(phone2 ? { 'טלפון נוסף': phone2 } : {}),
    ...(fax ? { 'פקס': fax } : {}),
    'כתובת': texts.ad || '(ראו הקלטת כתובת)',
    ...files,
    ...(Object.values(texts).some(Boolean) ? { 'זיהוי אוטומטי מהקלטות': 'כן - יש לבדוק מול ההקלטה' } : {}),
    'מזהה שיחה': callId,
    'גרסת שטר': AGREEMENT_VERSION,
    'אושרו התנאים': 'כן (בהקשה, בנוסח ההצהרה הטלפוני)',
  };
  const payload = {
    first: texts.fn || 'טלפוני (ראו הקלטת שם פרטי)', last: texts.ln || '(ראו הקלטת שם משפחה)', phone,
    email, id, ip: '',
    companies: all ? '' : (texts.cl || '(ראו הקלטת חברות)'), all: all ? 'כן' : '',
    pdf: '', extra: JSON.stringify(extra), src: 'ivr',
  };
  await env.DB.prepare("INSERT INTO joiners (id, submitted_at, cancelled_at, file_sha256, ident_hash, pii) VALUES (?, ?, '', '', ?, ?)")
    .bind(rid, now, ih, await encryptPii(key, rid, payload)).run();
  return true;
}

const text = (body) => new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
