// סימולציה של שיחות ימות מול /api/ivr-menu ו-/api/ivr-join (בלי D1 ובלי ימות).
// הרצה: node --no-warnings scripts/voice_search/simulate_join.mjs
import assert from 'node:assert/strict';
import { onRequest as menu } from '../../functions/api/ivr-menu.js';
import { onRequest as join } from '../../functions/api/ivr-join.js';
import { importKeyForWrite, decryptPii } from '../../functions/api/_shared/joiners-crypto.js';

const inserted = [];
const DB = { prepare: (sql) => ({ bind: (...a) => ({
  first: async () => (sql.startsWith('SELECT') ? inserted.find((r) => r.ih === a[0]) || null : null),
  run: async () => { if (sql.startsWith('INSERT')) inserted.push({ rid: a[0], ih: a[2], pii: a[3] }); return {}; },
}) }) };
const env = { IVR_SECRET: 'S', IVR_SECRET_NEW: 'N', IVR_AUDIO_OFF: '1', JOINERS_KEY: Buffer.alloc(32, 7).toString('base64'), DB };

// ניקוד מוסר מהפלט כדי שההשוואות יישארו קריאות
const plain = (x) => x.replace(/[\u05b0-\u05c7]/g, '');
const run = async (fn, vars) => {
  const u = new URL('https://x/api/x');
  for (const [k, v] of Object.entries({ sk: 'N', ApiCallId: 'c1', ...vars })) u.searchParams.set(k, v);
  return plain(await (await fn({ request: new Request(u), env })).text());
};

// ---- תפריט ראשי ----
assert.match(await run(menu, {}), /^read=t-שלום וברכה.*=mm,no,1,1,7,No,no,no,,1\.2,,Ok,NONE,$/);
assert.equal(await run(menu, { mm: '1' }), 'go_to_folder=/1&');
assert.equal(await run(menu, { mm: '2' }), 'go_to_folder=/2&');
assert.equal(await run(menu, { mm: '2', join: '/5', search: '/8' }), 'go_to_folder=/8&');
assert.match(await run(menu, { mm: '9' }), /^read=.*=mm2,/);
assert.match(await run(menu, { mm: '9', mm2: '0', mm3: 'NONE' }), /^id_list_message=t-תודה ולהתראות&hangup=yes&$/);
assert.match(await run(menu, { sk: 'bad' }), /שגיאת הרשאה/);
assert.match(await run(menu, { sk: 'S' }), /^read=/);                 // גם הסוד הישן תקף
assert.equal(await run(menu, { hangup: 'yes' }), '');

// ---- הצטרפות: מסלול מלא (כל החברות) ----
const base = { ApiPhone: '0501234567' };
let r = await run(join, base);                                         assert.match(r, /=id1,no,9,5,/);
r = await run(join, { ...base, id1: '123' });                          assert.match(r, /=id2,no,9,5,/);   // לא תקין -> ניסיון נוסף
r = await run(join, { ...base, id1: '123', id2: '123456782' });        assert.match(r, /^read=.*=nm1,no,record,\/1,jc1_nm1,no,yes,no,1,8$/);
r = await run(join, { ...base, id1: '123', id2: '123456782', nm1: '/1/jc1_nm1.wav' });  assert.match(r, /=ch,no,1,1,7,No,no,no,,1\.2,/);
const full = { ...base, id1: '123', id2: '123456782', nm1: '/1/jc1_nm1.wav', ch: '1' };
r = await run(join, full);                                             assert.match(r, /=rd,no,1,1,/);
r = await run(join, { ...full, rd: '1' });                             assert.equal(r.split('=')[1].split('.').length, 14 + 1);   // 14 פסקאות + הצהרה
r = await run(join, { ...full, rd: '2' });                             assert.match(r, /=ag,no,1,1,/);
full.rd = '2';
r = await run(join, { ...full, ag: '2' });                             assert.match(r, /^id_list_message=t-הבקשה בוטלה&go_to_folder=\/&$/);
assert.equal(inserted.length, 0);
r = await run(join, { ...full, ag: '1' });                             assert.match(r, /^id_list_message=t-הבקשה התקבלה תודה רבה&go_to_folder=\/&$/);
assert.equal(inserted.length, 1);
const key = await importKeyForWrite(env);
const p = await decryptPii(key, inserted[0].rid, inserted[0].pii);
assert.equal(p.id, '123456782'); assert.equal(p.phone, '0501234567'); assert.equal(p.all, 'כן'); assert.equal(p.src, 'ivr');
assert.equal(JSON.parse(p.extra)['הקלטת שם'], '/1/jc1_nm1');
await run(join, { ...full, ag: '1' });                                 assert.equal(inserted.length, 1);  // כפילות תוך 3 דקות לא נרשמת

// ---- הצטרפות: חברות מסוימות, בלי מספר מתקשר, בלי חזרה לשורש ----
const v2 = { ApiCallId: 'c2', ApiPhone: 'unknown', bk: '/' };
r = await run(join, { ...v2, id1: '039337423' });                      assert.match(r, /=ph1,no,10,9,/);
const v3 = { ...v2, id1: '039337423', ph1: '052-7654321', nm1: 'NONE' };
r = await run(join, v3);                                               assert.match(r, /=nm2,no,record/);
const v4 = { ...v3, nm2: '/1/jc2_nm2.wav', ch: '2' };
r = await run(join, v4);                                               assert.match(r, /=cl1,no,record,\/1,jc2_cl1,no,yes,no,1,30$/);
r = await run(join, { ...v4, cl1: '/1/jc2_cl1.wav', rd: '2', ag: '1' });        assert.match(r, /הבקשה התקבלה/);
const p2 = await decryptPii(key, inserted[1].rid, inserted[1].pii);
assert.equal(p2.phone, '0527654321'); assert.equal(p2.all, ''); assert.equal(JSON.parse(p2.extra)['הקלטת חברות'], '/1/jc2_cl1');

// ---- כשלונות ----
r = await run(join, { ApiCallId: 'c3', id1: '1', id2: '2', id3: '3' });
assert.match(r, /^id_list_message=t-מספר תעודת הזהות אינו תקין&go_to_folder=\/&$/);
assert.match(await run(join, { sk: 'bad' }), /שגיאת הרשאה/);
console.log('ok');
