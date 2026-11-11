// GET /api/permit-docs-public → קישורי המסמכים הציבוריים: רק מסמכים שמקושרים לרשימה (כללי / פרטי) של חברה.
//   { links: [{ chp, name, general: "<id>", private: "<id>" }] }  (המפתח חסר כשאין מסמך מקושר)
//   תת-שורה (כמה רישומים לאותו ח.פ., למשל "מסלול הלכה"): רשומה נפרדת { chp, sub: "<שם בהיתר>", ... } עם המסמכים שלה בלבד (גם כשאין לה מסמכים)
// הקובץ עצמו: /api/permit-docs-public/:id. מסמך שאינו מקושר לאף רשימה לא נחשף.
const CORS = { "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=300" };

import { publicLinks } from "./_shared/permit-links.js";

export async function onRequestGet({ env }) {
  try {
    return Response.json({ links: await publicLinks(env) }, { headers: CORS });
  } catch (e) {
    return Response.json({ links: [], error: "unavailable" }, { headers: { "Access-Control-Allow-Origin": "*" } });      // לפני מיגרציה 0007
  }
}
