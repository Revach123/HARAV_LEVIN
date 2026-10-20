import { checkAdmin } from "./_shared/auth.js";
import { noAuth } from "./_shared/permit-docs.js";
import { importKey, decryptPii, importKeyForWrite, encryptPii, identHash } from "./_shared/joiners-crypto.js";
import { normalizeId, normalizePhone, validEmail, clean, originOk, readJson, jerusalemNow, newRowId } from "./_shared/join-common.js";
// רשימת המצטרפים - מנהל בלבד, קריאה בלבד. הפרטים האישיים מוצפנים ב-D1 (AES-256-GCM) ומפוענחים כאן בלבד; לעולם לא נרשמים ללוג.
// GET /api/joiners?offset=0&limit=400      → { total, cancels, rows: [{ id, submitted_at, cancelled_at, file_sha256, ident_hash, first, last, phone, email, id_number, ip, companies, all, extra }] }
// GET /api/joiners?file=<sha256>           → קובץ אישור ההצטרפות (PDF) מהדלי הפרטי (רק קובץ שרשום ב-joiner_files)
// POST   /api/joiners                      → הוספת מצטרף ידנית (מנהל). גוף: { first, last, id, phone, email, companies, all, extra, submitted_at }
// PUT    /api/joiners?id=<מזהה>            → עריכת מצטרף (מנהל): שדות שנשלחו בלבד. { first, last, id_number, phone, email, companies, all, extra, cancelled_at }
// DELETE /api/joiners?id=<מזהה>            → "מחיקה" רכה (מנהל): הרשומה נשארת עם deleted_at (תאריך המחיקה). שחזור: PUT עם { deleted_at: "" }
// כתיבה: רק מנהל, רק מהאתר עצמו (Origin), ורק בפורמט JSON. שדה שלא שונה נשמר כמו שהוא (גם אם הוא בפורמט ישן, כמו טלפון עם מקף).
const H = { "Cache-Control": "no-store" };
// העמודה deleted_at נוספת אוטומטית בפעם הראשונה (מחיקה רכה: הרשומה נשמרת עם תאריך מחיקה)
let colReady = false;
async function ensureCol(env) {
  if (colReady) return;
  try { await env.DB.prepare("SELECT deleted_at FROM joiners LIMIT 1").first(); }
  catch { await env.DB.prepare("ALTER TABLE joiners ADD COLUMN deleted_at TEXT NOT NULL DEFAULT ''").run(); }
  colReady = true;
}
const out = (obj, status = 200) => Response.json(obj, { status, headers: H });
const toRow = (r, p) => ({ id: r.id, submitted_at: r.submitted_at, cancelled_at: r.cancelled_at, deleted_at: r.deleted_at || "", file_sha256: r.file_sha256, ident_hash: r.ident_hash,
  first: p.first || "", last: p.last || "", phone: p.phone || "", email: p.email || "", id_number: p.id || "", ip: p.ip || "", companies: p.companies || "", all: p.all || "", extra: p.extra || "",
  undecryptable: !p.first && !p.last && !p.email && !p.phone ? 1 : 0 });
