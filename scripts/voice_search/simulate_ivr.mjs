// סימולציה של שיחת ימות מול /api/ivr-company עם נתוני העסקים האמיתיים (בלי D1 ובלי ימות).
// הרצה: node scripts/voice_search/simulate_ivr.mjs
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { onRequest } from '../../functions/api/ivr-company.js';

const csv = readFileSync(new URL('../../reports/heteriske_audit/heteriske_businesses_with_chp.csv', import.meta.url), 'utf8').replace(/^﻿/, '');
const rows = [];
for (const l of csv.split('\n').slice(1)) {
  const m = l.match(/^(\d+),[^,]*,("(?:[^"]|"")*"|[^,]*),[^,]*,[^,]*,[^,]*,(\d*)/);
  if (m) rows.push({ id: m[1], registrar_name: m[2].replace(/^"|"$/g, '').replace(/""/g, '"'), permit_name: '', chp_number: m[3] });
}
// ---- DB: טבלת businesses (DB) - עם visibility; ושיקוף של company-info-db (DB1) עם FTS5 אמיתי ----
rows.forEach((r, i) => { r.visibility = i % 3 === 0 ? 'פרטי' : ''; r.entity_type = 'company'; });
const sttRows = new Map();
const stmt = (sql) => ({
  all: async () => ({ results: rows }),
  run: async () => ({}),
  bind: (...a) => ({
    first: async () => (sql.startsWith('SELECT text') ? (sttRows.has(a.join(':')) ? { text: sttRows.get(a.join(':')) } : null) : null),
    run: async () => { if (sql.startsWith('INSERT')) sttRows.set(`${a[0]}:${a[1]}`, a[2]); return {}; },
  }),
});

const sqlite = new DatabaseSync(':memory:');
sqlite.exec(`
  CREATE TABLE companies (id TEXT, name TEXT, name_norm TEXT, status TEXT, corp_type TEXT);
  CREATE TABLE partnerships (id TEXT, name TEXT, name_norm TEXT, status TEXT, ptype TEXT);
  CREATE TABLE associations (id TEXT, name TEXT, name_norm TEXT, status TEXT, category TEXT);
  CREATE VIRTUAL TABLE companies_fts USING fts5(id UNINDEXED, name_norm, tokenize='trigram');
  CREATE VIRTUAL TABLE partnerships_fts USING fts5(id UNINDEXED, name_norm, tokenize='trigram');
  CREATE VIRTUAL TABLE associations_fts USING fts5(id UNINDEXED, name_norm, tokenize='trigram');
`);
const norm = (n) => n.replace(/\([^)]*\)/g, ' ').replace(/[^א-ת0-9A-Za-z ]/g, ' ').replace(/\s+/g, ' ').trim();
const add = (tbl, id, name, status, sub) => {
  const col = tbl === 'companies' ? 'corp_type' : tbl === 'partnerships' ? 'ptype' : 'category';
  sqlite.prepare(`INSERT INTO ${tbl} (id,name,name_norm,status,${col}) VALUES (?,?,?,?,?)`).run(id, name, norm(name), status, sub);
  sqlite.prepare(`INSERT INTO ${tbl}_fts (id,name_norm) VALUES (?,?)`).run(id, norm(name));
};
for (const r of rows) if (r.chp_number) add('companies', r.chp_number, r.registrar_name, 'פעילה', 'פרטית');
add('companies', '511111111', 'אבגד תעשיות בע"מ', 'פעילה', 'ציבורית');             // בלי היתר עסקה
add('companies', '512222222', 'אבגד לוגיסטיקה בע"מ', 'פעילה', 'פרטית');
add('companies', '513333333', 'אבגד ישן בע"מ', 'מחוקה', 'פרטית');
add('partnerships', '551111111', 'קרן הדר שותפות מוגבלת', 'פעילה', 'שותפות מוגבלת');
add('associations', '581111111', 'עמותת חסד ואמת (ע"ר)', 'פעילה', 'חינוך');
for (let i = 0; i < 40; i++) add('companies', String(520000000 + i), `מנורה בטחון ${i} בע"מ`, 'פעילה', 'פרטית');   // הרבה תוצאות
const D1 = (db) => ({
  prepare: (sql) => ({
    bind: (...a) => ({
      sql, a,
      all: async () => ({ results: db.prepare(sql).all(...a).map((r) => ({ ...r })) }),
    }),
  }),
  batch: async (stmts) => Promise.all(stmts.map((x) => x.all())),
});
const DB1 = D1(sqlite);
const mkEnv = (extra = {}) => ({ IVR_SECRET: 'S', DB: { prepare: stmt }, DB1, ...extra });

