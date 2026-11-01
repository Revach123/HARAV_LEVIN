// ============================================================================
//  functions/api/ivr-join.js — הצטרפות להיתר עסקה פרטי בטלפון (ימות המשיח)
//
//  שלוחת api (ברירת מחדל /1). נרשם באותה טבלה ובאותה הצפנה כמו הטופס באתר (join.js), עם src = "ivr".
//  זרימה - כל השדות של הטופס באתר (join.html). כל משתנה ימות נשמר גם בשרת (מוצפן), כך שאם ימות מפעילה את השלוחה מחדש ממשיכים:
//    id        תעודת זהות (הקשה, בדיקת ספרת ביקורת)
//    fn, ln    שם פרטי, שם משפחה (שתי הקלטות)
//    pc / ph   אם מספר המתקשר זוהה: 1 = משתמשים בו, 2 = מקישים אחר (ph)
//    p2q / p2  טלפון נוסף (רשות)
//    ct, st    עיר ורחוב: הקשת האותיות הראשונות (כל אות לפי מקומה במקש: ב = 33, ל = 555) ובחירה מרשימה
//              כשנשארות עד 8 אפשרויות. אם השם לא נמצא (3 פעמים) - הקלטה. בלי נתוני ערים - הקלטת כתובת מלאה (ad), כמו קודם
//    hn        מספר בית (הקשה; 0 = אין מספר)
//    emq / em  אימייל (רשות, הקלטה)
//    fxq / fx  פקס (רשות)
//    ch, cl    1 = כל החברות, 2 = חברות מסוימות (cl = הקלטת השמות)
//    rd        1 = להקריא את נוסח השטר המלא (14 פסקאות), 2 = להמשיך
//    ag        הצהרה: 1 = מאשר ונרשם, 2 = שמיעה חוזרת של השטר המלא, 3 = ביטול
//  אחרי כל הקלטה / הקשה מוקרא למצטרף מה שזוהה / הוקש, עם אישור (1) או שינוי (2). לפני כל הקלטה נאמר לסיים בסולמית.
//  אימייל: שילוב דיבור והקשות בקטעים (1 = אותיות בקול, 2 = מספרים בהקשה, 3 = סיום, 4 = מחיקת הקטע האחרון), ואחר כך סיומת מרשימה (או הקלטה).
//  פקס: 9-10 ספרות (גם עם קידומת 153). בסוף - הקראת נוסח אישור הרישום.
//  כל שאלה שלא נענתה נשאלת שוב ושוב (אותו משתנה), בלי הגבלת ניסיונות.
//  ההקלטות נשמרות בימות בתיקיית השלוחה (IVR_JOIN_REC_FOLDER, ברירת מחדל /1); נתיבן נשמר ברשומה (שדות "הקלטת ..." בהערות).
//  ext.ini:  type=api / api_link=https://harav-levin.pages.dev/api/ivr-join / api_add_0=sk=<IVR_SECRET_NEW> / api_add_1=bk=/
//  דרישות: IVR_SECRET (או IVR_SECRET_NEW), JOINERS_KEY, binding DB.
// ============================================================================
import { folderParam, parseYemot, readRecord, readTap, secretOk } from './_shared/ivr-auth.js';
import { AGREEMENT_KEYS, unit, ttsClean } from './_shared/ivr_phrases.js';
import MANIFEST from './_shared/ivr_audio_manifest.js';
import { importKeyForWrite, encryptPii, decryptPii, identHash } from './_shared/joiners-crypto.js';
import { normalizeId, normalizePhone, jerusalemNow, newRowId, clean } from './_shared/join-common.js';
import { azureTranscribe, downloadRecording, sttConfigured } from './_shared/stt-azure.js';
import { sendConfirmation } from './_shared/join-mail.js';
import { pickEmail, spokenEmail, pickSegment, pickDomain } from './_shared/spoken-email.js';
import { splitSpeechAndDigits } from './_shared/dtmf.js';
import { spokenLetters } from './_shared/spoken-letters.js';
import { matchNames, loadCities, loadStreets } from './_shared/ivr-addr.js';

