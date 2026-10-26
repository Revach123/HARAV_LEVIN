// GET /api/permit-docs-public → קישורי המסמכים הציבוריים: רק מסמכים שמקושרים לרשימה (כללי / פרטי) של חברה.
//   { links: [{ chp, name, general: "<id>", private: "<id>" }] }  (המפתח חסר כשאין מסמך מקושר)
//   תת-שורה (כמה רישומים לאותו ח.פ., למשל "מסלול הלכה"): רשומה נפרדת { chp, sub: "<שם בהיתר>", ... } עם המסמכים שלה בלבד (גם כשאין לה מסמכים)
// הקובץ עצמו: /api/permit-docs-public/:id. מסמך שאינו מקושר לאף רשימה לא נחשף.
const CORS = { "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=300" };

const normName = s => String(s || "").toLowerCase().replace(/בע"?מ|בע״מ|בע''מ|\bltd\b|\blimited\b/g, "").replace(/[^0-9a-z\u0590-\u05ff]/g, "");

export async function onRequestGet({ env }) {
  try {
    // רישומים כפולים לאותו ח.פ.: הראשי (שם בהיתר = שם ברשם, אחרת הראשון) נשאר במפתח הח.פ., והשאר תתי-שורות במפתח נפרד
    const subOf = new Map();
    try {
      const dup = await env.DB.prepare(`
        SELECT id, chp_number, permit_name, registrar_name FROM businesses
        WHERE chp_number IN (SELECT chp_number FROM businesses WHERE COALESCE(chp_number,'') != '' GROUP BY chp_number HAVING COUNT(*) > 1)
        ORDER BY permit_name`).all();
      const g = new Map();
      for (const r of dup.results ?? []) { const k = String(r.chp_number).trim(); if (!g.has(k)) g.set(k, []); g.get(k).push(r); }
      for (const rs of g.values()) {
        const main = rs.find(r => !r.permit_name || normName(r.permit_name) === normName(r.registrar_name)) || rs[0];
        for (const r of rs) if (r !== main && r.permit_name) subOf.set(r.id, { chp: String(r.chp_number).trim(), sub: String(r.permit_name).replace(/\s+/g, " ").trim() });
      }
    } catch { /* בלי פיצול לתתי-שורות */ }
    const res = await env.DB.prepare(`
      SELECT c.doc_id, c.slot, b.id AS bid, b.chp_number, b.permit_name, b.registrar_name
      FROM permit_doc_companies c
      JOIN businesses b ON b.id = c.business_id
      JOIN permit_docs d ON d.id = c.doc_id
      WHERE c.slot != '' AND d.doc_type != 'other'`).all();
    const by = new Map();
    const keyOf = r => subOf.has(r.bid) ? "s:" + r.bid : r.chp_number || "n:" + (r.permit_name || r.registrar_name);
    const entry = r => by.get(keyOf(r)) || (subOf.has(r.bid) ? { ...subOf.get(r.bid), name: r.permit_name || "" } : { chp: r.chp_number || "", name: r.permit_name || r.registrar_name || "" });
    for (const r of res.results ?? []) {
      const k = keyOf(r);
      const e = entry(r);
      for (const s of String(r.slot).split(",")) if (s === "general" || s === "private") e[s] = r.doc_id;
      by.set(k, e);
    }
    try {          // מסמכים ראשיים מיוחדים (מיגרציה 0013): { id, title } ברשימה נפרדת לכל חברה
      const q = cols => env.DB.prepare(`
        SELECT s.doc_id, s.title, ${cols} b.id AS bid, b.chp_number, b.permit_name, b.registrar_name
        FROM permit_doc_special s
        JOIN businesses b ON b.id = s.business_id
        JOIN permit_docs d ON d.id = s.doc_id
        WHERE d.doc_type != 'other' ORDER BY s.created_at, s.title`).all();
      const sp = await q("s.detail,").catch(() => q(""));      // לפני מיגרציה 0014 אין פירוט
      for (const r of sp.results ?? []) {
        const k = keyOf(r);
        const e = entry(r);
        (e.specials = e.specials || []).push({ id: r.doc_id, title: r.title, detail: r.detail || "" });
        by.set(k, e);
      }
    } catch { /* אין טבלה עדיין */ }
    try {          // הת"ע מיוחד לאג"ח: תת-שורה לכל אג"ח ומסמך שלה (גם אם המסמך הוא ההת"ע הראשי של החברה). הרשימה לפי שיוך המסמך לאג"ח (מיגרציה 0018):
                   // פרטי -> "both" (כמו היתר פרטי: מופיע גם בכללי עם סימון), כללי -> "general", משותף -> שניהם; שיוך שטרם סווג - לפי סיווג המסמך
      const q = slot => `
        SELECT DISTINCT x.doc_id, x.security_id, x.name AS bname, x.symbol, ${slot ? "x.slot" : "'' AS slot"}, d.doc_type, b.id AS bid, b.chp_number, b.permit_name, b.registrar_name
        FROM permit_doc_bonds x
        JOIN permit_docs d ON d.id = x.doc_id
        JOIN permit_doc_companies c ON c.doc_id = d.id
        JOIN businesses b ON b.id = c.business_id
        WHERE d.doc_type != 'other' AND (x.chp = '' OR x.chp = b.chp_number)`;
      let bd; try { bd = await env.DB.prepare(q(true)).all(); } catch { bd = await env.DB.prepare(q(false)).all(); }
      const series = n => { const m = String(n || "").replace(/["'׳״`]/g, "").replace(/\s+/g, " ").match(/אגח\s*([א-ת]{1,3}|\d{1,2})(?:\s|$)/); return m ? (/^\d/.test(m[1]) ? m[1] : m[1].length === 1 ? m[1] + "'" : m[1].slice(0, -1) + '"' + m[1].slice(-1)) : ""; };
      const seen = new Set();
      for (const r of bd.results ?? []) {
        const key = keyOf(r), s = series(r.bname), label = 'אג"ח ' + (s || r.symbol || r.bname);
        const rl = String(r.slot || "").split(",").filter(x => x === "private" || x === "general");
        const lists = rl.length ? rl.map(t => t === "general" ? "general" : "both") : [r.doc_type === "general" ? "general" : r.doc_type === "private" ? "private" : "both"];
        const en = entry(r);
        for (const list of lists) {
          const k = key + "|" + r.security_id + "|" + r.doc_id + "|" + list; if (seen.has(k)) continue; seen.add(k);
          (en.bond_docs = en.bond_docs || []).push({ id: r.doc_id, list, label });
        }
        by.set(key, en);
      }
    } catch { /* אין טבלה עדיין */ }
    for (const [bid, x] of subOf) if (!by.has("s:" + bid)) by.set("s:" + bid, { ...x });          // תת-שורה בלי מסמכים: רשומה ריקה, כדי שלא תקבל את מסמכי הראשית
    return Response.json({ links: [...by.values()] }, { headers: CORS });
  } catch (e) {
    return Response.json({ links: [], error: "unavailable" }, { headers: { "Access-Control-Allow-Origin": "*" } });      // לפני מיגרציה 0007
  }
}
