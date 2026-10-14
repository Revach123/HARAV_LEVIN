// GET /api/registry-name-search?q=<שם חברה>   (מנהל בלבד)
// חיפוש שם בכל מאגר הרישום (חברות / שותפויות / עמותות) דרך ה-D1 השני (DB1 = company-info-db, אינדקס FTS5 trigram),
// כדי למצוא ח.פ. לפי שם בטופס הוספת עסק. אותה שליפה כמו שלוחת הטלפון (_shared/registry-search.js).

import { registryCandidates, typeLabel } from './_shared/registry-search.js';

const DEFUNCT = /מחוק|נמחק|מבוטל|פירוק|מפורק|מחוסל|חוסל|חיסול/;

function isAuthed(request, env) {
  const auth = request.headers.get("Authorization") || "";
  return auth.replace("Bearer ", "").trim() === env.ADMIN_PASSWORD;
}

export async function onRequestGet({ request, env }) {
  if (!isAuthed(request, env)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!env.DB1) return Response.json({ error: "DB1 (company-info-db) לא מחובר לפרויקט" }, { status: 503 });
  const q = (new URL(request.url).searchParams.get("q") || "").trim();
  if (q.length < 3) return Response.json({ results: [] });
  try {
    const { rows, truncated } = await registryCandidates(env.DB1, q);
    const results = rows
      .map(r => ({ id: r.id, name: r.name, kind: r.kind, type: typeLabel(r), status: r.status || "", defunct: DEFUNCT.test(r.status || "") }))
      .sort((a, b) => (a.defunct - b.defunct) || a.name.localeCompare(b.name, "he"))
      .slice(0, 20);
    return Response.json({ results, more: truncated || rows.length > 20 });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
