// סימולציה של שליחת שטר היתר העסקה בפקס מהקו הטלפוני (/api/ivr-company + _shared/ivr-fax.js), בלי ימות, בלי D1 ובלי ספק הפקס.
// הרצה: node scripts/voice_search/simulate_fax.mjs
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { onRequest } from '../../functions/api/ivr-company.js';
import { unit } from '../../functions/api/_shared/ivr_phrases.js';
const T = (k) => unit(k, {});          // הטקסט שמוקרא (עם ניקוד), כמו שהקו שולח

// ---- D1 מדומה על SQLite ----
const db = new DatabaseSync(':memory:');
db.exec(`
  CREATE TABLE businesses (id INTEGER PRIMARY KEY, chp_number TEXT, entity_type TEXT, registrar_name TEXT, permit_name TEXT, visibility TEXT);
  CREATE TABLE permit_docs (id TEXT PRIMARY KEY, file_key TEXT, original_name TEXT, doc_type TEXT);
  CREATE TABLE permit_doc_companies (doc_id TEXT, business_id INTEGER, slot TEXT);
  INSERT INTO businesses VALUES (1,'510000001','company','כללית בע"מ','','');            -- היתר כללי, שטר כללי
  INSERT INTO businesses VALUES (2,'510000002','company','שתיים בע"מ','','פרטי');        -- כללי + פרטי, שני שטרות
  INSERT INTO businesses VALUES (3,'510000003','company','בלי שטר בע"מ','','');          -- היתר בלי שטר מקושר
  INSERT INTO permit_docs VALUES ('d1','docs/d1.pdf','shtar1.pdf','general'),('d2g','docs/d2g.pdf','g.pdf','general'),('d2p','docs/d2p.pdf','p.pdf','private'),('dx','docs/dx.pdf','x.pdf','other');
  INSERT INTO permit_doc_companies VALUES ('d1',1,'general'),('d2g',2,'general'),('d2p',2,'private'),('dx',3,'general');
`);
const st = (sql, a = []) => ({
  all: async () => ({ results: db.prepare(sql).all(...a).map((r) => ({ ...r })) }),
  first: async () => { const r = db.prepare(sql).get(...a); return r ? { ...r } : null; },
  run: async () => { const r = db.prepare(sql).run(...a); return { meta: { last_row_id: Number(r.lastInsertRowid) } }; },
});
const DB = { prepare: (sql) => ({ ...st(sql), bind: (...a) => st(sql, a) }), batch: async (x) => Promise.all(x.map((s) => s.run())) };
const PERMITS = { get: async (k) => (k.startsWith('docs/') ? { arrayBuffer: async () => new TextEncoder().encode('%PDF-' + k).buffer } : null) };

// ---- ספק הפקס מדומה ----
const sentFaxes = [];
globalThis.fetch = async (url, opt) => {
  const fd = opt.body;
  sentFaxes.push({ url: String(url), key: fd.get('api_key'), fax: fd.get('recipient_fax'), file: await fd.get('pdf_file').text() });
  return new Response('{"status":"success"}', { status: 200 });
};

const baseEnv = { IVR_SECRET: 'S', IVR_AUDIO_OFF: '1', DB, PERMITS, FAX_API_KEY: 'KEY123' };
let call = 0;
async function step(vars, env = baseEnv) {
  const pending = [];
  const body = new URLSearchParams({ sk: 'S', ApiCallId: 'c' + call, ApiPhone: '0501234567', ...vars });
  const res = await onRequest({ request: new Request('https://x/api/ivr-company', { method: 'POST', body }), env, waitUntil: (p) => pending.push(p) });
  await Promise.all(pending);
  return res.text();
}
const asks = (out, v) => assert.ok(out.includes(`=${v},`), `expected question ${v}, got: ${out.slice(0, 300)}`);

