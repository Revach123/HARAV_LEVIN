// GET /api/bond-prices → { ts, count, prices: { "<מספר נייר>": [שער, "last"|"base", שעת עסקה, שינוי%] } }
// שערים של כל אג"ח החברות מהנתונים הציבוריים של הבורסה (אותו API ש-market.tase.co.il משתמש בו; עיכוב הבורסה - כ-15 דקות), עם מטמון של 2 דקות.
// "last" = שער עסקה אחרון (LastRate); "base" = שער הבסיס כשעוד לא היתה עסקה היום. אותה שיטה כמו revach: functions/api/tase-proxy.js.
// הרשימה עצמה (אילו אג"ח) נשארת הקבצים הסטטיים; כאן רק השער. כשל = 502 והדף ממשיך להציג את השער היומי.
const URL_MD = "https://api.tase.co.il/api/security/securitiesmarketdata";
const HEADERS = { "Content-Type": "application/json;charset=UTF-8", Referer: "https://market.tase.co.il/", "User-Agent": "Mozilla/5.0", Accept: "application/json" };
const TTL = 120;

async function page(n) {
  const r = await fetch(URL_MD, { method: "POST", headers: HEADERS, body: JSON.stringify({ dType: 1, TotalRec: 1, pageNum: n, cl1: "2", cl2: "0", lang: "0" }) });
  if (!r.ok) throw new Error("TASE " + r.status);
  return r.json();
}

export async function loadPrices() {
  const first = await page(1);
  let items = first.Items || [];
  const total = first.TotalRec || items.length, per = items.length;
  if (per && items.length < total) {
    const pages = Math.min(80, Math.ceil(total / per));
    for (const d of await Promise.all(Array.from({ length: pages - 1 }, (_, i) => page(i + 2)))) items = items.concat(d.Items || []);
  }
  const prices = {};
  for (const it of items) {
    const sid = parseInt(String(it.Id), 10), last = Number(it.LastRate), base = Number(it.BaseRate);
    if (!sid || (!(last > 0) && !(base > 0))) continue;
    prices[sid] = last > 0 ? [last, "last", it.DealTime || "", it.Change ?? null] : [base, "base", it.DealTime || "", null];
  }
  return { ts: new Date().toISOString(), count: Object.keys(prices).length, prices };
}

export async function onRequestGet({ request, waitUntil }) {
  const cache = typeof caches !== "undefined" ? caches.default : null, key = new Request(new URL(request.url).origin + "/api/bond-prices");
  try { const hit = cache && await cache.match(key); if (hit) return hit; } catch { /* בלי מטמון */ }
  try {
    const data = await loadPrices();
    if (data.count < 50) throw new Error("תשובה חלקית מהבורסה (" + data.count + ")");
    const res = Response.json(data, { headers: { "Cache-Control": `public, max-age=${TTL}`, "Access-Control-Allow-Origin": "*" } });
    if (cache) { const p = cache.put(key, res.clone()).catch(() => {}); if (typeof waitUntil === "function") waitUntil(p); }
    return res;
  } catch (e) {
    return Response.json({ error: String(e.message || e) }, { status: 502, headers: { "Access-Control-Allow-Origin": "*" } });
  }
}
