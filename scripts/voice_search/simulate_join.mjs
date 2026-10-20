// סימולציה של שיחות ימות מול /api/ivr-menu ו-/api/ivr-join (בלי D1 ובלי ימות).
// הרצה: node --no-warnings scripts/voice_search/simulate_join.mjs
import assert from 'node:assert/strict';
import { onRequest as menu } from '../../functions/api/ivr-menu.js';
import { onRequest as join } from '../../functions/api/ivr-join.js';
import { pickEmail, spokenEmail } from '../../functions/api/_shared/spoken-email.js';
import { onRequestGet as audio, toPcmWav } from '../../functions/api/joiner-audio.js';
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
await step(d, /=em0,no,record,\/1,jc2_em0,no,yes,no,1,15$/);
d.em0 = '/1/jc2_em0.wav';
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
assert.equal(ex2['טלפון נוסף'], '035551234'); assert.equal(ex2['פקס'], '035551235'); assert.equal(ex2['הקלטת אימייל'], '/1/jc2_em0'); assert.equal(ex2['הקלטת חברות'], '/1/jc2_cl');

// ---- זיהוי הקלטות ב-Azure (fetch מדומה): שם, כתובת, אימייל וחברות נכנסים כטקסט לרישום ----
const SAID = { fn: 'משה', ln: 'כהן', ad: 'רחוב הרצל 5 בני ברק', cl: 'בנק לאומי, מנורה', em0: 'בלה בלה', em1: { 'he-IL': 'שגיאה', 'en-US': 'M O S H E at gmail dot com', 'en-GB': 'em oh' } };
const mails = [];
const langsSeen = new Set();
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts = {}) => {
  url = String(url);
  if (url.includes('DownloadFile')) {
    const tag = new URL(url).searchParams.get('path').replace(/\.wav$/, '').split('_').pop();
    const bytes = new Uint8Array(60); bytes.set([0x52, 0x49, 0x46, 0x46]); bytes[44] = tag.length; bytes.set(new TextEncoder().encode(tag), 45);
    return new Response(bytes, { status: 200 });
  }
  if (url.includes('FileAction')) throw new Error('הקלטה לא אמורה להימחק');
  if (url.includes('stt.speech.microsoft.com')) {
    const b = new Uint8Array(await new Response(opts.body).arrayBuffer());
    const tag = new TextDecoder().decode(b.slice(45, 45 + b[44]));
    const said = typeof SAID[tag] === 'object' ? SAID[tag][new URL(url).searchParams.get('language')] : SAID[tag];   // לפי שפת הזיהוי
    langsSeen.add(new URL(url).searchParams.get('language'));
    return new Response(JSON.stringify(said ? { RecognitionStatus: 'Success', DisplayText: said + '.' } : { RecognitionStatus: 'NoMatch' }), { status: 200 });
  }
  if (url.includes('send-confirmation')) { mails.push(JSON.parse(opts.body)); return new Response('{}', { status: 200 }); }
  return realFetch(url, opts);
};
env.AZURE_SPEECH_KEY = 'k'; env.YEMOT_TOKEN = '1:2'; env.WP_MAIL_URL = 'https://wp/send-confirmation'; env.WP_MAIL_SECRET = 's';
const t = { ApiCallId: 'c5', ApiPhone: '0501234567', id: '111111118', fn: '/1/jc5_fn.wav', ln: '/1/jc5_ln.wav', pc: '1', p2q: '2', ad: '/1/jc5_ad.wav', emq: '1', fxq: '2', ch: '2', cl: '/1/jc5_cl.wav', rd: '2' };
await step(t, /=em0,no,record,\/1,jc5_em0,/);
// מייל לא תקין: "מייל לא תקין" ושואלים שוב (הקלטה חדשה em1)
await step({ ...t, em0: '/1/jc5_em0.wav' }, /^read=t-מייל לא תקין\.t-לאחר הצליל אמרו את כתבת האימייל.*=em1,no,record,\/1,jc5_em1,/);
// "גימייל" מוכר כ-gmail, ו-".com" מתווסף אוטומטית
await step({ ...t, em0: '/1/jc5_em0.wav', em1: '/1/jc5_em1.wav' }, /=ch|=rd|=ag|^id_list/);
await step({ ...t, em0: '/1/jc5_em0.wav', em1: '/1/jc5_em1.wav', ag: '1' }, /^id_list_message=t-הבקשה התקבלה\.t-נשלח אישור למייל\.t-תודה רבה&go_to_folder=\/&$/);
const p3 = await decryptPii(key, inserted[2].rid, inserted[2].pii);
assert.equal(p3.first, 'משה'); assert.equal(p3.last, 'כהן'); assert.equal(p3.email, 'moshe@gmail.com'); assert.equal(p3.companies, 'בנק לאומי, מנורה');
const ex3 = JSON.parse(p3.extra);
assert.equal(ex3['כתובת'], 'רחוב הרצל 5 בני ברק'); assert.equal(ex3['הקלטת שם פרטי'], '/1/jc5_fn'); assert.equal(ex3['הקלטת אימייל'], '/1/jc5_em1');
assert.ok(ex3['זיהוי אוטומטי מהקלטות']);
assert.deepEqual([...langsSeen].sort(), ['en-GB', 'en-US', 'he-IL']);                                  // כל הזיהויים נבדקו
assert.equal(mails.length, 1); assert.equal(mails[0].to, 'moshe@gmail.com'); assert.match(mails[0].text, /משה כהן/);   // מייל האישור נשלח לכתובת שאומתה

