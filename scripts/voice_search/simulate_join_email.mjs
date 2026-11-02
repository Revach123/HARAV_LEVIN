// סימולציה של הצטרפות במייל (functions/api/join-email.js), בלי CloudMailin, בלי וורדפרס ובלי D1.
// הרצה: node --no-warnings scripts/voice_search/simulate_join_email.mjs
import assert from 'node:assert/strict';
import { onRequestPost, parseForm, checkForm, addressOf } from '../../functions/api/join-email.js';
import { importKeyForWrite, decryptPii } from '../../functions/api/_shared/joiners-crypto.js';

// ---- קריאת הטופס ----
assert.equal(addressOf('Moshe Cohen <Moshe@Example.com>'), 'moshe@example.com');
let f = parseForm('שם פרטי: משה\nשם משפחה: כהן\n\n> שם פרטי: \n> טלפון: \n> טלפון נוסף: 0521111111\nטלפון: 050-1234567');
assert.deepEqual(f, { first: 'משה', last: 'כהן', phone2: '0521111111', phone: '050-1234567' });
assert.equal(checkForm({ companies: 'כל החברות' }).v.all, true);
assert.equal(checkForm({ companies: 'כל' }).v.all, true);
assert.deepEqual(checkForm({ companies: 'חברה א, חברה ב' }).v.companies, ['חברה א', 'חברה ב']);

// ---- סביבה ----
const sent = [], inserted = [], log = new Map();
globalThis.fetch = async (url, init) => { sent.push({ url, ...JSON.parse(init.body) }); return new Response('{"ok":true}'); };
const env = {
  JOIN_EMAIL_SECRET: 'S3cret', JOIN_EMAIL_REPLY_TO: 'abc@cloudmailin.net', WP_MAIL_URL: 'https://wp/x', WP_MAIL_SECRET: 'w',
  JOINERS_KEY: Buffer.alloc(32, 7).toString('base64'),
  DB: { prepare: (sql) => ({ run: async () => ({}), bind: (...a) => ({
    first: async () => (sql.includes('FROM join_email_log') ? (log.has(a[0] + a[1]) ? { n: log.get(a[0] + a[1]) } : null)
      : sql.includes('FROM joiners') ? null : null),
    run: async () => {
      if (sql.startsWith('INSERT INTO join_email_log')) log.set(a[0] + a[1], (log.get(a[0] + a[1]) || 0) + 1);
      if (sql.startsWith('INSERT INTO joiners')) inserted.push({ rid: a[0], pii: a[4] });
      return {};
    } }) }) },
};
const post = async (msg, auth = 'Bearer S3cret') => {
  const r = await onRequestPost({ request: new Request('https://site/api/join-email', { method: 'POST', headers: { authorization: auth, 'content-type': 'application/json' }, body: JSON.stringify(msg) }), env });
  return { status: r.status, text: await r.text() };
};
const mail = (from, subject, plain) => ({ headers: { from, subject, message_id: '<m1@x>' }, envelope: { from }, plain });

// הרשאה
assert.equal((await post(mail('a@b.co', 'הצטרפות', ''), 'Bearer wrong')).status, 403);
assert.equal((await post(mail('a@b.co', 'הצטרפות', ''), 'Basic ' + btoa('cloudmailin:S3cret'))).text, 'form sent');

// 1. בקשה ראשונה -> טופס, עם Reply-To
sent.length = 0;
let r = await post(mail('משה <moshe@example.com>', 'הצטרפות', 'שלום, אבקש להצטרף'));
assert.equal(r.text, 'form sent');
assert.equal(sent.length, 1); assert.equal(sent[0].to, 'moshe@example.com'); assert.equal(sent[0].reply_to, 'abc@cloudmailin.net');
assert.match(sent[0].text, /שם פרטי: \n/); assert.match(sent[0].text, /אישור השטר: /); assert.match(sent[0].text, /הריני מצהיר/);

// 2. טופס חלקי (בתוך הציטוט) -> תשובה עם מה שחסר
sent.length = 0;
const quoted = (lines) => 'הנה\n\n' + sent.length + lines.map((l) => '> ' + l).join('\n');
r = await post(mail('moshe@example.com', 'Re: הצטרפות להיתר עיסקא פרטי - טופס למילוי',
  '> שם פרטי: משה\n> שם משפחה: כהן\n> תעודת זהות: 123456789\n> טלפון: 0501234567\n> עיר: בני ברק\n> רחוב: \n> בחירת חברות: \n> אישור השטר: '));
assert.equal(r.text, 'missing');
assert.match(sent[0].text, /תעודת זהות \(המספר אינו תקין\)/); assert.match(sent[0].text, /- רחוב/); assert.match(sent[0].text, /אישור השטר \(יש לכתוב "מאשר"\)/);
assert.match(sent[0].text, /שם פרטי: משה/);              // מה שמולא נשאר בטופס

// 3. טופס מלא -> נשמר + מייל אישור
sent.length = 0;
r = await post(mail('moshe@example.com', 'Re: הצטרפות',
  'שם פרטי: משה\nשם משפחה: כהן\nתעודת זהות: 123456782\nטלפון: 0501234567\nטלפון נוסף:\nעיר: בני ברק\nרחוב: רבי עקיבא\nמספר בית: 12\nפקס:\nבחירת חברות: כל החברות\nאישור השטר: מאשר\n\n> שם פרטי:\n> שם משפחה:'));
assert.equal(r.text, 'saved');
assert.equal(inserted.length, 1);
const p = await decryptPii(await importKeyForWrite(env), inserted[0].rid, inserted[0].pii);
assert.equal(p.first, 'משה'); assert.equal(p.email, 'moshe@example.com'); assert.equal(p.src, 'email'); assert.equal(p.all, 'כן');
const ex = JSON.parse(p.extra);
assert.equal(ex['כתובת'], 'רבי עקיבא 12, בני ברק'); assert.equal(ex['ערוץ'], 'מייל'); assert.match(ex['אושרו התנאים'], /מאשר/);
assert.equal(sent.length, 1); assert.equal(sent[0].to, 'moshe@example.com'); assert.match(sent[0].subject, /אישור הצטרפות/);

// 4. מייל אחר (למשל אימות העברה מ-Gmail) -> מועבר למכון
sent.length = 0;
r = await post(mail('forwarding-noreply@google.com', 'Gmail Forwarding Confirmation', 'Confirmation code: 123456'));
assert.equal(r.text, 'forwarded'); assert.equal(sent[0].to, 'sl5742214@gmail.com'); assert.match(sent[0].text, /123456/);

// 5. מיילים אוטומטיים לא מקבלים תשובה; הגבלת כמות לשולח
assert.equal((await post(mail('mailer-daemon@x.com', 'הצטרפות', ''))).text, 'ignored');
for (let i = 0; i < 6; i++) await post(mail('spam@x.com', 'הצטרפות', ''));
assert.equal((await post(mail('spam@x.com', 'הצטרפות', ''))).text, 'limited');

console.log('simulate_join_email: ok');
