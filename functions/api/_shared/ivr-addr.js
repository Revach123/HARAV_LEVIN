// ============================================================================
//  functions/api/_shared/ivr-addr.js — בחירת עיר / רחוב בהקשת אותיות בטלפון (ivr-join.js)
//
//  אות אחת בכל הקשה (ואחריה סולמית): במקש שלה, כמה פעמים לפי מקומה במקש (כמו בטלפון ישן):
//    2 = ד ה ו   3 = א ב ג   4 = מ נ   5 = י כ ל   6 = ז ח ט   7 = ר ש ת   8 = צ ק   9 = ס ע פ
//  לדוגמה: ב = 33, ל = 555. אותיות סופיות כמו הרגילות (ם = מ). רווחים וסימנים לא מוקשים.
//  שם מתאים אם האותיות שהוקשו הן תחילת השם, או תחילת השם בלי תואר בהתחלה ("הרב", "רבי", "שדרות" וכו'),
//  ואם אין כאלה - תחילת אחת המילים בשם.
//
//  הנתונים: data/ivr-addr/cities.json ([סמל, שם] לכל יישוב) ו-data/ivr-addr/streets/<סמל>.json
//  (שמות הרחובות ביישוב). נבנים מ-data.gov.il ע"י scripts/ivr_addr/build_addr.py (workflow ‏ivr-addr-data).
// ============================================================================

import { normalize as vmNorm, fold as vmFold, skeleton as vmSkel } from './voice-match.js';

