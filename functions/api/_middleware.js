import { GROUPS, bump, dataVersion } from "./_shared/data-version.js";

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

  // גרסת הנתונים (בדיקת עדכונים בדפדפן): בטעינת הרשימות המלאות - נלקחת לפני הקריאה (הנתונים לפחות חדשים כמוה);
  // אחרי שינוי מוצלח - המונה של הקבוצה עולה, והגרסה החדשה חוזרת בכותרת (כדי שהשינוי של המשתמש עצמו לא ייחשב "עדכון מבחוץ")
  const path = new URL(request.url).pathname, write = request.method !== "GET" && request.method !== "HEAD";
  const group = Object.keys(GROUPS).find(g => GROUPS[g](path));
  let ver = null;
  if (!write && env.DB && (path === "/api/businesses" || path === "/api/permit-docs")) { try { ver = await dataVersion(env); } catch { ver = null; } }

  const response = await next();

  if (write && group && env.DB && response.ok) { try { await bump(env, group); ver = await dataVersion(env); } catch { ver = null; } }

  // Attach CORS to every response
  const newHeaders = new Headers(response.headers);
  Object.entries(corsHeaders).forEach(([k, v]) => newHeaders.set(k, v));
  if (ver) { newHeaders.set("X-Data-Ver", JSON.stringify(ver)); newHeaders.set("Access-Control-Expose-Headers", "X-Data-Ver"); }

  return new Response(response.body, {
    status: response.status,
    headers: newHeaders,
  });
}