async function call(env, vars) {
  const u = new URL('https://x/api/ivr-company');
  u.searchParams.set('sk', 'S');
  u.searchParams.set('ApiCallId', vars.ApiCallId || 't1');
  for (const [k, v] of Object.entries(vars)) if (k !== 'ApiCallId') u.searchParams.set(k, v);
  return (await onRequest({ request: new Request(u), env })).text();
}
const parts = (r) => r.replace(/^read=/, '').split('=')[0].split('.');
const permitOf = (n) => rows.findIndex((x) => x.chp_number === n);

// 1. ללא זיהוי דיבור: ח.פ. בלבד, בלי תפריט
let env = mkEnv();
let r = await call(env, {});
assert.match(r, /^read=t-הקישו את מספר הח פ.*=h1,no,9,5,/); console.log('1a', r);
// בנק לאומי (520018078): נמצא ברישום, ויש לו היתר (פרטי/כללי לפי visibility)
const bl = rows.find((x) => x.chp_number === '520018078');
r = await call(env, { h1: '520018078' });
console.log('1b', parts(r));
assert.equal(parts(r)[0], 't-חברה פרטית'); assert.equal(parts(r)[1], 't-בנק לאומי לישראל בית עין מם');
assert.equal(parts(r)[2], bl.visibility === 'פרטי' ? 't-לעסק זה יש רק היתר עסקה פרטי' : 't-קיים היתר עסקה כללי');
assert.match(r, /=nx1,no,1,1,7,No,no,no,,1\.2,/);
// עסק עם visibility = 'פרטי': רק היתר פרטי
const prv = rows.find((x) => x.visibility === 'פרטי' && x.chp_number && x.chp_number !== '520018078');
r = await call(env, { h1: prv.chp_number });
assert.equal(parts(r)[2], 't-לעסק זה יש רק היתר עסקה פרטי');
assert.equal(parts(r)[3], 't-היתר העסקה תקף רק למי שחתם על היתר עסקה פרטי');
assert.equal(parts(r).length, 5); console.log('1b2', parts(r));
// חברה שאין לה היתר עסקה (רק ברישום)
r = await call(env, { h1: '511111111' });
console.log('1c', parts(r)); assert.deepEqual(parts(r).slice(0, 3), ['t-חברה ציבורית', 't-אבגד תעשיות בית עין מם', 't-לא קיים היתר עסקה']);
r = await call(env, { h1: '551111111' }); assert.equal(parts(r)[0], 't-שותפות מוגבלת'); assert.equal(parts(r)[1], 't-קרן הדר');
r = await call(env, { h1: '581111111' }); assert.equal(parts(r)[0], 't-עמותה'); assert.equal(parts(r)[1], 't-עמותת חסד ואמת');
assert.match(await call(env, { h1: '999999999' }), /^read=t-לא נמצאה חברה במספר הזה לחיפוש נוסף הקישו 1 לסיום הקישו 2=nx1/);
// nx: 1 -> סבב חדש, 2 -> סיום
assert.match(await call(env, { h1: '511111111', nx1: '1' }), /=h2,no,9,5,/);
assert.match(await call(env, { h1: '511111111', nx1: '2' }), /^id_list_message=t-תודה ולהתראות&go_to_folder=\/5&$/);
assert.equal(await call(env, { hangup: 'yes' }), '');
assert.match(await (async () => { const u = new URL('https://x/api/ivr-company?sk=bad'); return (await onRequest({ request: new Request(u), env })).text(); })(), /הרשאה/);

