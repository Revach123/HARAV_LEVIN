// בדיקה קריאה-בלבד: משווה את רשימת הקרנות הנוכחית באתר (GET /api/glatt-funds) לרשימה המקורית (glatt-funds-seed.js).
// מדווח: שורות מקוריות שחסרות עכשיו, שורות חדשות שנוספו, ושורות של חברה/חיפוש מסוים. נתונים ציבוריים (בלי פרטים אישיים).
// הרצה: node scripts/probe/glatt_funds_diff.mjs [טקסט-לחיפוש]
import { SEED } from '../../functions/api/_shared/glatt-funds-seed.js';
import fs from 'node:fs';
const q = process.argv[2] || 'הראל';
const norm = s => String(s ?? '').replace(/\s+/g, ' ').trim();
const key = r => [r.company, r.track, r.number].map(norm).join('|');
const res = await fetch('https://harav-levin.pages.dev/api/glatt-funds', { headers: { 'User-Agent': 'Mozilla/5.0' } });
if (!res.ok) { console.error('HTTP', res.status); process.exit(1); }
const cur = await res.json();
const curKeys = new Map(); for (const r of cur.rows) { const k = key(r); (curKeys.get(k) || curKeys.set(k, []).get(k)).push(r); }
const seedKeys = new Set(SEED.map(key));
const missing = SEED.filter(r => !curKeys.has(key(r)));
const added = cur.rows.filter(r => !seedKeys.has(key(r)));
const typeChanged = SEED.filter(r => curKeys.has(key(r)) && !curKeys.get(key(r)).some(x => norm(x.type) === norm(r.type)));
const hit = r => (norm(r.company) + ' ' + norm(r.track)).includes(q);
const out = {
  when: new Date().toISOString(), saved_at: cur.saved_at, updated: cur.updated, current_rows: cur.rows.length, seed_rows: SEED.length,
  missing_from_current: missing.map(r => ({ company: r.company, track: r.track, type: r.type, number: r.number })),
  added_vs_seed: added.map(r => ({ company: r.company, track: r.track, type: r.type, number: r.number, tab: r.tab })),
  type_changed: typeChanged.map(r => ({ company: r.company, track: r.track, seed_type: r.type, now: curKeys.get(key(r)).map(x => x.type) })),
  search: q, search_current: cur.rows.filter(hit).map(r => ({ company: r.company, track: r.track, type: r.type, number: r.number, tab: r.tab })),
  search_seed: SEED.filter(hit).map(r => ({ company: r.company, track: r.track, type: r.type, number: r.number })),
};
fs.mkdirSync('data/probe', { recursive: true });
fs.writeFileSync('data/probe/glatt_funds_diff.json', JSON.stringify(out, null, 1));
console.log(JSON.stringify({ saved_at: out.saved_at, current: out.current_rows, seed: out.seed_rows, missing: out.missing_from_current.length, added: out.added_vs_seed.length, type_changed: out.type_changed.length }));
