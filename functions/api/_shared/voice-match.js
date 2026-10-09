// התאמת שם עסק לטקסט שהגיע מזיהוי דיבור.
//
// אותה שיטה כמו חיפוש החברות באתר (revach /company-search): כל מילה בשאילתה
// חייבת להופיע בשם (בכל סדר, גם כתת-מחרוזת). הסובלנות לשגיאות זיהוי מצומצמת
// בכוונה, כדי שהתוצאות יישארו בטווח הגיוני:
//   1. איחוד אותיות שנשמעות דומה (ק/כ, ט/ת, ס/ש, ע/א, ח/כ, סופיות) - בשני הצדדים.
//   2. תחילית ה/ו/ב/ל/מ/כ/ש על מילת השאילתה ("הבנק" -> "בנק").
//   3. רק אם אין שום תוצאה: השוואה ללא ו/י (כתיב מלא/חסר), עדיין עם כל המילים.
// אין OR בין מילים, אין מרחק עריכה, ואין יותר מ-MAX_RESULTS תוצאות.

export const MAX_RESULTS = 5;

const LEGAL_SUFFIX = new Set(['בעמ', 'בע', 'מ', 'ע', 'ר', 'עמותה', 'חברה', 'לימיטד']);
const PREFIXES = 'הובלמכש';

const FOLD = {
  'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ',
  'ק': 'כ', 'ח': 'כ', 'ט': 'ת', 'ס': 'ש', 'ע': 'א',
};

// ניקוד, גרשיים ומקפים נמחקים (מאחדים מילה); כל תו אחר שאינו אות/ספרה -> רווח.
export function normalize(s) {
  if (!s) return '';
  s = String(s).replace(/[֑-ׇ]/g, '');
  s = s.replace(/\([^)]*\)/g, ' ');
  s = s.replace(/["'״׳“”‘’\-־`]/g, '');
  s = s.replace(/[^א-ת0-9A-Za-z ]/g, ' ');
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

export function fold(s) {
  let out = '';
  for (const ch of s) out += FOLD[ch] || ch;
  return out;
}

// מילים של שם עסק / שאילתה, אחרי נרמול ואיחוד. סיומות משפטיות (בע"מ וכו') מוסרות
// לפני האיחוד (האיחוד הופך ע->א).
export function tokens(s) {
  return normalize(s).split(' ').filter((w) => w && !LEGAL_SUFFIX.has(w)).map(fold);
}

// "שלד" של מילה: בלי ו/י, כדי לסבול כתיב מלא/חסר. מילה שכולה ו/י נשארת כמו שהיא.
export function skeleton(w) {
  const k = w.replace(/[וי]/g, '');
  return k || w;
}

// כל הצורות שבהן מילת שאילתה יכולה להיות כתובה בשם: כמו שהיא, או בלי תחילית.
function wordForms(w) {
  const forms = [w];
  if (w.length >= 3 && PREFIXES.includes(w[0])) forms.push(w.slice(1));
  return forms;
}

// האם מילת השאילתה מופיעה בשם. מילים קצרות (עד 2 תווים) - רק כמילה שלמה.
function wordInName(forms, nameTokens, nameJoined) {
  for (const f of forms) {
    if (f.length <= 2) {
      if (nameTokens.includes(f)) return true;
    } else if (nameJoined.includes(f)) {
      return true;
    }
  }
  return false;
}

// מילות שם שלא כוסו ע"י השאילתה - ככל שיש פחות, ההתאמה ספציפית יותר.
function scoreName(qTokens, nameTokens, qJoined, nameJoined) {
  if (qJoined === nameJoined) return 100;
  const extra = Math.max(0, nameTokens.length - qTokens.length);
  const wholeWords = qTokens.filter((w) => nameTokens.includes(w)).length;
  let score = 50 + wholeWords * 8 - extra * 6;
  if (nameJoined.startsWith(qJoined)) score += 15;
  return score;
}

/**
 * @param {string} query   הטקסט שזוהה
 * @param {Array<{id:string, chp_number?:string, registrar_name?:string, permit_name?:string}>} rows
 * @returns {{mode:string, total:number, results:Array, ambiguous:boolean}}
 */
export function searchBusinesses(query, rows, limit = MAX_RESULTS) {
  const qTokens = tokens(query);
  if (!qTokens.length) return { mode: 'empty', total: 0, results: [], ambiguous: false };
  const qJoined = qTokens.join(' ');
  const qForms = qTokens.map(wordForms);
  const qSkelForms = qTokens.map((w) => wordForms(skeleton(w)).map(skeleton));

  const prepared = [];
  for (const r of rows) {
    const names = [r.registrar_name, r.permit_name].filter(Boolean);
    const seen = new Set();
    for (const n of names) {
      const nt = tokens(n);
      if (!nt.length) continue;
      const nj = nt.join(' ');
      if (seen.has(nj)) continue;
      seen.add(nj);
      const ns = nt.map(skeleton);
      prepared.push({ row: r, name: n, nt, nj, ns, nsj: ns.join(' ') });
    }
  }

  const collect = (mode, test) => {
    const best = new Map();                       // id -> התוצאה הטובה ביותר של העסק
    for (const p of prepared) {
      if (!test(p)) continue;
      const score = scoreName(qTokens, p.nt, qJoined, p.nj) - (mode === 'near' ? 20 : 0);
      const prev = best.get(p.row.id);
      if (!prev || score > prev.score) best.set(p.row.id, { score, p });
    }
    return [...best.values()].sort((a, b) => b.score - a.score || a.p.nj.length - b.p.nj.length);
  };

  let mode = 'all-words';
  let hits = collect(mode, (p) => qForms.every((f) => wordInName(f, p.nt, p.nj)));
  if (!hits.length) {
    mode = 'near';
    hits = collect(mode, (p) => qSkelForms.every((f) => wordInName(f, p.ns, p.nsj)));
  }

  const results = hits.slice(0, limit).map(({ score, p }) => ({
    id: p.row.id,
    chp_number: p.row.chp_number || '',
    name: p.row.registrar_name || p.row.permit_name || p.name,
    score,
  }));
  // רב-משמעי: יותר מתוצאה אחת והראשונה לא מובילה בבירור
  const ambiguous = results.length > 1 && results[0].score - results[1].score < 10;
  return { mode: hits.length ? mode : 'none', total: hits.length, results, ambiguous };
}
