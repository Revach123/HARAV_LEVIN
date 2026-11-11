// סימולציה של שלוחה 3: הצטרפות בדיבור בלבד (/api/ivr-join-voice) עם ימות ו-ElevenLabs מדומים, ושמירה בטבלת המצטרפים.
// הרצה: node --no-warnings scripts/voice_search/simulate_join_voice.mjs
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { onRequest as voice } from '../../functions/api/ivr-join-voice.js';
import { onRequest as menu } from '../../functions/api/ivr-menu.js';
import { digitsFromSpeech } from '../../functions/api/_shared/stt-eleven.js';
import { importKeyForWrite, decryptPii } from '../../functions/api/_shared/joiners-crypto.js';

// ---- ספרות מדיבור ----
assert.equal(digitsFromSpeech('אחת שתיים שלוש ארבע חמש שש שבע שמונה שתיים'), '123456782');
assert.equal(digitsFromSpeech('אפס חמש אחת, 234-5678'), '0512345678');
assert.equal(digitsFromSpeech('אפס חמישים ושתיים שבע שבע'), '05277');
assert.equal(digitsFromSpeech('ושתיים ושלוש'), '23');
assert.equal(digitsFromSpeech('שלום'), '');
console.log('digits OK');

// ---- D1 מדומה ----
const db = new DatabaseSync(':memory:');
db.exec('CREATE TABLE joiners (id TEXT, submitted_at TEXT, cancelled_at TEXT, file_sha256 TEXT, ident_hash TEXT, pii TEXT)');
const st = (sql, a = []) => ({
  all: async () => ({ results: db.prepare(sql).all(...a) }),
  first: async () => db.prepare(sql).get(...a) ?? null,
  run: async () => { db.prepare(sql).run(...a); return {}; },
});
const DB = { prepare: (sql) => ({ ...st(sql), bind: (...a) => st(sql, a) }) };

// ---- ימות (הורדת הקלטה) ו-ElevenLabs מדומים: מה "נאמר" בכל הקלטה, לפי שם הקובץ ----
const said = new Map();
const elevenCalls = [];
globalThis.fetch = async (url, init = {}) => {
  url = String(url);
  if (url.includes('/DownloadFile')) {
    const path = new URL(url).searchParams.get('path');
    const f = path.split('/').pop().replace(/\.wav$/, '');
    return new Response(said.has(f) ? new Uint8Array([0x52, 0x49, 0x46, 0x46, ...Buffer.from(f), ...new Array(60).fill(0)]) : '{"responseStatus":"ERROR"}');
  }
  if (url === 'https://api.elevenlabs.io/v1/speech-to-text') {
    const fd = init.body, bytes = Buffer.from(await fd.get('file').arrayBuffer());
    elevenCalls.push({ key: init.headers['xi-api-key'], model: fd.get('model_id'), lang: fd.get('language_code') });
    const f = [...said.keys()].find((k) => bytes.includes(Buffer.from(k)));
    return Response.json({ text: f ? said.get(f) : '' });
  }
  throw new Error('unexpected fetch ' + url);
};

const env = { IVR_SECRET_NEW: 'N', IVR_AUDIO_OFF: '1', JOINERS_KEY: Buffer.alloc(32, 7).toString('base64'), DB, ELEVENLABS_API_KEY: 'EK', YEMOT_TOKEN: '0771:pw' };
const plain = (x) => x.replace(/[ְ-ׇ]/g, '');
const run = async (fn, vars, e = env) => {
  const u = new URL('https://x/api/x');
  for (const [k, v] of Object.entries({ sk: 'N', ApiCallId: 'c1', ApiPhone: '0501234567', ...vars })) u.searchParams.set(k, v);
  return plain(await (await fn({ request: new Request(u), env: e })).text());
};
let vars = {};
const step = async (add, re) => { vars = { ...vars, ...add }; const r = await run(voice, vars); assert.match(r, re, r); return r; };
// הקלטה: ימות מחזירה את נתיב הקובץ; "אומרים" text
const rec = (key, text) => { said.set(`vc1_${key}`, text); return { [key]: `/3/vc1_${key}.wav` }; };

// ---- תפריט ראשי: 3 = הצטרפות בדיבור ----
assert.match(await run(menu, {}), /להצטרפות בדבור הקישו 3=mm,no,1,1,7,No,no,no,,1\.2\.3,/);
assert.equal(await run(menu, { mm: '3' }), 'go_to_folder=/3&');
console.log('menu OK');

// ---- בלי מפתח ElevenLabs: הודעה וחזרה ----
assert.match(await run(voice, {}, { ...env, ELEVENLABS_API_KEY: '' }), /^id_list_message=t-השלוחה אינה זמינה כרגע&go_to_folder=\/&$/);

