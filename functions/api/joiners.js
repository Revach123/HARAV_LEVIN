import { checkAdmin } from "./_shared/auth.js";
import { noAuth } from "./_shared/permit-docs.js";
import { importKey, decryptPii } from "./_shared/joiners-crypto.js";
// רשימת המצטרפים - מנהל בלבד, קריאה בלבד. הפרטים האישיים מוצפנים ב-D1 (AES-256-GCM) ומפוענחים כאן בלבד; לעולם לא נרשמים ללוג.
// GET /api/joiners?offset=0&limit=400      → { total, cancels, rows: [{ id, submitted_at, cancelled_at, file_sha256, ident_hash, first, last, phone, email, id_number, ip, companies, all, extra }] }
// GET /api/joiners?file=<sha256>           → קובץ אישור ההצטרפות (PDF) מהדלי הפרטי (רק קובץ שרשום ב-joiner_files)
const H = { "Cache-Control": "no-store" };
export async function onRequestGet({ request, env }) {
  if (!(await checkAdmin(request, env))) return noAuth();
  const u = new URL(request.url);
  try {
    const sha = u.searchParams.get("file");
    if (sha) {
      if (!/^[0-9a-f]{64}$/.test(sha)) return Response.json({ error: "מזהה קובץ לא תקין" }, { status: 400, headers: H });
      if (!env.JOINERS) return Response.json({ error: "הדלי של המצטרפים לא מחובר" }, { status: 503, headers: H });
      const row = await env.DB.prepare("SELECT r2_key FROM joiner_files WHERE sha256 = ?").bind(sha).first();
      const obj = row ? await env.JOINERS.get(row.r2_key) : null;
      if (!obj) return Response.json({ error: "הקובץ לא נמצא (ייתכן שעדיין לא הועלה ל-R2)" }, { status: 404, headers: H });
      return new Response(obj.body, { headers: { "Content-Type": "application/pdf", "Content-Disposition": "inline", ...H } });
    }
    const offset = Math.max(0, parseInt(u.searchParams.get("offset") || "0", 10) || 0), limit = Math.min(500, Math.max(1, parseInt(u.searchParams.get("limit") || "400", 10) || 400));
    let key;
    try { key = await importKey(env); } catch { return Response.json({ error: "המפתח JOINERS_KEY לא מוגדר באתר" }, { status: 503, headers: H }); }
    const total = (await env.DB.prepare("SELECT COUNT(*) AS n FROM joiners").first()).n;
    const cancels = (await env.DB.prepare("SELECT COUNT(*) AS n FROM joiner_cancels").first()).n;
    const rs = (await env.DB.prepare("SELECT id, submitted_at, cancelled_at, file_sha256, ident_hash, pii FROM joiners ORDER BY submitted_at DESC, id LIMIT ? OFFSET ?").bind(limit, offset).all()).results ?? [];
    const rows = [];
    let bad = 0;
    for (const r of rs) {
      let p = {};
      try { p = await decryptPii(key, r.id, r.pii); } catch { bad++; }
      rows.push({ id: r.id, submitted_at: r.submitted_at, cancelled_at: r.cancelled_at, file_sha256: r.file_sha256, ident_hash: r.ident_hash,
        first: p.first || "", last: p.last || "", phone: p.phone || "", email: p.email || "", id_number: p.id || "", ip: p.ip || "", companies: p.companies || "", all: p.all || "", extra: p.extra || "", undecryptable: !p.first && !p.last && !p.email && !p.phone ? 1 : 0 });
    }
    if (rs.length && bad === rs.length) return Response.json({ error: "הפענוח נכשל: JOINERS_KEY באתר אינו תואם למפתח שבו הוצפנה הרשימה" }, { status: 500, headers: H });
    return Response.json({ total, cancels, rows }, { headers: H });
  } catch (e) {
    return Response.json({ error: "שגיאה בקריאת הרשימה" }, { status: 500, headers: H });
  }
}
