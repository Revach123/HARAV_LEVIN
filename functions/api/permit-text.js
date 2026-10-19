import { checkAdmin } from "./_shared/auth.js";
import { noAuth } from "./_shared/permit-docs.js";
// חיפוש בטקסט המסמכים ובמספרי תאגיד / שמות שנמצאו בהם - מנהל בלבד, קריאה בלבד.
// GET /api/permit-text?q=ביטוי          → { results: [{ id, name, page, snippet }] }  (FTS; אחרת LIKE)
// GET /api/permit-text?hp=513429035     → { docs: [{ id, name, n, src, status }] }
// GET /api/permit-text?hints=1          → { hp: [{ id, hp, src, n }] }  כל ה-ח.פ. שנמצאו, לכל מסמך (להצעות שיוך)
// GET /api/permit-text?names=1          → { names: [{ id, name, src }] }  שמות שנמצאו במסמכים (טקסט / חותמת / כתב יד), להצעות שיוך לפי שם
const norm = s => String(s || "").replace(/["'`״׳]/g, "").replace(/\s+/g, " ").trim();
export async function onRequestGet({ request, env }) {
  if (!(await checkAdmin(request, env))) return noAuth();
  const u = new URL(request.url);
  try {
    if (u.searchParams.get("names")) {
      const r = await env.DB.prepare("SELECT d.id AS id, n.name AS name, n.src AS src FROM permit_doc_name n JOIN permit_docs d ON d.sha256 = n.sha256 WHERE length(n.name) BETWEEN 4 AND 90").all();
      return Response.json({ names: r.results ?? [] });
    }
    if (u.searchParams.get("hints")) {
      const r = await env.DB.prepare("SELECT d.id AS id, h.hp AS hp, h.src AS src, h.n AS n FROM permit_doc_hp h JOIN permit_docs d ON d.sha256 = h.sha256").all();
      return Response.json({ hp: r.results ?? [] });
    }
    const hp = (u.searchParams.get("hp") || "").replace(/\D/g, "");
    if (hp) {
      const r = await env.DB.prepare("SELECT d.id AS id, d.original_name AS name, h.n AS n, h.src AS src, h.status AS status FROM permit_doc_hp h JOIN permit_docs d ON d.sha256 = h.sha256 WHERE h.hp = ? ORDER BY h.n DESC LIMIT 100").bind(hp).all();
      return Response.json({ docs: r.results ?? [] });
    }
    const q = norm(u.searchParams.get("q"));
    if (q.length < 2) return Response.json({ results: [] });
    let rows;
    if (q.length >= 3) {
      try {
        rows = (await env.DB.prepare("SELECT d.id AS id, d.original_name AS name, f.page AS page, snippet(permit_doc_fts, 0, '[', ']', '…', 14) AS snippet FROM permit_doc_fts f JOIN permit_docs d ON d.sha256 = f.sha256 WHERE permit_doc_fts MATCH ? LIMIT 60")
          .bind('"' + q.replace(/"/g, '""') + '"').all()).results;
      } catch { rows = null; }      // אין עדיין אינדקס FTS (מיגרציה 0016)
    }
    if (!rows) {
      const like = "%" + q.replace(/[%_\\]/g, m => "\\" + m) + "%";
      rows = (await env.DB.prepare("SELECT d.id AS id, d.original_name AS name, p.page AS page, substr(p.text, max(1, instr(p.text, ?) - 40), 120) AS snippet FROM permit_doc_page p JOIN permit_docs d ON d.sha256 = p.sha256 WHERE p.text LIKE ? ESCAPE '\\' LIMIT 60").bind(q, like).all()).results;
    }
    return Response.json({ results: rows ?? [] });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