// שני ניסיונות כושלים: מתווספת אפשרות להמשיך בלי אימייל; הרישום נשמר בלי אימייל ובלי "נשלח אישור"
SAID.em1 = 'עוד פעם לא נכון';   // כל השפות: לא תקין
const f = { ...t, ApiCallId: 'c6', id: '200000008', fn: '/1/jc6_fn.wav', ln: '/1/jc6_ln.wav', ad: '/1/jc6_ad.wav', cl: '/1/jc6_cl.wav', em0: '/1/jc6_em0.wav', em1: '/1/jc6_em1.wav' };
{ const { em1, ...f0 } = f; await step(f0, /^read=t-מייל לא תקין\.t-לאחר הצליל.*=em1,no,record/); }              // כישלון ראשון: שואלים שוב
await step(f, /^read=t-מייל לא תקין\.t-להקלטה נוספת.*הקישו 1.*בלי מייל הקישו 2=ems2,no,1,1,7,No,no,no,,1\.2,/);
await step({ ...f, ems2: 'NONE' }, /^read=t-להקלטה נוספת.*=ems2,/);                                           // שתיקה: שואלים שוב
await step({ ...f, ems2: '1' }, /=em2,no,record,\/1,jc6_em2,/);                                           // עוד הקלטה
await step({ ...f, ems2: '1', em2: '/1/jc6_em2.wav' }, /^read=t-מייל לא תקין\.t-להקלטה נוספת.*=ems3,/);        // כישלון שלישי: שוב האפשרות להמשיך בלי
await step({ ...f, ems2: '1', em2: '/1/jc6_em2.wav', ems3: '2' }, /=ch|=rd|=ag/);                                                           // המשך בלי אימייל
const mailsBefore = mails.length;
await step({ ...f, ems2: '1', em2: '/1/jc6_em2.wav', ems3: '2', ag: '1' }, /^id_list_message=t-הבקשה התקבלה תודה רבה&go_to_folder=\/&$/);
const p4 = await decryptPii(key, inserted[3].rid, inserted[3].pid ?? inserted[3].pii);
assert.equal(p4.email, ''); assert.equal(mails.length, mailsBefore);
assert.equal(JSON.parse(p4.extra)['הקלטת אימייל'], undefined);

// בדיקת הפענוח של אימייל מדובר
for (const [said, want] of [['moshe שטרודל גימייל', 'moshe@gmail.com'], ['moshe שטרודל ג׳ימייל נקודה קום', 'moshe@gmail.com'], ['moshe@gmail', 'moshe@gmail.com'], ['moshe at gmail dot com', 'moshe@gmail.com'],
  ['dov שטרודל הוטמייל דוט קום', 'dov@hotmail.com'], ['a.b שטרודל walla.co.il', 'a.b@walla.co.il'], ['בלה בלה', ''], ['moshe', ''], ['', ''],
  // אות אחר אות: אנגלית אמריקאית / בריטית / עברית במבטא ישראלי
  ['M O S H E at gmail dot com', 'moshe@gmail.com'], ['em oh ess aitch ee at gee mail dot com', 'moshe@gmail.com'], ['em oh ess aitch ee at gmail dot com', 'moshe@gmail.com'],
  ["אם או אס אייץ' אי שטרודל ג'י מייל נקודה קום", 'moshe@gmail.com'], ["אם או אס אייץ' אי שטרודל גימייל קום", 'moshe@gmail.com'],
  ['dee ay en two zero at hotmail dot com', 'dan20@hotmail.com'], ['די איי אן שתיים אפס שטרודל הוטמייל קום', 'dan20@hotmail.com'],
  // זיהוי עברי שהדביק אותיות למילה אחת: "איי זד זד" -> "איזה זד" = AZZ; אי (E) בודד נשאר E
  ['איזה זד שטרודל גימייל נקודה קום', 'azz@gmail.com'], ['איזה זד', ''], ['אי זד שטרודל גימייל', 'ez@gmail.com'], ['בי סי די שטרודל גימייל', 'bcd@gmail.com'], ['בלה בלה שטרודל גימייל', ''],
  ['jay dot kay underscore double you at yahoo', 'j.k_w@yahoo.com'], ['אקס וואי זד שטרודל outlook נקודה קום', 'xyz@outlook.com']]) assert.equal(spokenEmail(said), want, said);
