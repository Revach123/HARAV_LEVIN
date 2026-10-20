// סימולציה של שיחות ימות מול /api/ivr-menu ו-/api/ivr-join (בלי D1 ובלי ימות).
// הרצה: node --no-warnings scripts/voice_search/simulate_join.mjs
import assert from 'node:assert/strict';
import { onRequest as menu } from '../../functions/api/ivr-menu.js';
import { onRequest as join } from '../../functions/api/ivr-join.js';
import { onRequestGet as audio } from '../../functions/api/joiner-audio.js';
import { importKeyForWrite, decryptPii } from '../../functions/api/_shared/joiners-crypto.js';

const inserted = [];
const states = new Map();
const DB = { prepare: (sql) => ({
  run: async () => ({}),                                                   // CREATE TABLE
  bind: (...a) => ({
    first: async () => (sql.includes('FROM joiners WHERE id = ?') ? (inserted.find((r) => r.rid === a[0]) ? { id: a[0], pii: inserted.find((r) => r.rid === a[0]).pii } : null)
      : sql.includes('FROM joiners') ? inserted.find((r) => r.ih === a[0]) || null
      : sql.includes('ivr_join_state') ? (states.has(a[0]) ? { data: states.get(a[0]) } : null) : null),
    run: async () => {
      if (sql.startsWith('INSERT INTO joiners')) inserted.push({ rid: a[0], ih: a[2], pii: a[3] });
      else if (sql.startsWith('INSERT OR REPLACE INTO ivr_join_state')) states.set(a[0], a[1]);
      else if (sql.startsWith('DELETE FROM ivr_join_state WHERE call_id')) states.delete(a[0]);
      return {};
    },
  }),
}) };
const env = { IVR_SECRET: 'S', IVR_SECRET_NEW: 'N', IVR_AUDIO_OFF: '1', JOINERS_KEY: Buffer.alloc(32, 7).toString('base64'), DB };

// ניקוד מוסר מהפלט כדי שההשוואות יישארו קריאות
const plain = (x) => x.replace(/[ְ-ׇ]/g, '');
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

// ---- הצטרפות: כל שדות הטופס באתר ----
// כל תשובה נוספת מתווספת למשתנים (כמו שימות עושה); ApiPhone = מספר המתקשר.
const base = { ApiPhone: '0501234567' };
const step = async (vars, re) => { const r = await run(join, vars); assert.match(r, re, r); return r; };
const KEY = (k) => new RegExp(`=${k},`);
let c = { ...base };
await step(c, /^read=t-הקישו את מספר תעודת הזהות.*=id,no,10,5,/);
await step({ ...c, id: '123' }, /^read=t-מספר תעודת הזהות אינו תקין\.t-הקישו.*=id,no,10,5,/);   // לא תקין: שואלים שוב, בלי הגבלה
await step({ ...c, id: 'NONE' }, /^read=t-הקישו את מספר תעודת הזהות.*=id,/);                      // שתיקה: שואלים שוב
c.id = '123456782';
await step(c, /^read=t-לאחר הצליל אמרו את שמכם הפרטי=fn,no,record,\/1,jc1_fn,no,yes,no,1,8$/);
await step({ ...c, fn: 'NONE' }, KEY('fn'));
c.fn = '/1/jc1_fn.wav';
await step(c, /^read=t-לאחר הצליל אמרו את שם המשפחה=ln,no,record,\/1,jc1_ln,/);
c.ln = '/1/jc1_ln.wav';
await step(c, /^read=t-לשימוש במספר הטלפון.*=pc,no,1,1,7,No,no,no,,1\.2,/);
c.pc = '1';
await step(c, /^read=t-להוספת מספר טלפון נוסף.*=p2q,/);
c.p2q = '2';
await step(c, /=ad,no,record,\/1,jc1_ad,no,yes,no,1,15$/);
c.ad = '/1/jc1_ad.wav';
await step(c, /=emq,/);
c.emq = '2';
await step(c, /=fxq,/);
c.fxq = '2';
await step(c, /=ch,no,1,1,7,No,no,no,,1\.2,/);
await step({ ...c, ch: 'NONE' }, /=ch,no,1,1,/);
c.ch = '1';
await step(c, /=rd,no,1,1,/);
await step({ ...c, rd: 'NONE' }, /=rd,no,1,1,/);
const r1 = await step({ ...c, rd: '1' }, /=ag,no,1,1,7,No,no,no,,1\.2\.3,/);
assert.equal(r1.split('=')[1].split('.').length, 14 + 1);                  // 14 פסקאות + הצהרה
c.rd = '2';
await step(c, /=ag,no,1,1,/);
await step({ ...c, ag: 'NONE' }, /=ag,no,1,1,/);                          // לא נענה: שואלים שוב
const r2 = await step({ ...c, ag: '2' }, /=ag,no,1,1,7,No,no,no,,1\.2\.3,/);  // שמיעה חוזרת
assert.equal(r2.split('=')[1].split('.').length, 14 + 1);
const r3 = await run(join, { ...c, ag: 'NONE' });                          assert.equal(r3.split('=')[1].split('.').length, 1);   // שתיקה: רק ההצהרה
await step({ ...c, ag: '3' }, /^id_list_message=t-הבקשה בוטלה&go_to_folder=\/&$/);
assert.equal(inserted.length, 0);
await step({ ...c, ag: '1' }, /^id_list_message=t-הבקשה התקבלה תודה רבה&go_to_folder=\/&$/);
assert.equal(inserted.length, 1);
assert.equal(states.size, 0);                                              // המצב השמור נמחק בסיום
const key = await importKeyForWrite(env);
const p = await decryptPii(key, inserted[0].rid, inserted[0].pii);
assert.equal(p.id, '123456782'); assert.equal(p.phone, '0501234567'); assert.equal(p.all, 'כן'); assert.equal(p.src, 'ivr');
const ex = JSON.parse(p.extra);
assert.equal(ex['הקלטת שם פרטי'], '/1/jc1_fn'); assert.equal(ex['הקלטת שם משפחה'], '/1/jc1_ln'); assert.equal(ex['הקלטת כתובת'], '/1/jc1_ad');
await run(join, { ...c, ag: '1' });                                        assert.equal(inserted.length, 1);  // כפילות תוך 3 דקות לא נרשמת

