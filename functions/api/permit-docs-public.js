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
      const q = cols => env.DB.prepare(`
        SELECT s.doc_id, s.title, ${cols} b.chp_number, b.permit_name, b.registrar_name
        FROM permit_doc_special s
        JOIN businesses b ON b.id = s.business_id
        JOIN permit_docs d ON d.id = s.doc_id
        WHERE d.doc_type != 'other' ORDER BY s.created_at, s.title`).all();
      const sp = await q("s.detail,").catch(() => q(""));      // לפני מיגרציה 0014 אין פירוט
      for (const r of sp.results ?? []) {
        const k = r.chp_number || "n:" + (r.permit_name || r.registrar_name);
        const e = by.get(k) || { chp: r.chp_number || "", name: r.permit_name || r.registrar_name || "" };
        (e.specials = e.specials || []).push({ id: r.doc_id, title: r.title, detail: r.detail || "" });
        by.set(k, e);
      }
    } catch { /* אין טבלה עדיין */ }
    try {          // הת"ע מיוחד לאג"ח: תת-שורה לכל מסמך (שמשויך לאג"ח ואינו ההת"ע הראשי של החברה); השם כולל את סדרות האג"ח
      const bd = await env.DB.prepare(`
        SELECT x.doc_id, x.name AS bname, x.symbol, d.doc_type, b.chp_number, b.permit_name, b.registrar_name
        FROM permit_doc_bonds x
        JOIN permit_docs d ON d.id = x.doc_id
        JOIN permit_doc_companies c ON c.doc_id = d.id
        JOIN businesses b ON b.id = c.business_id
        WHERE d.doc_type != 'other' AND c.slot = '' AND (x.chp = '' OR x.chp = b.chp_number)`).all();
      const series = n => { const m = String(n || "").replace(/["'׳״`]/g, "").replace(/\s+/g, " ").match(/אגח\s*([א-ת]{1,3}|\d{1,2})(?:\s|$)/); return m ? (/^\d/.test(m[1]) ? m[1] : m[1].length === 1 ? m[1] + "'" : m[1].slice(0, -1) + '"' + m[1].slice(-1)) : ""; };
      const g = new Map();
      for (const r of bd.results ?? []) {
        const k = (r.chp_number || "n:" + (r.permit_name || r.registrar_name)) + "|" + r.doc_id;
        const e = g.get(k) || { key: r.chp_number || "n:" + (r.permit_name || r.registrar_name), chp: r.chp_number || "", name: r.permit_name || r.registrar_name || "", id: r.doc_id, list: r.doc_type === "general" ? "general" : "private", ser: [], other: [] };
        const s = series(r.bname); if (s) { if (!e.ser.includes(s)) e.ser.push(s); } else e.other.push(r.symbol || r.bname);
        g.set(k, e);
      }
      for (const e of g.values()) {
        const en = by.get(e.key) || { chp: e.chp, name: e.name };
        (en.bond_docs = en.bond_docs || []).push({ id: e.id, list: e.list, label: 'אג"ח ' + [...e.ser, ...e.other].join(" ו-") });
        by.set(e.key, en);
      }
    } catch { /* אין טבלה עדיין */ }
    return Response.json({ links: [...by.values()] }, { headers: CORS });
  } catch (e) {
    return Response.json({ links: [], error: "unavailable" }, { headers: { "Access-Control-Allow-Origin": "*" } });      // לפני מיגרציה 0007
  }
}
