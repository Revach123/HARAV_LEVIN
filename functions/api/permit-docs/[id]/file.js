import { checkAdmin } from "../../_shared/auth.js";
import { noAuth, noStore, hex } from "../../_shared/permit-docs.js";
// GET /api/permit-docs/:id/file → קובץ ה-PDF (למנהל בלבד); ?enc=b64 → { name, data (base64), lite, sha }
// ?lite=1 → לצפייה: הגרסה הקלה (docs-lite/, נבנית ע"י scripts/compress_permit_pdfs.py - אותם עמודים ואותה שכבת טקסט) אם קיימת, אחרת המקור.
//   כשמוגשת הגרסה הקלה: כותרת X-Pdf-Lite: 1, ו-X-Sha256 של הקובץ שנשלח (לבדיקה בדפדפן שהקובץ לא שונה בדרך, כמו מול sha256 של המקור).
// הקובץ של מסמך לעולם אינו משתנה (מסמך חדש = מזהה חדש), ולכן הדפדפן שומר אותו במטמון שלו: פתיחה חוזרת בלי הורדה.
// בקשת ?lite=1 שעדיין אין לה גרסה קלה (הדחיסה רצה אחרי ההעלאה) נשמרת לזמן קצר בלבד, כדי לקבל את הקלה כשתהיה מוכנה.
const LONG = "private, max-age=2592000, immutable", SHORT = "private, max-age=3600";

export async function onRequestGet({ request, env, params }) {
  if (!(await checkAdmin(request, env))) return noAuth();
  if (!env.PERMITS) return noStore();
  try {
    const row = await env.DB.prepare("SELECT file_key, original_name FROM permit_docs WHERE id = ?").bind(params.id).first();
    if (!row) return Response.json({ error: "לא נמצא" }, { status: 404 });
    const q = new URL(request.url).searchParams, wantLite = !!q.get("lite");
    let obj = null, lite = false;
    if (wantLite) {
      obj = await env.PERMITS.get(row.file_key.startsWith("docs/") ? "docs-lite/" + row.file_key.slice(5) : "docs-lite/" + row.file_key).catch(() => null);
      lite = !!obj;
    }
    if (!obj) obj = await env.PERMITS.get(row.file_key);
    if (!obj) return Response.json({ error: "הקובץ לא נמצא באחסון" }, { status: 404 });
    const cache = lite || !wantLite ? LONG : SHORT, name = row.original_name || "permit.pdf";
    // ?enc=b64: הקובץ כ-JSON (base64). לרשתות עם סינון תוכן (למשל נטפרי) שחוסמות הורדת PDF אבל לא JSON.
    if (q.get("enc") === "b64") {
      const buf = await obj.arrayBuffer(), u8 = new Uint8Array(buf);
      let bin = "";
      for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
      const sha = lite ? hex(await crypto.subtle.digest("SHA-256", buf)) : "";
      return Response.json({ name, data: btoa(bin), lite, sha }, { headers: { "Cache-Control": cache } });
    }
    const headers = {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": cache,
    };
    if (lite) {          // הגרסה הקלה קטנה: מחשבים לה טביעה (לבדיקת שלמות בדפדפן)
      const buf = await obj.arrayBuffer();
      return new Response(buf, { headers: { ...headers, "X-Pdf-Lite": "1", "X-Sha256": hex(await crypto.subtle.digest("SHA-256", buf)) } });
    }
    return new Response(obj.body, { headers });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
