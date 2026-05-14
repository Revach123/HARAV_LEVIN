// GET /api/lookup?number=XXX
// Searches all three registries IN PARALLEL — returns first match found

const SOURCES = [
  {
    entityType:  "company",
    resource:    "f004176c-b85f-4542-8901-7b3176f9a054",
    filterField: "מספר חברה",
    nameField:   "שם חברה",
    typeField:   "סוג תאגיד",
    statusField: "סטטוס חברה",
  },
  {
    entityType:  "partnership",
    resource:    "139aa193-fabb-4f6b-a71b-0bb40fd73eb2",
    filterField: "מספר שותפות",
    nameField:   "שם שותפות",
    typeField:   "סוג תאגיד",
    statusField: "סטטוס תאגיד",
  },
  {
    entityType:  "association",
    resource:    "be5b7935-3922-45d4-9638-08871b17ec95",
    filterField: "מספר עמותה",
    nameField:   "שם עמותה בעברית",
    typeField:   "סיווג פעילות ענפי",
    statusField: "סטטוס עמותה",
  },
];

function cleanName(name) {
  return (name || "")
    .replace(/~/g, '"')
    .replace(/שותפות מוגבלת/g, "")
    .trim()
    .replace(/[.,\-!?~"]+$/, "")
    .trim();
}

async function searchSource(source, number) {
  const filters = encodeURIComponent(JSON.stringify({ [source.filterField]: number }));
  const url     = `https://data.gov.il/api/3/action/datastore_search?resource_id=${source.resource}&filters=${filters}&limit=1`;
  const res     = await fetch(url, { headers: { "User-Agent": "Business-Registry/1.0" } });
  const json    = await res.json();
  const records = json?.result?.records;

  if (records && records.length > 0) {
    const rec = records[0];
    return {
      found:      true,
      entityType: source.entityType,
      name:       cleanName(rec[source.nameField]),
      type:       rec[source.typeField]   || "",
      status:     rec[source.statusField] || "",
    };
  }
  // Return null if not found in this source (will be filtered out)
  return null;
}

export async function onRequestGet({ request }) {
  const url    = new URL(request.url);
  const number = (url.searchParams.get("number") || "").trim();

  if (!number) {
    return Response.json({ error: "Missing number parameter" }, { status: 400 });
  }

  try {
    // Search all three registries in parallel
    const results = await Promise.all(SOURCES.map(s => searchSource(s, number).catch(() => null)));
    const found   = results.find(r => r !== null);

    if (found) return Response.json(found);

    return Response.json({ found: false });
  } catch (e) {
    return Response.json({ error: "Failed to reach registrar: " + e.message }, { status: 502 });
  }
}
