// GET /api/permit-docs-public/:id → קובץ ה-PDF של מסמך שמקושר לרשימה (כללי / פרטי) של חברה. מסמך אחר: 404.
export async function onRequestGet({ request, env, params }) {
  if (!env.PERMITS) return new Response("not found", { status: 404 });
  try {
    const row = await env.DB.prepare(`
      SELECT d.file_key, d.original_name FROM permit_docs d
      WHERE d.id = ? AND d.doc_type != 'other' AND EXISTS (SELECT 1 FROM permit_doc_companies c WHERE c.doc_id = d.id AND c.slot != '')`).bind(params.id).first()
      || await env.DB.prepare(`SELECT d.file_key, d.original_name FROM permit_docs d WHERE d.id = ? AND d.doc_type != 'other' AND EXISTS (SELECT 1 FROM permit_doc_special s WHERE s.doc_id = d.id)`).bind(params.id).first().catch(() => null)
      // הת"ע מיוחד לאג"ח (תת-שורה לאג"ח): המסמך מקושר לאג"ח (permit_doc_bonds) ולחברה, גם כשאינו בחריץ כללי/פרטי של החברה. הרשימה הציבורית חושפת אותו (permit-docs-public.js), ולכן גם הקובץ מוגש
      || await env.DB.prepare(`SELECT d.file_key, d.original_name FROM permit_docs d WHERE d.id = ? AND d.doc_type != 'other'
           AND EXISTS (SELECT 1 FROM permit_doc_bonds x WHERE x.doc_id = d.id) AND EXISTS (SELECT 1 FROM permit_doc_companies c WHERE c.doc_id = d.id)`).bind(params.id).first().catch(() => null);
    if (!row) {          // סיבה מפורשת (לאבחון): המסמך לא קיים / לא מקושר לרשימה ציבורית
      const any = await env.DB.prepare("SELECT doc_type FROM permit_docs WHERE id = ?").bind(params.id).first().catch(() => null);
      let detail = "";
      if (any) {          // פירוט שיוכים לאבחון (בלי פרטים אישיים): חריצים, מסמכים מיוחדים, אג"ח
        const slots = (await env.DB.prepare("SELECT slot FROM permit_doc_companies WHERE doc_id = ? LIMIT 12").bind(params.id).all().catch(() => ({ results: [] }))).results.map(r => `'${r.slot}'`).join(",");
        const sp = await env.DB.prepare("SELECT COUNT(*) AS n FROM permit_doc_special WHERE doc_id = ?").bind(params.id).first().catch(() => null);
        const bd = await env.DB.prepare("SELECT COUNT(*) AS n FROM permit_doc_bonds WHERE doc_id = ?").bind(params.id).first().catch(() => null);
        detail = ` [company-links slots: ${slots || "none"}; special: ${sp ? sp.n : "?"}; bonds: ${bd ? bd.n : "?"}]`;
      }
      return new Response((any ? `not found: document exists (type ${any.doc_type}) but is not linked to a public list` : "not found: no such document id") + detail, { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
    }
    // צפייה מוגשת מהגרסה הקלה (docs-lite/, נבנית ע"י scripts/compress_permit_pdfs.py) אם קיימת; הורדה (?dl=1 / ?full=1) - תמיד המקור
    const q = new URL(request.url).searchParams;
    let obj = null;
    if (!q.get("dl") && !q.get("full")) obj = await env.PERMITS.get(row.file_key.startsWith("docs/") ? "docs-lite/" + row.file_key.slice(5) : "docs-lite/" + row.file_key).catch(() => null);
    if (!obj) obj = await env.PERMITS.get(row.file_key);
    if (!obj) return new Response("not found: file missing in storage (" + row.file_key + ")", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
    // ?enc=b64: הקובץ כ-JSON (base64), לרשתות עם סינון תוכן (נטפרי) שחוסמות הורדת PDF אבל לא JSON
    if (new URL(request.url).searchParams.get("enc") === "b64") {
      const u8 = new Uint8Array(await obj.arrayBuffer());
      let bin = "";
      for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
      return Response.json({ name: row.original_name || "permit.pdf", data: btoa(bin) }, { headers: { "Cache-Control": "public, max-age=300", "Access-Control-Allow-Origin": "*" } });
    }
    return new Response(obj.body, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${new URL(request.url).searchParams.get("dl") ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(row.original_name || "permit.pdf")}`,
        "Cache-Control": "public, max-age=300",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch {
    return new Response("not found", { status: 404 });
  }
}
