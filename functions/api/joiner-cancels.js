// functions/api/joiner-cancels.js
// בקשות ביטול הצטרפות (טבלה joiner_cancels, נקלטות מ-join-cancel.js). מנהל בלבד.
//   GET    /api/joiner-cancels          → { rows: [{ id, requested_at, matched, name, phone, email, id_number, form_date }] } (חדש ראשון)
//   DELETE /api/joiner-cancels?id=<מזהה> → מחיקת בקשה שטופלה (רק מהאתר עצמו, Origin)
import { checkAdmin } from "./_shared/auth.js";
import { noAuth } from "./_shared/permit-docs.js";
import { importKey, decryptPii } from "./_shared/joiners-crypto.js";
import { originOk } from "./_shared/join-common.js";

const H = { "Cache-Control": "no-store" };
const out = (obj, status = 200) => Response.json(obj, { status, headers: H });

export async function onRequestGet({ request, env }) {
  if (!(await checkAdmin(request, env))) return noAuth();
  let key; try { key = await importKey(env); } catch { return out({ error: "המפתח JOINERS_KEY לא מוגדר באתר" }, 503); }
  try {
    const rs = (await env.DB.prepare("SELECT id, requested_at, matched_joiners, pii FROM joiner_cancels ORDER BY requested_at DESC, id LIMIT 1000").all()).results ?? [];
    const rows = [];
    for (const r of rs) {
      let p = {}; try { p = await decryptPii(key, r.id, r.pii); } catch {}
      rows.push({ id: r.id, requested_at: r.requested_at, matched: r.matched_joiners === "כן", name: p.name || "", phone: p.phone || "", email: p.email || "", id_number: p.id || "", form_date: p.form_date || "", undecryptable: !p.name && !p.phone && !p.email ? 1 : 0 });
    }
    return out({ rows });
  } catch { return out({ error: "שגיאה בקריאת הבקשות" }, 500); }
}

export async function onRequestDelete({ request, env }) {
  if (!(await checkAdmin(request, env))) return noAuth();
  if (!originOk(request)) return out({ error: "הבקשה לא התקבלה (מקור לא מורשה)" }, 403);
  const id = new URL(request.url).searchParams.get("id") || "";
  if (!id) return out({ error: "חסר מזהה" }, 400);
  try {
    const r = await env.DB.prepare("SELECT id FROM joiner_cancels WHERE id = ?").bind(id).first();
    if (!r) return out({ error: "הבקשה לא נמצאה (ייתכן שכבר נמחקה)" }, 404);
    await env.DB.prepare("DELETE FROM joiner_cancels WHERE id = ?").bind(id).run();
    return out({ ok: true });
  } catch { return out({ error: "שגיאה במחיקה" }, 500); }
}