export async function onRequestGet({ request, env }) {
  if (!(await checkAdmin(request, env))) return noAuth();
  const u = new URL(request.url);
  try {
    const sha = u.searchParams.get("file");
    if (sha) {
      if (!/^[0-9a-f]{64}$/.test(sha)) return Response.json({ error: "מזהה קובץ לא תקין" }, { status: 400, headers: H });
      if (!env.JOINERS) return Response.json({ error: "הדלי של המצטרפים לא מחובר" }, { status: 503, headers: H });
      const row = await env.DB.prepare("SELECT r2_key FROM joiner_files WHERE sha256 = ?").bind(sha).first();
      const obj = row ? await env.JOINERS.get(row.r2_key) : null;
      if (!obj) return Response.json({ error: "הקובץ לא נמצא (ייתכן שעדיין לא הועלה ל-R2)" }, { status: 404, headers: H });
      return new Response(obj.body, { headers: { "Content-Type": "application/pdf", "Content-Disposition": "inline", ...H } });
    }
    const offset = Math.max(0, parseInt(u.searchParams.get("offset") || "0", 10) || 0), limit = Math.min(500, Math.max(1, parseInt(u.searchParams.get("limit") || "400", 10) || 400));
    let key;
    try { key = await importKey(env); } catch { return Response.json({ error: "המפתח JOINERS_KEY לא מוגדר באתר" }, { status: 503, headers: H }); }
    await ensureCol(env);
    const total = (await env.DB.prepare("SELECT COUNT(*) AS n FROM joiners").first()).n;
    const cancels = (await env.DB.prepare("SELECT COUNT(*) AS n FROM joiner_cancels").first()).n;
    const rs = (await env.DB.prepare("SELECT id, submitted_at, cancelled_at, deleted_at, file_sha256, ident_hash, pii FROM joiners ORDER BY submitted_at DESC, id LIMIT ? OFFSET ?").bind(limit, offset).all()).results ?? [];
    const rows = [];
    let bad = 0;
    for (const r of rs) {
      let p = {};
      try { p = await decryptPii(key, r.id, r.pii); } catch { bad++; }
      rows.push(toRow(r, p));
    }
    if (rs.length && bad === rs.length) return Response.json({ error: "הפענוח נכשל: JOINERS_KEY באתר אינו תואם למפתח שבו הוצפנה הרשימה" }, { status: 500, headers: H });
    return Response.json({ total, cancels, rows }, { headers: H });
  } catch (e) {
    return Response.json({ error: "שגיאה בקריאת הרשימה" }, { status: 500, headers: H });
  }
}

// ───────── כתיבה (מנהל בלבד) ─────────
async function guard(request, env) {
  if (!(await checkAdmin(request, env))) return noAuth();
  if (!originOk(request)) return out({ error: "הבקשה לא התקבלה (מקור לא מורשה)" }, 403);
  return null;
}
const DATE = /^\d{4}-\d{2}-\d{2}$/;
// תאריך "YYYY-MM-DD" מהמסך -> "YYYY-MM-DD HH:MM:SS" (שעה נוכחית), כמו שאר הרשומות
const withTime = d => `${d} ${jerusalemNow().slice(11)}`;

