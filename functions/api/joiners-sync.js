// functions/api/joiners-sync.js
// סנכרון מצטרפים חדשים וקובצי אישור (PDF) ישירות מהאתר הישן החי (וורדפרס), בלי גיבוי. מנהל בלבד, רק מהאתר עצמו (Origin).
// דורש בוורדפרס את הקטע wp-sync-endpoint.php (WPCode), ובאתר החדש WP_MAIL_URL ו-WP_MAIL_SECRET (אותה סיסמה).
//   POST /api/joiners-sync  { phase: "new" }                → עד 8 הגשות חדשות (מעבר ל-"נקודת ההמשך" השמורה). תשובה: { ok, added, existing, pdfs, more }
//   POST /api/joiners-sync  { phase: "cancels" }            → עד 8 בקשות ביטול חדשות (טופס 118) לטבלת joiner_cancels. תשובה: { ok, added, existing, more }
//   POST /api/joiners-sync  { phase: "backfill", offset: N } → משלים קובץ אישור למצטרפים אחרונים (90 יום) שחסר להם. תשובה: { ok, checked, pdfs, more }
// הלקוח קורא שוב ושוב עד more=false. שורה שכבר קיימת (אותו מזהה כמו בייבוא הישן) לא נדרסת.
import { checkAdmin } from "./_shared/auth.js";
import { noAuth } from "./_shared/permit-docs.js";
import { importKey, importKeyForWrite, encryptPii, decryptPii, identHash } from "./_shared/joiners-crypto.js";
import { originOk, readJson, clean } from "./_shared/join-common.js";

const H = { "Cache-Control": "no-store" };
const out = (obj, status = 200) => Response.json(obj, { status, headers: H });
const BATCH = 8, DEFAULT_SINCE = 5000, SETTING = "cfdb7_last_id_91", SETTING_C = "cfdb7_last_id_118";
const sha1_16 = async s => [...new Uint8Array(await crypto.subtle.digest("SHA-1", new TextEncoder().encode(s)))].map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
const sha256 = async buf => [...new Uint8Array(await crypto.subtle.digest("SHA-256", buf))].map(b => b.toString(16).padStart(2, "0")).join("");
const g = (f, ...names) => { for (const n of names) { const v = String(f[n] ?? "").trim(); if (v) return v; } return ""; };

// שדות גולמיים של CFDB7 -> מבנה הרשומה במאגר (כמו joiners-import.js, אבל מהשמות המקוריים של השדות)
export function mapFields(f) {
  const phone = g(f, "tel-780") || g(f, "tel-760"), phone2 = g(f, "tel-780") ? g(f, "tel-760") : "";
  const extra = {};
  if (phone2) extra["טלפון נוסף"] = phone2;
  if (g(f, "tel-860")) extra["כתובת"] = g(f, "tel-860");
  if (g(f, "MydatePicker", "mydatepicker")) extra["תאריך בטופס"] = g(f, "MydatePicker", "mydatepicker");
  return {
    first: clean(g(f, "private"), 60), last: clean(g(f, "family"), 60), phone: clean(phone, 40), email: clean(g(f, "your-email", "email", "youremail", "your-email2"), 120),
    id: clean(g(f, "id-number"), 20), ip: clean(g(f, "submit_ip"), 60), companies: clean(g(f, "companys"), 4000),
    all: /כל החברות/.test(g(f, "checkbox-640")) ? "כן" : "", pdf: clean(g(f, "wpcf7cfpdf_hidden_name"), 200),
    extra: Object.keys(extra).length ? JSON.stringify(extra) : "",
  };
}

function wpBase(env) { try { return new URL(env.WP_MAIL_URL).origin + "/wp-json/iska/v1/"; } catch { return ""; } }
async function wp(env, path, params) {
  const base = wpBase(env); if (!base || !env.WP_MAIL_SECRET) throw new Error("חיבור לוורדפרס לא מוגדר (WP_MAIL_URL / WP_MAIL_SECRET)");
  const r = await fetch(base + path + "?" + new URLSearchParams(params), { headers: { "X-Iska-Secret": env.WP_MAIL_SECRET } });
  if (r.status === 404 && path === "cf7-rows") throw new Error("הקטע wp-sync-endpoint.php לא פעיל באתר הישן (נתיב לא נמצא)");
  if (r.status === 403) throw new Error("הסיסמה בוורדפרס אינה זהה ל-WP_MAIL_SECRET");
  const j = await r.json().catch(() => null);
  if (!r.ok || !j) { const e = new Error((j && j.error) || "שגיאה מהאתר הישן (" + r.status + ")"); e.status = r.status; throw e; }
  return j;
}

// מושך את קובץ ה-PDF מהאתר הישן, שומר ב-R2 (לפי תוכן) ורושם ב-joiner_files. מחזיר sha256, או "" אם לא נמצא.
async function fetchPdf(env, name) {
  if (!name || !env.JOINERS) return "";
  let j; try { j = await wp(env, "cf7-pdf", { form: "91", name }); } catch { return ""; }
  if (!j.b64) return "";
  const bin = atob(j.b64), buf = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  const sha = await sha256(buf), key = `forms/91/${sha}.pdf`;
  await env.JOINERS.put(key, buf, { httpMetadata: { contentType: "application/pdf" } });
  await env.DB.prepare("INSERT OR REPLACE INTO joiner_files (sha256, original_name, r2_key, size) VALUES (?, ?, ?, ?)").bind(sha, name, key, buf.length).run();
  return sha;
}

