// PUT    /api/businesses/:id   → update (admin only)
// DELETE /api/businesses/:id   → delete (admin only)

function isAuthed(request, env) {
  const auth = request.headers.get("Authorization") || "";
  return auth.replace("Bearer ", "").trim() === env.ADMIN_PASSWORD;
}

export async function onRequestPut({ request, env, params }) {
  if (!isAuthed(request, env)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const id = params.id;
    const body = await request.json();
    const { chp_number, entity_type, registrar_name, permit_name, category, region, notes, visibility, agch_approved, has_details } = body;

    const result = await env.DB.prepare(
      `UPDATE businesses
       SET chp_number=?, entity_type=?, registrar_name=?, permit_name=?, category=?, region=?, notes=?, visibility=?, agch_approved=?, has_details=?,
           updated_at=datetime('now')
       WHERE id=?`
    ).bind(
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
      id
    ).run();

    if (result.changes === 0) {
      return Response.json({ error: "Business not found" }, { status: 404 });
    }
    return Response.json({ success: true });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}

export async function onRequestDelete({ request, env, params }) {
  if (!isAuthed(request, env)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await env.DB.prepare("DELETE FROM businesses WHERE id=?").bind(params.id).run();
    return Response.json({ success: true });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
