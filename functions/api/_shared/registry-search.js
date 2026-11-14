// חיפוש בכל מאגר הרישום (חברות, שותפויות, עמותות) - לא רק עסקים עם היתר עסקה.
//
// המאגר הוא ה-D1 של revach (company-info-db), בחיבור env.DB1: טבלאות companies /
// partnerships / associations ואינדקסי FTS5 trigram (companies_fts וכו') על name_norm.
// בלי DB1 (עדיין לא חובר) - נופלים חזרה לטבלת businesses בלבד, והשיחה לא נשברת.
//
// שלבים: (1) שליפת מועמדים מ-FTS (כל מילה חייבת להופיע, כמו company-search באתר),
// עם וריאנטים של שגיאות זיהוי רק אם אין כלום; (2) סינון ודירוג קפדני ע"י voice-match.js.

import { searchBusinesses, tokens, normalize } from './voice-match.js';

export const MAX_LIST = 8;          // תוצאות בכל דף הקראה (בטלפון: 9 = הדף הבא)
export const MAX_PAGED = 36;        // יותר מזה (או כשהחיפוש נקטע): לא מקריאים, מבקשים לדייק
const FETCH_LIMIT = 30;             // מועמדים לכל טבלה לכל וריאנט; הגעה לתקרה = "יותר מדי"
const MAX_VARIANTS = 10;

// קבוצות אותיות שזיהוי דיבור מחליף ביניהן (בכיוון ההפוך נוצרות גם הן).
const SWAP = { 'ק': 'כ', 'כ': 'ק', 'ח': 'כ', 'ט': 'ת', 'ת': 'ט', 'ס': 'ש', 'ש': 'ס', 'ע': 'א', 'א': 'ע' };
const PREFIXES = 'הובלמכש';

const DEFUNCT = /מחוק|נמחק|מבוטל|פירוק|מפורק|מחוסל|חוסל|חיסול/;

const ftsPhrase = (w) => `"${w.replace(/"/g, '""')}"`;
const digitsOnly = (s) => String(s || '').replace(/\D/g, '');

// ---------------------------------------------------------------------------
//  וריאנטים לשאילתת FTS
// ---------------------------------------------------------------------------
function variantSets(words) {
  const base = words.filter((w) => w.length >= 3);
  if (!base.length) return { tier1: [], tier2: [] };

  const tier1 = [base];
  const stripped = base.map((w) => (w.length >= 4 && PREFIXES.includes(w[0]) ? w.slice(1) : w));
  if (stripped.some((w, i) => w !== base[i])) tier1.push(stripped);

  const tier2 = [];
  const seen = new Set(tier1.map((v) => v.join(' ')));
  for (let i = 0; i < base.length && tier2.length < MAX_VARIANTS; i++) {
    for (let p = 0; p < base[i].length && tier2.length < MAX_VARIANTS; p++) {
      const alt = SWAP[base[i][p]];
      if (!alt) continue;
      const w = base[i].slice(0, p) + alt + base[i].slice(p + 1);
      const v = base.map((x, j) => (j === i ? w : x));
      const key = v.join(' ');
      if (!seen.has(key)) { seen.add(key); tier2.push(v); }
    }
  }
  return { tier1, tier2 };
}

// shorts = מילים קצרות מ-3 תווים (למשל מספר): ל-FTS trigram אין בהן שימוש, אז הן מצמצמות
// ב-LIKE על התוצאות שה-FTS כבר החזיר (זול), כדי שהן לא יגרמו לחתך שרירותי של 30 מועמדים.
//
// rankText = השאילתה המנורמלת. ה-LIMIT חותך מועמדים *אחרי* מיון לפי התאמה (זהה / מתחיל ב / מתחיל במילה /
// מכיל, אחר כך פעילות לפני מחוקים, ואז שם קצר), כך שעם מילה נפוצה ("יו" + "דיגיטל") ההתאמות הטובות ביותר
// לא נחתכות באופן שרירותי לפני שמגיעים לדירוג הקפדני. אותו דירוג כמו /api/search באתר (revach).
const DEFUNCT_SQL = (st) => `(${['מחוק', 'נמחק', 'מבוטל', 'פירוק', 'מפורק', 'מחוסל', 'חוסל', 'חיסול'].map((w) => `${st} LIKE '%${w}%'`).join(' OR ')})`;

