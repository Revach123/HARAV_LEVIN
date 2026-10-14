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

function isAuthed(request, env) {
  const auth = request.headers.get("Authorization") || "";
  return auth.replace("Bearer ", "").trim() === env.ADMIN_PASSWORD;
}
function normB(s) {
  s = String(s || "").replace(/~/g, '"').replace(/\([^)]*\)/g, " ").replace(/[^א-ת0-9A-Za-z ]/g, " ");
  return s.replace(/\s+/g, " ").trim();
}
const ftsPhrase = (w) => `"${w.replace(/"/g, '""')}"`;

export async function onRequestGet({ request, env }) {
  const t0 = Date.now();
  if (!isAuthed(request, env)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!env.DB1) return Response.json({ error: "DB1 (company-info-db) לא מחובר לפרויקט" }, { status: 503 });
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").trim();
  if (q.length < 3) return Response.json({ results: [] });
  try {
    const db = env.DB1, tables = Object.keys(SUB);
    let stmts;
    if (/^\d+$/.test(q)) {                                   // מספר: התחלה של מספר התאגיד
      stmts = tables.map(t => db.prepare(`SELECT id,name,status,${SUB[t]} AS sub FROM ${t} WHERE id LIKE ? LIMIT ${PER_TABLE}`).bind(q + "%"));
    } else {
      const words = normB(q).split(" ").filter(Boolean);
      const long = words.filter(w => w.length >= 3), short = words.filter(w => w.length < 3);
      if (!long.length) return Response.json({ results: [], hint: "הקלד לפחות מילה אחת של 3 אותיות" });
      const expr = long.map(ftsPhrase).join(" AND ");
      const like = short.map(() => " AND c.name_norm LIKE ?").join("");
      stmts = tables.map(t => db.prepare(
        `SELECT c.id,c.name,c.status,c.${SUB[t]} AS sub FROM ${t}_fts f JOIN ${t} c ON c.id=f.id WHERE ${t}_fts MATCH ?${like} LIMIT ${PER_TABLE}`
      ).bind(expr, ...short.map(w => `%${w}%`)));
    }
    // שלוש שאילתות במקביל; כשל באחת (למשל טבלה/אינדקס חסרים) לא מפיל את האחרות - השגיאה מוחזרת ב-errors
    const out = await Promise.allSettled(stmts.map(st => st.all()));
    const rows = [], errors = [];
    out.forEach((res, i) => {
      if (res.status === "fulfilled") (res.value.results || []).forEach(r => rows.push({ kind: KINDS[tables[i]], ...r }));
      else errors.push(`${tables[i]}: ${String(res.reason && res.reason.message || res.reason)}`);
    });
    if (errors.length === tables.length) return Response.json({ error: errors.join(" | ") }, { status: 500 });
    const results = rows
      .map(r => ({ id: String(r.id), name: r.name, kind: r.kind, type: typeLabel(r), status: r.status || "", defunct: DEFUNCT.test(r.status || "") }))
      .sort((a, b) => (a.defunct - b.defunct) || (a.name || "").localeCompare(b.name || "", "he"))
      .slice(0, 20);
    return Response.json({ results, more: rows.length > 20, errors, ms: Date.now() - t0 });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
