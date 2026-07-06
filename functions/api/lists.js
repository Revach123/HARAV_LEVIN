// functions/api/lists.js
// מגיש רשימות כ-JSON או CSV, עם CORS פתוח.
//   סינון (ציבורי):
//     /api/lists?type=companies-private
//     /api/lists?type=companies-general
//     /api/lists?type=bonds-private
//     /api/lists?type=bonds-general
//   גולמי (ניהול/גיבוי — כל השורות, כל העמודות):
//     /api/lists?type=companies-all
//     /api/lists?type=bonds-all
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
      const approvedExpr = isPrivate
        ? "CASE WHEN agch_approved IN ('כן','רק פרטי') THEN 1 ELSE 0 END"
        : "CASE WHEN agch_approved IN ('כן','רק כללי') THEN 1 ELSE 0 END";
      const visClause = isPrivate
        ? "visibility = 'פרטי'"
        : "COALESCE(visibility,'') <> 'פרטי'";
      sql = `
        SELECT permit_name, chp_number, category, region,
               ${approvedExpr} AS approved
        FROM businesses
        WHERE ${visClause}
        ORDER BY permit_name`;
    }

    else if (type === "bonds-private" || type === "bonds-general") {
      const isPrivate = type === "bonds-private";
      const approvedClause = isPrivate
        ? "biz.agch_approved IN ('כן','רק פרטי')"
        : "biz.agch_approved IN ('כן','רק כללי')";
      const visClause = isPrivate ? "AND biz.visibility = 'פרטי'" : "";
      sql = `
        SELECT b.security_id, b.bond_name, b.symbol,
               biz.permit_name AS company, b.corporate_id,
               b.last_price, b.change_pct, b.interest, b.maturity_date,
               b.linkage, b.base_index, b.turnover_kils, b.market_cap_kils
        FROM bonds b
        JOIN businesses biz ON biz.chp_number = b.corporate_id
        WHERE ${approvedClause} ${visClause}
        ORDER BY biz.permit_name, b.bond_name`;
    }

    // ── ייצוא גולמי מלא ──
    else if (type === "companies-all") {
      sql = `SELECT * FROM businesses ORDER BY permit_name`;
    }
    else if (type === "bonds-all") {
      sql = `SELECT * FROM bonds ORDER BY company_full_name, bond_name`;
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
