import { checkAdmin } from "./_shared/auth.js";
// GET /api/company-bonds?chp=ח"פ  (ניהול בלבד) - האג"ח הסחירות של חברה, בזמן אמת מ-datawise של הבורסה.
// משמש את חלון "בחירת אג"ח מסוימים" לחברה חדשה שעוד לא נכנסה לקובץ שנבנה בבנייה (maya_securities.json).
// דורש env.TASE_DATAWISE_KEY (סוד של Cloudflare Pages; אותו מפתח של ה-workflow). בלעדיו מוחזר error והחלון ממשיך לעבוד מהקובץ.
//   wrangler pages secret put TASE_DATAWISE_KEY --project-name harav-levin   (ואז פריסה מחדש)

const BASE = "https://datawise.tase.co.il";
const BOND_PREFIXES = ["03", "05", "11", "36"];      // כמו scripts/bonds_list/build_approved_bonds.py
const norm = v => String(v ?? "").trim().replace(/^0+/, "");

async function tradeList(env, ctx) {
  const headers = { accept: "application/json", "accept-language": "he-IL", apikey: env.TASE_DATAWISE_KEY };
  for (let d = 0; d <= 7; d++) {
    const dt = new Date(Date.now() - d * 86400000);
    const path = `/v1/basic-securities/trade-securities-list/${dt.getUTCFullYear()}/${String(dt.getUTCMonth() + 1).padStart(2, "0")}/${String(dt.getUTCDate()).padStart(2, "0")}`;
    const key = new Request(BASE + path);
    const cache = typeof caches !== "undefined" ? caches.default : null;
    let list = null;
    const hit = cache && await cache.match(key);
    if (hit) list = await hit.json();
    else {
      const res = await fetch(BASE + path, { headers });
      if (!res.ok) continue;
      list = (await res.json())?.tradeSecuritiesList?.result || [];
      if (list.length && cache) {
        const slim = list.filter(r => BOND_PREFIXES.includes(String(r.securityFullTypeCode || "").slice(0, 2)))
          .map(r => ({ securityId: r.securityId, securityName: r.securityName, symbol: r.symbol, corporateId: r.corporateId, securityFullTypeCode: r.securityFullTypeCode }));
        ctx?.waitUntil(cache.put(key, new Response(JSON.stringify(slim), { headers: { "Cache-Control": "max-age=900", "Content-Type": "application/json" } })));
        list = slim;
      }
    }
    if (list.length) return { list, date: dt.toISOString().slice(0, 10) };
  }
  return { list: [], date: "" };
}

export async function onRequestGet({ request, env, waitUntil }) {
  if (!(await checkAdmin(request, env))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!env.TASE_DATAWISE_KEY) return Response.json({ ok: false, error: "no_key", message: "לא הוגדר TASE_DATAWISE_KEY ב-Cloudflare Pages" });
  const chp = norm(new URL(request.url).searchParams.get("chp"));
  if (!chp) return Response.json({ ok: false, error: "missing chp" }, { status: 400 });
  try {
    const { list, date } = await tradeList(env, { waitUntil });
    const rows = list
      .filter(r => norm(r.corporateId) === chp && BOND_PREFIXES.includes(String(r.securityFullTypeCode || "").slice(0, 2)))
      .map(r => ({ security_id: Number(r.securityId), name: String(r.securityName || "").trim(), symbol: r.symbol || "" }));
    return Response.json({ ok: true, date, rows });
  } catch (e) {
    return Response.json({ ok: false, error: e.message }, { status: 502 });
  }
}
