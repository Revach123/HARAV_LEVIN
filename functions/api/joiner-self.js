// ============================================================================
//  functions/api/joiner-self.js — "הרישומים שלי": מצטרף שה-ת.ז. שלו כבר רשומה מזדהה באמצעות גוגל (אימייל) ומנהל את הרישומים
//  שנרשמו באותה כתובת אימייל: צפייה (מקובץ לפי ת.ז.), תיקון, מחיקה, מיזוג רישומים זהים.
//  GET  ?config=1                         -> { clientId } (ריק אם לא הוגדר GOOGLE_CLIENT_ID)
//  POST { action: "list"|"delete"|"update"|"merge", credential, ... }
//  כל פעולה מאמתת מחדש את ה-ID token מול גוגל, ופועלת רק על רישומים שהאימייל שלהם זהה לאימייל המאומת.
// ============================================================================
import { importKeyForWrite, encryptPii, decryptPii } from "./_shared/joiners-crypto.js";
import { originOk, readJson, clean, normalizePhone, reply } from "./_shared/join-common.js";
import { verifyGoogleToken } from "./_shared/google-id.js";
import { checkAdmin } from "./_shared/auth.js";
import { srcLabel } from "./_shared/joiner-src.js";

const xo = p => { try { const j = JSON.parse(p.extra || ""); return j && typeof j === "object" && !Array.isArray(j) ? j : {}; } catch { return {}; } };

async function loadMine(env, key, email, idn = "") {
  const out = [];
  for (let off = 0; ; off += 500) {
    const rs = (await env.DB.prepare("SELECT id, submitted_at, cancelled_at, file_sha256, pii FROM joiners ORDER BY id LIMIT 500 OFFSET ?").bind(off).all()).results ?? [];
    if (!rs.length) break;
    for (const r of rs) {
      let p; try { p = await decryptPii(key, r.id, r.pii); } catch { continue; }
      if (String(p.email || "").trim().toLowerCase() !== email && !(idn && String(p.id || "").replace(/\D/g, "") === idn)) continue;
      const x = xo(p);
      out.push({ rid: r.id, when: String(r.submitted_at || "").slice(0, 16), cancelled: !!r.cancelled_at, file: r.file_sha256 || "", p,
        view: { rid: r.id, when: String(r.submitted_at || "").slice(0, 10), first: p.first || "", last: p.last || "", id_number: String(p.id || "").replace(/\D/g, ""), phone: p.phone || "", email: p.email || "",
          address: x["כתובת"] || "", fax: x["פקס"] || "", phone2: x["טלפון נוסף"] || "", companies: p.companies || "", all: !!p.all, src: srcLabel(p.src, x), cancelled: !!r.cancelled_at } });
    }
  }
  return out;
}

async function removeRow(env, rid) {
  const r = await env.DB.prepare("SELECT id, file_sha256 FROM joiners WHERE id = ?").bind(rid).first();
  if (!r) return;
  await env.DB.prepare("DELETE FROM joiners WHERE id = ?").bind(rid).run();
  if (r.file_sha256) {
    const other = await env.DB.prepare("SELECT id FROM joiners WHERE file_sha256 = ? LIMIT 1").bind(r.file_sha256).first();
    if (!other) {
      const f = await env.DB.prepare("SELECT r2_key FROM joiner_files WHERE sha256 = ?").bind(r.file_sha256).first();
      if (f) { try { if (env.JOINERS) await env.JOINERS.delete(f.r2_key); } catch {} await env.DB.prepare("DELETE FROM joiner_files WHERE sha256 = ?").bind(r.file_sha256).run(); }
    }
  }
}

export async function onRequestGet({ request, env }) {
  if (new URL(request.url).searchParams.get("config")) return reply({ clientId: String(env.GOOGLE_CLIENT_ID || "").trim() });
  return reply({ error: "not found" }, 404);
}

