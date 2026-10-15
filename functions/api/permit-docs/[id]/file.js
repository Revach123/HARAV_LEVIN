import { checkAdmin } from "../../_shared/auth.js";
import { noAuth, noStore } from "../../_shared/permit-docs.js";
// GET /api/permit-docs/:id/file → קובץ ה-PDF (למנהל בלבד); ?enc=b64 → { name, data (base64) }

export async function onRequestGet({ request, env, params }) {
  if (!(await checkAdmin(request, env))) return noAuth();
  if (!env.PERMITS) return noStore();
  try {
    const row = await env.DB.prepare("SELECT file_key, original_name FROM permit_docs WHERE id = ?").bind(params.id).first();
    if (!row) return Response.json({ error: "לא נמצא" }, { status: 404 });
    const obj = await env.PERMITS.get(row.file_key);
    if (!obj) return Response.json({ error: "הקובץ לא נמצא באחסון" }, { status: 404 });
    // ?enc=b64: הקובץ כ-JSON (base64). לרשתות עם סינון תוכן (למשל נטפרי) שחוסמות הורדת PDF אבל לא JSON.
    if (new URL(request.url).searchParams.get("enc") === "b64") {
      const u8 = new Uint8Array(await obj.arrayBuffer());
      let bin = "";
      for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
      return Response.json({ name: row.original_name || "permit.pdf", data: btoa(bin) }, { headers: { "Cache-Control": "private, no-store" } });
    }
    return new Response(obj.body, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(row.original_name || "permit.pdf")}`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
