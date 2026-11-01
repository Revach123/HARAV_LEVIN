import { checkAdmin } from "./_shared/auth.js";
import { noAuth } from "./_shared/permit-docs.js";
import { importKey, decryptPii, importKeyForWrite, encryptPii, identHash } from "./_shared/joiners-crypto.js";
import { normalizeId, normalizePhone, validEmail, clean, originOk, readJson, jerusalemNow, newRowId } from "./_shared/join-common.js";
// רשימת המצטרפים - מנהל בלבד, קריאה בלבד. הפרטים האישיים מוצפנים ב-D1 (AES-256-GCM) ומפוענחים כאן בלבד; לעולם לא נרשמים ללוג.
// GET /api/joiners?offset=0&limit=400      → { total, cancels, rows: [{ id, submitted_at, cancelled_at, file_sha256, ident_hash, first, last, phone, email, id_number, ip, companies, all, extra }] }
// GET /api/joiners?file=<sha256>           → קובץ אישור ההצטרפות (PDF) מהדלי הפרטי (רק קובץ שרשום ב-joiner_files)
// POST   /api/joiners                      → הוספת מצטרף ידנית (מנהל). גוף: { first, last, id, phone, email, companies, all, extra, submitted_at }
// PUT    /api/joiners?id=<מזהה>            → עריכת מצטרף (מנהל): שדות שנשלחו בלבד. { first, last, id_number, phone, email, companies, all, extra, cancelled_at }
// DELETE /api/joiners?id=<מזהה>            → מחיקת מצטרף (מנהל), כולל קובץ האישור שלו אם אף מצטרף אחר לא משתמש בו
// כתיבה: רק מנהל, רק מהאתר עצמו (Origin), ורק בפורמט JSON. שדה שלא שונה נשמר כמו שהוא (גם אם הוא בפורמט ישן, כמו טלפון עם מקף).
const H = { "Cache-Control": "no-store" };
const out = (obj, status = 200) => Response.json(obj, { status, headers: H });
const toRow = (r, p) => ({ id: r.id, submitted_at: r.submitted_at, cancelled_at: r.cancelled_at, file_sha256: r.file_sha256, ident_hash: r.ident_hash,
  first: p.first || "", last: p.last || "", phone: p.phone || "", email: p.email || "", id_number: p.id || "", ip: p.ip || "", companies: p.companies || "", all: p.all || "", extra: p.extra || "", src: p.src || "",
  undecryptable: !p.first && !p.last && !p.email && !p.phone ? 1 : 0 });
