// POST /api/sync-registry
// מחזיר תשובה מיידית ומריץ את העדכון ברקע ללא timeout

const SOURCES = [
  { resource: "f004176c-b85f-4542-8901-7b3176f9a054", filterField: "מספר חברה",    nameField: "שם חברה" },
  { resource: "139aa193-fabb-4f6b-a71b-0bb40fd73eb2", filterField: "מספר שותפות", nameField: "שם שותפות" },
  { resource: "be5b7935-3922-45d4-9638-08871b17ec95", filterField: "מספר עמותה",  nameField: "שם עמותה בעברית" },
];

function isAuthed(request, env) {
  return (request.headers.get("Authorization") || "").replace("Bearer ", "").trim() === env.ADMIN_PASSWORD;
}

function cleanName(name) {
  return (name || "").replace(/~/g, '"').replace(/שותפות מוגבלת/g, "").trim().replace(/[.,\-!?~"]+$/, "").trim();
}

async function lookupNumber(number) {
  const results = await Promise.allSettled(
    SOURCES.map(async (src) => {
      const filters = encodeURIComponent(JSON.stringify({ [src.filterField]: number }));
      const res  = await fetch(
        `https://data.gov.il/api/3/action/datastore_search?resource_id=${src.resource}&filters=${filters}&limit=1`,
        { headers: { "User-Agent": "Registry-Updater/1.0" } }
      );
      const json = await res.json();
      const rec  = json?.result?.records?.[0];
      return rec ? cleanName(rec[src.nameField]) : null;
    })
  );
  for (const r of results) if (r.status === "fulfilled" && r.value) return r.value;
  return null;
}

async function doRegistrySync(env) {
  const { results } = await env.DB.prepare(
    `SELECT id, chp_number, registrar_name FROM businesses
     WHERE chp_number IS NOT NULL AND chp_number != ''`
  ).all();

  if (!results.length) return;

  let updated = 0;
  const BATCH = 5;

  for (let i = 0; i < results.length; i += BATCH) {
    await Promise.allSettled(results.slice(i, i + BATCH).map(async (biz) => {
      try {
        const name = await lookupNumber(biz.chp_number);
        if (name && name !== (biz.registrar_name || "").trim()) {
          await env.DB.prepare(
            `UPDATE businesses SET registrar_name=?, updated_at=datetime('now') WHERE id=?`
          ).bind(name, biz.id).run();
          updated++;
        }
      } catch {}
    }));
  }

  console.log(`Registry sync done. Updated: ${updated}/${results.length}`);
}

export async function onRequestPost({ request, env, waitUntil }) {
  if (!isAuthed(request, env)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // מחזיר מיד — העדכון ממשיך ברקע
  waitUntil(doRegistrySync(env));

  return Response.json({
    started: true,
    message: "עדכון שמות מרשם הופעל ברקע — יסתיים תוך מספר דקות",
  });
}
