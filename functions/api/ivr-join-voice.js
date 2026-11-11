// ============================================================================
//  functions/api/ivr-join-voice.js — הצטרפות להיתר עסקה פרטי בדיבור בלבד (שלוחה 3, ניסיון), זיהוי ב-ElevenLabs
//
//  כמו ivr-join.js (שלוחה 1), אבל כל פרט נמסר בדיבור: תעודת זהות, שם פרטי, שם משפחה, טלפון, כתובת, פקס, אימייל, שמות חברות.
//  אימייל: ההקלטה מזוהה פעמיים (עברית + זיהוי שפה אוטומטי) ו-pickEmail בוחר כתובת תקינה; מוקראת אות אחר אות. אחרי הרישום - מייל אישור.
//  אחרי כל הקלטה: "זוהה: <מה שזוהה>. לאישור הקישו 1, להקלטה חוזרת הקישו 2". מספרים (ת.ז., טלפון, פקס) נאמרים
//  ספרה אחר ספרה ומוקראים חזרה ספרה אחר ספרה. הקשות רק לשאלות כן / לא ולהצהרה.
//  נרשם באותה טבלה ובאותה הצפנה כמו שלוחה 1 (save מ-ivr-join.js), עם ערוץ "טלפון - דיבור (ElevenLabs)".
//  משתנים (כל ניסיון במשתנה חדש, כי ימות שומרת את הערך הישן):
//    <f>_<n> הקלטה n של השדה f (id, fn, ln, ph, ad, fx, cl), <f>_c<n> אישור (1) / הקלטה חוזרת (2)
//    pc = טלפון המתקשר (1) / אחר (2), fxq = פקס כן (1) / לא (2), emq = אימייל כן (1) / לא (2), ch = כל החברות (1) / מסוימות (2), rd / ag כמו בשלוחה 1
//  התקדמות השיחה נשמרת מוצפנת בשרת (ivr_join_voice_state), כמו בשלוחה 1.
//  ext.ini (שלוחה 3):  type=api / api_link=https://harav-levin.pages.dev/api/ivr-join-voice / api_add_0=sk=<IVR_SECRET_NEW> / api_add_1=bk=/
//  דרישות: ELEVENLABS_API_KEY, YEMOT_TOKEN (הורדת ההקלטות), IVR_SECRET_NEW, JOINERS_KEY, binding DB.
//  אופציונלי: IVR_VOICE_REC_FOLDER (תיקיית ההקלטות בימות, ברירת מחדל /3).
// ============================================================================
import { folderParam, parseYemot, readRecord, readTap, secretOk } from './_shared/ivr-auth.js';
import { unit, ttsClean } from './_shared/ivr_phrases.js';
import { agreementStep } from './_shared/ivr-agreement.js';
import MANIFEST from './_shared/ivr_audio_manifest.js';
import { importKeyForWrite, encryptPii, decryptPii } from './_shared/joiners-crypto.js';
import { normalizeId, normalizePhone, clean, jerusalemNow } from './_shared/join-common.js';
import { elevenConfigured, elevenTranscribeRecording, digitsFromSpeech } from './_shared/stt-eleven.js';
import { save, normalizeFax, spellEmail } from './ivr-join.js';
import { pickEmail } from './_shared/spoken-email.js';
import { sendConfirmation } from './_shared/join-mail.js';

const EMPTY = 'NONE';
const REC_MIN = 1, REC_MAX = 10, REC_ADDR_MAX = 15, REC_LIST_MAX = 30;
const VERSION = 'טלפוני-דיבור-1';
const CHANNEL = 'טלפון - דיבור (ElevenLabs, שלוחה 3)';

