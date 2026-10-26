import { checkAdmin } from "./_shared/auth.js";
import { dataVersion } from "./_shared/data-version.js";
// GET /api/data-version → { biz: { v, s }, docs: { v, s } }: בדיקה קלה אם רשימת העסקים / נתוני המסמכים השתנו (מנהל בלבד)
export async function onRequestGet({ request, env }) {
  if (!(await checkAdmin(request, env))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return Response.json(await dataVersion(env), { headers: { "Cache-Control": "no-store" } });
}