// ---- הצטרפות: כל האפשרויות (טלפון אחר, טלפון נוסף, אימייל, פקס, חברות מסוימות), בלי מספר מתקשר ----
const d = { ApiCallId: 'c2', ApiPhone: 'unknown', bk: '/', id: '039337423', fn: '/1/jc2_fn.wav', ln: '/1/jc2_ln.wav' };
await step(d, /=ph,no,11,9,/);                                             // אין מספר מתקשר: מקישים טלפון
await step({ ...d, ph: '12' }, /^read=t-מספר הטלפון אינו תקין\..*=ph,/);
d.ph = '052-7654321';
await step(d, /=p2q,/);
d.p2q = '1';
await step(d, /=p2,no,11,9,/);
d.p2 = '03-5551234';
await step(d, /=ad,no,record,/);
d.ad = '/1/jc2_ad.wav';
await step(d, /=emq,/);
d.emq = '1';
await step(d, /=em,no,record,\/1,jc2_em,no,yes,no,1,15$/);
d.em = '/1/jc2_em.wav';
await step(d, /=fxq,/);
d.fxq = '1';
await step(d, /=fx,no,11,9,/);
d.fx = '0355 51235'.replace(/\D/g, '');
await step(d, /=ch,/);
d.ch = '2';
await step(d, /=cl,no,record,\/1,jc2_cl,no,yes,no,1,30$/);
await step({ ...d, cl: 'NONE' }, /=cl,no,record,/);
d.cl = '/1/jc2_cl.wav'; d.rd = '2';
await step({ ...d, ag: '1' }, /הבקשה התקבלה/);
const p2 = await decryptPii(key, inserted[1].rid, inserted[1].pii);
assert.equal(p2.phone, '0527654321'); assert.equal(p2.all, '');
const ex2 = JSON.parse(p2.extra);
assert.equal(ex2['טלפון נוסף'], '035551234'); assert.equal(ex2['פקס'], '035551235'); assert.equal(ex2['הקלטת אימייל'], '/1/jc2_em'); assert.equal(ex2['הקלטת חברות'], '/1/jc2_cl');

