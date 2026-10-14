// GET /api/lookup?number=XXX
// מחזיר שם, סוג עסק (bizType), סוג ישות, וסטטוס

const SOURCES = [
  {
    entityType:  "company",
    resource:    "f004176c-b85f-4542-8901-7b3176f9a054",
    filterField: "מספר חברה",
    nameField:   "שם חברה",
    typeField:   "סוג תאגיד",
    limField:    "מגבלות",
    statusField: "סטטוס חברה",
    classify(rec) {
      const typeRaw  = String(rec["סוג תאגיד"] || "").trim();
      const limRaw   = String(rec["מגבלות"]    || "").trim();
      const isPublic = typeRaw.includes("ציבורית");
      const type     = isPublic ? "חברה ציבורית" : "חברה פרטית";
      const lim      = limRaw.includes("לא מוגבלת") ? "לא מוגבלת" : 'בע"מ';
      return `${type} - ${lim}`;
    },
  },
  {
    entityType:  "partnership",
    resource:    "139aa193-fabb-4f6b-a71b-0bb40fd73eb2",
    filterField: "מספר שותפות",
    nameField:   "שם שותפות",
    typeField:   "סוג תאגיד",
    statusField: "סטטוס תאגיד",
    classify()  { return 'שותפות - לא בע"מ'; },
  },
  {
    entityType:  "association",
    resource:    "be5b7935-3922-45d4-9638-08871b17ec95",
    filterField: "מספר עמותה",
    nameField:   "שם עמותה בעברית",
    typeField:   "סיווג פעילות ענפי",
    statusField: "סטטוס עמותה",
    classify()  { return "עמותה רשומה"; },
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
  const rec     = json?.result?.records?.[0];
  if (!rec) return null;
  const name = cleanName(rec[source.nameField]);
  if (!name) return null;
  return {
    found:      true,
    entityType: source.entityType,
    name,
    bizType: source.classify(rec),
    type:    rec[source.typeField]   || "",
    status:  rec[source.statusField] || "",
  };
}

// קודם המאגר המקומי (DB1 = company-info-db, עותק שבועי של הרשמים): מהיר, ולא תלוי ב-data.gov.il. אם אין שם - עוברים לרשם החי.
async function searchRegistryDb(db, number) {
  if (!db || !/^\d{1,12}$/.test(number)) return null;
  const id = Number(number);
  const [c, p, a] = await Promise.allSettled([
    db.prepare("SELECT name,status,corp_type,restrictions FROM companies WHERE id=? LIMIT 1").bind(id).first(),
    db.prepare("SELECT name,status,ptype FROM partnerships WHERE id=? LIMIT 1").bind(id).first(),
    db.prepare("SELECT name,status,category FROM associations WHERE id=? LIMIT 1").bind(id).first(),
  ]);
  const row = (x) => (x.status === "fulfilled" && x.value && cleanName(x.value.name) ? x.value : null);
  if (row(c)) {
    const r = c.value;
    const isPublic = String(r.corp_type || "").includes("ציבורית");
    const lim = String(r.restrictions || "").includes("לא מוגבלת") ? "לא מוגבלת" : 'בע"מ';
    return { found: true, entityType: "company", name: cleanName(r.name), bizType: `${isPublic ? "חברה ציבורית" : "חברה פרטית"} - ${lim}`, type: r.corp_type || "", status: r.status || "" };
  }
  if (row(p)) return { found: true, entityType: "partnership", name: cleanName(p.value.name), bizType: 'שותפות - לא בע"מ', type: p.value.ptype || "", status: p.value.status || "" };
  if (row(a)) return { found: true, entityType: "association", name: cleanName(a.value.name), bizType: "עמותה רשומה", type: a.value.category || "", status: a.value.status || "" };
  return null;
}

export async function onRequestGet({ request, env }) {
  const url    = new URL(request.url);
  const number = (url.searchParams.get("number") || "").trim();
  if (!number) {
    return Response.json({ error: "Missing number parameter" }, { status: 400 });
  }
  try {
    const local = await searchRegistryDb(env && env.DB1, number).catch(() => null);
    if (local) return Response.json(local);
    // שלושת הרשמים נשאלים במקביל; מחזירים ברגע שהראשון מוצא (בלי להמתין לאיטי מביניהם)
    const found = await new Promise(resolve => {
      let pending = SOURCES.length;
      SOURCES.forEach(s => searchSource(s, number).catch(() => null).then(r => {
        if (r) resolve(r);
        else if (--pending === 0) resolve(null);
      }));
    });
    if (found) return Response.json(found);
    return Response.json({ found: false });
  } catch (e) {
    return Response.json({ error: "Failed to reach registrar: " + e.message }, { status: 502 });
  }
}
