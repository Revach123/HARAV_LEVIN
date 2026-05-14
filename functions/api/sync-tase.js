// POST /api/sync-tase  — updates tase_has_agch for all businesses

const TASE_API   = "https://datawise.tase.co.il";
const TASE_KEY   = "OpB1TDhiRrF5kbQtjx75Qgcm6Csh31to";
const BOND_TYPES = ["03", "05", "11", "36"];

function isAuthed(request, env) {
  return (request.headers.get("Authorization") || "").replace("Bearer ", "").trim() === env.ADMIN_PASSWORD;
}

export async function onRequestPost({ request, env }) {
  if (!isAuthed(request, env)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 1. Fetch bond company IDs from TASE
  let bondIds = null;
  let dateUsed = null;
  let taseTotal = 0;

  for (let d = 0; d <= 7; d++) {
    const dt    = new Date();
    dt.setDate(dt.getDate() - d);
    const year  = dt.getFullYear();
    const month = String(dt.getMonth() + 1).padStart(2, "0");
    const day   = String(dt.getDate()).padStart(2, "0");

    try {
      const res  = await fetch(
        `${TASE_API}/v1/basic-securities/trade-securities-list/${year}/${month}/${day}`,
        { headers: { accept: "application/json", "accept-language": "he-IL", apikey: TASE_KEY } }
      );

      if (!res.ok) continue;

      const json = await res.json();
      const list = json?.tradeSecuritiesList?.result;
      if (!list?.length) continue;

      taseTotal = list.length;
      bondIds   = new Set(
        list
          .filter(s => BOND_TYPES.includes(String(s.securityFullTypeCode || "").slice(0, 2)))
          .map(s => String(s.corporateId || "").trim())
          .filter(Boolean)
      );
      dateUsed = `${year}-${month}-${day}`;
      break;
    } catch (e) {
      continue;
    }
  }

  if (!bondIds) {
    return Response.json({ error: "לא הצלחנו לקבל נתונים מהבורסה" }, { status: 502 });
  }

  // 2. Get all businesses with registration numbers
  const { results } = await env.DB.prepare(
    `SELECT id, chp_number, tase_has_agch FROM businesses
     WHERE chp_number IS NOT NULL AND chp_number != ''`
  ).all();

  // 3. Update each business
  let updated = 0;
  let withBonds = 0;

  for (const biz of results) {
    const hasAgch  = bondIds.has(String(biz.chp_number).trim()) ? "יש" : "אין";
    const prevAgch = (biz.tase_has_agch || "").trim();
    if (hasAgch === "יש") withBonds++;

    if (hasAgch !== prevAgch) {
      await env.DB.prepare(
        `UPDATE businesses SET tase_has_agch = ?, updated_at = datetime('now') WHERE id = ?`
      ).bind(hasAgch, biz.id).run();
      updated++;
    }
  }

  return Response.json({
    success:      true,
    dateUsed,
    taseTotal,
    bondCompanies: bondIds.size,
    dbChecked:    results.length,
    withBonds,
    updated,
  });
}
