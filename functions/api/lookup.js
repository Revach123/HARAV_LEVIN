// GET /api/lookup?chp=XXXXXXX
// Proxy to data.gov.il — runs server-side so no CORS issues

const GOV_API = "https://data.gov.il/api/3/action/datastore_search";
const RESOURCE = "f004176c-b85f-4542-8901-7b3176f9a054";

export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const chp = (url.searchParams.get("chp") || "").trim();

  if (!chp) {
    return Response.json({ error: "Missing chp parameter" }, { status: 400 });
  }

  const filters = encodeURIComponent(JSON.stringify({ "מספר חברה": chp }));
  const govUrl  = `${GOV_API}?resource_id=${RESOURCE}&filters=${filters}&limit=1`;

  try {
    const res  = await fetch(govUrl, { headers: { "User-Agent": "Business-Registry/1.0" } });
    const json = await res.json();
    const records = json?.result?.records;

    if (records && records.length > 0) {
      const rec = records[0];
      return Response.json({
        found:  true,
        name:   rec["שם חברה"]    || "",
        type:   rec["סוג תאגיד"]  || "",
        status: rec["סטטוס חברה"] || "",
      });
    }

    return Response.json({ found: false });
  } catch (e) {
    return Response.json({ error: "Failed to reach registrar: " + e.message }, { status: 502 });
  }
}
