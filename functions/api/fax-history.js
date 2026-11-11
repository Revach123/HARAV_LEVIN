// functions/api/fax-history.js
// היסטוריית שליחת פקסים מספק הפקס (שחקים, shchakim.live) - לדף /fax-history בניהול. מנהל בלבד.
//   GET /api/fax-history?year=2026  ->  { ok, year, data }   (data = התשובה של הספק כפי שהיא)
//   GET /api/fax-history?log=1      ->  { ok, rows }          (היומן שלנו של שליחות מהקו הטלפוני: ivr_fax_log - מתי, חברה, שטר, מספר פקס, תוצאה ותשובת הספק)
// משתמש באותם סודות של שליחת הפקסים: FAX_API_KEY (חובה), FAX_API_URL (רשות). המפתח לא יוצא לדפדפן.
import { checkAdmin } from "./_shared/auth.js";
import { noAuth } from "./_shared/permit-docs.js";

const DEFAULT_URL = "https://shchakim.live/shch/api/ApiSendFaxShchakim";
const out = (obj, status = 200) => Response.json(obj, { status, headers: { "Cache-Control": "no-store" } });

export async function onRequestGet({ request, env }) {
  if (!(await checkAdmin(request, env))) return noAuth();
  if (new URL(request.url).searchParams.get("log")) {
    try {
      const rows = (await env.DB.prepare("SELECT id, at, company, chp, kind, doc_id, fax, caller, status, response FROM ivr_fax_log ORDER BY id DESC LIMIT 200").all()).results || [];
      return out({ ok: true, rows });
    } catch (e) { return out({ ok: true, rows: [], note: /no such table/i.test(String(e.message)) ? "עדיין לא נשלח אף פקס מהקו הטלפוני" : String(e.message) }); }
  }
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
