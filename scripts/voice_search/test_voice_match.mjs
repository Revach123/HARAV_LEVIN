// בדיקת חיפוש הדיבור על שמות העסקים האמיתיים, עם שגיאות זיהוי מדומות.
// הרצה: node scripts/voice_search/test_voice_match.mjs
import { readFileSync } from 'node:fs';
import { searchBusinesses, tokens } from '../../functions/api/_shared/voice-match.js';

function parseCsv(text) {
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n') { row.push(cur.replace(/\r$/, '')); rows.push(row); row = []; cur = ''; }
    else cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

const csv = readFileSync(new URL('../../reports/heteriske_audit/heteriske_businesses_with_chp.csv', import.meta.url), 'utf8').replace(/^﻿/, '');
const [head, ...data] = parseCsv(csv);
const col = (n) => head.indexOf(n);
const rows = data.filter((r) => r[col('name')]).map((r) => ({
  id: r[col('code')], chp_number: r[col('chp_number')], registrar_name: r[col('name')], permit_name: '',
}));
console.log(`עסקים: ${rows.length}`);

const stripSuffix = (n) => n.replace(/\s*בע["״]?מ\s*$/, '');
const SWAPS = [['ק', 'כ'], ['כ', 'ק'], ['ט', 'ת'], ['ת', 'ט'], ['ס', 'ש'], ['ח', 'כ'], ['ע', 'א']];
const variants = {
  exact:      (n) => n,
  noSuffix:   (n) => n.replace(/\s*בע["״]?מ\s*$/, ''),
  swapLetter: (n) => { const base = stripSuffix(n); for (const [a, b] of SWAPS) if (base.includes(a)) return base.replace(a, b); return null; },
  dropVowel:  (n) => { const base = stripSuffix(n); const m = base.replace(/[וי]/, ''); return m !== base ? m : null; },
  prefixHe:   (n) => 'ה' + n.replace(/\s*בע["״]?מ\s*$/, ''),
  firstWords: (n) => { const t = n.replace(/\s*בע["״]?מ\s*$/, '').split(/\s+/); return t.length >= 3 ? t.slice(0, 2).join(' ') : null; },
};

let failed = 0;
for (const [name, fn] of Object.entries(variants)) {
  let n = 0, top1 = 0, top5 = 0, sumTotal = 0, maxTotal = 0, noRes = 0;
  for (const r of rows) {
    // שמות שהמילה הראשונה בהם היא אות בודדת/ראשי תיבות עם נקודות אינם ניתנים להקלטה כמות שהם
    if (tokens(r.registrar_name).length === 0 || tokens(r.registrar_name)[0].length < 3) continue;
    const q = fn(r.registrar_name);
    if (!q) continue;
    n++;
    const res = searchBusinesses(q, rows);
    sumTotal += res.total; maxTotal = Math.max(maxTotal, res.total);
    if (!res.total) noRes++;
    if (res.results[0]?.id === r.id) top1++;
    if (res.results.some((x) => x.id === r.id)) top5++;
  }
  console.log(`${name.padEnd(11)} n=${String(n).padEnd(5)} top1=${(100 * top1 / n).toFixed(1)}% top5=${(100 * top5 / n).toFixed(1)}% ללא תוצאה=${noRes} ממוצע תוצאות=${(sumTotal / n).toFixed(1)} מקס=${maxTotal}`);
  if (name === 'exact' && top1 / n < 0.97) failed++;
}

// דוגמאות ידניות
for (const q of ['בנק לאומי', 'הבנק לאומי', 'אגוז הנפקות', 'בנק']) {
  const r = searchBusinesses(q, rows);
  console.log(`\n"${q}" -> ${r.mode}, total=${r.total}, ambiguous=${r.ambiguous}`);
  r.results.forEach((x) => console.log(`  ${x.score}  ${x.chp_number}  ${x.name}`));
}
console.log('\ntokens:', tokens('הבנק הלאומי לישראל בע"מ'));
process.exit(failed ? 1 : 0);