export async function onRequestGet({ request, env }) {
  const u = new URL(request.url);
  // ?domains=1: ספירת סיומות האימייל בלבד (בלי שום פרט אישי) - מנהל, או הרצה אוטומטית עם X-Cron-Secret (workflow joiner-email-domains)
  if (u.searchParams.get("domains")) {
    const cs = request.headers.get("X-Cron-Secret") || "";
    if (!(await checkAdmin(request, env)) && !(env.CRON_SECRET && cs.length === env.CRON_SECRET.length && cs === env.CRON_SECRET)) return noAuth();
    try {
      const key = await importKey(env), counts = {}; let total = 0, withMail = 0, bad = 0;
      for (let off = 0; ; off += 500) {
        const rs = (await env.DB.prepare("SELECT id, pii FROM joiners ORDER BY id LIMIT 500 OFFSET ?").bind(off).all()).results ?? [];
        if (!rs.length) break;
        for (const r of rs) {
          total++;
          let p; try { p = await decryptPii(key, r.id, r.pii); } catch { bad++; continue; }
          const m = String((p && p.email) || "").trim().toLowerCase().match(/@([^@\s]+)$/);
          if (m) { withMail++; counts[m[1]] = (counts[m[1]] || 0) + 1; }
        }
      }
      const domains = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([domain, n]) => ({ domain, n }));
      return out({ total, with_email: withMail, undecryptable: bad, domains });
    } catch (e) { return out({ error: String(e.message || e) }, 500); }
  }
  if (!(await checkAdmin(request, env))) return noAuth();
  // ?typos=1: רשימה מלאה של כתובות אימייל עם שגיאת כתיב מוכרת בסיומת, והתיקון המוצע (מנהל בלבד, JSON).
  // לכל שורה: רישומים דומים (אותה ת.ז. או אותו שם מלא) - עם הכתובת שלהם, כדי לראות אם כבר קיים רישום נוסף עם כתובת תקינה.
  if (u.searchParams.get("typos")) {
    try {
      const key = await importKey(env), all = [], list = [];
      for (let off = 0; ; off += 500) {
        const rs = (await env.DB.prepare("SELECT id, submitted_at, cancelled_at, pii FROM joiners ORDER BY id LIMIT 500 OFFSET ?").bind(off).all()).results ?? [];
        if (!rs.length) break;
        for (const r of rs) {
          let p; try { p = await decryptPii(key, r.id, r.pii); } catch { continue; }
          const em = String((p && p.email) || "").trim(), at = em.lastIndexOf("@");
          const dom = at > 0 ? em.slice(at + 1).toLowerCase() : "", nd = dom ? fixDomain(dom) : "";
          const name = `${p.first || ""} ${p.last || ""}`.replace(/\s+/g, " ").trim();
          all.push({ id: r.id, when: String(r.submitted_at || "").slice(0, 10), cancelled: !!r.cancelled_at, name, idn: String(p.id || "").replace(/\D/g, ""), email: em, bad: !!dom && nd !== dom, fixed: at > 0 && nd !== dom ? em.slice(0, at + 1) + nd : "" });
        }
      }
      const byId = new Map(), byName = new Map();
      const add = (m, k, e) => { if (!k) return; (m.get(k) || m.set(k, []).get(k)).push(e); };
      for (const e of all) { add(byId, e.idn.length >= 5 ? e.idn : "", e); add(byName, e.name.split(" ").length >= 2 ? e.name : "", e); }
      for (const e of all) {
        if (!e.bad) continue;
        const rel = new Map();
        for (const o of byId.get(e.idn.length >= 5 ? e.idn : "") || []) if (o !== e) rel.set(o.id, { o, by: ["ת.ז."] });
        for (const o of byName.get(e.name.split(" ").length >= 2 ? e.name : "") || []) if (o !== e) { const x = rel.get(o.id); if (x) x.by.push("שם"); else rel.set(o.id, { o, by: ["שם"] }); }
        const related = [...rel.values()].slice(0, 8).map(({ o, by }) => ({ id: o.id, id_number: o.idn, when: o.when, name: o.name, email: o.email, by: by.join("+"), cancelled: o.cancelled, bad: o.bad,
          same_fixed: !!e.fixed && o.email.toLowerCase() === e.fixed.toLowerCase(), good_email: !!o.email && !o.bad }));
        list.push({ id: e.id, when: e.when, name: e.name, id_number: e.idn, email: e.email, fixed: e.fixed, related,
          has_good_other: related.some(r => r.by.includes("ת.ז.") && r.good_email) });
      }
      list.sort((a, b) => a.email.split("@")[1].localeCompare(b.email.split("@")[1]) || a.email.localeCompare(b.email));
      return out({ list });
    } catch (e) { return out({ error: String(e.message || e) }, 500); }
  }
  try {
    const sha = u.searchParams.get("file");
    if (sha) {
      if (!/^[0-9a-f]{64}$/.test(sha)) return Response.json({ error: "מזהה קובץ לא תקין" }, { status: 400, headers: H });
      if (!env.JOINERS) return Response.json({ error: "הדלי של המצטרפים לא מחובר" }, { status: 503, headers: H });
      const row = await env.DB.prepare("SELECT r2_key FROM joiner_files WHERE sha256 = ?").bind(sha).first();
      const obj = row ? await env.JOINERS.get(row.r2_key) : null;
      if (!obj) return Response.json({ error: "הקובץ לא נמצא (ייתכן שעדיין לא הועלה ל-R2)" }, { status: 404, headers: H });
      const html = /\.html$/i.test(row.r2_key);   // אישורים שנוצרו באתר החדש הם HTML; מהאתר הישן PDF
      return new Response(obj.body, { headers: { "Content-Type": html ? "text/html; charset=utf-8" : "application/pdf", "Content-Disposition": "inline", ...(html ? { "Content-Security-Policy": "sandbox; default-src 'none'; img-src https:; style-src 'unsafe-inline'" } : {}), ...H } });
    }
    if (u.searchParams.get("count")) {          // מספר המצטרפים בלבד (לכפתור בדף הראשי של הניהול), בלי פענוח
      const c = await env.DB.prepare("SELECT COUNT(*) AS n, SUM(CASE WHEN COALESCE(cancelled_at,'') = '' THEN 1 ELSE 0 END) AS a FROM joiners").first();
      return Response.json({ total: c.n || 0, active: c.a || 0 }, { headers: H });
    }
    const offset = Math.max(0, parseInt(u.searchParams.get("offset") || "0", 10) || 0), limit = Math.min(500, Math.max(1, parseInt(u.searchParams.get("limit") || "400", 10) || 400));
    let key;
    try { key = await importKey(env); } catch { return Response.json({ error: "המפתח JOINERS_KEY לא מוגדר באתר" }, { status: 503, headers: H }); }
    const total = (await env.DB.prepare("SELECT COUNT(*) AS n FROM joiners").first()).n;
    const cancels = (await env.DB.prepare("SELECT COUNT(*) AS n FROM joiner_cancels").first()).n;
    const rs = (await env.DB.prepare("SELECT id, submitted_at, cancelled_at, file_sha256, ident_hash, pii FROM joiners ORDER BY submitted_at DESC, id LIMIT ? OFFSET ?").bind(limit, offset).all()).results ?? [];
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

const TYPO_GMAIL = new Set(["gmil.com", "gamil.com", "gimel.com", "gmail.co", "gmeil.com", "gimal.com", "gmaij.com", "gnail.com", "gmail.con", "jmail.com", "gmial.com", "gmaii.com", "gmai.com", "gail.com", "gimail.com", "gmaul.com", "jmil.com", "gmyl.com", "gmail.co.il", "gmal.com", "gmail.cim", "gmail.comj", "gimil.com", "gmaui.com", "gmail.c0m", "jmel.com", "gmaj.com", "gmeij.com", "gmel.com", "gmaol.com", "gmabl.com", "gmailc.om", "gmil.cim", "gmail.cum", "gtmail.com", "gmkil.ckm", "gmail.comy", "gmgila.com", "gmail.fom", "gmail.cpm", "gmnail.com", "gmiail.com", "gmaul.cum", "gamil.cpm", "gmail.coml", "gmij.com", "gmail.comom", "qmail.com", "gmaum.com", "gwail.com", "gmailk.com", "gmsil.com", "gmqil.com", "gmail.comhu", "ygmqil.com", "gmayl.com", "giamel.com", "gimij.com", "gmamil.com", "gmaik.com", "gmail.com.il", "gumal.com", "gmaill.com", "gmail.cam"]);
const fixDomain = d => TYPO_GMAIL.has(d) ? "gmail.com" : d === "walla.con" ? "walla.com" : d;
// תיקון שגיאות כתיב מוכרות בסיומת האימייל (gmil.com -> gmail.com ...): רק לפי רשימה מפורשת, רק הסיומת (שם המשתמש לא נוגע), עם ?dry=1 לבדיקה בלבד.
// מנהל, או הרצה אוטומטית עם X-Cron-Secret (workflow joiner-email-fix). מחזיר ספירה לפי סיומת בלבד.
async function fixEmailDomains(request, env, dry) {
  const key = await importKeyForWrite(env), changes = {}; let fixed = 0, bad = 0;
  for (let off = 0; ; off += 300) {
    const rs = (await env.DB.prepare("SELECT id, pii FROM joiners ORDER BY id LIMIT 300 OFFSET ?").bind(off).all()).results ?? [];
    if (!rs.length) break;
    for (const r of rs) {
      let p; try { p = await decryptPii(key, r.id, r.pii); } catch { bad++; continue; }
      const em = String((p && p.email) || "").trim(), at = em.lastIndexOf("@");
      if (at < 1) continue;
      const dom = em.slice(at + 1).toLowerCase(), nd = fixDomain(dom);
      if (nd === dom) continue;
      changes[`${dom} -> ${nd}`] = (changes[`${dom} -> ${nd}`] || 0) + 1; fixed++;
      if (dry) continue;
      p.email = em.slice(0, at + 1) + nd;
      try { const x = typeof p.extra === "string" ? JSON.parse(p.extra || "{}") : (p.extra || {}); x["תיקון סיומת אימייל"] = `${dom} -> ${nd}`; p.extra = typeof p.extra === "string" ? JSON.stringify(x) : x; } catch {}
      await env.DB.prepare("UPDATE joiners SET pii = ? WHERE id = ?").bind(await encryptPii(key, r.id, p), r.id).run();
    }
  }
  return { dry: !!dry, fixed, undecryptable: bad, changes: Object.entries(changes).sort((a, b) => b[1] - a[1]).map(([k, n]) => ({ change: k, n })) };
}

export async function onRequestPost({ request, env }) {
  const u0 = new URL(request.url);
  if (u0.searchParams.get("fixdomains")) {
    const cs = request.headers.get("X-Cron-Secret") || "";
    if (!(await checkAdmin(request, env)) && !(env.CRON_SECRET && cs.length === env.CRON_SECRET.length && cs === env.CRON_SECRET)) return noAuth();
    try { return out(await fixEmailDomains(request, env, u0.searchParams.get("dry") === "1")); } catch (e) { return out({ error: String(e.message || e) }, 500); }
  }
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
    const r = await env.DB.prepare("SELECT id, submitted_at, cancelled_at, file_sha256, ident_hash, pii FROM joiners WHERE id = ?").bind(id).first();
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
    await env.DB.prepare("UPDATE joiners SET pii = ?, ident_hash = ?, cancelled_at = ? WHERE id = ?").bind(await encryptPii(wkey, r.id, p), ih, cancelled, r.id).run();
    return out({ ok: true, row: toRow({ ...r, cancelled_at: cancelled, ident_hash: ih }, p) });
  } catch { return out({ error: "שגיאה בשמירה" }, 500); }
}