// ---- זיהוי הקלטות ב-Azure (fetch מדומה): שם, כתובת, אימייל וחברות נכנסים כטקסט לרישום ----
const SAID = { fn: 'משה', ln: 'כהן', ad: 'רחוב הרצל 5 בני ברק', em: 'moshe שטרודל gmail נקודה com', cl: 'בנק לאומי, מנורה' };
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts = {}) => {
  url = String(url);
  if (url.includes('DownloadFile')) {
    const path = new URL(url).searchParams.get('path');
    const tag = Object.keys(SAID).find((k) => path.includes(`_${k}`));
    const bytes = new Uint8Array(60); bytes.set([0x52, 0x49, 0x46, 0x46]); bytes.set(new TextEncoder().encode(tag || '?'), 44);
    return new Response(bytes, { status: 200 });
  }
  if (url.includes('FileAction')) throw new Error('הקלטה לא אמורה להימחק');
  if (url.includes('stt.speech.microsoft.com')) {
    const tag = new TextDecoder().decode(new Uint8Array(await new Response(opts.body).arrayBuffer()).slice(44, 46));
    return new Response(JSON.stringify({ RecognitionStatus: 'Success', DisplayText: SAID[tag] + '.' }), { status: 200 });
  }
  return realFetch(url, opts);
};
env.AZURE_SPEECH_KEY = 'k'; env.YEMOT_TOKEN = '1:2';
const t = { ApiCallId: 'c5', ApiPhone: '0501234567', id: '111111118', fn: '/1/jc5_fn.wav', ln: '/1/jc5_ln.wav', pc: '1', p2q: '2', ad: '/1/jc5_ad.wav', emq: '1', em: '/1/jc5_em.wav', fxq: '2', ch: '2', cl: '/1/jc5_cl.wav', rd: '2' };
await step({ ...t, ag: '1' }, /הבקשה התקבלה/);
const p3 = await decryptPii(key, inserted[2].rid, inserted[2].pii);
assert.equal(p3.first, 'משה'); assert.equal(p3.last, 'כהן'); assert.equal(p3.email, 'moshe@gmail.com'); assert.equal(p3.companies, 'בנק לאומי, מנורה');
const ex3 = JSON.parse(p3.extra);
assert.equal(ex3['כתובת'], 'רחוב הרצל 5 בני ברק'); assert.equal(ex3['הקלטת שם פרטי'], '/1/jc5_fn');   // ההקלטה נשמרת לצד הטקסט
assert.ok(ex3['זיהוי אוטומטי מהקלטות']);
// ---- השמעת הקלטה במסך המנהל (joiner-audio): מנהל בלבד, הנתיב מהרשומה ולא מהבקשה ----
const aenv = { ...env, ADMIN_PASSWORD: 'pw' };
const aurl = (id, k) => new URL(`https://x/api/joiner-audio?id=${id}&k=${encodeURIComponent(k)}`);
const areq = (u, auth = 'Bearer pw') => audio({ request: new Request(u, { headers: auth ? { Authorization: auth } : {} }), env: aenv });
let ra = await areq(aurl(inserted[2].rid, 'הקלטת שם פרטי'));
assert.equal(ra.status, 200); assert.equal(ra.headers.get('content-type'), 'audio/wav'); assert.equal((await ra.arrayBuffer()).byteLength, 60);
assert.equal((await areq(aurl(inserted[2].rid, 'הקלטת שם פרטי'), '')).status, 401);                      // בלי הרשאה
assert.equal((await areq(aurl(inserted[2].rid, 'כתובת'))).status, 400);                                 // רק שדות הקלטת ...
assert.equal((await areq(aurl(inserted[2].rid, 'הקלטת מזהה'))).status, 404);                            // אין הקלטה בשדה
assert.equal((await areq(aurl('wnotthere0000', 'הקלטת שם פרטי'))).status, 404);

globalThis.fetch = realFetch;
delete env.AZURE_SPEECH_KEY; delete env.YEMOT_TOKEN;

// ---- ימות מפעילה את השלוחה מחדש באמצע השיחה (בלי משתנים): ממשיכים מאותה נקודה, לא מההתחלה ----
const rs = { ApiCallId: 'c9', ApiPhone: '0501234567', id: '123456782', fn: '/1/jc9_fn.wav', ln: '/1/jc9_ln.wav', pc: '1', p2q: '2', ad: '/1/jc9_ad.wav', emq: '2', fxq: '2', ch: '1' };
await step(rs, /=rd,/);                                                    // נשמר
await step({ ApiCallId: 'c9', ApiPhone: '0501234567' }, /=rd,/);           // התחלה מחדש: ממשיכים מ-rd ולא שואלים ת.ז.
await step({ ...rs, rd: '1' }, /=ag,/);                                    // השטר הושמע (pl נשמר)
const rs2 = await run(join, { ApiCallId: 'c9', ApiPhone: '0501234567' });  // התחלה מחדש אחרי ההקראה: רק ההצהרה, לא השטר שוב
assert.match(rs2, /=ag,/); assert.equal(rs2.split('=')[1].split('.').length, 1);

// ---- הרשאה ----
assert.match(await run(join, { sk: 'bad' }), /שגיאת הרשאה/);
console.log('ok');
