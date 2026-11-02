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

// שליחה למצטרפים מנדרים פלוס בטווח תאריכים שעדיין לא קיבלו אישור (מנהל, או הרצה אוטומטית עם X-Cron-Secret ב-workflow joiner-nedarim-send).
//   POST /api/joiners-confirm?nedarim=1  { from: "YYYY-MM-DD", to: "YYYY-MM-DD" (כולל), dry: true|false }
//   dry: רק ספירה. אחרת שולח עד BATCH בקריאה, ומחזיר remaining (לקרוא שוב עד 0). לא שולח למבוטלים, בלי מייל תקין, או למי שכבר קיבל (joiner_mail).
async function sendNedarimRange(request, env) {
  const b = (await readJson(request, 2048)) || {};
  const day = x => (/^\d{4}-\d{2}-\d{2}$/.test(String(x || "")) ? String(x) : "");
  const from = day(b.from), to = day(b.to);
  if (!from || !to) return out({ error: "חסר from / to (YYYY-MM-DD)" }, 400);
  let key; try { key = await importKey(env); } catch { return out({ error: "המפתח JOINERS_KEY לא מוגדר באתר" }, 503); }
  await table(env);
  const end = new Date(Date.parse(to + "T00:00:00Z") + 86400000).toISOString().slice(0, 10);
  const rs = (await env.DB.prepare("SELECT id, submitted_at, cancelled_at, pii FROM joiners WHERE submitted_at >= ? AND submitted_at < ? ORDER BY submitted_at").bind(from, end).all()).results ?? [];
  const mailRows = (await env.DB.prepare("SELECT id, sent_at FROM joiner_mail").all()).results ?? [];
  const sent = new Set(mailRows.map(r => r.id)), sentAt = new Map(mailRows.map(r => [r.id, String(r.sent_at || "")]));
  // כתובות אימייל שכבר קיבלו אישור (גם ממצטרף אחר): לא שולחים אליהן שוב. וגם לא פעמיים לאותה כתובת באותה הרצה.
  // retry (ניסיון חוזר יומי): רק אישור שנשלח מתחילת הטווח נחשב (הגשות כפולות באותו שבוע); אישור על הרשמה ישנה יותר לא מונע אישור להרשמה החדשה
  const recentOnly = !!b.retry;
  const gotEmail = new Set(), sentIds = [...sent].filter(id => !recentOnly || sentAt.get(id) >= from);
  for (let i = 0; i < sentIds.length; i += 90) {
    const ids = sentIds.slice(i, i + 90);
    for (const row of (await env.DB.prepare(`SELECT id, pii FROM joiners WHERE id IN (${ids.map(() => "?").join(",")})`).bind(...ids).all()).results ?? []) {
      try { const q = await decryptPii(key, row.id, row.pii); const e = String(q.email || "").trim().toLowerCase(); if (e) gotEmail.add(e); } catch { /* מדלגים */ }
    }
  }
  const todo = [], seenNow = new Set(); let dupSkipped = 0, noEmail = 0, cancelled = 0, already = 0;
  for (const r of rs) {
    if (r.cancelled_at) { cancelled++; continue; }
    if (sent.has(r.id)) { already++; continue; }
    let p; try { p = await decryptPii(key, r.id, r.pii); } catch { continue; }
    if (!/^nedarim/.test(String(p.src || ""))) continue;
    const email = String(p.email || "").trim();
    if (!validEmail(email)) { noEmail++; continue; }
    const k = email.toLowerCase();
    if (gotEmail.has(k) || seenNow.has(k)) { dupSkipped++; continue; }
    seenNow.add(k);
    todo.push({ r, p, email });
  }
  if (b.dry === true) return out({ ok: true, dry: true, in_range: rs.length, to_send: todo.length, unique_emails: new Set(todo.map(x => x.email.toLowerCase())).size, skipped_same_email: dupSkipped, skipped_no_valid_email: noEmail, skipped_cancelled: cancelled, skipped_already_sent: already });
  if (!env.WP_MAIL_URL || !env.WP_MAIL_SECRET) return out({ error: "שליחת מיילים לא מוגדרת באתר (WP_MAIL_URL / WP_MAIL_SECRET)" }, 503);
  const origin = new URL(request.url).origin; let ok = 0, failed = 0;
  for (const { r, p, email } of todo.slice(0, BATCH)) {
    const d = String(r.submitted_at || "").slice(0, 10).split("-").reverse().join("/");
    const sentOk = await sendConfirmation(env, email, { first: p.first || "", last: p.last || "", id: p.id || "", date: d, all: !!p.all, companies: String(p.companies || "").split(",").map(x => x.trim()).filter(Boolean), origin, intro: `מצורף אישור על הצטרפותך מתאריך ${d}.` });
    if (sentOk) { await env.DB.prepare("INSERT OR REPLACE INTO joiner_mail (id, sent_at) VALUES (?, datetime('now'))").bind(r.id).run(); ok++; } else failed++;
  }
  return out({ ok: true, sent: ok, failed, remaining: Math.max(0, todo.length - ok - failed), to_send_before: todo.length, skipped_same_email: dupSkipped });
}

export async function onRequestPost({ request, env }) {
  if (new URL(request.url).searchParams.get("nedarim")) {
    const cs = request.headers.get("X-Cron-Secret") || "", cron = !!env.CRON_SECRET && cs.length === env.CRON_SECRET.length && cs === env.CRON_SECRET;
    if (!cron && !(await checkAdmin(request, env))) return noAuth();
    if (!cron && !originOk(request)) return out({ error: "הבקשה לא התקבלה (מקור לא מורשה)" }, 403);
    try { return await sendNedarimRange(request, env); } catch (e) { return out({ error: String(e.message || e) }, 500); }
  }
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
