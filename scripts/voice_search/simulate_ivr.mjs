// סימולציה של שיחת ימות מול /api/ivr-company עם נתוני העסקים האמיתיים (בלי D1 ובלי ימות).
// הרצה: node scripts/voice_search/simulate_ivr.mjs
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { onRequest } from '../../functions/api/ivr-company.js';

const csv = readFileSync(new URL('../../reports/heteriske_audit/heteriske_businesses_with_chp.csv', import.meta.url), 'utf8').replace(/^﻿/, '');
const rows = [];
for (const l of csv.split('\n').slice(1)) {
  const m = l.match(/^(\d+),[^,]*,("(?:[^"]|"")*"|[^,]*),[^,]*,[^,]*,[^,]*,(\d*)/);
  if (m) rows.push({ id: m[1], registrar_name: m[2].replace(/^"|"$/g, '').replace(/""/g, '"'), permit_name: '', chp_number: m[3] });
}
const sttRows = new Map();
const stmt = (sql) => ({
  all: async () => ({ results: rows }),
  run: async () => ({}),
  bind: (...a) => ({
    first: async () => (sql.startsWith('SELECT text') ? (sttRows.has(a.join(':')) ? { text: sttRows.get(a.join(':')) } : null) : null),
    run: async () => { if (sql.startsWith('INSERT')) sttRows.set(`${a[0]}:${a[1]}`, a[2]); return {}; },
  }),
});
const mkEnv = (extra = {}) => ({ IVR_SECRET: 'S', DB: { prepare: stmt }, ...extra });

async function call(env, vars) {
  const u = new URL('https://x/api/ivr-company');
  u.searchParams.set('sk', 'S');
  u.searchParams.set('ApiCallId', 't1');
  for (const [k, v] of Object.entries(vars)) u.searchParams.set(k, v);
  return (await onRequest({ request: new Request(u), env })).text();
}

// 1. ללא הגדרת דיבור: ח.פ. של בנק לאומי
let env = mkEnv();
let r = await call(env, {});
assert.match(r, /^read=t-.*=h,no,9,5,/); console.log('1a', r);
r = await call(env, { h: '520018078' });
assert.match(r, /בנק לאומי לישראל/); assert.match(r, /=kh,/); console.log('1b', r);
r = await call(env, { h: '520018078', kh: '1' });
assert.match(r, /^id_list_message=t-נבחר בנק לאומי לישראל.*&go_to_folder=\/5&$/); console.log('1c', r);
assert.match(await call(env, { h: '123456789' }), /לא נמצא עסק/);
assert.equal(await call(env, { hangup: 'yes' }), '');
assert.match(await (async () => { const u = new URL('https://x/api/ivr-company?sk=bad'); return (await onRequest({ request: new Request(u), env })).text(); })(), /הרשאה/);

// 2. דיבור מוגדר: שם עם שגיאות זיהוי
env = mkEnv({ IVR_VOICE_READ_OPTS: 'no,voice' });
r = await call(env, {});
assert.match(r, /^read=t-אמרו את שם העסק=s1,no,voice$/); console.log('2a', r);
r = await call(env, { s1: 'הבנק לאומי' });
assert.match(r, /=k1_0,/); assert.match(r, /בנק לאומי לישראל/); console.log('2b', r);
r = await call(env, { s1: 'הבנק לאומי', k1_0: '1' });
assert.match(r, /נבחר בנק לאומי/); console.log('2c', r);
// לא נמצא -> שואלים שוב; אחרי 3 כשלונות -> ח.פ.
r = await call(env, { s1: 'קקקקקק' });
assert.match(r, /לא נמצא עסק בשם הזה אמרו שוב את שם העסק=s2,no,voice$/); console.log('2d', r);
r = await call(env, { s1: 'קקקקקק', s2: 'NONE', s3: 'זזזזזז' });
assert.match(r, /=h,no,9,5,/); console.log('2e', r);
// דחיית מועמד -> המועמד הבא
r = await call(env, { s1: 'בנק', k1_0: '2' });
assert.match(r, /=k1_1,/); console.log('2f', r);
// הקלטה גולמית במקום טקסט -> הודעה ברורה
assert.match(await call(env, { s1: '/5/8/rec001.wav' }), /לא הוגדר נכון/);

// 3. הקלטה + זיהוי חיצוני (Yemot DownloadFile + Azure), עם fetch מדומה
const realFetch = globalThis.fetch;
const calls = [];
let heard = 'הבנק לאומי';
globalThis.fetch = async (url, init = {}) => {
  url = String(url); calls.push(url.split('?')[0].split('/').pop());
  if (url.includes('DownloadFile')) return new Response(new Uint8Array([0x52, 0x49, 0x46, 0x46, ...new Array(100).fill(0)]));
  if (url.includes('stt.speech.microsoft.com')) {
    assert.equal(init.headers['Ocp-Apim-Subscription-Key'], 'AK'); assert.match(url, /language=he-IL/);
    return Response.json({ RecognitionStatus: 'Success', DisplayText: heard });
  }
  if (url.includes('FileAction')) return Response.json({ responseStatus: 'OK' });
  throw new Error('unexpected ' + url);
};
env = mkEnv({ AZURE_SPEECH_KEY: 'AK', YEMOT_TOKEN: '0771:pw' });
r = await call(env, { ApiCallId: 'abc-1' });
assert.match(r, /^read=t-אמרו את שם העסק=s1,no,record,\/6,rabc1_1,no,yes,no$/); console.log('3a', r);
r = await call(env, { ApiCallId: 'abc-1', s1: '/6/rabc1_1.wav' });
assert.match(r, /=k1_0,/); assert.match(r, /בנק לאומי לישראל/); console.log('3b', r, calls);
const n = calls.length;
r = await call(env, { ApiCallId: 'abc-1', s1: '/6/rabc1_1.wav', k1_0: '1' });
assert.match(r, /נבחר בנק לאומי/); assert.equal(calls.length, n, 'התמלול נשלף מהמטמון ולא חוזר ל-Azure'); console.log('3c', r);
// דיבור לא מזוהה -> שואלים שוב
heard = '';
r = await call(env, { ApiCallId: 'abc-2', s1: '/6/rabc2_1.wav' });
assert.match(r, /לא הצלחתי להבין אמרו שוב את שם העסק=s2,no,record,\/6,rabc2_2/); console.log('3d', r);
globalThis.fetch = realFetch;
console.log('OK');
