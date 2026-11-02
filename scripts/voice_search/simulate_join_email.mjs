// סימולציה של הצטרפות במייל (functions/api/join-email.js), בלי CloudMailin, בלי וורדפרס ובלי D1.
// הרצה: node --no-warnings scripts/voice_search/simulate_join_email.mjs
import assert from 'node:assert/strict';
import { onRequestPost, parseForm, pickCompanies, addressOf } from '../../functions/api/join-email.js';
import { importKeyForWrite, decryptPii } from '../../functions/api/_shared/joiners-crypto.js';

// ---- קריאת הטופס ----
assert.equal(addressOf('Moshe Cohen <Moshe@Example.com>'), 'moshe@example.com');
let f = parseForm('שם פרטי: משה\nשם משפחה: כהן\n\n> שם פרטי: \n> טלפון (למשל 0501234567): \n> טלפון נוסף (לא חובה): 0521111111\nטלפון: 050-1234567\nקוד רשימה (לא לשנות): 1234567');
assert.deepEqual(f, { first: 'משה', last: 'כהן', phone2: '0521111111', phone: '050-1234567', list: '1234567' });
const NAMES = ['אלפא בע"מ', 'בטא השקעות', 'גמא נדל"ן', 'גמא תעשיות'];
assert.deepEqual(pickCompanies('כל החברות', NAMES), { all: true, companies: [], bad: [] });
assert.deepEqual(pickCompanies('1, 3', NAMES).companies, ['אלפא בע"מ', 'גמא נדל"ן']);
assert.deepEqual(pickCompanies('2 4', NAMES).companies, ['בטא השקעות', 'גמא תעשיות']);
assert.deepEqual(pickCompanies('בטא, 9', NAMES), { all: false, companies: ['בטא השקעות'], bad: ['מספר 9 אינו ברשימה'] });
assert.match(pickCompanies('גמא', NAMES).bad[0], /מתאים לכמה חברות/);

// ---- סביבה ----
let rows = NAMES.map((n) => ({ permit_name: n }));
const sent = [], inserted = [], log = new Map(), lists = new Map();
globalThis.fetch = async (url, init) => { sent.push({ url, ...JSON.parse(init.body) }); return new Response('{"ok":true}'); };
const env = {
  JOIN_EMAIL_SECRET: 'S3cret', JOIN_EMAIL_REPLY_TO: 'join@example.org', WP_MAIL_URL: 'https://wp/x', WP_MAIL_SECRET: 'w',
  JOINERS_KEY: Buffer.alloc(32, 7).toString('base64'),
  ASSETS: { fetch: async () => new Response('[]') },
  DB: { prepare: (sql) => ({
    run: async () => ({}), all: async () => ({ results: sql.includes('FROM businesses') ? rows : [] }), first: async () => null,
    bind: (...a) => ({
      first: async () => (sql.includes('FROM join_email_log') ? (log.has(a[0] + a[1]) ? { n: log.get(a[0] + a[1]) } : null)
        : sql.includes('FROM join_email_lists') ? (lists.has(a[0]) ? { names: lists.get(a[0]) } : null) : null),
      run: async () => {
        if (sql.startsWith('INSERT INTO join_email_log')) log.set(a[0] + a[1], (log.get(a[0] + a[1]) || 0) + 1);
        if (sql.startsWith('INSERT OR IGNORE INTO join_email_lists') && !lists.has(a[0])) lists.set(a[0], a[1]);
        if (sql.startsWith('INSERT INTO joiners')) inserted.push({ rid: a[0], pii: a[4] });
        return {};
      } }) }) },
};
const post = async (msg, auth = 'Bearer S3cret') => {
  const r = await onRequestPost({ request: new Request('https://site/api/join-email', { method: 'POST', headers: { authorization: auth, 'content-type': 'application/json' }, body: JSON.stringify(msg) }), env });
  return { status: r.status, text: await r.text() };
};
const mail = (from, subject, plain) => ({ headers: { from, subject, message_id: '<m1@x>' }, envelope: { from }, plain });
const decrypt = async (i = -1) => { const r = inserted.at(i); return decryptPii(await importKeyForWrite(env), r.rid, r.pii); };

// הרשאה
assert.equal((await post(mail('a@b.co', 'הצטרפות', ''), 'Bearer wrong')).status, 403);
assert.equal((await post(mail('a@b.co', 'הצטרפות', ''), 'Basic ' + btoa('cloudmailin:S3cret'))).text, 'form sent');