// ---- מצב שיחה מוצפן (ivr_join_voice_state) ----
const keepKey = (k) => ['pc', 'fxq', 'emq', 'ch', 'rd', 'ag'].includes(k) || /^s_/.test(k) || /^[a-z]+_c?\d+$/.test(k);
const STATE_TTL_MS = 6 * 3600 * 1000;
async function loadState(env, callId) {
  if (!callId) return {};
  try {
    const key = await importKeyForWrite(env);
    await env.DB.prepare('CREATE TABLE IF NOT EXISTS ivr_join_voice_state (call_id TEXT PRIMARY KEY, data TEXT, at INTEGER)').run();
    const r = await env.DB.prepare('SELECT data FROM ivr_join_voice_state WHERE call_id = ?').bind(callId).first();
    return r ? await decryptPii(key, callId, r.data) : {};
  } catch (e) { console.log('voice state load error', e && e.message); return {}; }
}
async function saveState(env, callId, v) {
  if (!callId) return;
  try {
    if (v.finished) { await env.DB.prepare('DELETE FROM ivr_join_voice_state WHERE call_id = ?').bind(callId).run(); return; }
    const key = await importKeyForWrite(env);
    const keep = {};
    for (const k of Object.keys(v)) if (keepKey(k) && typeof v[k] === 'string' && v[k] && v[k] !== EMPTY) keep[k] = v[k];
    await env.DB.prepare('INSERT OR REPLACE INTO ivr_join_voice_state (call_id, data, at) VALUES (?, ?, ?)')
      .bind(callId, await encryptPii(key, callId, keep), Date.now()).run();
    await env.DB.prepare('DELETE FROM ivr_join_voice_state WHERE at < ?').bind(Date.now() - STATE_TTL_MS).run();
  } catch (e) { console.log('voice state save error', e && e.message); }
}

export async function onRequest({ request, env }) {
  const raw = await parseYemot(request);
  if (!secretOk(env, raw.sk)) return text('id_list_message=t-שגיאת הרשאה&');
  if (raw.hangup === 'yes') return text('');
  const mf = String(env.IVR_AUDIO_OFF || '') === '1' ? {} : MANIFEST;
  const P = (key) => unit(key, mf);
  const bk = folderParam(raw, 'bk', env.IVR_BACK_FOLDER || '/');
  const done = (...keys) => `id_list_message=${keys.map(P).join('.')}&go_to_folder=${bk}&`;
  if (!elevenConfigured(env)) return text(done('v:off'));

  const callId = String(raw.ApiCallId || '').replace(/\W/g, '');
  const v = { ...(await loadState(env, callId)), ...raw };
  try {
    const out = await step({ v, env, P, bk, done, origin: new URL(request.url).origin });
    await saveState(env, callId, v);
    return text(out);
  } catch (e) {
    console.log(`ivr-join-voice error: ${e && e.message}`);          // בלי פרטים אישיים בלוג
    return text(done('join:error'));
  }
}

const has = (v, k) => Object.prototype.hasOwnProperty.call(v, k);
const empty = (x) => !x || x === EMPTY;
const T = (txt) => `t-${ttsClean(txt)}`;
const spaced = (d) => String(d).split('').join(' ');