// 2. דיבור (ימות מחזירה טקסט): תפריט, ושם לפי דיבור - בכל החברות
env = mkEnv({ IVR_VOICE_READ_OPTS: 'no,voice' });
r = await call(env, {});
assert.match(r, /^read=t-מומלץ לחפש לפי ח פ.*הקישו 1.*הקישו 2 לחיפוש לפי שם החברה=m1,no,1,1,7,No,no,no,,1\.2,/); console.log('2a OK');
assert.match(await call(env, { m1: '1' }), /=h1,no,9,5,/);
// ח.פ. לא קיים -> לפי שם
r = await call(env, { m1: '1', h1: '111111111' });
assert.match(r, /^read=t-לא נמצאה חברה במספר הזה אמרו את שם החברה=s1_1,no,voice$/); console.log('2b', r);
r = await call(env, { m1: '2' });
assert.match(r, /^read=t-אמרו את שם החברה=s1_1,no,voice$/);
// חברה בלי היתר: "אבגד לוגיסטיקה" (נמצאת רק ברישום)
r = await call(env, { m1: '2', s1_1: 'אבגד לוגיסטיקה' });
console.log('2c', parts(r)); assert.deepEqual(parts(r).slice(0, 3), ['t-חברה פרטית', 't-אבגד לוגיסטיקה בית עין מם', 't-לא קיים היתר עסקה']);
// "אבגד" לבד: 3 תוצאות, כל אחת בשלוש הודעות נפרדות, המחוקה אחרונה ומסומנת
r = await call(env, { m1: '2', s1_1: 'אבגד' });
const p = parts(r); console.log('2d', p);
assert.equal(p.length, 3 * 3 + 1);
assert.ok(p.every((x) => !x.includes('בערבון')));
assert.equal(p[p.length - 4], 't-חברה פרטית מחוקה'); assert.equal(p[p.length - 3], 't-אבגד ישן בית עין מם');
assert.equal(p[p.length - 1], 't-לחיפוש נוסף הקישו 1 לסיום הקישו 2');
// שגיאות זיהוי: ק<->כ, ח/כ, תחילית ה
for (const q of ['הבנק לאומי', 'במק לאומי']) {
  r = await call(env, { m1: '2', s1_1: q });
  console.log('2e', q, parts(r)[1]);
}
assert.equal(parts(await call(env, { m1: '2', s1_1: 'הבנק לאומי' }))[1], 't-בנק לאומי לישראל בית עין מם');
assert.equal(parts(await call(env, { m1: '2', s1_1: 'חסד ואמת' }))[1], 't-עמותת חסד ואמת');
// הרבה תוצאות -> לא מקריאים; 1 = שם מלא יותר, 2 = ח.פ.
r = await call(env, { m1: '2', s1_1: 'מנורה בטחון' });
assert.match(r, /^read=t-הרבה מדי אפשרויות אנא אמרו את השם המלא או חפשו לפי מספר ח פ לאמירת השם המלא הקישו 1 לחיפוש לפי ח פ הקישו 2=t1_1,no,1,1,7,No,no,no,,1\.2,/); console.log('2f', r);
assert.match(await call(env, { m1: '2', s1_1: 'מנורה בטחון', t1_1: '1' }), /^read=t-אמרו שוב את שם החברה=s1_2,no,voice$/);
assert.match(await call(env, { m1: '2', s1_1: 'מנורה בטחון', t1_1: '2' }), /=h1,no,9,5,/);
// שם מלא יותר אחרי ההפניה: תוצאה יחידה
r = await call(env, { m1: '2', s1_1: 'מנורה בטחון', t1_1: '1', s1_2: 'מנורה בטחון 7' });
assert.equal(parts(r)[1], 't-מנורה בטחון 7 בית עין מם');
// לא נמצא -> שואלים שוב; אחרי 3 כשלונות -> ח.פ.
r = await call(env, { m1: '2', s1_1: 'זזזזזזז' });
assert.match(r, /^read=t-לא נמצאה חברה בשם הזה אמרו שוב את שם החברה=s1_2,no,voice$/);
r = await call(env, { m1: '2', s1_1: 'זזזזזזז', s1_2: 'NONE', s1_3: 'צצצצצצ' });
assert.match(r, /=h1,no,9,5,/); console.log('2g', r);
assert.match(await call(env, { m1: '2', s1_1: 'זזזזזזז', s1_2: 'NONE', s1_3: 'צצצצצצ', h1: '111111111' }), /^read=t-לא נמצאה חברה מתאימה לחיפוש נוסף.*=nx1/);
assert.match(await call(env, { m1: '2', s1_1: '/6/rec001.wav' }), /לא הוגדר נכון/);
// חיפוש נוסף: סבב 2 מתחיל מהתפריט
assert.match(await call(env, { m1: '2', s1_1: 'אבגד לוגיסטיקה', nx1: '1' }), /=m2,no,1,1,/);

