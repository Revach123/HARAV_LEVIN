// POST /api/sync-bonds  — builds the `bonds` table from TASE's GENERAL
// securities list (datawise trade-securities-list), matched against our
// own `businesses` list by chp_number == corporateId.
//
// This is deliberately the "general" pull, not the heavy per-company sweep
// (maya.tase.co.il/api/v1/companies/{id}/details, one request per company
// id — that source stays out of this repo). trade-securities-list is a
// single request that returns every traded security for one day, already
// including corporateId/securityName/symbol/companyName — enough to
// identify which bonds belong to which of our companies. It does NOT
// include trading fields (price, interest, maturity, linkage, turnover,
// market cap) — those columns exist on `bonds` (see migrations/0002_bonds.sql)
// but stay untouched here; a later phase fills them from a separate source.
//
// Quota-conscious by design: only bonds whose corporateId matches a
// chp_number we already track are written, and only rows that actually
// changed are sent to D1 (same "diff before write" pattern as sync-tase.js).

const TASE_API   = "https://datawise.tase.co.il";
const TASE_KEY   = "OpB1TDhiRrF5kbQtjx75Qgcm6Csh31to";
const BOND_TYPES = ["03", "05", "11", "36"];

function isAuthed(request, env) {
  return (request.headers.get("Authorization") || "").replace("Bearer ", "").trim() === env.ADMIN_PASSWORD;
}

async function fetchTaseBondRows() {
  for (let d = 0; d <= 7; d++) {
    const dt    = new Date();
    dt.setDate(dt.getDate() - d);
    const year  = dt.getFullYear();
    const month = String(dt.getMonth() + 1).padStart(2, "0");
    const day   = String(dt.getDate()).padStart(2, "0");

    try {
      const res = await fetch(
        `${TASE_API}/v1/basic-securities/trade-securities-list/${year}/${month}/${day}`,
        { headers: { accept: "application/json", "accept-language": "he-IL", apikey: TASE_KEY } }
      );
      if (!res.ok) continue;

      const json = await res.json();
      const list = json?.tradeSecuritiesList?.result;
      if (!list?.length) continue;

      const bonds = list.filter(s => BOND_TYPES.includes(String(s.securityFullTypeCode || "").slice(0, 2)));
      return { bonds, dateUsed: `${year}-${month}-${day}`, taseTotal: list.length };
    } catch {
      continue;
    }
  }
  return null;
}

export async function onRequestPost({ request, env }) {
  if (!isAuthed(request, env)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const fetched = await fetchTaseBondRows();
  if (!fetched) {
    return Response.json({ error: "לא הצלחנו לקבל נתונים מהבורסה" }, { status: 502 });
  }
  const { bonds, dateUsed, taseTotal } = fetched;

  // 1. Our own companies — only bonds matching one of these get stored.
  const { results: businesses } = await env.DB.prepare(
    `SELECT chp_number FROM businesses WHERE chp_number IS NOT NULL AND chp_number != ''`
  ).all();
  const knownChp = new Set(businesses.map(b => String(b.chp_number).trim()));

  const matched = bonds.filter(s => knownChp.has(String(s.corporateId || "").trim()));

  // 2. Existing bonds rows, to diff against (avoid no-op writes).
  const { results: existingRows } = await env.DB.prepare(
    `SELECT security_id, bond_name, symbol, isin, corporate_id, company_full_name,
            security_type_code, trade_date, last_seen_active
     FROM bonds`
  ).all();
  const existing = new Map(existingRows.map(r => [String(r.security_id), r]));

  const statements = [];
  const seenIds = new Set();

  for (const s of matched) {
    const securityId = String(s.securityId ?? "").trim();
    if (!securityId) continue;
    seenIds.add(securityId);

    const row = {
      bond_name:           s.securityName || "",
      symbol:               s.symbol || "",
      isin:                 s.isin || "",
      corporate_id:         String(s.corporateId || "").trim(),
      company_full_name:    s.companyName || "",
      security_type_code:   String(s.securityFullTypeCode || ""),
      trade_date:           dateUsed,
    };

    const prev = existing.get(securityId);
    const changed = !prev
      || prev.bond_name !== row.bond_name
      || prev.symbol !== row.symbol
      || prev.isin !== row.isin
      || prev.corporate_id !== row.corporate_id
      || prev.company_full_name !== row.company_full_name
      || prev.security_type_code !== row.security_type_code
      || prev.trade_date !== row.trade_date
      || Number(prev.last_seen_active) !== 1;

    if (!changed) continue;

    statements.push(env.DB.prepare(
      `INSERT INTO bonds (security_id, bond_name, symbol, isin, corporate_id, company_full_name,
                           security_type_code, trade_date, last_seen_active, last_seen_at, removed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, datetime('now'), NULL)
       ON CONFLICT(security_id) DO UPDATE SET
         bond_name = excluded.bond_name,
         symbol = excluded.symbol,
         isin = excluded.isin,
         corporate_id = excluded.corporate_id,
         company_full_name = excluded.company_full_name,
         security_type_code = excluded.security_type_code,
         trade_date = excluded.trade_date,
         last_seen_active = 1,
         last_seen_at = datetime('now'),
         removed_at = NULL`
    ).bind(
      securityId, row.bond_name, row.symbol, row.isin, row.corporate_id,
      row.company_full_name, row.security_type_code, row.trade_date
    ));
  }

  // 3. Soft-delete bonds we previously tracked but didn't see (still active) today.
  for (const [securityId, prev] of existing) {
    if (seenIds.has(securityId)) continue;
    if (Number(prev.last_seen_active) !== 1) continue; // already marked gone
    statements.push(env.DB.prepare(
      `UPDATE bonds SET last_seen_active = 0, removed_at = datetime('now') WHERE security_id = ?`
    ).bind(securityId));
  }

  if (statements.length) {
    await env.DB.batch(statements);
  }

  return Response.json({
    success:       true,
    dateUsed,
    taseTotal,
    bondsInFeed:   bonds.length,
    matchedCompanies: matched.length,
    written:       statements.length,
  });
}