async function getSetting(env, k) { try { const r = await env.DB.prepare("SELECT value FROM admin_settings WHERE key = ?").bind(k).first(); return r ? r.value : null; } catch { return null; } }
async function setSetting(env, k, v) {
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS admin_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)").run();
  await env.DB.prepare("INSERT OR REPLACE INTO admin_settings (key, value) VALUES (?, ?)").bind(k, String(v)).run();
}

export async function onRequestPost({ request, env }) {
  if (!(await checkAdmin(request, env))) return noAuth();
  if (!originOk(request)) return out({ error: "הבקשה לא התקבלה (מקור לא מורשה)" }, 403);
  const b = (await readJson(request, 4096)) || {};
  let wkey, rkey; try { wkey = await importKeyForWrite(env); rkey = await importKey(env); } catch { return out({ error: "המפתח JOINERS_KEY לא מוגדר באתר" }, 503); }
  try {
    if (b.phase === "backfill") {
      const off = Math.max(0, Math.min(2000, parseInt(b.offset, 10) || 0));
      const rs = (await env.DB.prepare("SELECT id, pii FROM joiners WHERE file_sha256 = '' AND submitted_at >= date('now', '-90 days') ORDER BY submitted_at DESC, id LIMIT ? OFFSET ?").bind(BATCH, off).all()).results ?? [];
      let pdfs = 0;
      for (const r of rs) {
        let p = {}; try { p = await decryptPii(rkey, r.id, r.pii); } catch { continue; }
        if (!p.pdf || p.src === "site:kehilot") continue;
        const sha = await fetchPdf(env, p.pdf);
        if (sha) { await env.DB.prepare("UPDATE joiners SET file_sha256 = ? WHERE id = ?").bind(sha, r.id).run(); pdfs++; }
      }
      return out({ ok: true, phase: "backfill", checked: rs.length, pdfs, more: rs.length === BATCH && off + BATCH < 2000 });
    }
    if (b.phase === "cancels") {
      const saved = parseInt(await getSetting(env, SETTING_C), 10), since = Number.isFinite(saved) ? saved : 0;
      const j = await wp(env, "cf7-rows", { form: "118", since_id: String(since), limit: String(BATCH) });
      let added = 0, existing = 0, last = since;
      for (const r of j.rows || []) {
        last = Math.max(last, r.id);
        const rid = await sha1_16("cancel:cfdb7:" + r.id);       // כמו joiners_import.py: sid("cancel:" + "cfdb7:<Id>")
        if (await env.DB.prepare("SELECT id FROM joiner_cancels WHERE id = ?").bind(rid).first()) { existing++; continue; }
        const f = r.fields || {}, when = String(r.date || "").slice(0, 19);
        const payload = { name: clean(g(f, "your-name"), 80), phone: clean(g(f, "tel-297"), 40), email: clean(g(f, "your-email"), 120), id: "", src: "cfdb7:" + r.id + " (sync)", form_date: clean(g(f, "date-475"), 20) };
        if (!when || (!payload.name && !payload.phone && !payload.email)) continue;
        await env.DB.prepare("INSERT INTO joiner_cancels (id, requested_at, matched_joiners, pii) VALUES (?, ?, '', ?)").bind(rid, when, await encryptPii(wkey, rid, payload)).run();
        added++;
      }
      if (last !== since) await setSetting(env, SETTING_C, last);
      return out({ ok: true, phase: "cancels", added, existing, more: (j.rows || []).length === BATCH });
    }
    // phase "new"
    const saved = parseInt(await getSetting(env, SETTING), 10);
    const since = Number.isFinite(saved) ? saved : DEFAULT_SINCE;
    const j = await wp(env, "cf7-rows", { form: "91", since_id: String(since), limit: String(BATCH) });
    let added = 0, existing = 0, pdfs = 0, last = since;
    for (const r of j.rows || []) {
      last = Math.max(last, r.id);
      const rid = await sha1_16("cfdb7:" + r.id);
      if (await env.DB.prepare("SELECT id FROM joiners WHERE id = ?").bind(rid).first()) { existing++; continue; }
      const p = mapFields(r.fields || {});
      const when = String(r.date || "").slice(0, 19);
      if (!when || (!p.first && !p.last && !p.phone && !p.email && !p.id)) continue;
      let sha = ""; try { sha = await fetchPdf(env, p.pdf); } catch { sha = ""; }
      if (sha) pdfs++;
      const digits = p.id.replace(/\D/g, "");
      await env.DB.prepare("INSERT INTO joiners (id, submitted_at, cancelled_at, file_sha256, ident_hash, pii) VALUES (?, ?, '', ?, ?, ?)")
        .bind(rid, when, sha, digits ? await identHash(env, digits) : "", await encryptPii(wkey, rid, { ...p, src: "cfdb7:" + r.id + " (sync)" })).run();
      added++;
    }
    if (last !== since) await setSetting(env, SETTING, last);
    return out({ ok: true, phase: "new", added, existing, pdfs, more: (j.rows || []).length === BATCH, last_id: last, wp_max_id: j.max_id });
  } catch (e) { return out({ error: e && e.message ? e.message : "שגיאה בסנכרון" }, 502); }
}
