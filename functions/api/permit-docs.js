import { checkAdmin } from "./_shared/auth.js";
import { TYPES, MAX_BYTES, noAuth, noStore, newId, withBusinesses, existingBusinessIds, hex } from "./_shared/permit-docs.js";
// מאגר מסמכי היתר עסקה - כל הנקודות למנהל בלבד (בשלב זה אין תצוגה ציבורית).
// GET  /api/permit-docs                → כל המסמכים עם החברות המשויכות לכל אחד  { docs: [...] }
// GET  /api/permit-docs?sha=<sha256>   → בדיקת כפילות: { exists: bool, doc }
// POST /api/permit-docs                → העלאה (multipart: file, doc_type, business_ids, note, source, source_ref). קובץ זהה כבר קיים: 409
// קבצים נשמרים ב-R2 (קשירה PERMITS ב-wrangler.toml).

export async function onRequestGet({ request, env }) {
  if (!(await checkAdmin(request, env))) return noAuth();
  try {
    const url = new URL(request.url);
    const sha = (url.searchParams.get("sha") || "").toLowerCase();
    if (sha) {
      const row = await env.DB.prepare("SELECT * FROM permit_docs WHERE sha256 = ?").bind(sha).first();
      const doc = row ? (await withBusinesses(env, [row]))[0] : null;
      return Response.json({ exists: !!row, doc });
    }
    const res = await env.DB.prepare("SELECT * FROM permit_docs ORDER BY created_at DESC, id").all();
    return Response.json({ docs: await withBusinesses(env, res.results ?? []) });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}

export async function onRequestPost({ request, env }) {
  if (!(await checkAdmin(request, env))) return noAuth();
  if (!env.PERMITS) return noStore();
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!file || typeof file === "string") return Response.json({ error: "לא נבחר קובץ" }, { status: 400 });
    if (file.size > MAX_BYTES) return Response.json({ error: "הקובץ גדול מדי (מעל 50MB)" }, { status: 413 });
    const buf = await file.arrayBuffer();
    if (new TextDecoder().decode(buf.slice(0, 5)) !== "%PDF-") return Response.json({ error: "רק קובצי PDF" }, { status: 400 });
    const sha = hex(await crypto.subtle.digest("SHA-256", buf));
    const dup = await env.DB.prepare("SELECT * FROM permit_docs WHERE sha256 = ?").bind(sha).first();
    if (dup) return Response.json({ error: "קובץ זהה כבר קיים במאגר", duplicate: true, doc: (await withBusinesses(env, [dup]))[0] }, { status: 409 });

    const docType = TYPES.includes(form.get("doc_type")) ? form.get("doc_type") : "unknown";
    let bids = [];
    try { bids = JSON.parse(form.get("business_ids") || "[]"); } catch { bids = String(form.get("business_ids") || "").split(",").filter(Boolean); }
    bids = await existingBusinessIds(env, bids);
    const id = newId(), key = `docs/${sha}.pdf`;
    await env.PERMITS.put(key, buf, { httpMetadata: { contentType: "application/pdf" } });
    try {
      await env.DB.batch([
        env.DB.prepare("INSERT INTO permit_docs (id, sha256, file_key, original_name, size, doc_type, note, source, source_ref) VALUES (?,?,?,?,?,?,?,?,?)")
          .bind(id, sha, key, String(file.name || "").slice(0, 300), buf.byteLength, docType, String(form.get("note") || ""), String(form.get("source") || "upload"), String(form.get("source_ref") || "")),
        ...bids.map(b => env.DB.prepare("INSERT OR IGNORE INTO permit_doc_companies (doc_id, business_id) VALUES (?, ?)").bind(id, b)),
      ]);
    } catch (e) {
      await env.PERMITS.delete(key).catch(() => {});      // לא משאירים קובץ יתום
      throw e;
    }
    const row = await env.DB.prepare("SELECT * FROM permit_docs WHERE id = ?").bind(id).first();
    return Response.json({ success: true, doc: (await withBusinesses(env, [row]))[0] });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