// 1. בקשה ראשונה -> מייל אחד: טופס עם הנחיות, כפתור מילוי, רשימה ממוספרת, שטר
sent.length = 0;
let r = await post(mail('משה <moshe@example.com>', 'הצטרפות', 'שלום, אבקש להצטרף'));
assert.equal(r.text, 'form sent');
assert.equal(sent.length, 1); assert.equal(sent[0].to, 'moshe@example.com'); assert.equal(sent[0].reply_to, 'join@example.org');
const form = sent[0].text;
assert.match(form, /תעודת זהות \(9 ספרות\): \n/); assert.match(form, /חברות \(כל החברות, או מספרים/); assert.match(form, /אישור השטר \(כתבו: מאשר\): /);
assert.match(form, /3\. גמא נדל"ן/); assert.match(form, /הריני מצהיר/);
const code = form.match(/קוד רשימה \(לא לשנות\): (\d{7})/)[1];
assert.match(sent[0].html, /href="mailto:join@example\.org\?subject=/);

// 2. הרשימה השתנתה (נוספה חברה בהתחלה); תשובה עם מספרים לפי הרשימה הישנה (לפי הקוד) ובלי "מאשר" -> תיקון,
//    והמספרים מתורגמים לרשימה החדשה
rows = [{ permit_name: 'אאא ראשונה' }, ...rows];
sent.length = 0;
const reply = (vals) => Object.entries(vals).map(([k, v]) => `${k}: ${v}`).join('\n') + '\n\n' + form.split('\n').map((l) => '> ' + l).join('\n');
r = await post(mail('moshe@example.com', 'Re: הצטרפות להיתר עיסקא פרטי - טופס למילוי',
  reply({ 'שם פרטי': 'משה', 'שם משפחה': 'כהן', 'תעודת זהות': '123456789', 'טלפון': '0501234567', 'עיר': 'בני ברק', 'רחוב': 'רבי עקיבא', 'חברות': '1, 3' })));
assert.equal(r.text, 'missing');
assert.match(sent[0].text, /תעודת זהות - המספר אינו תקין/); assert.match(sent[0].text, /אישור השטר - יש לכתוב "מאשר"/);
assert.match(sent[0].text, /^שם פרטי: משה$/m);
assert.match(sent[0].text, /^חברות \([^)]*\): 2, 4$/m);           // אלפא=2, גמא נדל"ן=4 ברשימה החדשה
const code2 = sent[0].text.match(/קוד רשימה \(לא לשנות\): (\d{7})/)[1];
assert.notEqual(code2, code);

// 3. טופס מלא (בתוך הציטוט, כמו עריכה של המייל) -> נשמר + אישור
sent.length = 0;
const filledForm = sent.length + FIELDS_FILL(code2);
function FIELDS_FILL(c) {
  return ['שם פרטי: משה', 'שם משפחה: כהן', 'תעודת זהות (9 ספרות): 123456782', 'טלפון (למשל 0501234567): 0501234567', 'טלפון נוסף (לא חובה):',
    'עיר: בני ברק', 'רחוב: רבי עקיבא', 'מספר בית (לא חובה): 12א', 'פקס (לא חובה):', 'חברות (כל החברות, או מספרים מהרשימה שלמטה מופרדים בפסיק): 2, 4',
    'אישור השטר (כתבו: מאשר): מאשר', `קוד רשימה (לא לשנות): ${c}`].map((l) => '> ' + l).join('\n');
}
r = await post(mail('moshe@example.com', 'Re: הצטרפות', 'מצורף\n\n' + filledForm.slice(1)));
assert.equal(r.text, 'saved');
let p = await decrypt();
assert.equal(p.first, 'משה'); assert.equal(p.email, 'moshe@example.com'); assert.equal(p.src, 'email'); assert.equal(p.all, '');
assert.equal(p.companies, 'אלפא בע"מ, גמא נדל"ן');
const ex = JSON.parse(p.extra);
assert.equal(ex['כתובת'], 'רבי עקיבא 12א, בני ברק'); assert.equal(ex['ערוץ'], 'מייל');
assert.equal(sent.length, 1); assert.match(sent[0].subject, /אישור הצטרפות/);

// 4. כל החברות, דרך כפתור המילוי (מייל חדש, כותרת "הצטרפות - טופס ממולא")
r = await post(mail('dan@example.com', 'הצטרפות - טופס ממולא',
  'שם פרטי: דן\nשם משפחה: לוי\nתעודת זהות (9 ספרות): 000000018\nטלפון: 0521234567\nעיר: ירושלים\nרחוב: יפו\nחברות: כל החברות\nאישור השטר: מאשר'));
assert.equal(r.text, 'saved');
p = await decrypt(); assert.equal(p.all, 'כן');

// 5. מייל אחר (למשל אימות העברה מ-Gmail) -> מועבר למכון
sent.length = 0;
r = await post(mail('forwarding-noreply@google.com', 'Gmail Forwarding Confirmation', 'Confirmation code: 123456'));
assert.equal(r.text, 'forwarded'); assert.equal(sent[0].to, 'sl5742214@gmail.com'); assert.match(sent[0].text, /123456/);

// 6. מיילים אוטומטיים לא מקבלים תשובה; הגבלת כמות לשולח
assert.equal((await post(mail('mailer-daemon@x.com', 'הצטרפות', ''))).text, 'ignored');
for (let i = 0; i < 6; i++) await post(mail('spam@x.com', 'הצטרפות', ''));
assert.equal((await post(mail('spam@x.com', 'הצטרפות', ''))).text, 'limited');

// 7. נשלח לכתובת ה-Gmail (שמעבירה ל-CloudMailin): התשובות והכפתור לכתובת הזו
sent.length = 0;
r = await post({ headers: { from: 'avi@example.com', to: 'Iska Join <IskaJoin@gmail.com>', subject: 'הצטרפות' }, plain: '' });
assert.equal(r.text, 'form sent'); assert.equal(sent[0].reply_to, 'iskajoin@gmail.com'); assert.match(sent[0].html, /mailto:iskajoin@gmail\.com/);
sent.length = 0;
await post({ headers: { from: 'avi2@example.com', to: 'eea6f909d9fc5ae94f3b@cloudmailin.net', subject: 'הצטרפות' }, plain: '' });
assert.equal(sent[0].reply_to, 'join@example.org');

console.log('simulate_join_email: ok');
