// ============================================================================
//  functions/api/joiners-nedarim-check.js — בדיקה (קריאה בלבד) אם יש אישור לכל מצטרף מנדרים פלוס: קובץ אישור + מייל אישור שנשלח.
//  POST { after: "<מזהה אחרון>", items: true }  מנהל או X-Cron-Secret. עד 300 רשומות בקריאה (ממוינות לפי מזהה). לא יוצר ולא משנה כלום.
//  תשובה: { ok, next ("" כשסיים), scanned, nedarim, with_file, missing, mail_sent, no_email, items: [[תאריך, יש קובץ, נשלח מייל, יש מייל תקין]] }
// ============================================================================
import { checkAdmin } from "./_shared/auth.js";
import { noAuth } from "./_shared/permit-docs.js";
import { importKeyForWrite, decryptPii } from "./_shared/joiners-crypto.js";
import { originOk, readJson } from "./_shared/join-common.js";

const BATCH = 300;
const out = (obj, status = 200) => Response.json(obj, { status, headers: { "Cache-Control": "no-store" } });

export async function onRequestPost({ request, env }) {
  const cs = request.headers.get("X-Cron-Secret") || "", cron = !!env.CRON_SECRET && cs.length === env.CRON_SECRET.length && cs === env.CRON_SECRET;
  if (!cron && !(await checkAdmin(request, env))) return noAuth();
  if (!cron && !originOk(request)) return out({ error: "הבקשה לא התקבלה (מקור לא מורשה)" }, 403);
  const b = (await readJson(request, 2048)) || {};
  let key; try { key = await importKeyForWrite(env); } catch { return out({ error: "המפתח JOINERS_KEY לא מוגדר באתר" }, 503); }
  const after = String(b.after || ""), items = [];
  try {
    const rs = (await env.DB.prepare("SELECT id, submitted_at, cancelled_at, file_sha256, pii FROM joiners WHERE id > ? ORDER BY id LIMIT ?").bind(after, BATCH).all()).results ?? [];
    let nedarim = 0, withFile = 0, missing = 0, noEmail = 0, mailSent = 0;
    let sent = new Set(); try { sent = new Set(((await env.DB.prepare("SELECT id FROM joiner_mail").all()).results ?? []).map(r => r.id)); } catch { /* אין טבלה */ }
    for (const r of rs) {
      let p; try { p = await decryptPii(key, r.id, r.pii); } catch { continue; }
      if (!/^nedarim/.test(String(p.src || ""))) continue;
      nedarim++;
      const okMail = /^[\x21-\x7e]+@[\x21-\x7e]+\.[\x21-\x7e]{2,}$/.test(String(p.email || "").trim());
      if (!okMail) noEmail++;
      const sentMail = sent.has(r.id); if (sentMail) mailSent++;
      if (r.file_sha256) withFile++; else if (!r.cancelled_at) missing++;
      if (b.items) items.push([String(r.submitted_at || "").slice(0, 16), r.file_sha256 ? 1 : 0, sentMail ? 1 : 0, okMail ? 1 : 0, r.cancelled_at ? 1 : 0]);
    }
    return out({ ok: true, next: rs.length === BATCH ? rs[rs.length - 1].id : "", scanned: rs.length, nedarim, with_file: withFile, missing, mail_sent: mailSent, no_email: noEmail, ...(b.items ? { items } : {}) });
  } catch (e) { return out({ error: String(e.message || e) }, 500); }
}