// ---- שיחה מלאה ----
let r = await step({}, /^read=t-שלום כאן הצטרפות.*t-לאחר הצליל אמרו את מספר תעודת הזהות.*=id_0,no,record,\/3,vc1_id_0,no,yes,no,1,10$/);
// ת.ז. במילים -> הקראה ספרה אחר ספרה + אישור / הקלטה חוזרת
r = await step(rec('id_0', 'אחת שתיים שלוש ארבע חמש שש שבע שמונה שלוש'), /^read=t-מספר תעודת הזהות אינו תקין\.t-לאחר הצליל.*=id_1,/);          // ספרת ביקורת שגויה -> "אינו תקין" והקלטה חוזרת
assert.match(r, /תעודת הזהות אינו תקין/);
r = await step(rec('id_1', 'אחת שתיים שלוש ארבע חמש שש שבע שמונה שתיים'), /^read=t-זוהה\.t-1 2 3 4 5 6 7 8 2\.t-לאישור הקישו 1 להקלטה חוזרת הקישו 2=id_c1,no,1,1,/);
r = await step({ id_c1: '2' }, /=id_2,no,record,/);                                   // הקלטה חוזרת
r = await step(rec('id_2', '123456782'), /=id_c2,/);
r = await step({ id_c2: '1' }, /=fn_0,no,record,\/3,vc1_fn_0,/);
r = await step(rec('fn_0', 'אריה.'), /^read=t-זוהה\.t-אריה\.t-לאישור.*=fn_c0,/);
r = await step({ fn_c0: '1' }, /=ln_0,no,record,/);
// לא זוהה כלום -> "לא הצלחנו להבין" והקלטה חוזרת
r = await step(rec('ln_0', ''), /^read=t-לא הצלחנו להבין.*=ln_1,no,record,/);
r = await step(rec('ln_1', 'כהן'), /=ln_c1,/);
r = await step({ ln_c1: '1' }, /=pc,no,1,1,/);                                         // טלפון המתקשר זוהה
r = await step({ pc: '2' }, /=ph_0,no,record,/);
r = await step(rec('ph_0', 'אפס חמישים ושתיים שבע אחת אחת שבע אפס ארבע אחת'), /^read=t-זוהה\.t-0 5 2 7 1 1 7 0 4 1\.t-לאישור.*=ph_c0,/);
r = await step({ ph_c0: '1' }, /=p2q,no,1,1,/);
r = await step({ p2q: '1' }, /=p2_0,no,record,/);
r = await step(rec('p2_0', 'אפס שלוש חמש שש שבע שמונה תשע אפס אחת'), /^read=t-זוהה\.t-0 3 5 6 7 8 9 0 1\.t-לאישור.*=p2_c0,/);
// כתובת: עיר, רחוב, מספר בית
r = await step({ p2_c0: '1' }, /=ct_0,no,record,\/3,vc1_ct_0,/);
r = await step(rec('ct_0', 'בני ברק'), /^read=t-זוהה\.t-בני ברק\.t-לאישור.*=ct_c0,/);
r = await step({ ct_c0: '1' }, /=st_0,no,record,/);
r = await step(rec('st_0', 'הרב קוק'), /=st_c0,/);
r = await step({ st_c0: '1' }, /=hn_0,no,record,/);
r = await step(rec('hn_0', 'שלום'), /^read=t-מספר הבית אינו תקין.*=hn_1,no,record,/);
r = await step(rec('hn_1', 'חמש'), /^read=t-זוהה\.t-מספר בית 5\.t-לאישור.*=hn_c1,/);
r = await step({ hn_c1: '1' }, /=fxq,no,1,1,/);
r = await step({ fxq: '2' }, /=emq,no,1,1,/);
// אימייל בדיבור: זיהוי בעברית + אוטומטי, הקראה אות אחר אות ואישור
r = await step({ emq: '1' }, /=em_0,no,record,\/3,vc1_em_0,no,yes,no,1,15$/);
r = await step(rec('em_0', 'משהו'), /^read=t-לא הצלחנו לזהות כתבת אימייל תקינה.*=em_1,no,record,/);
r = await step(rec('em_1', 'אם או אס אייץ שטרודל גימייל נקודה קום'), /^read=t-כתבת המייל שהוכנסה\.t-אם או אס אייץ שטרודל גימייל\.t-לאישור הקישו 1 להקלטה חוזרת הקישו 2=em_c1,/);
r = await step({ em_c1: '1' }, /=ch,no,1,1,/);
r = await step({ ch: '2' }, /=cl_0,no,record,\/3,vc1_cl_0,no,yes,no,1,30$/);
r = await step(rec('cl_0', 'בנק לאומי, מגדל'), /=cl_c0,/);
r = await step({ cl_c0: '1' }, /=rd,no,1,1,/);
// הקראת השטר המלא: בחלקים קצרים (כל חלק בבקשה נפרדת, בלי הקשה), ואחריהם ההצהרה
r = await step({ rd: '1' }, /=ap_100,no,1,1,1,No,no,no,,,,Ok,NONE,/);
let chunks = 1, maxLen = r.length;
for (let k = 0; ; k++) {
  vars[`ap_${100 + k}`] = 'NONE';
  r = await run(voice, vars); maxLen = Math.max(maxLen, r.length);
  if (/=ag_1,/.test(r)) break;
  assert.match(r, new RegExp(`=ap_${101 + k},no,1,1,1,`), r); chunks++;
}
assert.ok(chunks >= 4 && maxLen < 2000, `chunks ${chunks}, longest response ${maxLen}`);
assert.match(r, /^read=t-אני מצהיר.*=ag_1,no,1,1,7,No,no,no,,1\.2\.3,/);
console.log('agreement OK:', chunks, 'chunks, longest response', maxLen, 'chars');
// 2 = שמיעה חוזרת (שוב מהחלק הראשון, במשתנים חדשים), ואז אישור
r = await step({ ag_1: '2' }, /=ap_200,no,1,1,1,/);
for (let k = 0; ; k++) { vars[`ap_${200 + k}`] = 'NONE'; r = await run(voice, vars); if (/=ag_2,/.test(r)) break; }
r = await step({ ag_2: '1' }, /^id_list_message=.*t-אריה כהן.*t-1 2 3 4 5 6 7 8 2.*&go_to_folder=\/&$/);
console.log('call OK');

