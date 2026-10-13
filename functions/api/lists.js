// functions/api/lists.js
// מגיש רשימות כ-JSON או CSV, עם CORS פתוח.
//   סינון (ציבורי):
//     /api/lists?type=companies-private
//     /api/lists?type=companies-general
//   גולמי (ניהול/גיבוי — כל השורות, כל העמודות):
//     /api/lists?type=companies-all
//   אג"ח: לא כאן. קבצים סטטיים /data/bonds_list/bonds_{private,general,all}.{json,csv} (נבנים יומית ממאיה).
//   פורמט:
//     &format=csv   → מוריד CSV (BOM + כותרות, לאקסל)
//     (ברירת מחדל)  → JSON

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" },
  });

// המרת שורות ל-CSV עם BOM (כדי שאקסל יזהה UTF-8 ויציג עברית)
function toCsv(rows) {
  if (!rows.length) return "\uFEFF";
  const cols = Object.keys(rows[0]);
  const esc = v => {
    const s = v == null ? "" : String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lines = [cols.join(",")];
  for (const r of rows) lines.push(cols.map(c => esc(r[c])).join(","));
  return "\uFEFF" + lines.join("\r\n");
}

const csvResponse = (rows, name) =>
  new Response(toCsv(rows), {
    status: 200,
    headers: {
      ...CORS,
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}.csv"`,
    },
  });

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const params = new URL(request.url).searchParams;
  const type = params.get("type") || "";
  const format = (params.get("format") || "").toLowerCase();

  try {
    let sql;

    if (type === "companies-private" || type === "companies-general") {
      const isPrivate = type === "companies-private";
      const approvedCond = isPrivate
        ? "agch_approved IN ('כן','רק פרטי')"
        : "agch_approved IN ('כן','רק כללי')";
      const approvedExpr = `CASE WHEN ${approvedCond} THEN 1 ELSE 0 END`;
      // מצב אג"ח: אין אג"ח / יש אג"ח - מאושר / יש אג"ח - לא מאושר
      // (tase_has_agch = "יש" מהבורסה; מאושר גובר גם אם הדגל מהבורסה לא עודכן)
      const bondsStatusExpr = `CASE WHEN ${approvedCond} THEN 'יש אג"ח - מאושר'
                                    WHEN tase_has_agch = 'יש' THEN 'יש אג"ח - לא מאושר'
                                    ELSE 'אין אג"ח' END`;
      // "קיים היתר עסקה פרטי": העסק מסומן פרטי (visibility = 'פרטי')
      const hasPrivateExpr = `CASE WHEN visibility = 'פרטי' THEN 'כן' ELSE 'לא' END`;
      // סימון מפורש "רק פרטי": agch_approved = 'רק פרטי', או הערה שכתוב בה "רק ... פרטי" (למשל "מאושר רק לאג"ח פרטי בלבד")
      const onlyPrivateExplicit = `(COALESCE(agch_approved,'') = 'רק פרטי'
                                    OR (COALESCE(notes,'') LIKE '%רק%' AND COALESCE(notes,'') LIKE '%פרטי%'))`;
      // פרטי = עסקים המסומנים פרטי. כללי = כל העסקים חוץ מאלה שמסומנים במפורש "רק פרטי"
      // (כלומר גם עסקים עם היתר פרטי נכללים ברשימה הכללית, ויש עמודה שמראה מי מהם).
      const whereClause = isPrivate ? "visibility = 'פרטי'" : `NOT ${onlyPrivateExplicit}`;
      sql = `
        SELECT permit_name, chp_number, category, region,
               ${hasPrivateExpr} AS has_private_permit,
               ${approvedExpr} AS approved,
               ${bondsStatusExpr} AS bonds_status
        FROM businesses
        WHERE ${whereClause}
        ORDER BY permit_name`;
    }


    // ── ייצוא גולמי מלא ──
    else if (type === "companies-all") {
      sql = `SELECT * FROM businesses ORDER BY permit_name`;
    }
    // אג"ח: רשימה אחת בלבד - קבצים סטטיים שנבנים כל יום מדף החברה במאיה (scripts/bonds_list), בלי טבלת bonds.
    else if (type.startsWith("bonds-")) {
      return json({ ok: false, error: "moved", type,
        message: 'רשימת האג"ח היא קבצים סטטיים: /data/bonds_list/bonds_private|bonds_general|bonds_all (.json / .csv)' }, 410);
    }

    else {
      return json({ ok: false, error: "unknown_type", type }, 400);
    }

    const { results } = await env.DB.prepare(sql).all();

    if (format === "csv") {
      return csvResponse(results, type);
    }
    return json({ ok: true, type, count: results.length, rows: results });
  } catch (e) {
    return json({ ok: false, error: e.message, type }, 500);
  }
}