// 1) חברה עם שטר כללי: אפשרות 3, מספר פקס, אישור, שליחה
call = 1;
let o = await step({ h1: '510000001' });
assert.ok(o.includes(T('fax:offer')) && o.includes(',1.2.3,'), 'fax option offered');
o = await step({ h1: '510000001', nx1: '3' }); asks(o, 'fx1_1');
o = await step({ h1: '510000001', nx1: '3', fx1_1: '12' }); asks(o, 'fx1_2'); assert.ok(o.includes(T('fax:bad')));
o = await step({ h1: '510000001', nx1: '3', fx1_1: '12', fx1_2: '031234567' }); asks(o, 'fy1_2'); assert.ok(o.includes('d-031234567'));
o = await step({ h1: '510000001', nx1: '3', fx1_1: '12', fx1_2: '031234567', fy1_2: '1' }); asks(o, 'ns1'); assert.ok(o.includes(T('fax:sent')));
assert.equal(sentFaxes.length, 1); assert.deepEqual([sentFaxes[0].key, sentFaxes[0].fax, sentFaxes[0].file], ['KEY123', '031234567', '%PDF-docs/d1.pdf']);
// ימות שולחת שוב את אותם משתנים (למשל עם התשובה הבאה): לא שולחים פעם שנייה
o = await step({ h1: '510000001', nx1: '3', fx1_1: '12', fx1_2: '031234567', fy1_2: '1' });
assert.equal(sentFaxes.length, 1, 'no duplicate send');
o = await step({ h1: '510000001', nx1: '3', fx1_1: '12', fx1_2: '031234567', fy1_2: '1', ns1: '2' }); assert.ok(o.includes('go_to_folder'), 'bye');
console.log('1 OK: general permit sent once');

// 2) כללי + פרטי: בחירת שטר; שינוי מספר לפני אישור
call = 2;
o = await step({ h1: '510000002' }); asks(o, 'nx1');
o = await step({ h1: '510000002', nx1: '3' }); asks(o, 'fd1');
o = await step({ h1: '510000002', nx1: '3', fd1: '2' }); asks(o, 'fx1_1');
o = await step({ h1: '510000002', nx1: '3', fd1: '2', fx1_1: '029999999', fy1_1: '2' }); asks(o, 'fx1_2');
o = await step({ h1: '510000002', nx1: '3', fd1: '2', fx1_1: '029999999', fy1_1: '2', fx1_2: '0721234567', fy1_2: '1' }); asks(o, 'ns1');
assert.equal(sentFaxes.at(-1).file, '%PDF-docs/d2p.pdf'); assert.equal(sentFaxes.at(-1).fax, '0721234567');
console.log('2 OK: private permit chosen, number changed before sending');

// 3) חברה בלי שטר מקושר (רק מסמך "אחר"): אין אפשרות 3
call = 3;
o = await step({ h1: '510000003' });
assert.ok(!o.includes(T('fax:offer')) && o.includes(',1.2,'), 'no fax option without a linked document');
console.log('3 OK: no fax option without a public document');

// 4) בלי FAX_API_KEY: הקו כמו קודם
call = 4;
o = await step({ h1: '510000001' }, { ...baseEnv, FAX_API_KEY: '' });
assert.ok(!o.includes(T('fax:offer')), 'no fax option without key');
console.log('4 OK: no key -> no fax option');

// 5) מגבלה: עד 3 פקסים לשיחה (סבבים 1-4 באותה שיחה)
call = 5; const before = sentFaxes.length;
const r = (n, extra) => ({ [`h${n}`]: '510000001', [`nx${n}`]: '3', [`fx${n}_1`]: '031111111', [`fy${n}_1`]: '1', ...extra });
let vars = {};
for (let n = 1; n <= 4; n++) {
  if (n > 1) vars[`ns${n - 1}`] = '1';
  vars[`h${n}`] = '510000001'; await step(vars);          // הקראת התוצאות (שומרת את מצב הסבב)
  vars = { ...vars, ...r(n) };
  o = await step(vars);
}
assert.equal(sentFaxes.length - before, 3, '3 per call'); assert.ok(o.includes(T('fax:limit')), 'limit message');
console.log('5 OK: limited to 3 faxes per call');
console.log('log:', db.prepare('SELECT call_id, slot, fax, chp, kind, doc_id, status FROM ivr_fax_log').all().map((x) => Object.values(x).join(' ')));
console.log('ALL OK');
