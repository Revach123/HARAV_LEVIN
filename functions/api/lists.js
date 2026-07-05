// functions/api/lists.js
// מגיש 4 רשימות כ-JSON, עם CORS פתוח (לאפשר הטמעה גם באתר אחר).
//   /api/lists?type=companies-private
//   /api/lists?type=companies-general
//   /api/lists?type=bonds-private
//   /api/lists?type=bonds-general
//
// לוגיקת אישור:
//   פרטי  → agch_approved ∈ (כן, רק פרטי)
//   כללי  → agch_approved ∈ (כן, רק כללי)
// "כללי" מבחינת visibility = כל מה שאינו 'פרטי'.

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

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const type = new URL(request.url).searchParams.get("type") || "";

  try {
    let sql, binds = [];

    if (type === "companies-private" || type === "companies-general") {
      const isPrivate = type === "companies-private";
      // סימון אישור מחושב לפי הרמה
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

    else {
      return json({ ok: false, error: "unknown_type", type }, 400);
    }

    const { results } = await env.DB.prepare(sql).bind(...binds).all();
    return json({ ok: true, type, count: results.length, rows: results });
  } catch (e) {
    return json({ ok: false, error: e.message, type }, 500);
  }
}
