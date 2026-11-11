// functions/api/fax-history.js
// היסטוריית שליחת פקסים מספק הפקס (שחקים, shchakim.live) - לדף /fax-history בניהול. מנהל בלבד.
//   GET /api/fax-history?year=2026  ->  { ok, year, data }   (data = התשובה של הספק כפי שהיא)
// משתמש באותם סודות של שליחת הפקסים: FAX_API_KEY (חובה), FAX_API_URL (רשות). המפתח לא יוצא לדפדפן.
import { checkAdmin } from "./_shared/auth.js";
import { noAuth } from "./_shared/permit-docs.js";

const DEFAULT_URL = "https://shchakim.live/shch/api/ApiSendFaxShchakim";
const out = (obj, status = 200) => Response.json(obj, { status, headers: { "Cache-Control": "no-store" } });

export async function onRequestGet({ request, env }) {
  if (!(await checkAdmin(request, env))) return noAuth();
  const key = String(env.FAX_API_KEY || "").trim();
  if (!key) return out({ ok: false, error: "FAX_API_KEY לא מוגדר באתר" }, 503);
  const nowYear = new Date().getFullYear();
  const y = Number(new URL(request.url).searchParams.get("year")) || nowYear;
  const year = y >= 2020 && y <= nowYear + 1 ? y : nowYear;
  try {
    const fd = new FormData();
    fd.append("api_key", key); fd.append("action", "history"); fd.append("year", String(year));
    const res = await fetch(env.FAX_API_URL || DEFAULT_URL, { method: "POST", body: fd });
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch { data = text.slice(0, 20000); }
    if (!res.ok) return out({ ok: false, error: `שגיאת ספק הפקס (${res.status})`, data }, 502);
    return out({ ok: true, year, data });
  } catch (e) { return out({ ok: false, error: "החיבור לספק הפקס נכשל: " + (e.message || e) }, 502); }
}
