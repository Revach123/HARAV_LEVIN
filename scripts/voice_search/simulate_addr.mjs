// סימולציה של שאלות הכתובת בשלוחת ההצטרפות (עיר / רחוב בהקשת אותיות, מספר בית), בלי ימות ובלי D1.
// הרצה: node --no-warnings scripts/voice_search/simulate_addr.mjs
import assert from 'node:assert/strict';
import { onRequest as join } from '../../functions/api/ivr-join.js';
import { tapCode, tapLetter, matchNames, clearAddrCache } from '../../functions/api/_shared/ivr-addr.js';
import { decryptPii, importKeyForWrite } from '../../functions/api/_shared/joiners-crypto.js';

// ---- קידוד והתאמה ----
assert.equal(tapCode('ב'), '33');
assert.equal(tapCode('ל'), '555');
assert.equal(tapCode('ם'), tapCode('מ'));
assert.equal(tapLetter('33'), 'ב'); assert.equal(tapLetter('555'), 'ל'); assert.equal(tapLetter('3'), 'א');
assert.equal(tapLetter('34'), ''); assert.equal(tapLetter('4444'), ''); assert.equal(tapLetter('444'), '');   // מ נ - רק שתי אותיות
const CITIES = [['3000', 'ירושלים'], ['6100', 'בני ברק'], ['2610', 'בית שמש'], ['1309', 'אלעד'], ['70', 'אשדוד'], ['2640', 'ראש העין'],
  ['5000', 'תל אביב - יפו'], ['6400', 'הרצליה'], ['9000', 'באר שבע'], ['7900', 'פתח תקווה'], ['3780', 'ביתר עילית'], ['1', 'בית אל'],
  ['2', 'בית דגן'], ['3', 'בית חלקיה'], ['4', 'בית חשמונאי'], ['5', 'בית ניר'], ['6', 'בית עוזיאל'], ['7', 'בית קמה'], ['8', 'בית רבן'], ['9', 'מושב קטן']];
const names = CITIES.map((c) => c[1]);
assert.deepEqual(matchNames(names, 'אל').list, ['אלעד']);
assert.equal(matchNames(names, 'בי').list.length, 10);                  // "בית..." - יותר מ-8
assert.deepEqual(matchNames(names, 'קט').list, ['מושב קטן']);          // התאמה לפי מילה שנייה
assert.deepEqual(matchNames(['הרצל', 'הרצליה', 'הר', 'הרב קוק', 'הרדוף', 'הרימון', 'הרקפת', 'הרמב"ם', 'הרי"ף'], 'הר').exact, ['הר']);
// תארים: "הרב קוק" / "רבי עקיבא" / "האדמו"ר מגור" נמצאים גם בלי התואר, לצד שמות שמתחילים באותן אותיות
const ST = ['הרב קוק', 'קורח', 'רבי עקיבא', 'עזרא', 'האדמו"ר מגור', 'שדרות ירושלים', "ר' חיים עוזר", 'הרב רבי מאיר'];
assert.deepEqual(matchNames(ST, 'קו').list, ['הרב קוק', 'קורח']);
assert.deepEqual(matchNames(ST, 'עק').list, ['רבי עקיבא']);
assert.deepEqual(matchNames(ST, 'מג').list, ['האדמו"ר מגור']);
assert.deepEqual(matchNames(ST, 'ירו').list, ['שדרות ירושלים']);
assert.deepEqual(matchNames(ST, 'חיי').list, ["ר' חיים עוזר"]);
assert.deepEqual(matchNames(ST, 'מאי').list, ['הרב רבי מאיר']);
assert.deepEqual(matchNames(ST, 'רב').list, ['רבי עקיבא', 'הרב רבי מאיר']);

