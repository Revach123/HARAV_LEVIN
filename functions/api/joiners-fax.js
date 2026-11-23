// functions/api/joiners-fax.js
// שליחה ידנית של אישור ההצטרפות בפקס, מניהול המצטרפים. מנהל בלבד, רק מהאתר עצמו.
//   POST /api/joiners-fax { id, fax? } → { ok, status: "pending" }   fax ריק = מספר הפקס שנשמר ברישום
// אותו אישור כמו במייל (buildConfirmation), עם משפט פתיחה "מצורף אישור על הצטרפותך מתאריך …". ההפקה והשליחה: התור join_fax_confirm (_shared/join-fax-confirm.js).
// אפשר לשלוח שוב גם למי שכבר קיבל (למשל מספר אחר) - המגבלות של הקו (5 ביום לאותו מספר, FAX_DAILY_MAX ביום) חלות גם כאן.
import { checkAdmin } from "./_shared/auth.js";
import { noAuth } from "./_shared/permit-docs.js";
import { importKey, decryptPii, encryptPii, importKeyForWrite } from "./_shared/joiners-crypto.js";
import { originOk, readJson } from "./_shared/join-common.js";
import { queueFaxConfirmation } from "./_shared/join-fax-confirm.js";
import { normFax } from "./_shared/ivr-fax.js";

const out = (obj, status = 200) => Response.json(obj, { status, headers: { "Cache-Control": "no-store" } });

export async function onRequestPost({ request, env, waitUntil }) {
  if (!(await checkAdmin(request, env))) return noAuth();
  if (!originOk(request)) return out({ error: "הבקשה לא התקבלה (מקור לא מורשה)" }, 403);
  if (!String(env.FAX_API_KEY || "").trim() || String(env.FAX_OFF || "") === "1") return out({ error: "שליחת פקסים אינה מוגדרת באתר (FAX_API_KEY), או כבויה (FAX_OFF)" }, 503);
  const b = (await readJson(request, 2048)) || {};
  const id = String(b.id || "");
  const r = id && await env.DB.prepare("SELECT id, submitted_at, cancelled_at, pii FROM joiners WHERE id = ?").bind(id).first();
  if (!r) return out({ error: "הרישום לא נמצא" }, 404);
  if (r.cancelled_at) return out({ error: "הרישום בוטל" }, 400);
  let key; try { key = await importKey(env); } catch { return out({ error: "המפתח JOINERS_KEY לא מוגדר באתר" }, 503); }
  let p; try { p = await decryptPii(key, r.id, r.pii); } catch { return out({ error: "לא ניתן לפענח את הרישום" }, 500); }
  let x = {}; try { x = JSON.parse(p.extra || "{}") || {}; } catch { x = {}; }
  const fax = normFax(b.fax || x["פקס"] || "");
  if (!fax) return out({ error: "מספר הפקס אינו תקין" }, 400);
  if (b.fax && normFax(x["פקס"] || "") !== fax) {          // מספר חדש שהוקלד: נשמר ברישום
    try { x["פקס"] = fax; await env.DB.prepare("UPDATE joiners SET pii = ? WHERE id = ?").bind(await encryptPii(await importKeyForWrite(env), r.id, { ...p, extra: JSON.stringify(x) }), r.id).run(); } catch { /* השליחה ממשיכה */ }
  }
  const d = String(r.submitted_at || "").slice(0, 10).split("-").reverse().join("/");
  const companies = String(p.companies || "").split(",").map(s => s.trim()).filter(Boolean);
  const ok = await queueFaxConfirmation(env, waitUntil, "adm", fax, { first: p.first || "", last: p.last || "", id: p.id || "", date: d, all: !!p.all, companies,
    origin: new URL(request.url).origin, intro: `מצורף אישור על הצטרפותך מתאריך ${d}.` }, r.id);
  return ok ? out({ ok: true, status: "pending" }) : out({ error: "הרישום לתור הפקסים נכשל" }, 500);
}