export async function onRequestPost({ request, env }) {
  if (!originOk(request)) return reply({ ok: false, error: "הבקשה לא התקבלה" }, 403);
  const b = await readJson(request, 20 * 1024);
  if (!b) return reply({ ok: false, error: "הבקשה לא תקינה" }, 400);
  // מנהל (מהניהול): עובד לפי אימייל ו/או ת.ז. בלי הזדהות גוגל. מצטרף מהאתר: הזדהות גוגל (פעילה רק אחרי שהוגדר GOOGLE_CLIENT_ID ופתיחה באתר)
  let who;
  if (b.admin && (await checkAdmin(request, env))) {
    who = { email: String(b.email || "").trim().toLowerCase(), idn: String(b.idn || "").replace(/\D/g, "") };
    if (!who.email && !who.idn) return reply({ ok: false, error: "חסר אימייל או ת.ז." }, 400);
  } else {
    who = await verifyGoogleToken(env, b.credential);
    if (!who) return reply({ ok: false, error: "ההזדהות נכשלה או פגה. נא להזדהות שוב." }, 401);
  }
  let key; try { key = await importKeyForWrite(env); } catch { return reply({ ok: false, error: "השירות אינו זמין כרגע" }, 503); }
  try {
    let mine = await loadMine(env, key, who.email, who.idn || "");
    const find = rid => mine.find(m => m.rid === rid);
    const act = String(b.action || "list");
    if (act === "delete") {
      const m = find(String(b.rid || "")); if (!m) return reply({ ok: false, error: "הרישום לא נמצא תחת כתובת האימייל שלך" }, 404);
      await removeRow(env, m.rid);
    } else if (act === "update") {
      const m = find(String(b.rid || "")); if (!m) return reply({ ok: false, error: "הרישום לא נמצא תחת כתובת האימייל שלך" }, 404);
      const p = m.p, x = xo(p), errors = {};
      if (b.first != null) { const v = clean(b.first, 40); if (v.length < 2) errors.first = "נא למלא שם פרטי"; else p.first = v; }
      if (b.last != null) { const v = clean(b.last, 40); if (v.length < 2) errors.last = "נא למלא שם משפחה"; else p.last = v; }
      if (b.phone != null) { const v = normalizePhone(b.phone); if (!v) errors.phone = "מספר הטלפון אינו תקין"; else p.phone = v; }
      if (b.address != null) { const v = clean(b.address, 160); if (v.length < 3) errors.address = "נא למלא כתובת"; else x["כתובת"] = v; }
      if (Object.keys(errors).length) return reply({ ok: false, errors }, 422);
      x["עודכן ע\"י המצטרף"] = new Date().toISOString().slice(0, 10);
      p.extra = JSON.stringify(x);
      await env.DB.prepare("UPDATE joiners SET pii = ? WHERE id = ?").bind(await encryptPii(key, m.rid, p), m.rid).run();
    } else if (act === "merge") {
      const keep = find(String(b.keep || "")), drop = find(String(b.drop || ""));
      if (!keep || !drop || keep === drop) return reply({ ok: false, error: "הרישומים לא נמצאו תחת כתובת האימייל שלך" }, 404);
      const idk = String(keep.p.id || "").replace(/\D/g, ""), idd = String(drop.p.id || "").replace(/\D/g, "");
      if (!idk || idk !== idd) return reply({ ok: false, error: "אפשר למזג רק רישומים עם אותה ת.ז." }, 400);
      const p = keep.p, x = xo(p), y = xo(drop.p);
      for (const f of ["first", "last", "phone"]) if (!p[f] && drop.p[f]) p[f] = drop.p[f];
      for (const f of ["כתובת", "פקס", "טלפון נוסף"]) if (!x[f] && y[f]) x[f] = y[f];
      if (drop.p.all) p.all = "כן";
      const names = new Set([...String(p.companies || "").split(/\s*,\s*/), ...String(drop.p.companies || "").split(/\s*,\s*/)].filter(Boolean));
      p.companies = [...names].join(", ");
      x["מוזג מרישום"] = drop.when;
      p.extra = JSON.stringify(x);
      await env.DB.prepare("UPDATE joiners SET pii = ? WHERE id = ?").bind(await encryptPii(key, keep.rid, p), keep.rid).run();
      await removeRow(env, drop.rid);
    } else if (act !== "list") return reply({ ok: false, error: "פעולה לא מוכרת" }, 400);
    if (act !== "list") mine = await loadMine(env, key, who.email, who.idn || "");
    return reply({ ok: true, email: who.email, records: mine.map(m => m.view) });
  } catch (e) {
    return reply({ ok: false, error: "אירעה שגיאה. נא לנסות שוב." }, 500);
  }
}