async function step({ v, env, P, bk, done, origin }) {
  const folder = (env.IVR_VOICE_REC_FOLDER || '/3').replace(/\/$/, '');
  const call = String(v.ApiCallId || 'x').replace(/\W/g, '');
  const recFile = (key) => `v${call}_${key}`;
  const S = (name, k) => v[`s_${name}_${k}`];
  const setS = (name, k, val) => { v[`s_${name}_${k}`] = String(val); };
  const yn = (key, phrase) => (v[key] === '1' || v[key] === '2' ? null : readTap(P(phrase), key, ['1', '2'], { empty: EMPTY }));

  // שדה בדיבור: הקלטה -> ElevenLabs -> (parse) -> "זוהה: ..." -> 1 = אישור, 2 = הקלטה חוזרת.
  // parse מחזיר את הערך או '' (לא תקין -> bad + הקלטה חוזרת); sayOf = איך מקריאים את הערך חזרה.
  // langs: שפות הזיהוי (['he'] = עברית; '' = אוטומטי). עם יותר משפה אחת parse מקבל את כל הזיהויים (מערך).
  const field = async (name, ask, max, { parse = (t) => t, bad = 'join:noHear', sayOf = (x) => x, intro = '', langs = null, heard = 'heard' } = {}) => {
    if (S(name, 'ok') === '1') return { val: S(name, 'x') || '' };
    const n = Number(S(name, 'n') || 0), key = `${name}_${n}`, ck = `${name}_c${n}`;
    const askAt = (i, pre = '') => readRecord(pre + (i === 0 ? intro : '') + P(ask), `${name}_${i}`, folder, recFile(`${name}_${i}`), REC_MIN, max);
    if (!has(v, key) || empty(v[key])) return { ask: askAt(n) };
    if (S(name, 't') !== String(n)) {          // זיהוי פעם אחת לכל הקלטה (נשמר במצב השיחה)
      const value = String(v[key]);
      const texts = (await elevenTranscribeRecording(env, [
        ...(/\.(wav|mp3|ogg)$/i.test(value) || /^\/.*\//.test(value) ? [value] : []),
        `${folder}/${recFile(key)}.wav`, `${folder}/${recFile(key)}`,
      ], langs || ['he'])).map((x) => clean(x, 300).replace(/[.,!?]+$/g, '').trim());
      const t = texts.find(Boolean) || '';
      setS(name, 'raw', t); setS(name, 'x', t ? parse(langs ? texts : t) : ''); setS(name, 't', n);
    }
    const val = S(name, 'x') || '';
    if (!val) { setS(name, 'n', n + 1); return { ask: askAt(n + 1, `${P(S(name, 'raw') ? bad : 'join:noHear')}.`) }; }
    if (v[ck] === '1') { setS(name, 'ok', '1'); setS(name, 'f', key); return { val }; }
    if (v[ck] === '2') { setS(name, 'n', n + 1); return { ask: askAt(n + 1) }; }
    return { ask: readTap(`${P(heard)}.${T(sayOf(val))}.${P('v:confirm')}`, ck, ['1', '2'], { empty: EMPTY }) };
  };
  const num = (norm) => (t) => norm(digitsFromSpeech(t)) || '';
  let o;

  // 1. תעודת זהות (בפתיחה: הסבר קצר על השלוחה)
  const idQ = await field('id', 'v:askId', REC_MAX, { parse: num(normalizeId), bad: 'join:badId', sayOf: spaced, intro: `${P('v:intro')}.` });
  if (idQ.ask) return idQ.ask;
  // 2-3. שם פרטי, שם משפחה
  const fnQ = await field('fn', 'join:askFirst', REC_MAX);
  if (fnQ.ask) return fnQ.ask;
  const lnQ = await field('ln', 'join:askLast', REC_MAX);
  if (lnQ.ask) return lnQ.ask;
  // 4. טלפון: המספר שממנו מתקשרים (1) או אחר בדיבור (2)
  let phone = '';
  const callerPhone = normalizePhone(v.ApiPhone);
  if (callerPhone) {
    if ((o = yn('pc', 'join:phoneChoice'))) return o;
    if (v.pc === '1') phone = callerPhone;
  }
  if (!phone) {
    const q = await field('ph', 'v:askPhone', REC_MAX, { parse: num(normalizePhone), bad: 'join:badPhone', sayOf: spaced });
    if (q.ask) return q.ask;
    phone = q.val;
  }
  // 5. כתובת מלאה בהקלטה אחת
  const adQ = await field('ad', 'join:askAddress', REC_ADDR_MAX);
  if (adQ.ask) return adQ.ask;
  // 6. פקס (רשות)
  if ((o = yn('fxq', 'join:faxQ'))) return o;
  let fax = '';
  if (v.fxq === '1') {
    const q = await field('fx', 'v:askFax', REC_MAX, { parse: num(normalizeFax), bad: 'join:badFax', sayOf: spaced });
    if (q.ask) return q.ask;
    fax = q.val;
  }
  // 6ב. אימייל (רשות): בדיבור, אות אחר אות; זיהוי בעברית ובזיהוי שפה אוטומטי, הקראה אות אחר אות ואישור
  if ((o = yn('emq', 'join:emailQ'))) return o;
  let email = '';
  if (v.emq === '1') {
    const q = await field('em', 'v:askEmail', REC_ADDR_MAX, { langs: ['he', ''], parse: pickEmail, bad: 'v:badEmail', sayOf: spellEmail, heard: 'join:emailHeard' });
    if (q.ask) return q.ask;
    email = q.val;
  }
  // 7. כל החברות / חברות מסוימות (שמות בדיבור)
  if (v.ch !== '1' && v.ch !== '2') return readTap(P('join:choice'), 'ch', ['1', '2'], { empty: EMPTY });
  const all = v.ch === '1';
  let clQ = { val: '' };
  if (!all) { clQ = await field('cl', 'join:askList', REC_LIST_MAX); if (clQ.ask) return clQ.ask; }
  // 8. הקראת השטר המלא (אופציונלית) והצהרה - כמו בשלוחה 1
  if (v.rd !== '1' && v.rd !== '2') return readTap(P('join:askRead'), 'rd', ['1', '2'], { empty: EMPTY });
  // השטר המלא מוקרא בחלקים קצרים (בקשה לכל חלק), ואחריו ההצהרה: 1 = מאשר, 2 = שמיעה חוזרת, 3 = ביטול (_shared/ivr-agreement.js)
  const agQ = await agreementStep({ env, v, S, setS, P, readTap, empty: EMPTY });
  if (agQ.ask) return agQ.ask;
  if (agQ.cancel) { v.finished = true; return done('join:cancelled'); }

  // 9. רישום
  const id = idQ.val, texts = { fn: fnQ.val, ln: lnQ.val, ad: adQ.val, cl: clQ.val };
  const rec = (name) => `${folder}/${recFile(S(name, 'f') || `${name}_0`)}`;
  const saved = await save(env, {
    id, phone, phone2: '', fax, all, texts, email, addr: {}, callId: String(v.ApiCallId || ''), channel: CHANNEL, version: VERSION,
    files: {
      'הקלטת תעודת זהות': rec('id'), 'הקלטת שם פרטי': rec('fn'), 'הקלטת שם משפחה': rec('ln'), 'הקלטת כתובת': rec('ad'),
      ...(v.pc !== '1' ? { 'הקלטת טלפון': rec('ph') } : {}), ...(fax ? { 'הקלטת פקס': rec('fx') } : {}), ...(email ? { 'הקלטת אימייל': rec('em') } : {}), ...(!all ? { 'הקלטת חברות': rec('cl') } : {}),
    },
  });
  v.finished = true;
  if (!saved) return done('join:done');
  // מייל אישור (כמו בשלוחה 1) - "נשלח אישור למייל" מוקרא רק אם המייל באמת נשלח
  let mailSent = false;
  if (email) {
    const companies = all ? [] : (texts.cl ? texts.cl.split(/\s*[,،]\s*|\s+ו(?=[א-ת])/).filter(Boolean) : ['(לפי ההקלטה)']);
    try {
      mailSent = await sendConfirmation(env, email, { first: texts.fn || '', last: texts.ln || '', id, date: jerusalemNow().slice(0, 10).split('-').reverse().join('/'), all, companies, origin });
    } catch { mailSent = false; }
  }
  const name = `${texts.fn} ${texts.ln}`.trim();
  return `id_list_message=${P('join:okHello')}.${name ? `${T(name)}.` : ''}${P('join:okId')}.${T(spaced(id))}.${P('join:okBody')}.${mailSent ? `${P('join:mailSent')}.` : ''}${P('join:thanks')}&go_to_folder=${bk}&`;
}

const text = (body) => new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
