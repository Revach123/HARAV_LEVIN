// ============================================================================
//  functions/api/ivr-join-voice.js — הצטרפות להיתר עסקה פרטי בדיבור בלבד (שלוחה 3, ניסיון), זיהוי ב-ElevenLabs
//
//  כמו ivr-join.js (שלוחה 1), אבל שמות, כתובת, אימייל ושמות חברות נמסרים בדיבור, ומספרים (ת.ז., טלפונים, פקס, מספר בית) בהקשה - אותם שדות כמו בשלוחה 1 ובטופס באתר: תעודת זהות, שם פרטי, שם משפחה,
//  טלפון, טלפון נוסף, עיר, רחוב, מספר בית, אימייל, פקס, ושמות חברות (או כל החברות).
//  אימייל: ההקלטה מזוהה פעמיים (עברית + זיהוי שפה אוטומטי) ו-pickEmail בוחר כתובת תקינה; מוקראת אות אחר אות. אחרי הרישום - מייל אישור.
//  אחרי כל הקלטה: "זוהה: <מה שזוהה>. לאישור הקישו 1, להקלטה חוזרת הקישו 2". מספרים מוקשים (ספרות + סולמית)
//  ומוקראים חזרה ספרה אחר ספרה לאישור. הקשות גם לשאלות כן / לא ולהצהרה.
//  נרשם באותה טבלה ובאותה הצפנה כמו שלוחה 1 (save מ-ivr-join.js), עם ערוץ "טלפון - דיבור (ElevenLabs)".
//  משתנים (כל ניסיון במשתנה חדש, כי ימות שומרת את הערך הישן):
//    <f>_<n> הקלטה n של השדה f (id, fn, ln, ph, p2, ct, st, hn, em, fx, cl), <f>_c<n> אישור (1) / הקלטה חוזרת (2)
//    pc = טלפון המתקשר (1) / אחר (2), p2q = טלפון נוסף כן (1) / לא (2), emq = אימייל כן (1) / לא (2), ch = כל החברות (1) / מסוימות (2), rd / ag כמו בשלוחה 1
//  התקדמות השיחה נשמרת מוצפנת בשרת (ivr_join_voice_state), כמו בשלוחה 1.
//  ext.ini (שלוחה 3):  type=api / api_link=https://harav-levin.pages.dev/api/ivr-join-voice / api_add_0=sk=<IVR_SECRET_NEW> / api_add_1=bk=/
//  דרישות: ELEVENLABS_API_KEY, YEMOT_TOKEN (הורדת ההקלטות), IVR_SECRET_NEW, JOINERS_KEY, binding DB.
//  אופציונלי: IVR_VOICE_REC_FOLDER (תיקיית ההקלטות בימות, ברירת מחדל /3).
// ============================================================================
import { folderParam, parseYemot, readRecord, readTap, secretOk } from './_shared/ivr-auth.js';
import { unit, ttsClean } from './_shared/ivr_phrases.js';
import { agreementStep, warmAgreement } from './_shared/ivr-agreement.js';
import MANIFEST from './_shared/ivr_audio_manifest.js';
import { importKeyForWrite, encryptPii, decryptPii } from './_shared/joiners-crypto.js';
import { normalizeId, normalizePhone, clean, jerusalemNow } from './_shared/join-common.js';
import { elevenConfigured, elevenTranscribeRecording } from './_shared/stt-eleven.js';
import { save, normalizeFax, spellEmail, emailStep } from './ivr-join.js';
import { tapLetter } from './_shared/ivr-addr.js';
import { pickEmail } from './_shared/spoken-email.js';
import { sendConfirmation, markMailSent } from './_shared/join-mail.js';
import { queueFaxConfirmation } from './_shared/join-fax-confirm.js';

const EMPTY = 'NONE';
const REC_MIN = 1, REC_MAX = 10, REC_ADDR_MAX = 15, REC_LIST_MAX = 30;
const VERSION = 'טלפוני-דיבור-1';
const CHANNEL = 'טלפון - דיבור (ElevenLabs, שלוחה 3)';

