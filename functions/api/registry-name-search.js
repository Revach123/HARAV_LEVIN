import { checkAdmin } from "./_shared/auth.js";
// GET /api/registry-name-search?q=<שם חברה או מספר>   (מנהל בלבד)
// חיפוש שם בכל מאגר הרישום (חברות / שותפויות / עמותות) דרך ה-D1 השני (DB1 = company-info-db), באינדקס FTS5 trigram
// (companies_fts וכו') - שאילתה אחת (D1 batch), בלי וריאנטים של זיהוי דיבור.
// ⚠ נרמול: גרסה B של revach (גרש/מקף -> רווח), כי עמודת name_norm והאינדקס נבנו כך (ראו revach functions/api/search.js).
// הנרמול של שלוחת הטלפון (voice-match, מוחק מקפים) לא מתאים: "פוקס-ויזל" הופך שם למילה אחת ולא נמצא.

import { typeLabel } from './_shared/registry-search.js';

const DEFUNCT = /מחוק|נמחק|מבוטל|פירוק|מפורק|מחוסל|חוסל|חיסול/;
const PER_TABLE = 25;
const SUB = { companies: "corp_type", partnerships: "ptype", associations: "category" };
const KINDS = { companies: "company", partnerships: "partnership", associations: "association" };

const isAuthed = (request, env) => checkAdmin(request, env);
function normB(s) {
  s = String(s || "").replace(/~/g, '"').replace(/\([^)]*\)/g, " ").replace(/[^א-ת0-9A-Za-z ]/g, " ");
  return s.replace(/\s+/g, " ").trim();
}
const ftsPhrase = (w) => `"${w.replace(/"/g, '""')}"`;
// דירוג לפי דמיון לשם שהוקלד: זהה (בלי "בע"מ") > מתחיל בו > מכיל אותו כמילים שלמות > מכיל > כל המילים > השאר; ואז הפרש אורך
const core = s => (" " + normB(s) + " ").replace(/ בע מ /g, " ").replace(/\s+/g, " ").trim();
function similarity(q, name) {
  const a = core(q), b = core(name);
  if (!a || !b) return 9;
  if (b === a) return 0;
  if (b.startsWith(a + " ") || b.startsWith(a)) return 1;
  if ((" " + b + " ").includes(" " + a + " ")) return 2;
  if (b.includes(a)) return 3;
  return a.split(" ").every(w => b.includes(w)) ? 4 : 5;
}

export async function onRequestGet({ request, env }) {
  const t0 = Date.now();
  if (!(await isAuthed(request, env))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!env.DB1) return Response.json({ error: "DB1 (company-info-db) לא מחובר לפרויקט" }, { status: 503 });
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").trim();
  if (q.length < 3) return Response.json({ results: [] });
  try {
    const db = env.DB1, tables = Object.keys(SUB);
    let stmts;
    if (/^\d+$/.test(q)) {                                   // תחילת מספר תאגיד: טווח על המפתח המספרי (אינדקס) - לא LIKE (סריקה מלאה)
      const k = Math.min(q.length, 9), lo = Number(q.slice(0, k)) * 10 ** (9 - k), hi = (Number(q.slice(0, k)) + 1) * 10 ** (9 - k);
      stmts = tables.map(t => db.prepare(`SELECT id,name,status,${SUB[t]} AS sub FROM ${t} WHERE id >= ? AND id < ? ORDER BY id LIMIT ${PER_TABLE}`).bind(lo, hi));
    } else {
      const words = normB(q).split(" ").filter(Boolean);
      const long = words.filter(w => w.length >= 3), short = words.filter(w => w.length < 3);
      if (!long.length) return Response.json({ results: [], hint: "הקלד לפחות מילה אחת של 3 אותיות" });
      const expr = long.map(ftsPhrase).join(" AND ");
      const like = short.map(() => " AND c.name_norm LIKE ?").join("");
      stmts = tables.map(t => db.prepare(
        `SELECT DISTINCT c.id,c.name,c.status,c.${SUB[t]} AS sub FROM ${t}_fts f JOIN ${t} c ON c.id=f.id WHERE ${t}_fts MATCH ?${like} LIMIT ${PER_TABLE * 4}`
      ).bind(expr, ...short.map(w => `%${w}%`)));
      const phrase = normB(q);          // כל הביטוי כרצף אחד (trigram = חיפוש תת-מחרוזת): השם המדויק נכלל גם כשיש הרבה התאמות למילה בודדת
      if (words.length > 1 && phrase.length >= 3) stmts.push(...tables.map(t => db.prepare(
        `SELECT DISTINCT c.id,c.name,c.status,c.${SUB[t]} AS sub FROM ${t}_fts f JOIN ${t} c ON c.id=f.id WHERE ${t}_fts MATCH ? LIMIT ${PER_TABLE}`
      ).bind(ftsPhrase(phrase))));
    }
    // שלוש שאילתות במקביל; כשל באחת (למשל טבלה/אינדקס חסרים) לא מפיל את האחרות - השגיאה מוחזרת ב-errors
    const out = await Promise.allSettled(stmts.map(st => st.all()));
    const rows = [], errors = [];
    out.forEach((res, i) => {
      const t = tables[i % tables.length];
      if (res.status === "fulfilled") (res.value.results || []).forEach(r => rows.push({ kind: KINDS[t], ...r }));
      else errors.push(`${t}: ${String(res.reason && res.reason.message || res.reason)}`);
    });
    if (out.slice(0, tables.length).every(r => r.status !== "fulfilled")) return Response.json({ error: errors.join(" | ") }, { status: 500 });
    const seen = new Set();          // אותו תאגיד לא יופיע פעמיים (שורות כפולות באינדקס החיפוש)
    const results = rows
      .filter(r => { const k = r.kind + ":" + r.id; if (seen.has(k)) return false; seen.add(k); return true; })
      .map(r => ({ id: String(r.id), name: r.name, kind: r.kind, type: typeLabel(r), status: r.status || "", defunct: DEFUNCT.test(r.status || ""), _s: /^\d+$/.test(q) ? 0 : similarity(q, r.name) }))
      .sort((a, b) => (a._s - b._s) || (a.defunct - b.defunct) || (core(a.name).length - core(b.name).length) || (a.name || "").localeCompare(b.name || "", "he"))
      .map(({ _s, ...r }) => r)
      .slice(0, 20);
    return Response.json({ results, more: rows.length > 20, errors, ms: Date.now() - t0 });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
