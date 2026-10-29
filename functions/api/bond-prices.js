// GET /api/bond-prices → { ts, count, prices: { "<מספר נייר>": [שער, "last"|"base", שעת עסקה, שינוי%, ריבית שנתית בבורסה, מועד פדיון בבורסה, מושהה] } }
// הריבית ומועד הפדיון מאותה תשובה: הדף משווה אותם לרשימה, ואם שונו (למשל הפחתת דירוג) לא מציג תשואה מחושבת.
// שערים של כל אג"ח החברות מהנתונים הציבוריים של הבורסה (אותו API ש-market.tase.co.il משתמש בו; עיכוב הבורסה - כ-15 דקות), עם מטמון: טרי עד 90 שניות, ואחר כך מוגש מיד ומתרענן ברקע.
// "last" = שער עסקה אחרון (LastRate); "base" = שער הבסיס כשעוד לא היתה עסקה היום. אותה שיטה כמו revach: functions/api/tase-proxy.js.
// הרשימה עצמה (אילו אג"ח) נשארת הקבצים הסטטיים; כאן רק השער. כשל = 502 והדף ממשיך להציג את השער היומי.
const URL_MD = "https://api.tase.co.il/api/security/securitiesmarketdata";
const HEADERS = { "Content-Type": "application/json;charset=UTF-8", Referer: "https://market.tase.co.il/", "User-Agent": "Mozilla/5.0", Accept: "application/json" };

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
    const ai = parseFloat(it.AnnualInterest), extra = [Number.isFinite(ai) ? ai : null, String(it.RedemptionDate || ""), !!it.SuspendStatus];
    prices[sid] = last > 0 ? [last, "last", it.DealTime || "", it.Change ?? null, ...extra] : [base, "base", it.DealTime || "", null, ...extra];
  }
  return { ts: new Date().toISOString(), count: Object.keys(prices).length, prices };
}

const FRESH = 90, KEEP = 900;          // עד 90 שניות - טרי; אחר כך מוגש מיד ומתרענן ברקע (עד 15 דקות), כך שאף מבקר לא מחכה לשליפה האיטית (כ-30 קריאות לבורסה)
let inflight = null;
function refresh(cache, key) {
  if (inflight) return inflight;
  inflight = (async () => {
    const data = await loadPrices();
    if (data.count < 50) throw new Error("תשובה חלקית מהבורסה (" + data.count + ")");
    if (cache) await cache.put(key, new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${KEEP}`, "X-Fetched": data.ts } })).catch(() => {});
    return data;
  })().finally(() => { inflight = null; });
  return inflight;
}
const out = (body, extra = {}) => new Response(body, { headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=30", "Access-Control-Allow-Origin": "*", ...extra } });

export async function onRequestGet({ request, waitUntil }) {
  const cache = typeof caches !== "undefined" ? caches.default : null, key = new Request(new URL(request.url).origin + "/api/bond-prices");
  let hit = null; try { hit = cache && await cache.match(key); } catch { hit = null; }
  if (hit) {
    const age = (Date.now() - Date.parse(hit.headers.get("X-Fetched") || "")) / 1000;
    if (!(age <= FRESH)) { const p = refresh(cache, key).catch(() => {}); if (typeof waitUntil === "function") waitUntil(p); }
    return out(hit.body);
  }
  try { return out(JSON.stringify(await refresh(cache, key))); }
  catch (e) { return Response.json({ error: String(e.message || e) }, { status: 502, headers: { "Access-Control-Allow-Origin": "*" } }); }
}
