import { checkAdmin } from "./_shared/auth.js";
import { noAuth, newId } from "./_shared/permit-docs.js";
// חברות שאינן במאגר העסקים (מחוקות / מוזגו / לא במאגר) שמשויכים אליהן מסמכי היתר - מנהל בלבד.
// GET  /api/permit-ext          → { companies: [{ id, chp, name, status, note, doc_ids: [...] }] }
// POST /api/permit-ext          → יצירה { chp?, name, status?, note? }; אם יש כבר חברה עם אותו ח.פ. (או אותו שם בלי ח.פ.) מוחזרת הקיימת (ומתעדכן הסטטוס אם נשלח)
const STATUSES = ["deleted", "merged", "not_in_db"];
const norm = s => String(s || "").trim();

export async function onRequestGet({ request, env }) {
  if (!(await checkAdmin(request, env))) return noAuth();
  try {
    const rows = (await env.DB.prepare("SELECT * FROM permit_ext_companies ORDER BY name").all()).results ?? [];
    const links = (await env.DB.prepare("SELECT doc_id, ext_id FROM permit_doc_ext").all()).results ?? [];
    const by = new Map(rows.map(r => [r.id, []]));
    for (const l of links) if (by.has(l.ext_id)) by.get(l.ext_id).push(l.doc_id);
    return Response.json({ companies: rows.map(r => ({ ...r, doc_ids: by.get(r.id) })) });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}

export async function onRequestPost({ request, env }) {
  if (!(await checkAdmin(request, env))) return noAuth();
  try {
    const b = await request.json();
    const chp = norm(b.chp).replace(/\D/g, ""), name = norm(b.name).slice(0, 300);
    if (!name && !chp) return Response.json({ error: "חסר שם או ח.פ." }, { status: 400 });
    const status = STATUSES.includes(b.status) ? b.status : "not_in_db";
    let row = chp ? await env.DB.prepare("SELECT * FROM permit_ext_companies WHERE chp = ?").bind(chp).first() : await env.DB.prepare("SELECT * FROM permit_ext_companies WHERE chp = '' AND name = ?").bind(name).first();
    if (row) {
      if (b.status && STATUSES.includes(b.status) && b.status !== row.status) await env.DB.prepare("UPDATE permit_ext_companies SET status = ?, updated_at = datetime('now') WHERE id = ?").bind(status, row.id).run();
      row = await env.DB.prepare("SELECT * FROM permit_ext_companies WHERE id = ?").bind(row.id).first();
      return Response.json({ company: { ...row, doc_ids: [] }, existed: true });
    }
    const id = newId();
    await env.DB.prepare("INSERT INTO permit_ext_companies (id, chp, name, status, note) VALUES (?,?,?,?,?)").bind(id, chp, name || chp, status, norm(b.note).slice(0, 500)).run();
    const fresh = await env.DB.prepare("SELECT * FROM permit_ext_companies WHERE id = ?").bind(id).first();
    return Response.json({ company: { ...fresh, doc_ids: [] }, existed: false });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