// תבנית LIKE מוגבלת ל-50 בייט (עברית = 2 בייט לתו): מקצרים בטוח.
function likePrefix(s, maxBytes = 40) {
  const enc = new TextEncoder().encode(s);
  if (enc.length <= maxBytes) return s;
  const dec = new TextDecoder('utf-8', { fatal: true });
  for (let n = maxBytes; n > 0; n--) { try { return dec.decode(enc.slice(0, n)); } catch { /* באמצע תו */ } }
  return '';
}

function ftsStatements(db, variant, shorts = [], rankText = '') {
  const expr = variant.map(ftsPhrase).join(' AND ');
  const like = shorts.map(() => ' AND c.name_norm LIKE ?').join('');
  const lp = likePrefix(rankText);
  const rankArgs = [rankText, `${lp}%`, `% ${lp}%`];
  const args = [expr, ...shorts.map((w) => `%${w}%`), ...rankArgs];
  const order = `CASE WHEN c.name_norm = ? THEN 0 WHEN c.name_norm LIKE ? THEN 1 WHEN c.name_norm LIKE ? THEN 2 ELSE 3 END, CASE WHEN ${DEFUNCT_SQL('c.status')} THEN 1 ELSE 0 END, length(c.name_norm)`;
  const q = (tbl, sub) => `SELECT c.id,c.name,c.status,c.${sub} AS sub FROM ${tbl}_fts f JOIN ${tbl} c ON c.id=f.id WHERE ${tbl}_fts MATCH ?${like} ORDER BY ${order} LIMIT ${FETCH_LIMIT}`;
  return [
    db.prepare(q('companies', 'corp_type')).bind(...args),
    db.prepare(q('partnerships', 'ptype')).bind(...args),
    db.prepare(q('associations', 'category')).bind(...args),
  ];
}

const KINDS = ['company', 'partnership', 'association'];

async function fetchVariants(db, variants, shorts, rankText) {
  const stmts = variants.flatMap((v) => ftsStatements(db, v, shorts, rankText));
  const out = await db.batch(stmts);
  const rows = new Map();
  let truncated = false;
  out.forEach((res, i) => {
    const list = res.results || [];
    if (list.length >= FETCH_LIMIT) truncated = true;
    for (const r of list) rows.set(`${KINDS[i % 3]}:${r.id}`, { kind: KINDS[i % 3], ...r });
  });
  return { rows: [...rows.values()], truncated };
}

export async function registryCandidates(db, query) {
  const words = normalize(query).split(' ').filter(Boolean);
  const { tier1, tier2 } = variantSets(words);
  if (!tier1.length) return { rows: [], truncated: false };
  const shorts = words.filter((w) => w.length < 3);
  const rankText = words.join(' ');
  let got = await fetchVariants(db, tier1, shorts, rankText);
  if (!got.rows.length && tier2.length) got = await fetchVariants(db, tier2, shorts, rankText);
  return got;
}

// ---------------------------------------------------------------------------
//  היתרי עסקה (טבלת businesses)
// ---------------------------------------------------------------------------
// כמו lists.js: visibility = 'רק פרטי' = עסק שיש לו *רק* היתר עסקה פרטי (מופיע רק ברשימה הפרטית);
// 'פרטי' = יש לו גם היתר עסקה פרטי (נוסף על הכללי); ריק = היתר כללי בלבד.
// אם לאותו עסק כמה שורות: 'פרטי' באחת מהן = "כללי וגם פרטי"; אחרת ריק באחת מהן = "כללי";
// 'רק פרטי' מוקרא רק כשכל השורות כאלה.
// 'רק לאג"ח' = אין היתר לחברה עצמה (רק לאג"ח שלה): לא נספר כהיתר; אם אין שורה אחרת - "אין היתר".
export function permitIndex(businesses) {
  const byChp = new Map(), byName = new Map();
  const put = (map, key, vis) => {
    if (!key || vis === 'רק לאג"ח') return;
    const kind = vis === 'רק פרטי' ? 'רק פרטי' : vis === 'פרטי' ? 'כללי+פרטי' : 'כללי';
    const prev = map.get(key);
    const rank = { 'רק פרטי': 0, 'כללי': 1, 'כללי+פרטי': 2 };
    if (prev === undefined || rank[kind] > rank[prev]) map.set(key, kind);
  };
  for (const b of businesses) {
    put(byChp, digitsOnly(b.chp_number), b.visibility);
    put(byName, tokens(b.registrar_name || b.permit_name || '').join(' '), b.visibility);
  }
  return (item) => byChp.get(digitsOnly(item.id)) || byName.get(tokens(item.name).join(' ')) || null;
}

