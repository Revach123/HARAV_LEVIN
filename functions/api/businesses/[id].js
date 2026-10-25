import { checkAdmin } from "../_shared/auth.js";
import { normalizePcat } from "../_shared/pcat.js";
// PUT    /api/businesses/:id   → update (admin only)
// DELETE /api/businesses/:id   → delete (admin only)

const isAuthed = (request, env) => checkAdmin(request, env);

export async function onRequestPut({ request, env, params }) {
  if (!(await isAuthed(request, env))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const id = params.id;
    const body = await request.json();
    const { chp_number, entity_type, registrar_name, permit_name, category, region, notes, notes_scope, visibility, agch_approved, has_details } = body;

    const vals = [
      chp_number     || "",
      entity_type    || "company",
      registrar_name || "",
      permit_name    || "",
      category       || "",
      region         || "",
      notes          || "",
      visibility     || "",
      agch_approved  || "",
      has_details    ? 1 : 0,
    ];
    let result;
    try {
      result = await env.DB.prepare(
        `UPDATE businesses
         SET chp_number=?, entity_type=?, registrar_name=?, permit_name=?, category=?, region=?, notes=?, visibility=?, agch_approved=?, has_details=?,
             notes_scope=?, updated_at=datetime('now')
         WHERE id=?`
      ).bind(...vals, notes_scope || "", id).run();
    } catch (e) {
      if (!/no such column: notes_scope/i.test(String(e.message))) throw e;
      result = await env.DB.prepare(     // העמודה notes_scope עדיין לא נוספה למסד (migrations/0004)
        `UPDATE businesses
         SET chp_number=?, entity_type=?, registrar_name=?, permit_name=?, category=?, region=?, notes=?, visibility=?, agch_approved=?, has_details=?,
             updated_at=datetime('now')
         WHERE id=?`
      ).bind(...vals, id).run();
    }

    if (result.changes === 0) {
      return Response.json({ error: "Business not found" }, { status: 404 });
    }
    if (body.permits_category !== undefined) {          // קטגוריה עבור רשימת השטרות (migrations/0019); לפני המיגרציה מתעלמים
      try { await env.DB.prepare("UPDATE businesses SET permits_category = ? WHERE id = ?").bind(normalizePcat(body.permits_category), id).run(); }
      catch (e) { if (!/no such column: permits_category/i.test(String(e.message))) throw e; }
    }
    return Response.json({ success: true });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}

export async function onRequestDelete({ request, env, params }) {
  if (!(await isAuthed(request, env))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await env.DB.prepare("DELETE FROM businesses WHERE id=?").bind(params.id).run();
    return Response.json({ success: true });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
