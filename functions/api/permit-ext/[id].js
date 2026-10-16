import { checkAdmin } from "../_shared/auth.js";
import { noAuth } from "../_shared/permit-docs.js";
// PUT    /api/permit-ext/:id → עדכון { name?, chp?, status?, note? }
// DELETE /api/permit-ext/:id → מחיקת החברה מהרשימה (המסמכים שלה נשארים, אבל יחזרו להיות לא משויכים אם אין להם שיוך אחר)
const STATUSES = ["deleted", "merged", "not_in_db"];

export async function onRequestPut({ request, env, params }) {
  if (!(await checkAdmin(request, env))) return noAuth();
  try {
    const row = await env.DB.prepare("SELECT * FROM permit_ext_companies WHERE id = ?").bind(params.id).first();
    if (!row) return Response.json({ error: "לא נמצא" }, { status: 404 });
    const b = await request.json();
    const status = b.status !== undefined ? b.status : row.status;
    if (!STATUSES.includes(status)) return Response.json({ error: "סטטוס לא תקין" }, { status: 400 });
    await env.DB.prepare("UPDATE permit_ext_companies SET name = ?, chp = ?, status = ?, note = ?, updated_at = datetime('now') WHERE id = ?")
      .bind(b.name !== undefined ? String(b.name).trim().slice(0, 300) : row.name, b.chp !== undefined ? String(b.chp).replace(/\D/g, "") : row.chp, status, b.note !== undefined ? String(b.note).slice(0, 500) : row.note, params.id).run();
    return Response.json({ company: await env.DB.prepare("SELECT * FROM permit_ext_companies WHERE id = ?").bind(params.id).first() });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}

export async function onRequestDelete({ request, env, params }) {
  if (!(await checkAdmin(request, env))) return noAuth();
  try {
    await env.DB.batch([env.DB.prepare("DELETE FROM permit_doc_ext WHERE ext_id = ?").bind(params.id), env.DB.prepare("DELETE FROM permit_ext_companies WHERE id = ?").bind(params.id)]);
    return Response.json({ success: true });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
