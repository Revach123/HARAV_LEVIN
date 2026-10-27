import { GROUPS, bump, dataVersion } from "./_shared/data-version.js";

// מטמון קצה (Cloudflare Cache API) לתשובות ציבוריות שנקראות הרבה ומשתנות לעיתים רחוקות: רשימות החברות, קישורי השטרות וקובצי ה-PDF.
// פגיעה במטמון חוסכת את כל שאילתות ה-D1 / קריאת R2 / קידוד base64. שינוי בניהול מתעדכן בציבורי תוך TTL (שניות) לכל היותר.
const EDGE_TTL = { lists: 120, links: 120, doc: 600 };
function edgeTtl(url) {
  const p = url.pathname;
  if (p === "/api/lists") {
    const t = url.searchParams.get("type");
    return (t === "companies-private" || t === "companies-general") && url.searchParams.get("format") !== "csv" ? EDGE_TTL.lists : 0;
  }
  if (p === "/api/permit-docs-public") return EDGE_TTL.links;
  if (/^\/api\/permit-docs-public\/[^/]+$/.test(p)) return EDGE_TTL.doc;
  return 0;
}

// Shared middleware for all API routes
export async function onRequest(context) {
  const { request, next, env } = context;

  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // מטמון קצה: רק GET בלי כותרת Range, והמפתח הוא ה-URL המלא (כולל ?enc=b64 / ?dl=1)
  const reqUrl = new URL(request.url);
  const ttl = request.method === "GET" && !request.headers.has("Range") && typeof caches !== "undefined" && caches.default ? edgeTtl(reqUrl) : 0;
  const cacheKey = ttl ? new Request(reqUrl.toString(), { method: "GET" }) : null;
  if (cacheKey) {
    let hit = null;
    try { hit = await caches.default.match(cacheKey); } catch { hit = null; }
    if (hit) { const h = new Headers(hit.headers); h.set("X-Edge-Cache", "HIT"); return new Response(hit.body, { status: hit.status, headers: h }); }
  }

  // גרסת הנתונים (בדיקת עדכונים בדפדפן): בטעינת הרשימות המלאות - נלקחת לפני הקריאה (הנתונים לפחות חדשים כמוה);
  // אחרי שינוי מוצלח - המונה של הקבוצה עולה, והגרסה החדשה חוזרת בכותרת (כדי שהשינוי של המשתמש עצמו לא ייחשב "עדכון מבחוץ")
  const path = reqUrl.pathname, write = request.method !== "GET" && request.method !== "HEAD";
  const group = Object.keys(GROUPS).find(g => GROUPS[g](path));
  let ver = null;
  if (!write && env.DB && (path === "/api/businesses" || path === "/api/permit-docs")) { try { ver = await dataVersion(env); } catch { ver = null; } }

  const response = await next();

  if (write && group && env.DB && response.ok) { try { await bump(env, group); ver = await dataVersion(env); } catch { ver = null; } }

  // Attach CORS to every response
  const newHeaders = new Headers(response.headers);
  Object.entries(corsHeaders).forEach(([k, v]) => newHeaders.set(k, v));
  if (ver) { newHeaders.set("X-Data-Ver", JSON.stringify(ver)); newHeaders.set("Access-Control-Expose-Headers", "X-Data-Ver"); }

  // נשמרות רק תשובות תקינות (200). קישורי השטרות בכשל חוזרים כ-200 בלי Cache-Control - לא נשמרים
  const storable = cacheKey && response.status === 200 && (path !== "/api/permit-docs-public" || (response.headers.get("Cache-Control") || "").includes("max-age"));
  if (storable) {
    newHeaders.set("Cache-Control", `public, max-age=${ttl}`);
    newHeaders.set("Access-Control-Expose-Headers", "Content-Disposition");
    const out = new Response(response.body, { status: response.status, headers: newHeaders });
    const copy = out.clone();
    const put = caches.default.put(cacheKey, copy).catch(() => {});
    if (context.waitUntil) context.waitUntil(put);
    return out;
  }

  return new Response(response.body, {
    status: response.status,
    headers: newHeaders,
  });
}
