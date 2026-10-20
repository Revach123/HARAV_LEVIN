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
// שתיקה / ערך אחר: שואלים שוב ושוב, בלי הגבלה ובלי ניתוק
for (const mm of ['9', 'NONE', '0']) assert.match(await run(menu, { mm }), /^read=.*=mm,no,1,1,7,/);
assert.match(await run(menu, { sk: 'bad' }), /שגיאת הרשאה/);
assert.match(await run(menu, { sk: 'S' }), /^read=/);                 // גם הסוד הישן תקף
assert.equal(await run(menu, { hangup: 'yes' }), '');

// ---- הצטרפות: מסלול מלא (כל החברות) ----
const base = { ApiPhone: '0501234567' };
let r = await run(join, base);                                         assert.match(r, /^read=t-הקישו את מספר תעודת הזהות.*=id,no,10,5,/);
r = await run(join, { ...base, id: '123' });                           assert.match(r, /^read=t-מספר תעודת הזהות אינו תקין\.t-הקישו.*=id,no,10,5,/);   // לא תקין: שואלים שוב, בלי הגבלה
r = await run(join, { ...base, id: 'NONE' });                          assert.match(r, /^read=t-הקישו את מספר תעודת הזהות.*=id,/);                    // שתיקה: שואלים שוב
r = await run(join, { ...base, id: '123456782' });                     assert.match(r, /^read=.*=nm,no,record,\/1,jc1_nm,no,yes,no,1,8$/);
r = await run(join, { ...base, id: '123456782', nm: 'NONE' });         assert.match(r, /=nm,no,record,/);                                              // לא הוקלט: שואלים שוב
r = await run(join, { ...base, id: '123456782', nm: '/1/jc1_nm.wav' });  assert.match(r, /=ch,no,1,1,7,No,no,no,,1\.2,/);
r = await run(join, { ...base, id: '123456782', nm: '/1/jc1_nm.wav', ch: 'NONE' });  assert.match(r, /=ch,no,1,1,/);
const full = { ...base, id: '123456782', nm: '/1/jc1_nm.wav', ch: '1' };
r = await run(join, full);                                             assert.match(r, /=rd,no,1,1,/);
r = await run(join, { ...full, rd: 'NONE' });                          assert.match(r, /=rd,no,1,1,/);
r = await run(join, { ...full, rd: '1' });                             assert.equal(r.split('=')[1].split('.').length, 14 + 1);   // 14 פסקאות + הצהרה
assert.match(r, /=ag,no,1,1,/);
r = await run(join, { ...full, rd: '2' });                             assert.match(r, /=ag,no,1,1,/);
r = await run(join, { ...full, rd: '2', ag: 'NONE' });                 assert.match(r, /=ag,no,1,1,/);                                                 // לא נענה: שואלים שוב
full.rd = '2';
r = await run(join, { ...full, ag: '2' });                             assert.match(r, /^id_list_message=t-הבקשה בוטלה&go_to_folder=\/&$/);
assert.equal(inserted.length, 0);
r = await run(join, { ...full, ag: '1' });                             assert.match(r, /^id_list_message=t-הבקשה התקבלה תודה רבה&go_to_folder=\/&$/);
assert.equal(inserted.length, 1);
const key = await importKeyForWrite(env);
const p = await decryptPii(key, inserted[0].rid, inserted[0].pii);
assert.equal(p.id, '123456782'); assert.equal(p.phone, '0501234567'); assert.equal(p.all, 'כן'); assert.equal(p.src, 'ivr');
assert.equal(JSON.parse(p.extra)['הקלטת שם'], '/1/jc1_nm');
await run(join, { ...full, ag: '1' });                                 assert.equal(inserted.length, 1);  // כפילות תוך 3 דקות לא נרשמת

// ---- הצטרפות: חברות מסוימות, בלי מספר מתקשר ----
const v2 = { ApiCallId: 'c2', ApiPhone: 'unknown', bk: '/' };
r = await run(join, { ...v2, id: '039337423' });                       assert.match(r, /=ph,no,11,9,/);
r = await run(join, { ...v2, id: '039337423', ph: '12' });             assert.match(r, /^read=t-מספר הטלפון אינו תקין\..*=ph,/);
const v3 = { ...v2, id: '039337423', ph: '052-7654321', nm: '/1/jc2_nm.wav', ch: '2' };
r = await run(join, v3);                                               assert.match(r, /=cl,no,record,\/1,jc2_cl,no,yes,no,1,30$/);
r = await run(join, { ...v3, cl: 'NONE' });                            assert.match(r, /=cl,no,record,/);
r = await run(join, { ...v3, cl: '/1/jc2_cl.wav', rd: '2', ag: '1' }); assert.match(r, /הבקשה התקבלה/);
const p2 = await decryptPii(key, inserted[1].rid, inserted[1].pii);
assert.equal(p2.phone, '0527654321'); assert.equal(p2.all, ''); assert.equal(JSON.parse(p2.extra)['הקלטת חברות'], '/1/jc2_cl');

// ---- הרשאה ----
assert.match(await run(join, { sk: 'bad' }), /שגיאת הרשאה/);
console.log('ok');