// ---------------------------------------------------------------------------
//  תיאור לתוצאה: סוג, שם (בע"מ נשאר ומוקרא בראשי תיבות), מצב היתר
// ---------------------------------------------------------------------------
// חל"צ: ברשם היא "חברה פרטית"; מזוהה לפי השם או כשאותו מספר רשום גם ברשם העמותות (pbc, dedupeById)
const isPbc = (item) => !!item.pbc || /(^|[^א-ת])חל["״'׳]?צ([^א-ת]|$)/.test(String(item.name || ''));

export function typeLabel(item) {
  if (item.kind === 'other' || item.kind === 'business') return '';   // רשות / אגודה שיתופית / עסק בלי מספר: רק השם
  const s = String(item.sub || '');
  let label;
  if (item.kind === 'partnership') label = /מוגבלת/.test(s) ? 'שותפות מוגבלת' : /כללית/.test(s) ? 'שותפות כללית' : 'שותפות';
  else if (item.kind === 'association') label = 'עמותה';
  else if (isPbc(item)) label = 'חברה לתועלת הציבור';
  else label = /ציבורי/.test(s) ? 'חברה ציבורית' : /פרטי/.test(s) ? 'חברה פרטית' : 'חברה';
  return DEFUNCT.test(item.status || '') ? `${label} מחוקה` : label;
}

// שם להקראה: בלי (ע"ר) ובלי "שותפות מוגבלת" (הסוג מוקרא לפני השם). "בע"מ" בסוף נפרד
// מהשם (baam) כדי שיושמע בקובץ שמע משלו.
export function splitName(name) {
  let n = String(name || '').replace(/\s*\(\s*ע["״']?ר\s*\)\s*$/, '').replace(/\s*שותפות מוגבלת\s*$/, '');
  const baam = /\s*בע["״]?מ\.?\s*$/.test(n);
  if (baam) n = n.replace(/\s*בע["״]?מ\.?\s*$/, '');
  return { name: n.replace(/[\s.,\-]+$/, '').trim(), baam };
}

/** מה מוקרא לתוצאה: {type, name, baam, permit: 'private' (רק פרטי) | 'both' (כללי וגם פרטי) | 'general' | 'none'} */
export function describe(item, permitOf) {
  const p = permitOf(item);
  const { name, baam } = splitName(item.name);
  return { type: typeLabel(item), name, baam, permit: p === 'רק פרטי' ? 'private' : p === 'כללי+פרטי' ? 'both' : p === 'כללי' ? 'general' : 'none' };
}

// ---------------------------------------------------------------------------
//  ממשק ראשי
// ---------------------------------------------------------------------------
const toBusinessRow = (it) => ({ id: `${it.kind}:${it.id}`, registrar_name: it.name, permit_name: '', chp_number: it.id });

// בלי DB1: עסקים מטבלת businesses בלבד, בצורה שווה לפריטי הרישום.
function fromBusinesses(businesses) {
  return businesses.map((b) => ({
    kind: b.entity_type === 'partnership' ? 'partnership' : b.entity_type === 'association' ? 'association' : 'company',
    id: b.chp_number || b.id, name: b.registrar_name || b.permit_name, status: '', sub: '',
  }));
}

// עסקים עם היתר שאינם ברשם (data.gov.il) שב-DB1: קופות חולים ואגודות עות'מאניות (5849/99),
// רשויות מקומיות, אגודות שיתופיות, חברות זרות. בלי זה לא נמצאים בחיפוש הטלפוני כלל.
// "ברשם" = מספר ישראלי בן 9 ספרות שמתחיל ב-5 *וגם* שרענון הרשם מצא לו שם (registrar_name).
// אותו כלל כמו ב-Revach (build_heter_iska.py: notInRegistry). השם - כפי שהוא ברשימה (permit_name).
const kindOfNumber = (d) => (/^(58|599)/.test(d) ? 'association' : /^55/.test(d) ? 'partnership' : /^(50|57)/.test(d) ? 'other' : 'company');
// אותו מספר בשתי טבלאות (חל"צ: גם ברשם החברות וגם ברשם העמותות) - פעם אחת בלבד,
// הרשומה שתואמת לקידומת: 58 עמותה, 55 שותפות, אחרת חברה. (כמו בדף החיפוש ב-Revach)
function dedupeById(items) {
  const want = (id) => (/^58/.test(id) ? 'association' : /^55/.test(id) ? 'partnership' : 'company');
  const byId = new Map(), kinds = new Map();
  for (const it of items) {
    const id = digitsOnly(it.id) || String(it.id), prev = byId.get(id);
    if (!kinds.has(id)) kinds.set(id, new Set());
    kinds.get(id).add(it.kind);
    if (!prev || (prev.kind !== want(id) && it.kind === want(id))) byId.set(id, it);
  }
  for (const [id, it] of byId) if (it.kind === 'company' && kinds.get(id).has('association')) it.pbc = true;
  const keep = new Set(byId.values());
  return items.filter((it) => keep.has(it));
}

export function notInRegistry(businesses) {
  const seen = new Set(), out = [];
  for (const b of businesses || []) {
    const d = digitsOnly(b.chp_number);
    if (!d) {
      // עסק בלי מספר תאגיד (בעיקר חנויות): נמצא לפי השם בלבד, מוקרא בלי סוג ובלי מספר
      const name = String(b.permit_name || b.registrar_name || '').trim();
      if (!name || seen.has('n:' + name)) continue;
      seen.add('n:' + name);
      out.push({ kind: 'business', id: `b:${b.id}`, name, status: '', sub: '' });
      continue;
    }
    if (seen.has(d)) continue;
    if (String(b.registrar_name || '').trim() && /^5\d{8}$/.test(d)) continue;
    seen.add(d);
    out.push({ kind: kindOfNumber(d), id: String(b.chp_number).trim(), name: b.permit_name || b.registrar_name, status: '', sub: '' });
  }
  return out;
}

/** @returns {{items:Array, total:number, tooMany:boolean}} items מדורגים, פעילים לפני מחוקים */
export async function searchByName(env, query, businesses) {
  let candidates, truncated = false;
  if (env.DB1) {
    ({ rows: candidates, truncated } = await registryCandidates(env.DB1, query));
    candidates = dedupeById(candidates.concat(notInRegistry(businesses)));
  } else {
    console.log('registry-search: DB1 not bound - searching businesses only');
    candidates = fromBusinesses(businesses);
  }
  const byKey = new Map(candidates.map((c) => [`${c.kind}:${c.id}`, c]));
  const found = searchBusinesses(query, candidates.map(toBusinessRow), 50);
  const items = found.results.map((r) => byKey.get(r.id)).filter(Boolean);
  items.sort((a, b) => (DEFUNCT.test(a.status || '') ? 1 : 0) - (DEFUNCT.test(b.status || '') ? 1 : 0));
  return { items, total: found.total, tooMany: truncated || found.total > MAX_PAGED };          // עד MAX_PAGED: מוקראות בדפים של MAX_LIST (9 = תוצאות נוספות)
}

/** חיפוש לפי ח.פ. (מספר תאגיד): מחזיר פריטים מכל הטבלאות שה-id שלהן שווה. */
export async function searchByChp(env, chp, businesses) {
  const id = digitsOnly(chp);
  if (!id) return [];
  if (env.DB1) {
    const db = env.DB1;
    const out = await db.batch([
      db.prepare('SELECT id,name,status,corp_type AS sub FROM companies WHERE id = ? LIMIT 1').bind(id),
      db.prepare('SELECT id,name,status,ptype AS sub FROM partnerships WHERE id = ? LIMIT 1').bind(id),
      db.prepare('SELECT id,name,status,category AS sub FROM associations WHERE id = ? LIMIT 1').bind(id),
    ]);
    const items = [];
    out.forEach((res, i) => (res.results || []).forEach((r) => items.push({ kind: KINDS[i], ...r })));
    if (!items.length) items.push(...notInRegistry(businesses).filter((it) => digitsOnly(it.id) === id));
    return dedupeById(items);
  }
  return fromBusinesses(businesses.filter((b) => digitsOnly(b.chp_number) === id));
}
