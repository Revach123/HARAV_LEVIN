// ============================================================================
//  functions/api/ivr-join.js — הצטרפות להיתר עסקה פרטי בטלפון (ימות המשיח)
//
//  שלוחת api (ברירת מחדל /1). נרשם באותה טבלה ובאותה הצפנה כמו הטופס באתר (join.js), עם src = "ivr".
//  זרימה (בלי מצב בשרת - הכול נגזר מהמשתנים שימות מחזירה בכל קריאה):
//    id<a>   תעודת זהות (הקשה, עד 3 ניסיונות, בדיקת ספרת ביקורת)
//    ph<a>   טלפון - רק אם מספר המתקשר (ApiPhone) לא זוהה
//    nm<a>   הקלטת שם פרטי ושם משפחה (עד 2 ניסיונות)
//    ch      1 = כל החברות, 2 = חברות מסוימות
//    cl<a>   הקלטת שמות החברות (רק ב-ch=2)
//    rd      1 = להקריא את נוסח השטר המלא (14 פסקאות), 2 = להמשיך
//    ag      הצהרה: 1 = מאשר ונרשם, 2 = ביטול
//  ההקלטות נשמרות בימות בתיקיית השלוחה (IVR_JOIN_REC_FOLDER, ברירת מחדל /1); נתיבן נשמר ברשומה (שדות "הקלטת ..." בהערות).
//  ext.ini:  type=api / api_link=https://harav-levin.pages.dev/api/ivr-join / api_add_0=sk=<IVR_SECRET_NEW> / api_add_1=bk=/
//  דרישות: IVR_SECRET (או IVR_SECRET_NEW), JOINERS_KEY, binding DB.
// ============================================================================
import { folderParam, parseYemot, readRecord, readTap, secretOk } from './_shared/ivr-auth.js';
import { AGREEMENT_KEYS, unit } from './_shared/ivr_phrases.js';
import MANIFEST from './_shared/ivr_audio_manifest.js';
import { importKeyForWrite, encryptPii, identHash } from './_shared/joiners-crypto.js';
import { normalizeId, normalizePhone, jerusalemNow, newRowId } from './_shared/join-common.js';

const EMPTY = 'NONE';
const MAX_ID_TRIES = 3, MAX_NAME_TRIES = 2, REC_MIN = 1, REC_MAX = 8, REC_LIST_MAX = 30;
const AGREEMENT_VERSION = 'טלפוני-1';

export async function onRequest({ request, env }) {
  const v = await parseYemot(request);
  if (!secretOk(env, v.sk)) return text('id_list_message=t-שגיאת הרשאה&');
  if (v.hangup === 'yes') return text('');

  const mf = String(env.IVR_AUDIO_OFF || '') === '1' ? {} : MANIFEST;
  const P = (key) => unit(key, mf);
  const bk = folderParam(v, 'bk', env.IVR_BACK_FOLDER || '/');
  const done = (...keys) => (`id_list_message=${keys.map(P).join('.')}&go_to_folder=${bk}&`);

  try {
    return text(await step({ v, env, P, bk, done }));
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

  // 1. תעודת זהות
  let id = '';
  for (let a = 1; a <= MAX_ID_TRIES; a++) {
    const k = `id${a}`;
    if (!has(v, k)) return readTap(a === 1 ? P('join:askId') : `${P('join:badId')}.${P('join:askId')}`, k, null, { max: 10, min: 5, empty: EMPTY });
    id = empty(v[k]) ? '' : normalizeId(v[k]);
    if (id) break;
  }
  if (!id) return done('join:badId');

  // 2. טלפון: מספר המתקשר, ואם לא זוהה - הקשה
  let phone = normalizePhone(v.ApiPhone);
  if (!phone) {
    for (let a = 1; a <= MAX_ID_TRIES; a++) {
      const k = `ph${a}`;
      if (!has(v, k)) return readTap(a === 1 ? P('join:askPhone') : `${P('join:badPhone')}.${P('join:askPhone')}`, k, null, { max: 11, min: 9, empty: EMPTY });
      phone = empty(v[k]) ? '' : normalizePhone(v[k]);
      if (phone) break;
    }
    if (!phone) return done('join:badPhone');
  }

  // 3. שם (הקלטה)
  let nameFile = '';
  for (let a = 1; a <= MAX_NAME_TRIES; a++) {
    const k = `nm${a}`;
    if (!has(v, k)) return readRecord(P('join:askName'), k, folder, recFile(`nm${a}`), REC_MIN, REC_MAX);
    if (!empty(v[k])) { nameFile = recPath(`nm${a}`); break; }
  }
  if (!nameFile) return done('join:error');

  // 4. כל החברות / חברות מסוימות
  if (!has(v, 'ch')) return readTap(P('join:choice'), 'ch', ['1', '2'], { empty: EMPTY });
  if (v.ch !== '1' && v.ch !== '2') return done('join:cancelled');
  const all = v.ch === '1';
  let listFile = '';
  if (!all) {
    for (let a = 1; a <= MAX_NAME_TRIES; a++) {
      const k = `cl${a}`;
      if (!has(v, k)) return readRecord(P('join:askList'), k, folder, recFile(`cl${a}`), REC_MIN, REC_LIST_MAX);
      if (!empty(v[k])) { listFile = recPath(`cl${a}`); break; }
    }
    if (!listFile) return done('join:error');
  }

  // 5. הצהרה והסכמה
  if (!has(v, 'rd')) return readTap(P('join:askRead'), 'rd', ['1', '2'], { empty: EMPTY });
  if (!has(v, 'ag')) {
    const full = v.rd === '1' ? AGREEMENT_KEYS.map(P).join('.') + '.' : '';   // rd=1: הקראת השטר המלא לפני ההצהרה
    return readTap(full + P('join:declare'), 'ag', ['1', '2'], { empty: EMPTY });
  }
  if (v.ag !== '1') return done('join:cancelled');

  await save(env, { id, phone, all, nameFile, listFile, callId: String(v.ApiCallId || '') });
  return done('join:done');
}

async function save(env, { id, phone, all, nameFile, listFile, callId }) {
  const key = await importKeyForWrite(env);
  const ih = await identHash(env, id);
  // הגנה מקריאה כפולה: אותה ת.ז. שנרשמה ב-3 הדקות האחרונות לא נרשמת שוב
  const recent = await env.DB.prepare('SELECT id FROM joiners WHERE ident_hash = ? AND submitted_at >= ? LIMIT 1')
    .bind(ih, jerusalemNow(new Date(Date.now() - 3 * 60000))).first();
  if (recent) return;

  const rid = newRowId(), now = jerusalemNow();
  const extra = {
    'ערוץ': 'טלפון (ימות המשיח)',
    'הקלטת שם': nameFile,
    ...(listFile ? { 'הקלטת חברות': listFile } : {}),
    'מזהה שיחה': callId,
    'גרסת שטר': AGREEMENT_VERSION,
    'אושרו התנאים': 'כן (בהקשה, בנוסח ההצהרה הטלפוני)',
  };
  const payload = {
    first: 'הצטרפות טלפונית', last: '(ראו הקלטת שם)', phone, email: '', id, ip: '',
    companies: all ? '' : '(ראו הקלטת חברות)', all: all ? 'כן' : '',
    pdf: '', extra: JSON.stringify(extra), src: 'ivr',
  };
  await env.DB.prepare("INSERT INTO joiners (id, submitted_at, cancelled_at, file_sha256, ident_hash, pii) VALUES (?, ?, '', '', ?, ?)")
    .bind(rid, now, ih, await encryptPii(key, rid, payload)).run();
}

const text = (body) => new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
