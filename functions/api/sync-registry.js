// POST /api/sync-registry
// שואב את כל השמות ב-3 בקשות גדולות במקום בקשה לכל חברה

const SOURCES = [
  { resource: "f004176c-b85f-4542-8901-7b3176f9a054", idField: "מספר חברה",    nameField: "שם חברה" },
  { resource: "139aa193-fabb-4f6b-a71b-0bb40fd73eb2", idField: "מספר שותפות", nameField: "שם שותפות" },
  { resource: "be5b7935-3922-45d4-9638-08871b17ec95", idField: "מספר עמותה",  nameField: "שם עמותה בעברית" },
];

const GOV_SQL = "https://data.gov.il/api/3/action/datastore_search_sql";
const BATCH   = 300;

function isAuthed(request, env) {
  return (request.headers.get("Authorization") || "").replace("Bearer ", "").trim() === env.ADMIN_PASSWORD;
}

function cleanName(name) {
  return (name || "").replace(/~/g, '"').replace(/שותפות מוגבלת/g, "").trim().replace(/[.,\-!?~"]+$/, "").trim();
}

async function fetchNamesFromSource(numbers, source) {
  const nameMap = {};
  for (let i = 0; i < numbers.length; i += BATCH) {
    const batch    = numbers.slice(i, i + BATCH);
    const inClause = batch.map(n => parseInt(n, 10)).filter(n => !isNaN(n)).join(",");
    if (!inClause) continue;
    const sql = `SELECT "${source.idField}","${source.nameField}" FROM "${source.resource}" WHERE "${source.idField}" IN (${inClause})`;
    try {
      const res  = await fetch(GOV_SQL, {
        method:  "POST",
        headers: { "Content-Type": "application/json", "User-Agent": "Registry-Updater/1.0" },
        body:    JSON.stringify({ sql }),
      });
      const json = await res.json();
      for (const rec of (json?.result?.records || [])) {
        const id   = String(rec[source.idField] || "").trim();
        const name = cleanName(rec[source.nameField]);
        if (id && name) nameMap[id] = name;
      }
    } catch {}
  }
  return nameMap;
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== "POST") return Response.json({ error: "Method Not Allowed" }, { status: 405 });
  if (!isAuthed(request, env)) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { results: businesses } = await env.DB.prepare(
    `SELECT id, chp_number, registrar_name FROM businesses WHERE chp_number IS NOT NULL AND chp_number != ''`
  ).all();

  if (!businesses.length) return Response.json({ done: true, updated: 0, total: 0 });

  const numbers = businesses.map(b => b.chp_number);

  const [companyNames, partnershipNames, assocNames] = await Promise.all(
    SOURCES.map(src => fetchNamesFromSource(numbers, src))
  );

  const nameMap = { ...assocNames, ...partnershipNames, ...companyNames };

  let updated = 0;
  for (const biz of businesses) {
    const newName = nameMap[String(biz.chp_number).trim()];
    if (newName && newName !== (biz.registrar_name || "").trim()) {
      await env.DB.prepare(
        `UPDATE businesses SET registrar_name=?, updated_at=datetime('now') WHERE id=?`
      ).bind(newName, biz.id).run();
      updated++;
    }
  }

  return Response.json({ done: true, updated, total: businesses.length });
}