const EMPTY = 'NONE';
const REC_MIN = 1, REC_MAX = 8, REC_ADDR_MAX = 15, REC_LIST_MAX = 30;
const PICK_MAX = 8;                // עד כמה אפשרויות מוקראות כרשימה (9 = לא ברשימה)
const PICK_FAILS = 3;              // אחרי כמה ניסיונות שלא נמצא שם עוברים להקלטה
const AGREEMENT_VERSION = 'טלפוני-1';

// ---- מצב שיחה מוצפן (ivr_join_state) ----
const STATE_KEYS = ['pc', 'p2q', 'emq', 'emok', 'emf', 'emskip', 'fxq', 'ch', 'rd', 'pl'];
// משתני ימות שהשלוחה מגדירה בעצמה (שם_מספר, למשל fn_0, id_1, em_m3, fn_c0) ומצב צד-שרת (s_...) נשמרים גם הם
const keepKey = (k) => STATE_KEYS.includes(k) || /^s_/.test(k) || /^[a-z0-9]+_[a-z]*\d+$/.test(k);
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
    for (const k of Object.keys(v)) if (keepKey(k) && !empty(v[k]) && typeof v[k] === 'string') keep[k] = v[k];
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

// פקס: מספר רגיל (0 + 8-9 ספרות) או מספר עם קידומת 153 (עד 10 ספרות בסך הכול)
const normalizeFax = (x) => {
  let d = String(x || '').replace(/\D/g, '');
  if (d.startsWith('972')) d = '0' + d.slice(3);
  return /^(0\d{8,9}|153\d{6,7})$/.test(d) ? d : '';
};
const T = (txt) => `t-${ttsClean(txt)}`;                       // טקסט דינמי ב-TTS של ימות
const spaced = (d) => String(d).split('').join(' ');            // ספרות מוקראות אחת אחת

