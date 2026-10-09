// GET /api/voice-search?q=<טקסט שזוהה מדיבור>
// POST /api/voice-search  {"q": "..."}
//
// חיפוש עסק לפי שם שזוהה בדיבור. אותה שיטה כמו חיפוש החברות באתר, עם
// סובלנות מצומצמת לשגיאות זיהוי - ראו _shared/voice-match.js.
// מחזיר עד 5 תוצאות: {mode, total, ambiguous, results:[{id, chp_number, name, score}]}

import { searchBusinesses } from './_shared/voice-match.js';

const CACHE_MS = 60 * 1000;
let cache = { at: 0, rows: null };

async function loadRows(env) {
  if (cache.rows && Date.now() - cache.at < CACHE_MS) return cache.rows;
  const res = await env.DB
    .prepare("SELECT id, chp_number, registrar_name, permit_name FROM businesses")
    .all();
  cache = { at: Date.now(), rows: res.results ?? [] };
  return cache.rows;
}

export async function onRequest({ request, env }) {
  try {
    let q = new URL(request.url).searchParams.get("q");
    if (q === null && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      q = typeof body.q === "string" ? body.q : "";
    }
    q = (q || "").trim().slice(0, 200);
    if (q.length < 2) return Response.json({ mode: "empty", total: 0, ambiguous: false, results: [] });

    return Response.json({ query: q, ...searchBusinesses(q, await loadRows(env)) });
  } catch (e) {
    return Response.json({ error: e.message, results: [] }, { status: 500 });
  }
}
