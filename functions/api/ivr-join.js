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
import { normalizeId, normalizePhone, jerusalemNow, newRowId } from './_shared/join-common.js';

const EMPTY = 'NONE';
const REC_MIN = 1, REC_MAX = 8, REC_ADDR_MAX = 15, REC_LIST_MAX = 30;
const AGREEMENT_VERSION = 'טלפוני-1';

// ---- מצב שיחה מוצפן (ivr_join_state) ----
const STATE_KEYS = ['id', 'fn', 'ln', 'pc', 'ph', 'p2q', 'p2', 'ad', 'emq', 'em', 'fxq', 'fx', 'ch', 'cl', 'rd', 'pl'];
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
    const out = await step({ v, env, P, bk, done });
    await saveState(env, callId, v);
    return text(out);
  } catch (e) {
    console.log(`ivr-join error: ${e && e.message}`);   // בלי פרטים אישיים בלוג
    return text(done('join:error'));
  }
}

const has = (v, k) => Object.prototype.hasOwnProperty.call(v, k);
const empty = (x) => !x || x === EMPTY;

async function step({ v, env, P, done }) {
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
  if (v.emq === '1' && (o = rec('em', 'join:askEmail', REC_ADDR_MAX))) return o;

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

  await save(env, {
    id, phone, phone2, fax, all, callId: String(v.ApiCallId || ''),
    files: {
      'הקלטת שם פרטי': recPath('fn'), 'הקלטת שם משפחה': recPath('ln'), 'הקלטת כתובת': recPath('ad'),
      ...(v.emq === '1' ? { 'הקלטת אימייל': recPath('em') } : {}),
      ...(!all ? { 'הקלטת חברות': recPath('cl') } : {}),
    },
  });
  v.finished = true;
  return done('join:done');
}

async function save(env, { id, phone, phone2, fax, all, files, callId }) {
  const key = await importKeyForWrite(env);
  const ih = await identHash(env, id);
  // הגנה מקריאה כפולה: אותה ת.ז. שנרשמה ב-3 הדקות האחרונות לא נרשמת שוב
  const recent = await env.DB.prepare('SELECT id FROM joiners WHERE ident_hash = ? AND submitted_at >= ? LIMIT 1')
    .bind(ih, jerusalemNow(new Date(Date.now() - 3 * 60000))).first();
  if (recent) return;

  const rid = newRowId(), now = jerusalemNow();
  // אותם שדות כמו הטופס באתר (join.js). שמות, כתובת ואימייל נמסרים בקול, ולכן נשמרים כהקלטות (נתיב בימות).
  const extra = {
    'ערוץ': 'טלפון (ימות המשיח)',
    ...(phone2 ? { 'טלפון נוסף': phone2 } : {}),
    ...(fax ? { 'פקס': fax } : {}),
    'כתובת': '(ראו הקלטת כתובת)',
    ...files,
    'מזהה שיחה': callId,
    'גרסת שטר': AGREEMENT_VERSION,
    'אושרו התנאים': 'כן (בהקשה, בנוסח ההצהרה הטלפוני)',
  };
  const payload = {
    first: 'טלפוני (ראו הקלטת שם פרטי)', last: '(ראו הקלטת שם משפחה)', phone, email: '', id, ip: '',
    companies: all ? '' : '(ראו הקלטת חברות)', all: all ? 'כן' : '',
    pdf: '', extra: JSON.stringify(extra), src: 'ivr',
  };
  await env.DB.prepare("INSERT INTO joiners (id, submitted_at, cancelled_at, file_sha256, ident_hash, pii) VALUES (?, ?, '', '', ?, ?)")
    .bind(rid, now, ih, await encryptPii(key, rid, payload)).run();
}

const text = (body) => new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
