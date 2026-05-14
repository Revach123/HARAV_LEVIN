// GET /api/debug-tase  — temporary debug endpoint, delete after fixing

const TASE_API   = "https://datawise.tase.co.il";
const TASE_KEY   = "OpB1TDhiRrF5kbQtjx75Qgcm6Csh31to";
const BOND_TYPES = ["03", "05", "11", "36"];

export async function onRequestGet({ request, env }) {
  const auth = (request.headers.get("Authorization") || "").replace("Bearer ", "").trim();
  if (auth !== env.ADMIN_PASSWORD) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 1. Fetch TASE data
  let taseRaw = null, taseError = null;
  for (let d = 0; d <= 7; d++) {
    const dt    = new Date(); dt.setDate(dt.getDate() - d);
    const year  = dt.getFullYear();
    const month = String(dt.getMonth() + 1).padStart(2, "0");
    const day   = String(dt.getDate()).padStart(2, "0");
    try {
      const res  = await fetch(
        `${TASE_API}/v1/basic-securities/trade-securities-list/${year}/${month}/${day}`,
        { headers: { accept: "application/json", "accept-language": "he-IL", apikey: TASE_KEY } }
      );
      const json = await res.json();
      const list = json?.tradeSecuritiesList?.result;
      if (list?.length) { taseRaw = list; break; }
    } catch(e) { taseError = e.message; }
  }

  if (!taseRaw) {
    return Response.json({ error: "No TASE data", taseError });
  }

  // 2. Get bond securities
  const bonds = taseRaw.filter(s =>
    BOND_TYPES.includes(String(s.securityFullTypeCode || "").slice(0, 2))
  );

  // 3. Sample raw bond records to see actual field values
  const sample = bonds.slice(0, 10).map(s => ({
    securityId:          s.securityId,
    securityFullTypeCode: s.securityFullTypeCode,
    corporateId:         s.corporateId,
    corporateId_type:    typeof s.corporateId,
    issuerId:            s.issuerId,
    issuerId_type:       typeof s.issuerId,
  }));

  // 4. Get DB chp_numbers
  const { results: dbRows } = await env.DB.prepare(
    "SELECT id, chp_number FROM businesses WHERE chp_number != '' LIMIT 20"
  ).all();

  // 5. Check matches using corporateId
  const corpIds   = new Set(bonds.map(s => String(s.corporateId  || "").trim()).filter(Boolean));
  const issuerIds = new Set(bonds.map(s => String(s.issuerId     || "").trim()).filter(Boolean));

  const matchResults = dbRows.map(b => {
    const chp = String(b.chp_number).trim();
    return {
      chp_number:        chp,
      match_corporateId: corpIds.has(chp),
      match_issuerId:    issuerIds.has(chp),
    };
  });

  return Response.json({
    totalSecurities:   taseRaw.length,
    totalBonds:        bonds.length,
    uniqueCorporateIds: corpIds.size,
    sampleBondRecords: sample,
    dbSample:          matchResults,
  }, { headers: { "Content-Type": "application/json" } });
}
