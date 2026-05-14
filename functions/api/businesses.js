// GET  /api/businesses        → list all (public)
// POST /api/businesses        → create new (admin only)

function isAuthed(request, env) {
  const auth = request.headers.get("Authorization") || "";
  return auth.replace("Bearer ", "").trim() === env.ADMIN_PASSWORD;
}

export async function onRequestGet({ env }) {
  try {
    const result = await env.DB
      .prepare("SELECT * FROM businesses ORDER BY registrar_name, permit_name COLLATE NOCASE")
      .all();
    return Response.json(result.results ?? []);
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}

export async function onRequestPost({ request, env }) {
  if (!isAuthed(request, env)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { id, chp_number, entity_type, registrar_name, permit_name, category, region, notes, visibility, agch_approved, has_details } = body;

    if (!id) return Response.json({ error: "Missing id" }, { status: 400 });
    if (!registrar_name && !permit_name) {
      return Response.json({ error: "At least one name is required" }, { status: 400 });
    }

    await env.DB.prepare(
      `INSERT INTO businesses (id, chp_number, entity_type, registrar_name, permit_name, category, region, notes, visibility, agch_approved, has_details)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id,
      chp_number     || "",
      entity_type    || "company",
      registrar_name || "",
      permit_name    || "",
      category       || "",
      region         || "",
      notes          || "",
      visibility     || "",
      agch_approved  || "",
      has_details    ? 1 : 0
    ).run();

    return Response.json({ success: true });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
