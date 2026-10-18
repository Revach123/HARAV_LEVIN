import { checkAdmin } from "./_shared/auth.js";
import { noAuth } from "./_shared/permit-docs.js";
// מצב בדיקה לפריטים בדשבורד בדיקת מאגר המסמכים - מנהל בלבד.
// GET /api/permit-review                       → { items: [{ key, status, note, updated_at }] }
// PUT /api/permit-review  { key, status, note? }  status: approved | question | answered; status ריק = מחיקת המצב
export async function onRequestGet({ request, env }) {
  if (!(await checkAdmin(request, env))) return noAuth();
  try {
    return Response.json({ items: (await env.DB.prepare("SELECT key, status, note, updated_at FROM permit_review ORDER BY updated_at DESC").all()).results ?? [] });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}

export async function onRequestPut({ request, env }) {
  if (!(await checkAdmin(request, env))) return noAuth();
  try {
    const b = await request.json();
    const key = String(b.key || "").trim().slice(0, 200), status = String(b.status || "");
    if (!key) return Response.json({ error: "חסר מפתח" }, { status: 400 });
    if (!status) { await env.DB.prepare("DELETE FROM permit_review WHERE key = ?").bind(key).run(); return Response.json({ ok: true }); }
    if (!["approved", "question", "answered"].includes(status)) return Response.json({ error: "סטטוס לא חוקי" }, { status: 400 });
    const note = String(b.note || "").slice(0, 500);
    await env.DB.prepare("INSERT INTO permit_review (key, status, note) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET status = excluded.status, note = excluded.note, updated_at = datetime('now')").bind(key, status, note).run();
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
