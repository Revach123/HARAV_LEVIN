// functions/api/join-cancel.js
// קליטת "טופס ביטול" מהאתר (join.html#cancel) לטבלה joiner_cancels (migrations/0017).
//   POST /api/join-cancel   גוף: { name, phone, email, id (אופציונלי), form_date, t, website (honeypot) }
// ת.ז. אופציונלית: אם נמסרה, ומתאימה למצטרף קיים, הוא מסומן אוטומטית כמבוטל (cancelled_at). בלי ת.ז. הבקשה נשמרת והמנהל מתאים ידנית.
// התשובה זהה בכל המקרים (לא חושפת אם מישהו רשום).
import { importKeyForWrite, encryptPii, identHash } from "./_shared/joiners-crypto.js";
import { sendCancelNotice } from "./_shared/join-mail.js";
import { reply, normalizeId, normalizePhone, validEmail, clean, originOk, readJson, jerusalemNow, newRowId } from "./_shared/join-common.js";

export async function onRequestPost({ request, env, waitUntil }) {
  if (!originOk(request)) return reply({ ok: false, error: "הבקשה לא התקבלה" }, 403);
  const b = await readJson(request, 8 * 1024);
  if (!b) return reply({ ok: false, error: "הבקשה לא תקינה" }, 400);
  if (clean(b.website, 50) || (Number(b.t) || 0) < 3000) return reply({ ok: true });

  const name = clean(b.name, 80), phone = normalizePhone(b.phone), email = clean(b.email, 120);
  const rawId = clean(b.id, 20), id = rawId ? normalizeId(rawId) : "";
  const errors = {};
  if (name.length < 2) errors.name = "נא למלא שם";
  if (!phone && !email) errors.phone = "נא למלא טלפון או דוא\"ל";
  if (clean(b.phone, 30) && !phone) errors.phone = "מספר הטלפון אינו תקין";
  if (email && !validEmail(email)) errors.email = "כתובת הדוא\"ל אינה תקינה";
  if (rawId && !id) errors.id = "מספר תעודת הזהות אינו תקין";
  if (Object.keys(errors).length) return reply({ ok: false, errors }, 422);

  let key;
  try { key = await importKeyForWrite(env); } catch { return reply({ ok: false, error: "השירות אינו זמין כרגע. נא לנסות שוב מאוחר יותר." }, 503); }
  try {
    const rid = newRowId(), now = jerusalemNow();
    let matched = "";
    if (id) {
      const ih = await identHash(env, id);
      const r = await env.DB.prepare("UPDATE joiners SET cancelled_at = ? WHERE ident_hash = ? AND cancelled_at = ''").bind(now, ih).run();
      if (r && r.meta && r.meta.changes > 0) matched = "כן";
    }
    const payload = { name, phone, email, id, src: "site:kehilot", form_date: clean(b.form_date, 20) };
    await env.DB.prepare("INSERT INTO joiner_cancels (id, requested_at, matched_joiners, pii) VALUES (?, ?, ?, ?)")
      .bind(rid, now, matched, await encryptPii(key, rid, payload)).run();
    const task = sendCancelNotice(env, { name, phone, email, id, when: now, matched: !!matched });
    if (waitUntil) waitUntil(task); else await task;
    return reply({ ok: true });
  } catch {
    return reply({ ok: false, error: "אירעה שגיאה בשמירת הבקשה. נא לנסות שוב." }, 500);
  }
}
