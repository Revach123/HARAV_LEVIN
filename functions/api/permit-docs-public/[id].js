// GET /api/permit-docs-public/:id → קובץ ה-PDF של מסמך שמקושר לרשימה (כללי / פרטי) של חברה. מסמך אחר: 404.
export async function onRequestGet({ env, params }) {
  if (!env.PERMITS) return new Response("not found", { status: 404 });
  try {
    const row = await env.DB.prepare(`
      SELECT d.file_key, d.original_name FROM permit_docs d
      WHERE d.id = ? AND d.doc_type != 'other' AND EXISTS (SELECT 1 FROM permit_doc_companies c WHERE c.doc_id = d.id AND c.slot != '')`).bind(params.id).first()
      || await env.DB.prepare(`SELECT d.file_key, d.original_name FROM permit_docs d WHERE d.id = ? AND d.doc_type != 'other' AND EXISTS (SELECT 1 FROM permit_doc_special s WHERE s.doc_id = d.id)`).bind(params.id).first().catch(() => null);
    if (!row) return new Response("not found", { status: 404 });
    const obj = await env.PERMITS.get(row.file_key);
    if (!obj) return new Response("not found", { status: 404 });
    return new Response(obj.body, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(row.original_name || "permit.pdf")}`,
        "Cache-Control": "public, max-age=300",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch {
    return new Response("not found", { status: 404 });
  }
}