// ---- מצב שיחה מוצפן (ivr_join_voice_state) ----
const keepKey = (k) => ['pc', 'p2q', 'fxq', 'emq', 'emok', 'ch', 'rd', 'ag'].includes(k) || /^s_/.test(k) || /^[a-z0-9]+_[a-z]*\d+$/.test(k);
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

export async function onRequest({ request, env, waitUntil }) {
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
    const out = await step({ v, env, P, bk, done, origin: new URL(request.url).origin, waitUntil });
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

async function step({ v, env, P, bk, done, origin, waitUntil }) {
  const folder = (env.IVR_VOICE_REC_FOLDER || '/3').replace(/\/$/, '');
  const call = String(v.ApiCallId || 'x').replace(/\W/g, '');
  const recFile = (key) => `v${call}_${key}`;
  const S = (name, k) => v[`s_${name}_${k}`];
  const setS = (name, k, val) => { v[`s_${name}_${k}`] = String(val); };
  const yn = (key, phrase) => (v[key] === '1' || v[key] === '2' ? null : readTap(P(phrase), key, ['1', '2'], { empty: EMPTY }));

  // שדה בדיבור: הקלטה -> ElevenLabs -> (parse) -> "זוהה: ..." -> 1 = אישור, 2 = הקלטה חוזרת.
  // parse מחזיר את הערך או '' (לא תקין -> bad + הקלטה חוזרת); sayOf = איך מקריאים את הערך חזרה.
  // langs: שפות הזיהוי (['he'] = עברית; '' = אוטומטי). עם יותר משפה אחת parse מקבל את כל הזיהויים (מערך).
  const field = async (name, ask, max, { parse = (t) => t, bad = 'join:noHear', sayOf = (x) => x, intro = '', langs = null, heard = '', tapAfter = 0, spellOut = false } = {}) => {
    if (S(name, 'ok') === '1') return { val: S(name, 'x') || '' };
    if (S(name, 'tap') === '1') return { tap: true };          // tapAfter: אחרי כמה ניסיונות שנכשלו עוברים להקשה
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
    if (!val) {
      if (tapAfter && n + 1 >= tapAfter) { setS(name, 'tap', '1'); return { tap: true }; }
      setS(name, 'n', n + 1); return { ask: askAt(n + 1, `${P(S(name, 'raw') ? bad : 'join:noHear')}.`) };
    }
    if (v[ck] === '1') { setS(name, 'ok', '1'); setS(name, 'f', key); return { val }; }
    if (v[ck] === '2') {
      if (tapAfter && n + 1 >= tapAfter) { setS(name, 'tap', '1'); return { tap: true }; }
      setS(name, 'n', n + 1); return { ask: askAt(n + 1) };
    }
    return { ask: readTap(`${heard ? `${P(heard)}.` : ''}${T(sayOf(val))}.${spellOut ? spelled(val) : ''}${P('v:confirm')}`, ck, ['1', '2'], { empty: EMPTY }) };
  };

  // איות מוקרא של שם: אות אחר אות (אותיות סופיות כרגילות), בהקלטות הקבועות letter:<אות>
  const BASE = { ך: 'כ', ם: 'מ', ן: 'נ', ף: 'פ', ץ: 'צ' }, FINAL = { כ: 'ך', מ: 'ם', נ: 'ן', פ: 'ף', צ: 'ץ' };
  const spelled = (val) => {
    const ls = [...String(val)].map((c) => BASE[c] || c).filter((c) => /^[א-ת]$/.test(c));
    return ls.length ? `${P('v:spelling')}.${ls.map((l) => P(`letter:${l}`)).join('.')}.` : '';
  };

  // הקשת שם באותיות עבריות בלבד (בלי מצב מספרים), אחרי שהזיהוי בדיבור נכשל: אות אחת בכל הקשה (מקש לפי מקום האות) ואחריה סולמית; סולמית לבדה = סיום.
  // withSpell: בסוף מוקרא השם ואיות שלו לפני האישור (שם משפחה); אחרת רק השם (שם פרטי). אישור: 1 = מאשר, 2 = הקשה מחדש.
  const hebTap = (name, askKey, withSpell) => {
    const r = Number(S(name, 'tn') || 0), key = `${name}_t${r}`, acc = S(name, 'tx') || '';
    const final = (t) => (t ? t.slice(0, -1) + (FINAL[t.slice(-1)] || t.slice(-1)) : t);
    const tap = (pre, i, a) => readTap(pre + P(a ? 'join:nextLetter' : S(name, 'ti') ? 'join:firstLetter' : askKey), `${name}_t${i}`, null, { max: 3, min: 0, wait: 15, empty: EMPTY });
    const advance = (pre, a) => { setS(name, 'ti', '1'); setS(name, 'tn', r + 1); setS(name, 'tx', a); return { ask: tap(pre, r + 1, a) }; };
    const ck = `${name}_tc${S(name, 'tk') || 0}`;
    const confirm = () => ({ ask: readTap(`${T(final(acc))}.${withSpell ? spelled(final(acc)) : ''}${P('v:confirm')}`, ck, ['1', '2'], { empty: EMPTY }) });
    if (S(name, 'tf') === '1') {
      if (v[ck] === '1') { setS(name, 'ok', '1'); setS(name, 'x', final(acc)); return { val: final(acc) }; }
      if (v[ck] === '2') { setS(name, 'tk', Number(S(name, 'tk') || 0) + 1); setS(name, 'tf', ''); setS(name, 'ti', ''); return advance('', ''); }
      return confirm();
    }
    if (!has(v, key)) return { ask: tap('', r, acc) };
    const raw = empty(v[key]) ? '' : String(v[key]);
    if (!raw) {                                              // סולמית לבדה = סיום; אם עוד לא הוקשה אות - שואלים שוב
      if (!acc) return advance('', '');
      setS(name, 'tf', '1'); return confirm();
    }
    const l = tapLetter(raw);
    if (!l) return advance(`${P('join:badLetter')}.`, acc);
    return advance(`${P('join:typed')}.${P(`letter:${l}`)}.`, acc + l);
  };
  const orTap = (q, name, askKey, withSpell) => (q.tap ? hebTap(name, askKey, withSpell) : q);
  // מספרים (ת.ז., טלפון, פקס, מספר בית) בהקשה, כמו בשלוחה 1: ספרות + סולמית, הקראה חוזרת לאישור (1) או שינוי (2).
  // כל ניסיון במשתנה חדש (name_<n>), כי ימות שומרת את הערך הישן; ערך לא תקין = הודעה ושאלה חוזרת.
  const numStep = (name, phrase, bad, norm, max, min, say = spaced, intro = '') => {
    const n = Number(S(name, 'n') || 0), key = `${name}_${n}`, ck = `${name}_c${n}`;
    const val = has(v, key) && !empty(v[key]) ? norm(v[key]) : '';
    const ask = (i, pre = '') => readTap(pre + P(phrase), `${name}_${i}`, null, { max, min, empty: EMPTY });
    if (!val) return { ask: ask(n, (has(v, key) && !empty(v[key]) ? `${P(bad)}.` : '') || (n === 0 ? intro : '')) };
    if (v[ck] === '1') return { val };
    if (v[ck] === '2') { setS(name, 'n', n + 1); return { ask: ask(n + 1) }; }
    return { ask: readTap(`${T(say(val))}.${P('join:confirm')}`, ck, ['1', '2'], { empty: EMPTY }) };
  };
  let o;

  // 1. תעודת זהות (בפתיחה: הסבר קצר על השלוחה)
  const idQ = numStep('id', 'join:askId', 'join:badId', normalizeId, 10, 5, spaced, `${P('v:intro')}.`);
  if (idQ.ask) return idQ.ask;
  // 2-3. שם פרטי, שם משפחה
  const fnQ = orTap(await field('fn', 'join:askFirst', REC_MAX, { tapAfter: 2 }), 'fn', 'v:nameType', false);
  if (fnQ.ask) return fnQ.ask;
  const lnQ = orTap(await field('ln', 'join:askLast', REC_MAX, { tapAfter: 1, spellOut: true }), 'ln', 'v:nameType', true);
  if (lnQ.ask) return lnQ.ask;
  // 4. טלפון: המספר שממנו מתקשרים (1) או אחר בדיבור (2)
  let phone = '';
  const callerPhone = normalizePhone(v.ApiPhone);
  if (callerPhone) {
    if ((o = yn('pc', 'join:phoneChoice'))) return o;
    if (v.pc === '1') phone = callerPhone;
  }
  if (!phone) {
    const q = numStep('ph', 'join:askPhone', 'join:badPhone', normalizePhone, 11, 9);
    if (q.ask) return q.ask;
    phone = q.val;
  }
  // 4ב. טלפון נוסף (רשות)
  if ((o = yn('p2q', 'join:phone2Q'))) return o;
  let phone2 = '';
  if (v.p2q === '1') {
    const q = numStep('p2', 'join:askPhone2', 'join:badPhone', normalizePhone, 11, 9);
    if (q.ask) return q.ask;
    phone2 = q.val;
  }
  // 4ג. פקס (רשות): מי שמוסיף פקס יכול לקבל בו את אישור ההצטרפות
  if ((o = yn('fxq', 'v:faxQ'))) return o;
  let fax = '';
  if (v.fxq === '1') {
    const q = numStep('fx', 'join:askFax', 'join:badFax', normalizeFax, 10, 9);
    if (q.ask) return q.ask;
    fax = q.val;
  }
  // 5. כתובת: עיר, רחוב ומספר בית (שלוש הקלטות). "אין" = בלי מספר בית
  const ctQ = await field('ct', 'v:askCity', REC_MAX);
  if (ctQ.ask) return ctQ.ask;
  const stQ = await field('st', 'v:askStreet', REC_MAX);
  if (stQ.ask) return stQ.ask;
  const hnQ = numStep('hn', 'join:askHouse', 'join:badHouse', (x) => (/^\d{1,4}$/.test(String(x)) ? (x === '0' || Number(x) === 0 ? 'ללא' : String(Number(x))) : ''), 4, 1,
    (x) => (x === 'ללא' ? 'ללא מספר בית' : `מספר בית ${x}`));
  if (hnQ.ask) return hnQ.ask;
  // מספר דירה (בהקשה): 0 = ללא
  const apQ = numStep('ap', 'v:askApt', 'v:badApt', (x) => (/^\d{1,4}$/.test(String(x)) ? (Number(x) === 0 ? 'ללא' : String(Number(x))) : ''), 4, 1,
    (x) => (x === 'ללא' ? 'ללא מספר דירה' : `מספר דירה ${x}`));
  if (apQ.ask) return apQ.ask;
  const addr = { city: ctQ.val, street: stQ.val, house: hnQ.val === 'ללא' ? '' : hnQ.val, apt: apQ.val === 'ללא' ? '' : apQ.val };
  const adQ = { val: [[addr.street, addr.house].filter(Boolean).join(' ') + (addr.apt ? `, דירה ${addr.apt}` : ''), addr.city].filter(Boolean).join(', ') };
  // 6. אימייל (רשות): בדיבור, אות אחר אות; אחרי ניסיון אחד שנכשל (לא זוהה / שונה) - הקשה במקשי הטלפון (כמו בשלוחה 1)
  if ((o = yn('emq', 'v:emailQ'))) return o;
  let email = '';
  if (v.emq === '1') {
    const q = await field('em', 'v:askEmail', REC_ADDR_MAX, { langs: ['he', ''], parse: pickEmail, bad: 'v:badEmail', sayOf: spellEmail, heard: 'join:emailHeard', tapAfter: 1 });
    if (q.ask) return q.ask;
    if (q.tap) {
      const t = await emailStep({ v, P, askKey: 'v:emailType' });
      if (t.ask) return t.ask;
      email = t.email || '';
    } else email = q.val;
  }
  // 6ב. אישור ההצטרפות: למייל שהוזן; תמיד מציעים גם פקס (1 = כן; אם עוד לא נמסר מספר פקס - נשאל עכשיו; כל תשובה אחרת / שתיקה = בלי פקס).
  // בלי מייל: "לקבלת האישור דרך הפקס הקישו 1". פקס שנמסר בלי מייל - האישור נשלח אליו בלי לשאול.
  let faxConfirm = !!fax && !email;
  if (!(fax && !email)) {
    if (S('cv', 'a') == null) {
      if (!has(v, 'cv')) return readTap(P(email ? 'v:confirmAlsoFax' : 'v:confirmFax'), 'cv', null, { max: 1, min: 0, wait: 7, empty: EMPTY });
      setS('cv', 'a', v.cv === '1' ? '1' : '0');
    }
    if (S('cv', 'a') === '1') {
      faxConfirm = true;
      if (!fax) {
        const q = numStep('fx', 'join:askFax', 'join:badFax', normalizeFax, 10, 9);
        if (q.ask) return q.ask;
        fax = q.val;
      }
    }
  }
  // 7. כל החברות / חברות מסוימות (שמות בדיבור)
  if (v.ch !== '1' && v.ch !== '2') return readTap(P('join:choice'), 'ch', ['1', '2'], { empty: EMPTY });
  const all = v.ch === '1';
  let clQ = { val: '' };
  if (!all) { clQ = await field('cl', 'join:askList', REC_LIST_MAX); if (clQ.ask) return clQ.ask; }
  // 8. הקראת השטר המלא (אופציונלית) והצהרה - כמו בשלוחה 1
  if (v.rd !== '1' && v.rd !== '2') { await warmAgreement(env, waitUntil); return readTap(P('join:askRead'), 'rd', ['1', '2'], { empty: EMPTY }); }          // קבצי Azure לשטר מופקים ברקע כבר עכשיו
  // השטר המלא מוקרא בחלקים קצרים (בקשה לכל חלק), ואחריו ההצהרה: 1 = מאשר, 2 = שמיעה חוזרת, 3 = ביטול (_shared/ivr-agreement.js)
  const agQ = await agreementStep({ env, v, S, setS, P, readTap, empty: EMPTY, waitUntil });
  if (agQ.ask) return agQ.ask;
  if (agQ.cancel) { v.finished = true; return done('join:cancelled'); }

  // 9. רישום
  const id = idQ.val, texts = { fn: fnQ.val, ln: lnQ.val, ad: adQ.val, cl: clQ.val };
  const rec = (name) => `${folder}/${recFile(S(name, 'f') || `${name}_0`)}`;
  const saved = await save(env, {
    id, phone, phone2, fax, all, texts, email, addr, callId: String(v.ApiCallId || ''), channel: CHANNEL, version: VERSION,
    files: {
      'הקלטת שם פרטי': rec('fn'), 'הקלטת שם משפחה': rec('ln'),
      'הקלטת עיר': rec('ct'), 'הקלטת רחוב': rec('st'), 
      ...(email ? { 'הקלטת אימייל': rec('em') } : {}), ...(!all ? { 'הקלטת חברות': rec('cl') } : {}),
    },
  });
  v.finished = true;
  if (!saved) return done('join:done');
  // מייל אישור (כמו בשלוחה 1) - "נשלח אישור למייל" מוקרא רק אם המייל באמת נשלח
  let mailSent = false, faxQueued = false;
  if (email || fax) {
    const companies = all ? [] : (texts.cl ? texts.cl.split(/\s*[,،]\s*|\s+ו(?=[א-ת])/).filter(Boolean) : ['(לפי ההקלטה)']);
    const conf = { first: texts.fn || '', last: texts.ln || '', id, date: jerusalemNow().slice(0, 10).split('-').reverse().join('/'), all, companies, origin };
    try {
      if (email) { mailSent = await sendConfirmation(env, email, conf); if (mailSent) await markMailSent(env, saved); }
      if (fax && faxConfirm) faxQueued = await queueFaxConfirmation(env, waitUntil, call, fax, conf, saved);
    } catch (e) { console.log(`ivr-join-voice confirm error: ${e && e.message}`); }          // כשל בשליחה לא פוגע בהרשמה (השגיאה נרשמת בלוג, בלי פרטים אישיים)
  }
  const name = `${texts.fn} ${texts.ln}`.trim();
  return `id_list_message=${P('v:okTitle')}.${name ? `${T(name)}.` : ''}${P('join:okId')}.${T(spaced(id))}.${P('join:okBody')}.${mailSent ? `${P('join:mailSent')}.` : ''}${faxQueued ? `${P('join:faxQueued')}.` : ''}${P('join:thanks')}&go_to_folder=${bk}&`;
}

const text = (body) => new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