// ---- שיחה ----
const STREETS = { 3000: ['יפו', 'בר אילן', 'בן יהודה', 'יואל', 'סורוצקין', 'מלכי ישראל', 'שדרות הרצל'], 1309: ['רבי עקיבא', 'בן זכאי'], 9: [] };
const env = {
  IVR_SECRET_NEW: 'N', IVR_AUDIO_OFF: '1', JOINERS_KEY: Buffer.alloc(32, 7).toString('base64'),
  ASSETS: { fetch: async (req) => {
    const p = new URL(req.url).pathname;
    if (p === '/data/ivr-addr/cities.json') return Response.json(CITIES);
    const m = p.match(/^\/data\/ivr-addr\/streets\/(\d+)\.json$/);
    return m && STREETS[m[1]] ? Response.json(STREETS[m[1]]) : new Response('nf', { status: 404 });
  } },
};
const inserted = [], states = new Map();
env.DB = { prepare: (sql) => ({ run: async () => ({}), bind: (...a) => ({
  first: async () => (sql.includes('ivr_join_state') ? (states.has(a[0]) ? { data: states.get(a[0]) } : null) : null),
  run: async () => {
    if (sql.startsWith('INSERT INTO joiners')) inserted.push({ rid: a[0], pii: a[3] });
    else if (sql.startsWith('INSERT OR REPLACE INTO ivr_join_state')) states.set(a[0], a[1]);
    else if (sql.startsWith('DELETE FROM ivr_join_state WHERE call_id')) states.delete(a[0]);
    return {};
  } }) }) };

const plain = (x) => x.replace(/[ְ-ׇ]/g, '');
let call = 0;
async function conversation(answers, { log = false } = {}) {
  // answers: [regex על ההודעה, ערך] לפי הסדר; תשובות קבועות לשאר השאלות
  const callId = `c${++call}`, vars = { ApiPhone: '0501234567' };
  const fixed = { id: '123456782', pc: '1', p2q: '2', emq: '2', fxq: '2', ch: '1', rd: '2', ag: '1' };
  const queue = [...answers], said = [];
  for (let i = 0; i < 80; i++) {
    const u = new URL('https://x/api/ivr-join');
    for (const [k, v] of Object.entries({ sk: 'N', ApiCallId: callId, ...vars })) u.searchParams.set(k, v);
    const out = plain(await (await join({ request: new Request(u), env })).text());
    if (log) console.log(out.slice(0, 220));
    if (!out.startsWith('read=')) return { out, said };
    const m = out.match(/^read=(.*)=([^=,]+),no,(record)?/);
    const [, msg, name, rec] = m;
    said.push(msg);
    const base = name.replace(/_\d+$/, '').replace(/_[a-z]\d+$/, '');
    if (rec) { vars[name] = `/1/${name}.wav`; continue; }
    if (/^(fn|ln)$/.test(base)) continue;
    if (fixed[name] !== undefined) { vars[name] = fixed[name]; continue; }
    if (/^id_\d+$/.test(name)) { vars[name] = fixed.id; continue; }
    if (/^id_c\d+$/.test(name)) { vars[name] = '1'; continue; }
    const a = queue.shift();
    assert.ok(a, `no answer for ${name}: ${msg}`);
    assert.match(msg, a[0], `${name}: ${msg}`);
    vars[name] = a[1];
  }
  throw new Error('too many steps');
}
// אות אחר אות: כל אות היא תשובה נפרדת; אחרי כל אות (חוץ מהאחרונה) מוקראת האות ומתבקשת הבאה
const spell = (word, firstRe) => [...word].map((ch, i) => [i === 0 ? firstRe : /הוקשה האות.*האות הבאה/, tapCode(ch)]);
const lastExtra = async () => {
  const r = inserted.at(-1), key = await importKeyForWrite(env);
  const p = await decryptPii(key, r.rid, r.pii);
  return JSON.parse(p.extra);
};

// 1. ירושלים: י, ר -> רשימה; רחוב "בר" -> בר אילן; מספר בית 12
let r = await conversation([
  ...spell('י', /אות אחר אות.*פעמים את הספרה שלוש.*האות הראשונה של שם העיר/),
  [/הוקשה האות.*יוד.*לירושלים הקישו 1.*אינו ברשימה הקישו תשע/, '1'],
  ...spell('ב', /שם הרחוב.*בלי הרב או רבי/),
  [/לבר אילן הקישו 1.*לבן יהודה הקישו 2/, '1'],
  [/מספר הבית/, '12'],
  [/מספר בית 12.*לאישור הקישו 1/, '1'],
]);
assert.match(r.out, /תודה רבה/);
let ex = await lastExtra();
assert.equal(ex['עיר'], 'ירושלים'); assert.equal(ex['רחוב'], 'בר אילן'); assert.equal(ex['מספר בית'], '12');
assert.equal(ex['כתובת'], 'בר אילן 12, ירושלים');
assert.ok(!ex['הקלטת כתובת']);

