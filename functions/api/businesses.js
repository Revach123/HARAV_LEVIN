import { checkAdmin } from "./_shared/auth.js";
import { bondFlagFor } from "./company-bonds.js";
import { normalizePcat } from "./_shared/pcat.js";
import { applyBondPcatRows, syncBondFlagsFor } from "./_shared/bond-pcat.js";
// GET  /api/businesses        → list all (public)
// POST /api/businesses        → create new (admin only)

const isAuthed = (request, env) => checkAdmin(request, env);

export async function onRequestGet({ env }) {
  try {
    const result = await env.DB
      .prepare("SELECT * FROM businesses ORDER BY registrar_name, permit_name COLLATE NOCASE")
      .all();
    // "חברות מנפיקות אג"ח" בקטגוריה לרשימת השטרות: לפי has_agch_any - יש אג"ח כולל לא סחיר (ר' _shared/bond-pcat.js)
    return Response.json(applyBondPcatRows(result.results ?? []));
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}

export async function onRequestPost({ request, env }) {
  if (!(await isAuthed(request, env))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { id, chp_number, entity_type, registrar_name, permit_name, category, region, notes, notes_scope, visibility, agch_approved, has_details } = body;

    if (!id) return Response.json({ error: "Missing id" }, { status: 400 });
    if (!registrar_name && !permit_name) {
      return Response.json({ error: "At least one name is required" }, { status: 400 });
    }

    const vals = [
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
      has_details    ? 1 : 0,
    ];
    try {
      await env.DB.prepare(
        `INSERT INTO businesses (id, chp_number, entity_type, registrar_name, permit_name, category, region, notes, visibility, agch_approved, has_details, notes_scope)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(...vals, notes_scope || "").run();
    } catch (e) {
      if (!/no such column: notes_scope|has no column named notes_scope/i.test(String(e.message))) throw e;
      await env.DB.prepare(     // העמודה notes_scope עדיין לא נוספה למסד (migrations/0004)
        `INSERT INTO businesses (id, chp_number, entity_type, registrar_name, permit_name, category, region, notes, visibility, agch_approved, has_details)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(...vals).run();
    }

    if (body.issuer_id) {
      try { await env.DB.prepare("UPDATE businesses SET issuer_id = ? WHERE id = ?").bind(String(body.issuer_id).replace(/\D/g, "").slice(0, 12), id).run(); }
      catch (e) { if (!/no such column: issuer_id/i.test(String(e.message))) throw e; }
    }
    if (body.heb_name) {
      try { await env.DB.prepare("UPDATE businesses SET heb_name = ? WHERE id = ?").bind(String(body.heb_name).trim().slice(0, 200), id).run(); }
      catch (e) { if (!/no such column: heb_name/i.test(String(e.message))) throw e; }
    }
    {          // קטגוריה עבור רשימת השטרות (migrations/0019); עסק חדש בלי קטגוריה נכנס אוטומטית ל"שונות" (או "עיריות"); לפני המיגרציה מתעלמים
      try { await env.DB.prepare("UPDATE businesses SET permits_category = ? WHERE id = ?").bind(normalizePcat(body.permits_category), id).run(); }
      catch (e) { if (!/no such column: permits_category/i.test(String(e.message))) throw e; }
    }
    {          // דגל "יש אג"ח" מיידי (במקום לחכות לריצה הלילית); אם אי אפשר לבדוק נשאר ריק
      try { const f = await bondFlagFor(env, chp_number); if (f) await env.DB.prepare("UPDATE businesses SET tase_has_agch = ? WHERE id = ?").bind(f, id).run(); } catch {}
    }
    await syncBondFlagsFor(request, env, id);          // has_agch_any (יש אג"ח כולל לא סחיר) + הקטגוריה "חברות מנפיקות אג"ח" (_shared/bond-pcat.js)
    return Response.json({ success: true });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