const KEYS = { 2: 'דהו', 3: 'אבג', 4: 'מנ', 5: 'יכל', 6: 'זחט', 7: 'רשת', 8: 'צק', 9: 'סעפ' };
const FINALS = { 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' };
const TAP = {};
for (const [k, letters] of Object.entries(KEYS)) [...letters].forEach((ch, i) => { TAP[ch] = k.repeat(i + 1); });

/** קידוד ההקשות של טקסט: כל אות עברית לפי המקש שלה, שאר התווים מושמטים */
export function tapCode(s) {
  let out = '';
  for (const ch of String(s || '')) { const c = FINALS[ch] || ch; if (TAP[c]) out += TAP[c]; }
  return out;
}

/** הקשה של אות אחת -> האות ('33' -> 'ב'), או '' אם זו לא אות (מקשים שונים / יותר מדי פעמים) */
export function tapLetter(digits) {
  const d = String(digits || '');
  if (!/^([2-9])\1*$/.test(d)) return '';
  return KEYS[d[0]][d.length - 1] || '';
}

/** אותיות עבריות בלבד, סופיות כרגילות */
export const letters = (s) => [...String(s || '')].map((ch) => FINALS[ch] || ch).filter((ch) => TAP[ch]).join('');

// תארים בתחילת שם רחוב (אפשר לחפש גם בלעדיהם): "הרב קוק" נמצא גם בהקשת "קוק"
const TITLES = new Set(['הרב', 'רב', 'רבי', 'הרבי', 'רבנו', 'רבינו', 'רבן', 'ר', 'האדמור', 'אדמור', 'האדמו', 'הגאון', 'הגרא', 'מרן', 'הרבנית',
  'שדרות', 'שד', 'סמטת', 'סמ', 'כיכר', 'ככר', 'רחוב', 'רח', 'דרך', 'שכונת', 'שכ', 'מעלה', 'משעול', 'נתיב', 'גן', 'כביש']);
const words = (name) => String(name || '').replace(/["'׳״`]/g, '').split(/[\s\-–־().,]+/).filter((w) => letters(w));
function keys(name) {               // הצורות שבהן אפשר להקיש את השם: מלא, ובלי התארים שבתחילתו
  const ws = words(name), out = [letters(name)];
  let i = 0;
  while (i < ws.length - 1 && TITLES.has(ws[i])) { i++; out.push(letters(ws.slice(i).join(''))); }
  return out;
}

/** השמות שמתאימים לאותיות. exact = שמות שהאותיות הן כל השם (או כל השם בלי התואר). */
export function matchNames(names, typed) {
  const t = letters(typed);
  if (!t) return { list: [], exact: [] };
  const seen = new Set(), list = [], exact = [];
  for (const n of names) {
    if (seen.has(n)) continue;
    const ks = keys(n);
    if (!ks.some((k) => k.startsWith(t))) continue;
    seen.add(n); list.push(n);
    if (ks.includes(t)) exact.push(n);
  }
  if (list.length) return { list, exact };
  for (const n of names) {          // אין התאמה: תחילת מילה כלשהי בשם
    const ws = words(n);
    if (!seen.has(n) && ws.slice(1).some((_, i) => letters(ws.slice(i + 1).join('')).startsWith(t))) { seen.add(n); list.push(n); }
  }
  return { list, exact };
}

// ---- טעינת הנתונים (קבצים סטטיים של האתר; נשמרים בזיכרון בין שיחות) ----
const cache = new Map();
export const clearAddrCache = () => cache.clear();          // לבדיקות
async function getJson(env, origin, path) {
  if (cache.has(path)) return cache.get(path);
  try {
    const url = new URL(path, origin);
    const res = env.ASSETS ? await env.ASSETS.fetch(new Request(url)) : await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    if (cache.size > 300) cache.clear();
    cache.set(path, data);
    return data;
  } catch { return null; }
}

/** שמות היישובים להכוונת זיהוי הדיבור (עד 1000, הגדולים קודם; build_addr.py) או [] */
export async function loadCitiesTop(env, origin) {
  const d = await getJson(env, origin, '/data/ivr-addr/cities-top.json');
  return Array.isArray(d) ? d : [];
}

/** [[סמל, שם], ...] או null אם הנתונים לא זמינים */
export async function loadCities(env, origin) {
  const d = await getJson(env, origin, '/data/ivr-addr/cities.json');
  return Array.isArray(d) && d.length ? d : null;
}

/** שמות הרחובות ביישוב: [] = אין ביישוב רחובות ברשימה; null = הנתונים לא זמינים (אז הרחוב נמסר בהקלטה) */
export async function loadStreets(env, origin, code) {
  if (!/^\d+$/.test(String(code || ''))) return null;
  const d = await getJson(env, origin, `/data/ivr-addr/streets/${code}.json`);
  return Array.isArray(d) ? d : null;
}

// ---- שם מזיהוי דיבור -> השם ברשימה (יישוב / רחוב) ----
// השוואה אחרי נרמול: בלי ניקוד, גרשיים, מקפים, סוגריים ורווחים כפולים; אותיות דומות בצליל מאוחדות (voice-match.js); תואר בהתחלה
// ("רחוב", "הרב" וכו') אפשר להשמיט. שלבים, מהמחמיר למקל: כמו שהוא; בלי ו/י (כתיב מלא / חסר: חזקיהו = חזקיה);
// ואז גם בלי חשיבות לסדר המילים (ברשימה הרשמית שם המשפחה קודם: "הרב שבתאי חזקיה" = "חזקיהו שבתאי"). רק התאמה יחידה מחליפה את הטקסט.
const spokenWords = (s) => {
  const ws = vmNorm(String(s || '').replace(/\([^)]*\)/g, ' ')).split(' ').filter(Boolean), out = [ws];
  let i = 0;          // התארים נבדקים לפני איחוד האותיות ("רחוב", לא "רכוב")
  while (i < ws.length - 1 && TITLES.has(ws[i])) { i++; out.push(ws.slice(i)); }
  return out.map((f) => f.map(vmFold));
};
const STAGES = [
  (ws) => ws.join(''),
  (ws) => ws.map(vmSkel).join(''),
  (ws) => ws.slice().sort().join(' '),
  (ws) => ws.map(vmSkel).sort().join(' '),
];
export function canonName(names, spoken) {
  const q = spokenWords(spoken).filter((ws) => ws.length);
  if (!q.length || !Array.isArray(names)) return '';
  const prepared = names.map((n) => [n, spokenWords(n)]);
  for (const key of STAGES) {
    const qs = new Set(q.map(key)), hits = new Set();
    for (const [n, forms] of prepared) if (forms.some((f) => qs.has(key(f)))) hits.add(n);
    if (hits.size === 1) return [...hits][0];
    if (hits.size > 1) return '';
  }
  return '';
}

/** n השמות שהכי דומים לטקסט שזוהה (לרשימה גדולה מ-n, למשל 4000 רחובות בירושלים): מילים משותפות (בלי חשיבות לסדר,
 *  בלי ו/י) ואחריהן דמיון אותיות (זוגות אותיות משותפים). מחזיר את הרשימה כמו שהיא אם היא קטנה מ-n. */
export function likeliest(names, spoken, n) {
  if (!Array.isArray(names) || names.length <= n) return names || [];
  const skelWords = (s) => spokenWords(s).flat().map(vmSkel).filter(Boolean);
  const pairs = (w) => { const out = new Set(); for (let i = 0; i < w.length - 1; i++) out.add(w.slice(i, i + 2)); return out; };
  const qw = new Set(skelWords(spoken)), qp = pairs([...qw].join(''));
  if (!qw.size) return names.slice(0, n);
  const scored = names.map((name, i) => {
    const ws = new Set(skelWords(name)), p = pairs([...ws].join(''));
    let common = 0; for (const w of ws) if (qw.has(w)) common++;
    let pc = 0; for (const x of p) if (qp.has(x)) pc++;
    return { name, i, s: common * 10 + (p.size + qp.size ? (2 * pc) / (p.size + qp.size) : 0) };
  });
  return scored.sort((a, b) => b.s - a.s || a.i - b.i).slice(0, n).map((x) => x.name);
}