export async function onRequestDelete({ request, env }) {
  const g = await guard(request, env); if (g) return g;
  const id = new URL(request.url).searchParams.get("id") || "";
  if (!id) return out({ error: "חסר מזהה" }, 400);
  try {
    const r = await env.DB.prepare("SELECT id, file_sha256 FROM joiners WHERE id = ?").bind(id).first();
    if (!r) return out({ error: "המצטרף לא נמצא (ייתכן שכבר נמחק)" }, 404);
    await env.DB.prepare("DELETE FROM joiners WHERE id = ?").bind(id).run();
    let fileDeleted = false;
    if (r.file_sha256) {
      const other = await env.DB.prepare("SELECT id FROM joiners WHERE file_sha256 = ? LIMIT 1").bind(r.file_sha256).first();
      if (!other) {
        const f = await env.DB.prepare("SELECT r2_key FROM joiner_files WHERE sha256 = ?").bind(r.file_sha256).first();
        if (f) { try { if (env.JOINERS) await env.JOINERS.delete(f.r2_key); } catch {} await env.DB.prepare("DELETE FROM joiner_files WHERE sha256 = ?").bind(r.file_sha256).run(); fileDeleted = true; }
      }
    }
    return out({ ok: true, fileDeleted });
  } catch { return out({ error: "שגיאה במחיקה" }, 500); }
}
