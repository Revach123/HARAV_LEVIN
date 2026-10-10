// חיפוש בכל מאגר הרישום (חברות, שותפויות, עמותות) - לא רק עסקים עם היתר עסקה.
//
// המאגר הוא ה-D1 של revach (company-info-db), בחיבור env.DB1: טבלאות companies /
// partnerships / associations ואינדקסי FTS5 trigram (companies_fts וכו') על name_norm.
// בלי DB1 (עדיין לא חובר) - נופלים חזרה לטבלת businesses בלבד, והשיחה לא נשברת.
//
// שלבים: (1) שליפת מועמדים מ-FTS (כל מילה חייבת להופיע, כמו company-search באתר),
// עם וריאנטים של שגיאות זיהוי רק אם אין כלום; (2) סינון ודירוג קפדני ע"י voice-match.js.

import { searchBusinesses, tokens, normalize } from './voice-match.js';

export const MAX_LIST = 8;          // יותר מזה: לא מקריאים, מבקשים לדייק
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
function ftsStatements(db, variant, shorts = []) {
  const expr = variant.map(ftsPhrase).join(' AND ');
  const like = shorts.map(() => ' AND c.name_norm LIKE ?').join('');
  const args = [expr, ...shorts.map((w) => `%${w}%`)];
  const q = (tbl, sub) => `SELECT c.id,c.name,c.status,c.${sub} AS sub FROM ${tbl}_fts f JOIN ${tbl} c ON c.id=f.id WHERE ${tbl}_fts MATCH ?${like} LIMIT ${FETCH_LIMIT}`;
  return [
    db.prepare(q('companies', 'corp_type')).bind(...args),
    db.prepare(q('partnerships', 'ptype')).bind(...args),
    db.prepare(q('associations', 'category')).bind(...args),
  ];
}

const KINDS = ['company', 'partnership', 'association'];

async function fetchVariants(db, variants, shorts) {
  const stmts = variants.flatMap((v) => ftsStatements(db, v, shorts));
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

async function registryCandidates(db, query) {
  const words = normalize(query).split(' ').filter(Boolean);
  const { tier1, tier2 } = variantSets(words);
  if (!tier1.length) return { rows: [], truncated: false };
  const shorts = words.filter((w) => w.length < 3);
  let got = await fetchVariants(db, tier1, shorts);
  if (!got.rows.length && tier2.length) got = await fetchVariants(db, tier2, shorts);
  return got;
}

// ---------------------------------------------------------------------------
//  היתרי עסקה (טבלת businesses)
// ---------------------------------------------------------------------------
// כמו lists.js: visibility = 'פרטי' = עסק שיש לו *רק* היתר עסקה פרטי (מופיע רק ברשימה הפרטית);
// כל ערך אחר = היתר כללי. אם לאותו עסק כמה שורות והאחת מהן כללית - הוא כללי.
export function permitIndex(businesses) {
  const byChp = new Map(), byName = new Map();
  const put = (map, key, vis) => {
    if (!key) return;
    const kind = vis === 'פרטי' ? 'פרטי' : 'כללי';
    if (map.get(key) !== 'כללי') map.set(key, kind);
  };
  for (const b of businesses) {
    put(byChp, digitsOnly(b.chp_number), b.visibility);
    put(byName, tokens(b.registrar_name || b.permit_name || '').join(' '), b.visibility);
  }
  return (item) => byChp.get(digitsOnly(item.id)) || byName.get(tokens(item.name).join(' ')) || null;
}

// ---------------------------------------------------------------------------
//  תיאור לתוצאה: סוג, שם (בלי בע"מ), מצב היתר
// ---------------------------------------------------------------------------
export function typeLabel(item) {
  const s = String(item.sub || '');
  let label;
  if (item.kind === 'partnership') label = /מוגבלת/.test(s) ? 'שותפות מוגבלת' : /כללית/.test(s) ? 'שותפות כללית' : 'שותפות';
  else if (item.kind === 'association') label = 'עמותה';
  else label = /ציבורי/.test(s) ? 'חברה ציבורית' : /פרטי/.test(s) ? 'חברה פרטית' : 'חברה';
  return DEFUNCT.test(item.status || '') ? `${label} מחוקה` : label;
}

export function speechName(name) {
  return String(name || '')
    .replace(/\s*\(\s*ע["״']?ר\s*\)\s*$/, '')           // (ע"ר) בסוף עמותה
    .replace(/\s*בע["״]?מ\.?\s*$/, '')                   // בע"מ בסוף
    .replace(/\s*שותפות מוגבלת\s*$/, '')                  // הסוג כבר מוקרא לפני השם
    .replace(/[\s.,\-]+$/, '')
    .trim();
}

export function describe(item, permitOf) {
  const p = permitOf(item);
  const permit = p === 'פרטי' ? 'לעסק זה יש רק היתר עסקה פרטי' : p === 'כללי' ? 'קיים היתר עסקה כללי' : 'לא קיים היתר עסקה';
  return [typeLabel(item), speechName(item.name), permit];
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

/** @returns {{items:Array, total:number, tooMany:boolean}} items מדורגים, פעילים לפני מחוקים */
export async function searchByName(env, query, businesses) {
  let candidates, truncated = false;
  if (env.DB1) {
    ({ rows: candidates, truncated } = await registryCandidates(env.DB1, query));
  } else {
    console.log('registry-search: DB1 not bound - searching businesses only');
    candidates = fromBusinesses(businesses);
  }
  const byKey = new Map(candidates.map((c) => [`${c.kind}:${c.id}`, c]));
  const found = searchBusinesses(query, candidates.map(toBusinessRow), 50);
  const items = found.results.map((r) => byKey.get(r.id)).filter(Boolean);
  items.sort((a, b) => (DEFUNCT.test(a.status || '') ? 1 : 0) - (DEFUNCT.test(b.status || '') ? 1 : 0));
  return { items, total: found.total, tooMany: truncated || found.total > MAX_LIST };
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
    return items;
  }
  return fromBusinesses(businesses.filter((b) => digitsOnly(b.chp_number) === id));
}
