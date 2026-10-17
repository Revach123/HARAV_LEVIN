// GET /api/permit-docs-public → קישורי המסמכים הציבוריים: רק מסמכים שמקושרים לרשימה (כללי / פרטי) של חברה.
//   { links: [{ chp, name, general: "<id>", private: "<id>" }] }  (המפתח חסר כשאין מסמך מקושר)
// הקובץ עצמו: /api/permit-docs-public/:id. מסמך שאינו מקושר לאף רשימה לא נחשף.
const CORS = { "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=300" };

export async function onRequestGet({ env }) {
  try {
    const res = await env.DB.prepare(`
      SELECT c.doc_id, c.slot, b.chp_number, b.permit_name, b.registrar_name
      FROM permit_doc_companies c
      JOIN businesses b ON b.id = c.business_id
      JOIN permit_docs d ON d.id = c.doc_id
      WHERE c.slot != '' AND d.doc_type != 'other'`).all();
    const by = new Map();
    for (const r of res.results ?? []) {
      const k = r.chp_number || "n:" + (r.permit_name || r.registrar_name);
      const e = by.get(k) || { chp: r.chp_number || "", name: r.permit_name || r.registrar_name || "" };
      for (const s of String(r.slot).split(",")) if (s === "general" || s === "private") e[s] = r.doc_id;
      by.set(k, e);
    }
    try {          // מסמכים ראשיים מיוחדים (מיגרציה 0013): { id, title } ברשימה נפרדת לכל חברה
      const sp = await env.DB.prepare(`
        SELECT s.doc_id, s.title, b.chp_number, b.permit_name, b.registrar_name
        FROM permit_doc_special s
        JOIN businesses b ON b.id = s.business_id
        JOIN permit_docs d ON d.id = s.doc_id
        WHERE d.doc_type != 'other' ORDER BY s.created_at, s.title`).all();
      for (const r of sp.results ?? []) {
        const k = r.chp_number || "n:" + (r.permit_name || r.registrar_name);
        const e = by.get(k) || { chp: r.chp_number || "", name: r.permit_name || r.registrar_name || "" };
        (e.specials = e.specials || []).push({ id: r.doc_id, title: r.title });
        by.set(k, e);
      }
    } catch { /* אין טבלה עדיין */ }
    return Response.json({ links: [...by.values()] }, { headers: CORS });
  } catch (e) {
    return Response.json({ links: [], error: "unavailable" }, { headers: { "Access-Control-Allow-Origin": "*" } });      // לפני מיגרציה 0007
  }
}
