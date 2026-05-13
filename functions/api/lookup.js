// GET /api/lookup?number=XXX&type=company|partnership|association
// Proxy to data.gov.il — runs server-side, no CORS issues

const SOURCES = {
  company: {
    resource:    "f004176c-b85f-4542-8901-7b3176f9a054",
    filterField: "מספר חברה",
    nameField:   "שם חברה",
    typeField:   "סוג תאגיד",
    statusField: "סטטוס חברה",
  },
  partnership: {
    resource:    "139aa193-fabb-4f6b-a71b-0bb40fd73eb2",
    filterField: "מספר שותפות",
    nameField:   "שם שותפות",
    typeField:   "סוג תאגיד",
    statusField: "סטטוס תאגיד",
  },
  association: {
    resource:    "be5b7935-3922-45d4-9638-08871b17ec95",
    filterField: "מספר עמותה",
    nameField:   "שם עמותה בעברית",
    typeField:   "סיווג פעילות ענפי",
    statusField: "סטטוס עמותה",
  },
};

function cleanName(name) {
  return (name || "")
    .replace(/~/g, '"')
    .replace(/שותפות מוגבלת/g, "")
    .trim()
    .replace(/[.,\-!?~"]+$/, "")
    .trim();
}

export async function onRequestGet({ request }) {
  const url    = new URL(request.url);
  const number = (url.searchParams.get("number") || "").trim();
  const type   = (url.searchParams.get("type")   || "company").trim();

  if (!number) {
    return Response.json({ error: "Missing number parameter" }, { status: 400 });
  }

  const source = SOURCES[type];
  if (!source) {
    return Response.json({ error: "Invalid type. Use: company, partnership, association" }, { status: 400 });
  }

  const filters = encodeURIComponent(JSON.stringify({ [source.filterField]: number }));
  const govUrl  = `https://data.gov.il/api/3/action/datastore_search?resource_id=${source.resource}&filters=${filters}&limit=1`;

  try {
    const res  = await fetch(govUrl, { headers: { "User-Agent": "Business-Registry/1.0" } });
    const json = await res.json();
    const records = json?.result?.records;

    if (records && records.length > 0) {
      const rec = records[0];
      return Response.json({
        found:  true,
        name:   cleanName(rec[source.nameField]),
        type:   rec[source.typeField]   || "",
        status: rec[source.statusField] || "",
      });
    }

    return Response.json({ found: false });
  } catch (e) {
    return Response.json({ error: "Failed to reach registrar: " + e.message }, { status: 502 });
  }
}