// ---- נשמר בטבלת המצטרפים ----
const rows = db.prepare('SELECT * FROM joiners').all();
assert.equal(rows.length, 1);
const p = await decryptPii(await importKeyForWrite(env), rows[0].id, rows[0].pii);
assert.equal(p.first, 'אריה'); assert.equal(p.last, 'כהן'); assert.equal(p.phone, '0527117041'); assert.equal(p.id, '123456782'); assert.equal(p.companies, 'בנק לאומי, מגדל');
const x = JSON.parse(p.extra);
assert.equal(x['ערוץ'], 'טלפון - דיבור (ElevenLabs, שלוחה 3)'); assert.equal(x['כתובת'], 'הרב קוק 5, בני ברק');
assert.deepEqual([x['עיר'], x['רחוב'], x['מספר בית'], x['טלפון נוסף']], ['בני ברק', 'הרב קוק', '5', '035678901']);
assert.equal(x['הקלטת מספר בית'], '/3/vc1_hn_1'); assert.equal(x['הקלטת תעודת זהות'], '/3/vc1_id_2');
assert.equal(x['הקלטת שם משפחה'], '/3/vc1_ln_1'); assert.equal(p.email, 'mosh@gmail.com'); assert.equal(x['הקלטת אימייל'], '/3/vc1_em_1');
console.log('saved OK:', p.first, p.last, p.id, x['ערוץ']);
// ElevenLabs: מפתח בכותרת, עברית, scribe_v1; זיהוי פעם אחת לכל הקלטה
assert.ok(elevenCalls.every((c) => c.key === 'EK' && c.model === 'scribe_v1' && (c.lang === 'he' || c.lang === null)));
assert.equal(elevenCalls.filter((c) => c.lang === null).length, 2, 'email: also auto language');
assert.equal(elevenCalls.length, 17, 'one transcription per recording (email twice): ' + elevenCalls.length);
console.log('ElevenLabs calls OK:', elevenCalls.length);
// המצב נמחק בסיום
assert.equal(db.prepare('SELECT COUNT(*) AS n FROM ivr_join_voice_state').get().n, 0);

// ---- קבצי Azure לחלקי השטר: בפעם הראשונה TTS של ימות + הפקה ברקע, אחר כך מהקובץ ----
const { agreementStep, warmAgreement } = await import('../../functions/api/_shared/ivr-agreement.js');
const { readTap } = await import('../../functions/api/_shared/ivr-auth.js');
const { unit } = await import('../../functions/api/_shared/ivr_phrases.js');
const uploads = [], tts = [];
const prevFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  url = String(url);
  if (url.includes('tts.speech.microsoft.com')) { tts.push(init.body); assert.equal(init.headers['X-Microsoft-OutputFormat'], 'riff-8khz-16bit-mono-pcm'); return new Response(new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3])); }
  if (url.includes('/ym/api/UploadFile')) { uploads.push(init.body.get('path')); assert.equal(init.body.get('token'), '0771:pw'); return Response.json({ responseStatus: 'OK' }); }
  return prevFetch(url, init);
};
const aenv = { ...env, AZURE_SPEECH_KEY: 'AK', IVR_AUDIO_OFF: '' };
const bg = []; const wu = (pr) => bg.push(pr);
const av = { rd: '1' }, ctx = { env: aenv, v: av, S: (n, k) => av[`s_${n}_${k}`], setS: (n, k, x2) => { av[`s_${n}_${k}`] = String(x2); }, P: (k) => unit(k, {}), readTap, waitUntil: wu };
await warmAgreement(aenv, wu); await Promise.all(bg);          // כשנשאלת השאלה "לשמוע את השטר המלא?"
assert.equal(uploads.length, 6); assert.ok(uploads.every((x2) => /^ivr2:99\/ag_[0-9a-f]{12}\.wav$/.test(x2)), uploads.join(' '));
let q = await agreementStep(ctx);
assert.match(q.ask, /^read=f-\/99\/ag_[0-9a-f]{12}=ap_100,/, q.ask);          // החלק הראשון מקובץ Azure
assert.equal(uploads.length, 6, 'no duplicate production');
console.log('agreement audio OK: 6 Azure files, read from file');
globalThis.fetch = prevFetch;
console.log('ALL OK');
