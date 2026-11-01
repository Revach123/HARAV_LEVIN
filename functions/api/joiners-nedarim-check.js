// ============================================================================
//  functions/api/joiners-nedarim-check.js — בדיקה שיש אישור (קובץ אישור הצטרפות) לכל מצטרף מנדרים פלוס, ויצירת אישורים חסרים.
//  POST { after: "<מזהה אחרון>", fix: true|false }  מנהל בלבד. עד 300 רשומות בקריאה (ממוינות לפי מזהה).
//  תשובה: { ok, next ("" כשסיים), scanned, nedarim, with_file, generated, missing, mail_sent, no_email }
//  האישור שנוצר הוא אותו אישור כמו בהצטרפות באתר (HTML בדלי הפרטי), ומשויך למצטרף; שום מייל לא נשלח.
// ============================================================================
import { checkAdmin } from "./_shared/auth.js";
import { noAuth } from "./_shared/permit-docs.js";
import { importKeyForWrite, decryptPii } from "./_shared/joiners-crypto.js";
import { originOk, readJson } from "./_shared/join-common.js";
import { saveConfirmationFile } from "./_shared/join-mail.js";

const BATCH = 300;
const out = (obj, status = 200) => Response.json(obj, { status, headers: { "Cache-Control": "no-store" } });

export async function onRequestPost({ request, env }) {
  if (!(await checkAdmin(request, env))) return noAuth();
  if (!originOk(request)) return out({ error: "הבקשה לא התקבלה (מקור לא מורשה)" }, 403);
  const b = (await readJson(request, 2048)) || {};
  let key; try { key = await importKeyForWrite(env); } catch { return out({ error: "המפתח JOINERS_KEY לא מוגדר באתר" }, 503); }
  const after = String(b.after || ""), fix = b.fix === true, origin = new URL(request.url).origin;
  try {
    const rs = (await env.DB.prepare("SELECT id, submitted_at, cancelled_at, file_sha256, pii FROM joiners WHERE id > ? ORDER BY id LIMIT ?").bind(after, BATCH).all()).results ?? [];
    let nedarim = 0, withFile = 0, generated = 0, missing = 0, noEmail = 0, mailSent = 0;
    let sent = new Set(); try { sent = new Set(((await env.DB.prepare("SELECT id FROM joiner_mail").all()).results ?? []).map(r => r.id)); } catch { /* אין טבלה */ }
    for (const r of rs) {
      let p; try { p = await decryptPii(key, r.id, r.pii); } catch { continue; }
      if (!/^nedarim/.test(String(p.src || ""))) continue;
      nedarim++;
      if (!/^[\x21-\x7e]+@[\x21-\x7e]+\.[\x21-\x7e]{2,}$/.test(String(p.email || "").trim())) noEmail++;
      if (sent.has(r.id)) mailSent++;
      if (r.file_sha256) { withFile++; continue; }
      if (r.cancelled_at) continue;
      if (!fix) { missing++; continue; }
      const sha = await saveConfirmationFile(env, { first: p.first || "", last: p.last || "", id: p.id || "", date: String(r.submitted_at || "").slice(0, 10).split("-").reverse().join("/"), all: false, companies: [], origin });
      if (sha) { await env.DB.prepare("UPDATE joiners SET file_sha256 = ? WHERE id = ?").bind(sha, r.id).run(); generated++; } else missing++;
    }
    return out({ ok: true, next: rs.length === BATCH ? rs[rs.length - 1].id : "", scanned: rs.length, nedarim, with_file: withFile, generated, missing, mail_sent: mailSent, no_email: noEmail });
  } catch (e) { return out({ error: String(e.message || e) }, 500); }
}
