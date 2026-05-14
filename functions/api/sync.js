// POST /api/sync  — manual trigger for admin (same logic as cron worker)

const TASE_API   = "https://datawise.tase.co.il";
const TASE_KEY   = "OpB1TDhiRrF5kbQtjx75Qgcm6Csh31to";
const BOND_TYPES = ["03", "05", "11", "36"];

const SOURCES = [
  { resource: "f004176c-b85f-4542-8901-7b3176f9a054", filterField: "מספר חברה",       nameField: "שם חברה" },
  { resource: "139aa193-fabb-4f6b-a71b-0bb40fd73eb2", filterField: "מספר שותפות",    nameField: "שם שותפות" },
  { resource: "be5b7935-3922-45d4-9638-08871b17ec95", filterField: "מספר עמותה",     nameField: "שם עמותה בעברית" },
];

function isAuthed(request, env) {
  const auth = request.headers.get("Authorization") || "";
  return auth.replace("Bearer ", "").trim() === env.ADMIN_PASSWORD;
}

function cleanName(name) {
  return (name || "").replace(/~/g, '"').replace(/שותפות מוגבלת/g, "").trim().replace(/[.,\-!?~"]+$/, "").trim();
}

async function lookupNumber(number) {
  const results = await Promise.allSettled(
    SOURCES.map(async (src) => {
      const filters = encodeURIComponent(JSON.stringify({ [src.filterField]: number }));
      const res  = await fetch(`https://data.gov.il/api/3/action/datastore_search?resource_id=${src.resource}&filters=${filters}&limit=1`,
        { headers: { "User-Agent": "Registry-Updater/1.0" } });
      const json = await res.json();
      const rec  = json?.result?.records?.[0];
      return rec ? cleanName(rec[src.nameField]) : null;
    })
  );
  for (const r of results) if (r.status === "fulfilled" && r.value) return r.value;
  return null;
}

async function fetchTaseBondIds() {
  for (let d = 0; d <= 7; d++) {
    const dt    = new Date(); dt.setDate(dt.getDate() - d);
    const year  = dt.getFullYear();
    const month = String(dt.getMonth() + 1).padStart(2, "0");
    const day   = String(dt.getDate()).padStart(2, "0");
    try {
      const res  = await fetch(`${TASE_API}/v1/basic-securities/trade-securities-list/${year}/${month}/${day}`,
        { headers: { accept: "application/json", "accept-language": "he-IL", apikey: TASE_KEY } });
      const json = await res.json();
      const list = json?.tradeSecuritiesList?.result;
      if (!list?.length) continue;
      return new Set(
        list
          .filter(s => BOND_TYPES.includes(String(s.securityFullTypeCode || "").slice(0, 2)))
          .map(s => String(s.corporateId || "").trim())
          .filter(Boolean)
      );
    } catch {}
  }
  return null;
}

export async function onRequestPost({ request, env }) {
  if (!isAuthed(request, env)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const start = Date.now();

  const { results } = await env.DB.prepare(
    `SELECT id, chp_number, registrar_name, tase_has_agch
     FROM businesses WHERE chp_number IS NOT NULL AND chp_number != ''`
  ).all();

  if (!results.length) {
    return Response.json({ message: "אין עסקים עם מספר רישום", namesUpdated: 0, taseUpdated: 0, total: 0 });
  }

  // ── Part 1: Registrar names ──────────────────────────────────────────────
  let namesUpdated = 0;
  const BATCH = 5;
  for (let i = 0; i < results.length; i += BATCH) {
    await Promise.allSettled(results.slice(i, i + BATCH).map(async (biz) => {
      try {
        const name = await lookupNumber(biz.chp_number);
        if (name && name !== (biz.registrar_name || "").trim()) {
          await env.DB.prepare(
            `UPDATE businesses SET registrar_name=?, updated_at=datetime('now') WHERE id=?`
          ).bind(name, biz.id).run();
          namesUpdated++;
        }
      } catch {}
    }));
  }

  // ── Part 2: TASE bond status ─────────────────────────────────────────────
  let taseUpdated = 0;
  let taseError   = false;
  const bondIds   = await fetchTaseBondIds();

  if (!bondIds) {
    taseError = true;
  } else {
    for (const biz of results) {
      const hasAgch = bondIds.has(String(biz.chp_number).trim()) ? "יש" : "אין";
      if (hasAgch !== (biz.tase_has_agch || "").trim()) {
        await env.DB.prepare(
          `UPDATE businesses SET tase_has_agch=?, updated_at=datetime('now') WHERE id=?`
        ).bind(hasAgch, biz.id).run();
        taseUpdated++;
      }
    }
  }

  return Response.json({
    namesUpdated,
    taseUpdated,
    taseError,
    total:    results.length,
    duration: Math.round((Date.now() - start) / 1000),
  });
}
