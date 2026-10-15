import { checkAdmin } from "../_shared/auth.js";
import { TYPES, noAuth, withBusinesses, existingBusinessIds } from "../_shared/permit-docs.js";
// GET    /api/permit-docs/:id   → מסמך אחד
// PUT    /api/permit-docs/:id   → עדכון { doc_type?, business_ids? (החלפה מלאה של השיוכים), note? }
// DELETE /api/permit-docs/:id   → מחיקה מלאה של המסמך (השיוכים והקובץ)

export async function onRequestGet({ request, env, params }) {
  if (!(await checkAdmin(request, env))) return noAuth();
  try {
    const row = await env.DB.prepare("SELECT * FROM permit_docs WHERE id = ?").bind(params.id).first();
    if (!row) return Response.json({ error: "לא נמצא" }, { status: 404 });
    return Response.json({ doc: (await withBusinesses(env, [row]))[0] });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}

export async function onRequestPut({ request, env, params }) {
  if (!(await checkAdmin(request, env))) return noAuth();
  try {
    const row = await env.DB.prepare("SELECT * FROM permit_docs WHERE id = ?").bind(params.id).first();
    if (!row) return Response.json({ error: "לא נמצא" }, { status: 404 });
    const body = await request.json();
    const stmts = [];
    const docType = body.doc_type !== undefined ? body.doc_type : row.doc_type;
    if (!TYPES.includes(docType)) return Response.json({ error: "סיווג לא תקין" }, { status: 400 });
    const note = body.note !== undefined ? String(body.note) : row.note;
    stmts.push(env.DB.prepare("UPDATE permit_docs SET doc_type=?, note=?, updated_at=datetime('now') WHERE id=?").bind(docType, note, params.id));
    if (Array.isArray(body.business_ids)) {
      const ids = await existingBusinessIds(env, body.business_ids);
      stmts.push(env.DB.prepare("DELETE FROM permit_doc_companies WHERE doc_id = ?").bind(params.id));
      for (const b of ids) stmts.push(env.DB.prepare("INSERT OR IGNORE INTO permit_doc_companies (doc_id, business_id) VALUES (?, ?)").bind(params.id, b));
    }
    await env.DB.batch(stmts);
    const fresh = await env.DB.prepare("SELECT * FROM permit_docs WHERE id = ?").bind(params.id).first();
    return Response.json({ success: true, doc: (await withBusinesses(env, [fresh]))[0] });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}

export async function onRequestDelete({ request, env, params }) {
  if (!(await checkAdmin(request, env))) return noAuth();
  try {
    const row = await env.DB.prepare("SELECT * FROM permit_docs WHERE id = ?").bind(params.id).first();
    if (!row) return Response.json({ error: "לא נמצא" }, { status: 404 });
    await env.DB.batch([
      env.DB.prepare("DELETE FROM permit_doc_companies WHERE doc_id = ?").bind(params.id),
      env.DB.prepare("DELETE FROM permit_docs WHERE id = ?").bind(params.id),
    ]);
    if (env.PERMITS) await env.PERMITS.delete(row.file_key).catch(() => {});
    return Response.json({ success: true });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