async function step({ v, env, P, bk, done, origin }) {
  const folder = (env.IVR_JOIN_REC_FOLDER || '/1').replace(/\/$/, '');
  const call = String(v.ApiCallId || 'x').replace(/\W/g, '');
  const recFile = (tag) => `j${call}_${tag}`;
  const recPath = (tag) => `${folder}/${recFile(tag)}`;
  // כל שאלה שלא נענתה (שתיקה או ערך לא תקין) נשאלת שוב ושוב באותו משתנה, בלי הגבלת ניסיונות.
  // הערה לפני השאלה החוזרת (ערך לא תקין) רק כשהמתקשר אכן הקיש/אמר משהו.
  const again = (bad, key) => (has(v, key) && !empty(v[key]) ? `${P(bad)}.` : '');
  const yn = (key, phrase) => (v[key] === '1' || v[key] === '2' ? null : readTap(P(phrase), key, ['1', '2'], { empty: EMPTY }));
  const S = (name, k) => v[`s_${name}_${k}`];
  const setS = (name, k, val) => { v[`s_${name}_${k}`] = String(val); };

  // ספרות בהקשה + הקראה לאישור (1) או שינוי (2). כל ניסיון במשתנה חדש (name_<n>), כי ימות שומרת את הערך הישן.
  const numStep = (name, phrase, bad, norm, max, min, label, say = spaced) => {
    const n = Number(S(name, 'n') || 0), key = `${name}_${n}`, ck = `${name}_c${n}`;
    const val = has(v, key) && !empty(v[key]) ? norm(v[key]) : '';
    if (!val) return { ask: readTap(again(bad, key) + P(phrase), key, null, { max, min, empty: EMPTY }) };
    if (v[ck] === '1') return { val };
    if (v[ck] === '2') { setS(name, 'n', n + 1); return { ask: readTap(P(phrase), `${name}_${n + 1}`, null, { max, min, empty: EMPTY }) }; }
    return { ask: readTap(`${T(say(val))}.${P('join:confirm')}`, ck, ['1', '2'], { empty: EMPTY }) };
  };

  // בחירת שם מרשימה (עיר / רחוב) בהקשת האותיות הראשונות. הקשות שבסבבים קודמים נשמרות (s_<name>_acc) ומצטרפות לחדשות.
  // מצב: s_<name>_n סבב, s_<name>_list הרשימה שהוקראה (מופרדת ב-|), s_<name>_part הרשימה חלקית (שמות שהוקשו במלואם),
  // s_<name>_f ניסיונות כושלים, s_<name>_rec = מעבר להקלטה, s_<name>_ok / s_<name>_x הבחירה.
  const pickStep = (name, names, askKey) => {
    if (S(name, 'ok') === '1') return { val: S(name, 'x') || '' };
    if (S(name, 'rec') === '1') return { rec: true };
    const n = Number(S(name, 'n') || 0), key = `${name}_${n}`, mk = `${name}_m${n}`;
    const acc = S(name, 'acc') || '';
    const tap = (prefix, i, a) => readTap(prefix + P(a ? 'join:moreLetters' : askKey), `${name}_${i}`, null, { max: 30, min: 1, empty: EMPTY });
    const advance = (prefix, a) => { setS(name, 'n', n + 1); setS(name, 'acc', a); setS(name, 'list', ''); setS(name, 'part', ''); return { ask: tap(prefix, n + 1, a) }; };
    const fail = (note) => {
      const f = Number(S(name, 'f') || 0) + 1; setS(name, 'f', f);
      if (f >= PICK_FAILS) { setS(name, 'rec', '1'); return { rec: true }; }
      return advance(`${P(note)}.`, '');
    };
    const listAsk = (list, part) => readTap(`${list.map((x, i) => T(`ל${x} הקישו ${i + 1}`)).join('.')}.${P(part ? 'join:listMore' : 'join:notInList')}`,
      mk, [...list.map((_, i) => String(i + 1)), '9'], { empty: EMPTY });
    if (S(name, 'list')) {                                  // הוקראה רשימה: מחכים לבחירה
      const list = S(name, 'list').split('|'), c = Number(v[mk]);
      if (c >= 1 && c <= list.length) { setS(name, 'ok', '1'); setS(name, 'x', list[c - 1]); return { val: list[c - 1] }; }
      if (v[mk] === '9') return S(name, 'part') === '1' ? advance('', acc) : fail('join:pickAgain');
      return { ask: listAsk(list, S(name, 'part') === '1') };
    }
    const raw = has(v, key) && !empty(v[key]) ? String(v[key]) : '';
    if (!raw) return { ask: tap('', n, acc) };
    if (raw === '0') return advance(`${P('join:keyMap')}.`, acc);          // 0 = הסבר על מקום האותיות במקשים
    const d = raw.replace(/[^2-9]/g, '');
    if (!d) return advance(`${P('join:noHear')}.`, acc);
    const all = acc + d, m = matchNames(names, all);
    if (!m.list.length) return fail('join:noLetters');
    let list = m.list, part = false;
    if (list.length > PICK_MAX) {
      if (!m.exact.length || m.exact.length > PICK_MAX) return advance('', all);   // עוד הרבה אפשרויות: ממשיכים להקיש
      list = m.exact; part = true;                          // שם שהוקש במלואו, ויש עוד שמות שמתחילים בו
    }
    setS(name, 'acc', all); setS(name, 'list', list.join('|')); setS(name, 'part', part ? '1' : '');
    return { ask: listAsk(list, part) };
  };

  // הקלטה -> זיהוי דיבור -> הקראת מה שזוהה + אישור (1) / שינוי (2) (הקלטה חוזרת). בלי הגדרת Azure: נשמרת ההקלטה בלבד.
  const recStep = async (name, askKey, max, label, spellKey = '') => {
    if (S(name, 'ok') === '1') return { text: S(name, 'x') || '' };
    const n = Number(S(name, 'n') || 0), key = `${name}_${n}`;
    // spellKey: אם הזיהוי נכשל, מבקשים איות אות אחר אות (מצב sp)
    const askAt = (i, prefix = '') => readRecord(prefix + P(S(name, 'sp') === '1' ? spellKey : askKey), `${name}_${i}`, folder, recFile(`${name}_${i}`), REC_MIN, max);
    if (!has(v, key) || empty(v[key])) return { ask: askAt(n) };
    if (!sttConfigured(env)) { setS(name, 'ok', '1'); setS(name, 'x', ''); setS(name, 'f', key); return { text: '' }; }
    if (S(name, 'tn') !== String(n)) {
      const spelled = S(name, 'sp') === '1';
      const t = await transcribeOne(env, v, folder, recFile, key);
      setS(name, 'x', spelled ? spokenLetters(t) : t); setS(name, 'tn', n);
    }
    const text = S(name, 'x') || '';
    if (!text) {
      setS(name, 'n', n + 1);
      if (spellKey) { setS(name, 'sp', '1'); return { ask: askAt(n + 1) }; }          // לא זוהה: איות אות אחר אות
      return { ask: askAt(n + 1, `${P('join:noHear')}.`) };
    }
    const ck = `${name}_c${n}`;
    if (v[ck] === '1') { setS(name, 'ok', '1'); setS(name, 'f', key); return { text }; }
    if (v[ck] === '2') { setS(name, 'n', n + 1); return { ask: askAt(n + 1) }; }
    return { ask: readTap(`${T(text)}.${P('join:confirm')}`, ck, ['1', '2'], { empty: EMPTY }) };
  };
  let o;

  // 1. תעודת זהות
  const idQ = numStep('id', 'join:askId', 'join:badId', normalizeId, 10, 5, 'join:lblId');
  if (idQ.ask) return idQ.ask;
  const id = idQ.val;

  // 2. שם פרטי ושם משפחה (שתי הקלטות נפרדות)
  const fnQ = await recStep('fn', 'join:askFirst', REC_MAX, 'join:lblFirst');
  if (fnQ.ask) return fnQ.ask;
  const lnQ = await recStep('ln', 'join:askLast', REC_MAX, 'join:lblLast', 'join:askSpell');
  if (lnQ.ask) return lnQ.ask;

  // 3. טלפון: אם זוהה מספר המתקשר - בוחרים בו (1) או מקישים אחר (2)
  let phone = '';
  const callerPhone = normalizePhone(v.ApiPhone);
  if (callerPhone) {
    if ((o = yn('pc', 'join:phoneChoice'))) return o;
    if (v.pc === '1') phone = callerPhone;
  }
  if (!phone) {
    const q = numStep('ph', 'join:askPhone', 'join:badPhone', normalizePhone, 11, 9, 'join:lblPhone');
    if (q.ask) return q.ask;
    phone = q.val;
  }

  // 4. טלפון נוסף (רשות)
  if ((o = yn('p2q', 'join:phone2Q'))) return o;
  let phone2 = '';
  if (v.p2q === '1') {
    const q = numStep('p2', 'join:askPhone2', 'join:badPhone', normalizePhone, 11, 9, 'join:lblPhone');
    if (q.ask) return q.ask;
    phone2 = q.val;
  }

  // 5. כתובת: עיר, רחוב ומספר בית. עיר ורחוב בהקשת אותיות ובחירה מרשימה; בלי נתוני ערים - הקלטת הכתובת המלאה
  const addr = { city: '', street: '', house: '', recs: [] };
  let adQ = { text: '' };
  const cities = await loadCities(env, origin);
  if (!cities || has(v, 'ad_0') || v.s_ad_n) {            // שיחה שכבר התחילה בהקלטת כתובת - ממשיכה כך
    adQ = await recStep('ad', 'join:askAddress', REC_ADDR_MAX, 'join:lblAddress');
    if (adQ.ask) return adQ.ask;
  } else {
    let cityCode = '';
    const ctQ = pickStep('ct', cities.map((c) => c[1]), 'join:askCity');
    if (ctQ.ask) return ctQ.ask;
    if (ctQ.rec) {
      const q = await recStep('ctr', 'join:askCityRec', REC_MAX, 'join:lblCity');
      if (q.ask) return q.ask;
      addr.city = q.text; addr.recs.push('ctr');
    } else { addr.city = ctQ.val; cityCode = (cities.find((c) => c[1] === ctQ.val) || [])[0] || ''; }
    const streets = cityCode ? await loadStreets(env, origin, cityCode) : null;   // null = העיר הוקלטה / אין נתונים: הרחוב בהקלטה
    if (!streets || streets.length) {                       // [] = יישוב בלי רחובות ברשימה: בלי שאלת רחוב
      const stQ = streets ? pickStep('st', streets, 'join:askStreet') : { rec: true };
      if (stQ.ask) return stQ.ask;
      if (stQ.rec) {
        const q = await recStep('str', 'join:askStreetRec', REC_MAX, 'join:lblStreet');
        if (q.ask) return q.ask;
        addr.street = q.text; addr.recs.push('str');
      } else addr.street = stQ.val;
    }
    const hnQ = numStep('hn', 'join:askHouse', 'join:badHouse', (x) => (/^\d{1,4}$/.test(String(x)) ? String(Number(x)) : ''), 4, 1, 'join:lblHouse',
      (x) => (x === '0' ? 'ללא מספר בית' : `מספר בית ${x}`));
    if (hnQ.ask) return hnQ.ask;
    addr.house = hnQ.val === '0' ? '' : hnQ.val;
    adQ = { text: [[addr.street, addr.house].filter(Boolean).join(' '), addr.city].filter(Boolean).join(', ') };
  }

  // 6. אימייל (רשות): קטעים בדיבור ובהקשות, ואז סיומת מרשימה
  if ((o = yn('emq', 'join:emailQ'))) return o;
  let email = '';
  if (v.emq === '1') {
    const q = await emailStep({ v, env, P, folder, recFile, depth: 0 });
    if (q.ask) return q.ask;
    email = q.email || '';
  }

  // 7. פקס (רשות): 9-10 ספרות, גם עם קידומת 153
  if ((o = yn('fxq', 'join:faxQ'))) return o;
  let fax = '';
  if (v.fxq === '1') {
    const q = numStep('fx', 'join:askFax', 'join:badFax', normalizeFax, 10, 9, 'join:lblFax');
    if (q.ask) return q.ask;
    fax = q.val;
  }

  // 8. כל החברות / חברות מסוימות
  if (v.ch !== '1' && v.ch !== '2') return readTap(P('join:choice'), 'ch', ['1', '2'], { empty: EMPTY });
  const all = v.ch === '1';
  let clQ = { text: '' };
  if (!all) { clQ = await recStep('cl', 'join:askList', REC_LIST_MAX, 'join:lblList'); if (clQ.ask) return clQ.ask; }

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

  // הטקסטים שזוהו ואושרו (אם Azure לא מוגדר - נשארות ההקלטות בלבד)
  const texts = { fn: fnQ.text || '', ln: lnQ.text || '', ad: adQ.text || '', cl: clQ.text || '' };
  const fileOf = (name) => S(name, 'f') || `${name}_0`;
  const saved = await save(env, {
    id, phone, phone2, fax, all, texts, email, addr, callId: String(v.ApiCallId || ''),
    files: {
      'הקלטת שם פרטי': recPath(fileOf('fn')), 'הקלטת שם משפחה': recPath(fileOf('ln')),
      ...(has(v, 'ad_0') || v.s_ad_n ? { 'הקלטת כתובת': recPath(fileOf('ad')) } : {}),
      ...(addr.recs.includes('ctr') ? { 'הקלטת עיר': recPath(fileOf('ctr')) } : {}),
      ...(addr.recs.includes('str') ? { 'הקלטת רחוב': recPath(fileOf('str')) } : {}),
      ...(v.emq === '1' && !email && v.emf ? { 'הקלטת אימייל': recPath(v.emf) } : {}),
      ...(!all ? { 'הקלטת חברות': recPath(fileOf('cl')) } : {}),
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
  // הקראת נוסח האישור: "שלום <שם> ת.ז. <...>, הרינו לאשר בזאת שהתקבל הרישום..."
  const name = `${texts.fn} ${texts.ln}`.trim();
  const confirmText = `${P('join:okHello')}.${name ? `${T(name)}.` : ''}${P('join:okId')}.${T(spaced(id))}.${P('join:okBody')}`;
  if (!saved) return done('join:done');
  return `id_list_message=${confirmText}.${mailSent ? `${P('join:mailSent')}.` : ''}${P('join:thanks')}&go_to_folder=${bk}&`;
}

// ---- אימייל ----
// סיומות נפוצות (הקשה 1-9; 0 = סיומת אחרת בהקלטה). dom<N> = ביטוי ההקראה, he = ההגייה לאישור.
const EMAIL_DOMAINS = [
  ['gmail.com', 'גימייל'], ['walla.co.il', 'וואלה ישראל'], ['walla.com', 'וואלה קום'],
  ['yahoo.com', 'יאהו'], ['hotmail.com', 'הוטמייל'], ['outlook.com', 'אאוטלוק'],
  ['okmail.co.il', 'אוקי מייל'], ['netvision.net.il', 'נטוויזיון'], ['bezeqint.net', 'בזק'],
];
const LETTER_HE = { a: 'איי', b: 'בי', c: 'סי', d: 'די', e: 'אי', f: 'אף', g: "ג'י", h: "אייץ'", i: 'אַיי', j: "ג'יי", k: 'קיי', l: 'אל', m: 'אם',
  n: 'אן', o: 'או', p: 'פי', q: 'קיו', r: 'אר', s: 'אס', t: 'טי', u: 'יו', v: 'וי', w: 'דאבליו', x: 'אקס', y: 'וואי', z: 'זד' };
const spellChars = (str) => String(str).toLowerCase().split('').map((c) => LETTER_HE[c] || (c === '.' ? 'נקודה' : c === '_' ? 'קו תחתון' : c === '-' ? 'מקף' : c === '+' ? 'פלוס' : c)).join(' ');
const spellEmail = (email) => {
  const [local, domain = ''] = String(email).split('@');
  const known = EMAIL_DOMAINS.find(([d]) => d === domain.toLowerCase());
  return `${spellChars(local)} שטרודל ${known ? known[1] : spellChars(domain)}`;
};

// פעם ראשונה: הקלטה אחת בדיבור (אותיות ומספרים). אם לא נקלט / לא אושר: שילוב הקראות והקשות בקטעים. אחר כך בחירת סיומת, הקראה ואישור.
// מצב צד-שרת: s_em_segs (קטעים מופרדים ב-|), s_em_r (סבב), s_em_phase ('dom'), s_em_k (ניסיון סיומת), s_em_note (הערה לשאלה הבאה).
// בכל סבב משתנים חדשים (em_m<r> בחירה, em_v<r> קלט), כי ימות שומרת את הערכים הישנים.
async function emailStep(ctx) {
  const { v, env, P, folder, recFile } = ctx;
  if (v.emok) return { email: v.emok };
  if (v.emskip === '1') return {};
  if (!sttConfigured(env)) {                       // אי אפשר לאמת דיבור: נשמרת ההקלטה בלבד
    if (!has(v, 'em_0') || empty(v.em_0)) return { ask: readRecord(P('join:askEmail'), 'em_0', folder, recFile('em_0'), REC_MIN, REC_ADDR_MAX) };
    v.emf = 'em_0';
    return {};
  }
  if (ctx.depth > 6) return {};
  const S = (k, d = '') => (v[`s_em_${k}`] == null ? d : v[`s_em_${k}`]);
  const set = (k, val) => { v[`s_em_${k}`] = String(val); };
  const noteTake = () => { const n = S('note'); set('note', ''); return n ? `${P(n)}.` : ''; };
  const segs = () => S('segs').split('|').filter(Boolean);
  const r = Number(S('r', 0));
  const nextRound = (note) => { if (note) set('note', note); set('r', r + 1); return emailStep({ ...ctx, depth: ctx.depth + 1 }); };
  const recurse = () => emailStep({ ...ctx, depth: ctx.depth + 1 });

  if (S('phase') !== 'dom') {
    if (S('mode') !== 'seg') {
      // פעם ראשונה: הקלטה אחת בדיבור בלבד (אותיות ומספרים), בלי הקשות
      const vk = `em_v${r}`;
      if (!has(v, vk) || empty(v[vk])) return { ask: readRecord(noteTake() + P('join:emailSpeakFirst'), vk, folder, recFile(vk), REC_MIN, 30) };
      const seg = await transcribeMixed(env, v, vk, folder, recFile);
      if (!seg) { set('mode', 'seg'); return nextRound('join:noHear'); }          // לא נקלט: שילוב הקראות והקשות בקטעים
      set('segs', seg); set('phase', 'dom');
      return recurse();
    }
    // שילוב הקראות והקשות: בכל סבב אותיות (הקלטה) / מספרים (הקשה) / סיום / מחיקת הקטע האחרון
    const mk = `em_m${r}`, vk = `em_v${r}`;
    const choice = v[mk];
    if (!['1', '2', '3', '4'].includes(choice)) {
      const list = segs();
      const intro = S('intro') ? '' : `${P('join:emailInstr')}.`;
      set('intro', '1');
      const soFar = list.length ? `${P('join:emailSoFar')}.${T(spellChars(list.join('')))}.` : '';
      return { ask: readTap(noteTake() + intro + soFar + P('join:emailMenu'), mk, ['1', '2', '3', '4'], { empty: EMPTY }) };
    }
    if (choice === '1') {
      if (!has(v, vk) || empty(v[vk])) return { ask: readRecord(P('join:emailSpeakMix'), vk, folder, recFile(vk), REC_MIN, 25) };
      const seg = await transcribeMixed(env, v, vk, folder, recFile);
      if (!seg) return nextRound('join:noHear');
      set('segs', [...segs(), seg].join('|'));
      return nextRound('');
    }
    if (choice === '2') {
      if (!has(v, vk) || empty(v[vk])) return { ask: readTap(P('join:emailDigits'), vk, null, { max: 20, min: 1, empty: EMPTY }) };
      if (!/^\d{1,20}$/.test(String(v[vk]))) return nextRound('join:noHear');
      set('segs', [...segs(), String(v[vk])].join('|'));
      return nextRound('');
    }
    if (choice === '4') { const l = segs(); l.pop(); set('segs', l.join('|')); return nextRound(''); }
    // '3' - סיום
    if (!segs().length) return nextRound('join:emailEmpty');
    set('phase', 'dom');
    return recurse();
  }

  // סיומת
  const k = Number(S('k', 0)), dk = `em_d${k}`;
  const local = segs().join('');
  if (!['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'].includes(v[dk])) {
    const opts = EMAIL_DOMAINS.map((_, i) => P(`join:dom${i + 1}`)).join('.');
    return { ask: readTap(`${noteTake()}${P('join:emailDomIntro')}.${opts}.${P('join:domOther')}`, dk, ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'], { empty: EMPTY }) };
  }
  let domain = '';
  if (v[dk] === '0') {
    const xk = `em_x${k}`;
    if (!has(v, xk) || empty(v[xk])) return { ask: readRecord(P('join:emailDomSpeak'), xk, folder, recFile(xk), REC_MIN, 15) };
    domain = pickDomain(await transcribeLangs(env, v, xk, folder, recFile));
  } else domain = EMAIL_DOMAINS[Number(v[dk]) - 1][0];
  const email = domain ? `${local}@${domain}` : '';
  if (!email || !spokenEmail(email)) { set('k', k + 1); set('note', 'join:badEmail'); return recurse(); }
  const ck = `em_c${k}`;
  if (v[ck] === '1') { v.emok = email; return { email }; }
  if (v[ck] === '2') {
    set('mode', 'seg'); set('phase', ''); set('r', r + 1); set('k', k + 1); set('intro', '');     // שינוי: עריכה בשילוב הקראות והקשות (הכתובת שנקלטה נשארת)
    return recurse();
  }
  return { ask: readTap(`${P('join:emailHeard')}.${T(spellEmail(email))}.${P('join:confirm')}`, ck, ['1', '2'], { empty: EMPTY }) };
}

// הקלטה אחת מזוהה בכמה שפות (עברית + אנגלית אמריקאית + בריטית): אותיות באנגלית מזוהות רק בזיהוי האנגלי, מילים בעברית רק בעברית.
const EMAIL_LANGS = ['en-US', 'en-GB', 'he-IL'];
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

// הקלטה של אותיות בדיבור, אפשר עם הקשות באמצע: צלילי ההקשה מזוהים בקובץ (DTMF) והופכים לספרות, והדיבור שביניהם מתומלל בנפרד.
async function transcribeMixed(env, v, key, folder, recFile) {
  try {
    const value = String(v[key] || '');
    const rec = await downloadRecording(env, [
      ...(/\.(wav|mp3|ogg)$/i.test(value) || /^\/.*\//.test(value) ? [value] : []),
      `${folder}/${recFile(key)}.wav`, `${folder}/${recFile(key)}`,
    ]);
    if (!rec) return '';
    const parts = splitSpeechAndDigits(rec.bytes);
    console.log(`ivr email parts: ${parts.map((x) => (x.type === 'digits' ? `D${x.digits.length}` : 'S')).join(',')}`);   // בלי תוכן אישי
    let out = '';
    for (const part of parts) {
      if (part.type === 'digits') { out += part.digits; continue; }
      const langs = await Promise.all(EMAIL_LANGS.map(async (l) => clean(await azureTranscribe(env, part.wav, l), 200).replace(/[,!?]+$/g, '').trim()));
      out += pickSegment(langs);
    }
    return pickSegment([out]);
  } catch { return ''; }
}

// הקלטה אחת -> טקסט (עברית). אין מחיקה של ההקלטה, כדי שאפשר יהיה לבדוק מול הטקסט שזוהה.
async function transcribeOne(env, v, folder, recFile, key) {
  try {
    const value = String(v[key] || '');
    const rec = await downloadRecording(env, [
      ...(/\.(wav|mp3|ogg)$/i.test(value) || /^\/.*\//.test(value) ? [value] : []),
      `${folder}/${recFile(key)}.wav`, `${folder}/${recFile(key)}`,
    ]);
    return rec ? clean(await azureTranscribe(env, rec.bytes), 200).replace(/[.,!?]+$/g, '').trim() : '';
  } catch { return ''; }
}

export { spokenEmail };

async function save(env, { id, phone, phone2, fax, all, files, texts = {}, email = '', addr = {}, callId }) {
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
    ...(addr.city ? { 'עיר': addr.city } : {}),
    ...(addr.street ? { 'רחוב': addr.street } : {}),
    ...(addr.house ? { 'מספר בית': addr.house } : {}),
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
