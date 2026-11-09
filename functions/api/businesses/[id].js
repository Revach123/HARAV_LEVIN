import { checkAdmin } from "../_shared/auth.js";
import { bondFlagFor } from "../company-bonds.js";
import { normalizePcat } from "../_shared/pcat.js";
import { syncBondFlagsFor } from "../_shared/bond-pcat.js";
import { triggerBondsBuild, affectsBondsList } from "../_shared/bonds-build.js";
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

    const oldRow = await env.DB.prepare("SELECT agch_approved, visibility, chp_number, registrar_name, permit_name, notes, notes_scope FROM businesses WHERE id = ?").bind(id).first().catch(() => null);
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
      return Response.json({ error: "העסק כבר לא קיים במאגר (אולי נמחק בינתיים). רעננו את הדף" }, { status: 404 });
    }
    if (body.heb_name !== undefined) {          // שם העסק בעברית (migrations/0023); לפני המיגרציה מתעלמים
      try { await env.DB.prepare("UPDATE businesses SET heb_name = ? WHERE id = ?").bind(String(body.heb_name || "").trim().slice(0, 200), id).run(); }
      catch (e) { if (!/no such column: heb_name/i.test(String(e.message))) throw e; }
    }
    if (body.permits_category !== undefined) {          // קטגוריה עבור רשימת השטרות (migrations/0019); לפני המיגרציה מתעלמים
      try { await env.DB.prepare("UPDATE businesses SET permits_category = ? WHERE id = ?").bind(normalizePcat(body.permits_category), id).run(); }
      catch (e) { if (!/no such column: permits_category/i.test(String(e.message))) throw e; }
    }
    {          // עדכון מיידי של דגל "יש אג"ח" (במקום להמתין לריצה הלילית)
      try { const f = await bondFlagFor(env, chp_number); if (f) await env.DB.prepare("UPDATE businesses SET tase_has_agch = ? WHERE id = ?").bind(f, id).run(); } catch {}
    }
    if (affectsBondsList(oldRow, { agch_approved, visibility, chp_number, registrar_name, permit_name, notes, notes_scope })) await triggerBondsBuild(env, chp_number);          // רשימת האג"ח מתעדכנת מיד (בנייה מהירה)
    await syncBondFlagsFor(request, env, id);          // has_agch_any (יש אג"ח כולל לא סחיר) + הקטגוריה "חברות מנפיקות אג"ח" (_shared/bond-pcat.js)
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
    const oldRow = await env.DB.prepare("SELECT agch_approved, chp_number FROM businesses WHERE id = ?").bind(params.id).first().catch(() => null);
    await env.DB.prepare("DELETE FROM businesses WHERE id=?").bind(params.id).run();
    if (affectsBondsList(oldRow, null)) await triggerBondsBuild(env, oldRow.chp_number);
    return Response.json({ success: true });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