function checkFields(b, old) {
  // בודק רק שדות ששונו לעומת הקיים; מחזיר { errors, v } עם הערכים המנוקים
  const errors = {}, v = {};
  const changed = (k, cur) => k in b && String(b[k] ?? "") !== String(cur ?? "");
  if (changed("first", old.first)) { v.first = clean(b.first, 40); if (v.first.length < 2) errors.first = "נא למלא שם פרטי"; }
  if (changed("last", old.last)) { v.last = clean(b.last, 40); if (v.last.length < 2) errors.last = "נא למלא שם משפחה"; }
  if (changed("id_number", old.id)) { const raw = clean(b.id_number, 20); v.id = raw ? normalizeId(raw) : ""; if (raw && !v.id) errors.id_number = "מספר תעודת הזהות אינו תקין"; }
  if (changed("phone", old.phone)) { const raw = clean(b.phone, 30); v.phone = raw ? normalizePhone(raw) : ""; if (raw && !v.phone) errors.phone = "מספר הטלפון אינו תקין"; }
  if (changed("email", old.email)) { v.email = clean(b.email, 120); if (v.email && !validEmail(v.email)) errors.email = "כתובת הדוא\"ל אינה תקינה (אנגלית בלבד)"; }
  if (changed("companies", old.companies)) v.companies = clean(b.companies, 4000);
  if (changed("all", old.all)) v.all = b.all === true || b.all === "כן" ? "כן" : "";
  if (changed("extra", old.extra)) v.extra = String(b.extra ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").slice(0, 4000);
  return { errors, v };
}

export async function onRequestPost({ request, env }) {
  const g = await guard(request, env); if (g) return g;
  const b = await readJson(request, 40 * 1024); if (!b) return out({ error: "הבקשה לא תקינה" }, 400);
  const { errors, v } = checkFields(b, {});
  if (!v.first) errors.first = errors.first || "נא למלא שם פרטי";
  if (!v.last) errors.last = errors.last || "נא למלא שם משפחה";
  if (!v.id && !v.phone && !v.email) errors.phone = errors.phone || "נא למלא לפחות אחד: ת.ז., טלפון או דוא\"ל";
  const when = b.submitted_at ? (DATE.test(String(b.submitted_at)) ? withTime(b.submitted_at) : null) : jerusalemNow();
  if (!when) errors.submitted_at = "תאריך לא תקין";
  if (Object.keys(errors).length) return out({ ok: false, errors }, 422);
  let key; try { key = await importKeyForWrite(env); } catch { return out({ error: "המפתח JOINERS_KEY לא מוגדר באתר" }, 503); }
  try {
    const rid = newRowId(), ih = await identHash(env, v.id || "");
    const payload = { first: v.first, last: v.last, phone: v.phone || "", email: v.email || "", id: v.id || "", ip: "", companies: v.companies || "", all: v.all || "", pdf: "",
      extra: (v.extra || "") + ((v.extra || "") ? " | " : "") + "נוסף ידנית על ידי מנהל", src: "admin" };
    await env.DB.prepare("INSERT INTO joiners (id, submitted_at, cancelled_at, file_sha256, ident_hash, pii) VALUES (?, ?, '', '', ?, ?)").bind(rid, when, ih, await encryptPii(key, rid, payload)).run();
    return out({ ok: true, row: toRow({ id: rid, submitted_at: when, cancelled_at: "", file_sha256: "", ident_hash: ih }, payload) });
  } catch { return out({ error: "שגיאה בשמירה" }, 500); }
}

export async function onRequestPut({ request, env }) {
  const g = await guard(request, env); if (g) return g;
  const id = new URL(request.url).searchParams.get("id") || "";
  const b = await readJson(request, 40 * 1024); if (!id || !b) return out({ error: "הבקשה לא תקינה" }, 400);
  let rkey, wkey; try { rkey = await importKey(env); wkey = await importKeyForWrite(env); } catch { return out({ error: "המפתח JOINERS_KEY לא מוגדר באתר" }, 503); }
  try {
    await ensureCol(env);
    const r = await env.DB.prepare("SELECT id, submitted_at, cancelled_at, deleted_at, file_sha256, ident_hash, pii FROM joiners WHERE id = ?").bind(id).first();
    if (!r) return out({ error: "המצטרף לא נמצא (ייתכן שנמחק)" }, 404);
    let old; try { old = await decryptPii(rkey, r.id, r.pii); } catch { return out({ error: "לא ניתן לפענח את הרשומה, ולכן לא ניתן לערוך אותה" }, 409); }
    const { errors, v } = checkFields(b, old);
    let cancelled = r.cancelled_at;
    if ("cancelled_at" in b) {
      const c = String(b.cancelled_at || "").trim();
      if (c && !DATE.test(c) && !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(c)) errors.cancelled_at = "תאריך ביטול לא תקין";
      else cancelled = c && DATE.test(c) ? withTime(c) : c;
    }
    if (Object.keys(errors).length) return out({ ok: false, errors }, 422);
    const p = { ...old, ...v };
    const ih = "id" in v ? await identHash(env, v.id) : r.ident_hash;
    const deleted = "deleted_at" in b && !String(b.deleted_at || "").trim() ? "" : r.deleted_at;   // שחזור מצטרף שנמחק
    await env.DB.prepare("UPDATE joiners SET pii = ?, ident_hash = ?, cancelled_at = ?, deleted_at = ? WHERE id = ?").bind(await encryptPii(wkey, r.id, p), ih, cancelled, deleted || "", r.id).run();
    return out({ ok: true, row: toRow({ ...r, cancelled_at: cancelled, deleted_at: deleted || "", ident_hash: ih }, p) });
  } catch { return out({ error: "שגיאה בשמירה" }, 500); }
}

export async function onRequestDelete({ request, env }) {
  const g = await guard(request, env); if (g) return g;
  const id = new URL(request.url).searchParams.get("id") || "";
  if (!id) return out({ error: "חסר מזהה" }, 400);
  try {
    await ensureCol(env);
    const r = await env.DB.prepare("SELECT id, deleted_at FROM joiners WHERE id = ?").bind(id).first();
    if (!r) return out({ error: "המצטרף לא נמצא" }, 404);
    const when = r.deleted_at || jerusalemNow();
    if (!r.deleted_at) await env.DB.prepare("UPDATE joiners SET deleted_at = ? WHERE id = ?").bind(when, id).run();
    return out({ ok: true, deleted_at: when });
  } catch { return out({ error: "שגיאה במחיקה" }, 500); }
}