// 2. ב-י-ת (הרבה אפשרויות), מחיקה (1) והקשה חוזרת, ש -> בית שמש; אין קובץ רחובות -> הקלטת רחוב; אין מספר בית (0)
r = await conversation([
  ...spell('בי', /שם העיר/),
  [/הוקשה האות.*יוד.*האות הבאה/, '1'],
  [/האות האחרונה נמחקה.*עד כה הוקשו.*בית.*האות הבאה/, tapCode('י')],
  [/הוקשה האות.*יוד.*האות הבאה/, tapCode('ת')],
  [/הוקשה האות.*תו.*האות הבאה/, tapCode('ש')],
  [/לבית שמש הקישו 1/, '1'],
  [/מספר הבית/, '0'],
  [/ללא מספר בית/, '1'],
]);
ex = await lastExtra();
assert.equal(ex['עיר'], 'בית שמש'); assert.ok(ex['הקלטת רחוב']); assert.ok(!ex['מספר בית']);
assert.ok(r.said.some((s) => /אמרו את שם הרחוב/.test(s)));

// 3. הסבר המקשים (0), הקשה שאינה אות, אות שלא מתאימה פעמיים, "לא ברשימה" (9) -> אחרי 3 כישלונות הקלטת עיר ורחוב
r = await conversation([
  [/שם העיר/, '0'],
  [/מקום האותיות במקשים.*בספרה שלוש: אלף בית גימל.*הקישו את האות הראשונה ואחריה/, '34'],
  [/ההקשה אינה אות/, tapCode('צ')],
  [/אין שם שמתאים לאות הזו/, tapCode('א')],
  [/הוקשה האות.*אלף.*לאלעד הקישו 1.*לאשדוד הקישו 2/, '9'],
  [/נסו שוב מההתחלה/, tapCode('ץ')],
  [/מספר הבית/, '5'],
  [/מספר בית 5/, '1'],
]);
ex = await lastExtra();
assert.ok(ex['הקלטת עיר'] && ex['הקלטת רחוב']);
assert.ok(r.said.some((s) => /לא מצאנו את העיר/.test(s)));

// 4. יישוב בלי רחובות (לפי מילה שנייה: "קט"): לא נשאלת שאלת רחוב
r = await conversation([
  ...spell('ק', /שם העיר/),
  [/לבית קמה הקישו 1.*למושב קטן הקישו 2/, '2'],
  [/מספר הבית/, '3'],
  [/מספר בית 3/, '1'],
]);
ex = await lastExtra();
assert.equal(ex['כתובת'], '3, מושב קטן');
assert.ok(!r.said.some((s) => /שם הרחוב/.test(s)));

// 4ב. רחוב בלי התואר: באלעד "עק" -> רבי עקיבא
r = await conversation([
  ...spell('א', /שם העיר/),
  [/לאלעד הקישו 1/, '1'],
  [/שם הרחוב/, tapCode('ע')],
  [/לרבי עקיבא הקישו 1/, '1'],
  [/מספר הבית/, '7'],
  [/מספר בית 7/, '1'],
]);
ex = await lastExtra();
assert.equal(ex['כתובת'], 'רבי עקיבא 7, אלעד');

// 5. בלי נתוני ערים: הקלטת כתובת מלאה, כמו קודם
const saved = env.ASSETS; env.ASSETS = { fetch: async () => new Response('', { status: 404 }) }; clearAddrCache();
r = await conversation([]);
env.ASSETS = saved;
assert.ok(r.said.some((s) => /אמרו את כתבת מגוריכם/.test(s)));
ex = await lastExtra();
assert.ok(ex['הקלטת כתובת']);

console.log('simulate_addr: ok');