// 3. בלי DB1: נופלים חזרה לעסקים עם היתר, בלי לקרוס
const noReg = mkEnv({ IVR_VOICE_READ_OPTS: 'no,voice', DB1: undefined });
r = await call(noReg, { m1: '2', s1_1: 'בנק לאומי' });
assert.equal(parts(r)[1], 't-בנק לאומי לישראל בית עין מם'); console.log('3 OK');

// 4. הקלטה + זיהוי חיצוני (Yemot DownloadFile + Azure), עם fetch מדומה
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
assert.match(await call(env, { ApiCallId: 'abc-1' }), /=m1,no,1,1,/);
// הגבלת זמן להקלטה: מינימום 1, מקסימום 8 שניות
r = await call(env, { ApiCallId: 'abc-1', m1: '2' });
assert.match(r, /^read=t-אמרו את שם החברה=s1_1,no,record,\/6,rabc1_1_1,no,yes,no,1,8$/); console.log('4a', r);
// ניתן לשינוי / ביטול
assert.match(await call(mkEnv({ AZURE_SPEECH_KEY: 'AK', YEMOT_TOKEN: 'x:y', IVR_REC_MAX_SEC: '5' }), { ApiCallId: 'abc-1', m1: '2' }), /,no,1,5$/);
assert.match(await call(mkEnv({ AZURE_SPEECH_KEY: 'AK', YEMOT_TOKEN: 'x:y', IVR_REC_MAX_SEC: '0' }), { ApiCallId: 'abc-1', m1: '2' }), /,no,yes,no$/);
r = await call(env, { ApiCallId: 'abc-1', m1: '2', s1_1: '/6/rabc1_1_1.wav' });
assert.equal(parts(r)[1], 't-בנק לאומי לישראל בית עין מם'); console.log('4b', parts(r), calls);
const n = calls.length;
r = await call(env, { ApiCallId: 'abc-1', m1: '2', s1_1: '/6/rabc1_1_1.wav', nx1: '2' });
assert.match(r, /תודה ולהתראות/); assert.equal(calls.length, n);
heard = '';
r = await call(env, { ApiCallId: 'abc-2', m1: '2', s1_1: '/6/rabc2_1_1.wav' });
assert.match(r, /לא הצלחתי להבין אמרו שוב את שם החברה=s1_2,no,record,\/6,rabc2_1_2/); console.log('4c', r);
globalThis.fetch = realFetch;
console.log('OK');