assert.equal(pickEmail(['שגיאה', 'M O S H E at example dot co dot il', 'em oh ess aitch ee at gmail dot com']), 'moshe@gmail.com');   // עדיפות לספק מוכר
assert.equal(pickEmail(['', '']), '');

// ---- המרת µ-law / A-law ל-PCM (דפדפנים לא מנגנים wav טלפוני) ----
const lawWav = (fmt, bytes) => { const u = new Uint8Array(44 + bytes.length), v = new DataView(u.buffer); u.set([0x52, 0x49, 0x46, 0x46]); v.setUint32(4, 36 + bytes.length, true); u.set([0x57, 0x41, 0x56, 0x45, 0x66, 0x6d, 0x74, 0x20], 8); v.setUint32(16, 16, true); v.setUint16(20, fmt, true); v.setUint16(22, 1, true); v.setUint32(24, 8000, true); v.setUint32(28, 8000, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true); u.set([0x64, 0x61, 0x74, 0x61], 36); v.setUint32(40, bytes.length, true); u.set(bytes, 44); return u; };
const mu = toPcmWav(lawWav(7, [0xff, 0x00, 0x80, 0x7f])), mv = new DataView(mu.buffer);
assert.equal(mv.getUint16(20, true), 1); assert.equal(mv.getUint16(34, true), 16); assert.equal(mu.length, 44 + 8);
assert.deepEqual([0, 1, 2, 3].map((i) => mv.getInt16(44 + i * 2, true)), [0, -32124, 32124, 0]);       // µ-law: 0xff = +0, 0x00 = -32124, 0x80 = +32124, 0x7f = -0
const al = toPcmWav(lawWav(6, [0xd5, 0x55])); assert.equal(new DataView(al.buffer).getInt16(44, true), 8); assert.equal(new DataView(al.buffer).getInt16(46, true), -8);   // A-law: 0xd5 = +8, 0x55 = -8
const pcm = lawWav(1, [1, 2, 3, 4]); assert.equal(toPcmWav(pcm), pcm);                                 // PCM רגיל לא משתנה

// ---- השמעת הקלטה במסך המנהל (joiner-audio): מנהל בלבד, הנתיב מהרשומה ולא מהבקשה ----
const aenv = { ...env, ADMIN_PASSWORD: 'pw' };
const aurl = (id, k) => new URL(`https://x/api/joiner-audio?id=${id}&k=${encodeURIComponent(k)}`);
const areq = (u, auth = 'Bearer pw') => audio({ request: new Request(u, { headers: auth ? { Authorization: auth } : {} }), env: aenv });
const K = 'הקלטת שם פרטי';
const sg = await areq(new URL(`https://x/api/joiner-audio?sign=1&id=${inserted[2].rid}&k=${encodeURIComponent(K)}`));
assert.equal(sg.status, 200); const { url } = await sg.json(); assert.match(url, /exp=\d+&sig=[0-9a-f]{64}$/);
const play = (u, headers = {}) => audio({ request: new Request(new URL(u, 'https://x'), { headers }), env: aenv });     // בלי הרשאת מנהל: רק החתימה
let ra = await play(url);
assert.equal(ra.status, 200); assert.equal(ra.headers.get('content-type'), 'audio/wav'); assert.equal(ra.headers.get('accept-ranges'), 'bytes'); assert.equal((await ra.arrayBuffer()).byteLength, 60);
ra = await play(url, { Range: 'bytes=10-19' }); assert.equal(ra.status, 206); assert.equal(ra.headers.get('content-range'), 'bytes 10-19/60'); assert.equal((await ra.arrayBuffer()).byteLength, 10);
assert.equal((await play(url, { Range: 'bytes=0-' })).status, 206);
assert.equal((await play(url.replace(/sig=[0-9a-f]/, 'sig=0'))).status, 401);                              // חתימה שגויה
assert.equal((await play(url.replace(/exp=\d+/, 'exp=1000000000'))).status, 401);                          // פג תוקף
assert.equal((await play(url.replace(/k=[^&]+/, 'k=' + encodeURIComponent('הקלטת כתובת')))).status, 401);   // חתימה של הקלטה אחרת
assert.equal((await areq(aurl(inserted[2].rid, K), '')).status, 401);                                      // בלי הרשאה ובלי חתימה
assert.equal((await areq(new URL(`https://x/api/joiner-audio?sign=1&id=${inserted[2].rid}&k=${encodeURIComponent(K)}`), '')).status, 401);   // גם בקשת חתימה דורשת מנהל
assert.equal((await areq(aurl(inserted[2].rid, 'כתובת'))).status, 400);                                    // רק שדות הקלטת ...
assert.equal((await areq(aurl(inserted[2].rid, 'הקלטת מזהה'))).status, 404);                               // אין הקלטה בשדה
assert.equal((await areq(aurl('wnotthere0000', K))).status, 404);

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
