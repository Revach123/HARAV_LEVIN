// functions/api/joiners-confirm.js
// שליחה חוזרת של מייל אישור הצטרפות למצטרפים שנבחרו בניהול (למשל כל מי שנרשם בחודש האחרון). מנהל בלבד, רק מהאתר עצמו.
//   GET  /api/joiners-confirm              → { ok, sent: { מזהה: תאריך שליחה } }  (מי כבר קיבל אישור בשליחה כזו)
//   POST /api/joiners-confirm { ids: [...] } → עד 8 מצטרפים בכל קריאה. תשובה: { ok, sent, skipped, failed, results: [{ id, status }] }
// המייל: אותו אישור כמו בהצטרפות, עם משפט פתיחה "מצורף אישור על הצטרפותך מתאריך …". נשלח פעם אחת למצטרף (טבלת joiner_mail).
import { checkAdmin } from "./_shared/auth.js";
import { noAuth } from "./_shared/permit-docs.js";
import { importKey, decryptPii } from "./_shared/joiners-crypto.js";
import { originOk, readJson } from "./_shared/join-common.js";
import { sendConfirmation } from "./_shared/join-mail.js";

const H = { "Cache-Control": "no-store" };
const out = (obj, status = 200) => Response.json(obj, { status, headers: H });
const BATCH = 8;
const validEmail = v => /^[\x21-\x7e]+@[\x21-\x7e]+\.[\x21-\x7e]{2,}$/.test(v) && !/[<>"']/.test(v);
const table = env => env.DB.prepare("CREATE TABLE IF NOT EXISTS joiner_mail (id TEXT PRIMARY KEY, sent_at TEXT NOT NULL)").run();

export async function onRequestGet({ request, env }) {
  if (!(await checkAdmin(request, env))) return noAuth();
  try { await table(env); } catch { return out({ ok: true, sent: {} }); }
  const rs = (await env.DB.prepare("SELECT id, sent_at FROM joiner_mail").all()).results ?? [];
  return out({ ok: true, sent: Object.fromEntries(rs.map(r => [r.id, r.sent_at])) });
}

export async function onRequestPost({ request, env }) {
  if (!(await checkAdmin(request, env))) return noAuth();
  if (!originOk(request)) return out({ error: "הבקשה לא התקבלה (מקור לא מורשה)" }, 403);
  if (!env.WP_MAIL_URL || !env.WP_MAIL_SECRET) return out({ error: "שליחת מיילים לא מוגדרת באתר (WP_MAIL_URL / WP_MAIL_SECRET)" }, 503);
  const b = (await readJson(request, 8192)) || {};
  const ids = [...new Set((Array.isArray(b.ids) ? b.ids : []).map(String))].slice(0, BATCH);
  if (!ids.length) return out({ error: "לא נבחרו מצטרפים" }, 400);
  let key; try { key = await importKey(env); } catch { return out({ error: "המפתח JOINERS_KEY לא מוגדר באתר" }, 503); }
  await table(env);
  const origin = new URL(request.url).origin, results = [];
  for (const id of ids) {
    const r = await env.DB.prepare("SELECT id, submitted_at, cancelled_at, pii FROM joiners WHERE id = ?").bind(id).first();
    if (!r) { results.push({ id, status: "not_found" }); continue; }
    if (r.cancelled_at) { results.push({ id, status: "cancelled" }); continue; }
    if (await env.DB.prepare("SELECT 1 FROM joiner_mail WHERE id = ?").bind(id).first()) { results.push({ id, status: "already" }); continue; }
    let p; try { p = await decryptPii(key, r.id, r.pii); } catch { results.push({ id, status: "decrypt" }); continue; }
    const email = String(p.email || "").trim();
    if (!validEmail(email)) { results.push({ id, status: "no_email" }); continue; }
    const d = String(r.submitted_at || "").slice(0, 10).split("-").reverse().join("/");
    const companies = String(p.companies || "").split(",").map(x => x.trim()).filter(Boolean);
    const ok = await sendConfirmation(env, email, { first: p.first || "", last: p.last || "", id: p.id || "", date: d, all: !!p.all, companies, origin,
      intro: `מצורף אישור על הצטרפותך מתאריך ${d}.` });
    if (ok) await env.DB.prepare("INSERT OR REPLACE INTO joiner_mail (id, sent_at) VALUES (?, datetime('now'))").bind(id).run();
    results.push({ id, status: ok ? "sent" : "failed" });
  }
  const n = s => results.filter(x => x.status === s).length;
  return out({ ok: true, sent: n("sent"), failed: n("failed"), skipped: results.length - n("sent") - n("failed"), results });
}
