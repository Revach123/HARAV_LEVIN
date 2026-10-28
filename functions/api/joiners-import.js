// functions/api/joiners-import.js
// ייבוא מצטרפים חדשים מייצוא CSV של התוסף CFDB7 (טופס 91 באתר הישן). מנהל בלבד, רק מהאתר עצמו (Origin).
//   POST /api/joiners-import   גוף: { dry: true|false, rows: [ { id, date, private, family, "id number", "tel 760", "tel 780", email, "tel 860", companys, "checkbox 640", ... } ] }  (עד 500 שורות)
//   תשובה: { ok, total, added, existing, skipped }.  dry=true רק בודק ולא כותב.
// מזהה השורה זהה לזה של joiners_import.py (sha1 של "cfdb7:<Id>"), ולכן שורה שכבר יובאה (גם בייבוא הישן) לא תיכנס שוב, ושום רשומה קיימת לא נדרסת (עריכות וביטולים נשמרים).
import { checkAdmin } from "./_shared/auth.js";
import { noAuth } from "./_shared/permit-docs.js";
import { importKeyForWrite, encryptPii, identHash } from "./_shared/joiners-crypto.js";
import { originOk, readJson, clean, normalizePhone, jerusalemNow } from "./_shared/join-common.js";

const H = { "Cache-Control": "no-store" };
const out = (obj, status = 200) => Response.json(obj, { status, headers: H });
const sha1_16 = async s => [...new Uint8Array(await crypto.subtle.digest("SHA-1", new TextEncoder().encode(s)))].map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
const g = (r, k) => String(r[k] ?? "").trim();

// "20/10/2026 14:25" או "2026-10-20 14:25:00" -> "YYYY-MM-DD HH:MM:SS"
export function parseDate(s) {
  s = String(s || "").trim();
  let m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")} ${(m[4] || "00").padStart(2, "0")}:${m[5] || "00"}:${m[6] || "00"}`;
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) return `${m[1]}-${m[2]}-${m[3]} ${m[4] || "00"}:${m[5] || "00"}:${m[6] || "00"}`;
  return "";
}

export function mapRow(r) {
  const phone = g(r, "tel 780") || g(r, "tel 760");
  const phone2 = g(r, "tel 780") ? g(r, "tel 760") : "";
  const extra = {};
  if (phone2) extra["טלפון נוסף"] = phone2;
  if (g(r, "tel 860")) extra["כתובת"] = g(r, "tel 860");
  if (g(r, "mydatepicker")) extra["תאריך בטופס"] = g(r, "mydatepicker");
  const choice = g(r, "checkbox 640");
  return {
    first: clean(g(r, "private"), 60), last: clean(g(r, "family"), 60), phone: clean(phone, 40), email: clean(g(r, "email"), 120), id: clean(g(r, "id number"), 20), ip: "",
    companies: clean(g(r, "companys"), 4000), all: /כל החברות/.test(choice) ? "כן" : "", pdf: clean(g(r, "wpcf7cfpdf hidden name"), 200),
    extra: Object.keys(extra).length ? JSON.stringify(extra) : "", src: "cfdb7:" + g(r, "id") + " (csv)",
  };
}

// ייבוא רשימה מקובץ כלשהו (Excel / CSV של קהילה וכד'): הדפדפן ממפה את העמודות ושולח שורות מוכנות { first, last, phone, email, id, addr, companies, note, date, extra }.
// כפילות: אותה ת.ז. שכבר במאגר (ident_hash, מכל מקור) או אותה שורה מאותו מקור (ת.ז. / טלפון / מייל / שם) - לא נכנסת שוב ושום רשומה קיימת לא נדרסת. dry=true רק בודק.
export async function importMapped(b, env) {
  const label = clean(b.source, 60) || "קובץ";
  let key; try { key = await importKeyForWrite(env); } catch { return out({ error: "המפתח JOINERS_KEY לא מוגדר באתר" }, 503); }
  let added = 0, existing = 0, skipped = 0;
  const seen = new Set();
  try {
    for (const r of b.rows) {
      const x = {};
      if (clean(r.addr, 200)) x["כתובת"] = clean(r.addr, 200);
      if (clean(r.note, 400)) x["הערה"] = clean(r.note, 400);
      for (const [k, v] of Object.entries(r.extra && typeof r.extra === "object" ? r.extra : {})) if (clean(v, 300)) x[clean(k, 40)] = clean(v, 300);
      x["מקור הרשימה"] = label;
      const p = { first: clean(r.first, 60), last: clean(r.last, 60), phone: clean(r.phone, 40), email: clean(r.email, 120), id: clean(r.id, 20), ip: "", companies: clean(r.companies, 4000), all: "", pdf: "",
        extra: JSON.stringify(x), src: "import:" + label };
      if (!p.first && !p.last && !p.phone && !p.email && !p.id) { skipped++; continue; }
      const digits = p.id.replace(/\D/g, "");
      const k = digits || normalizePhone(p.phone) || p.email.toLowerCase() || p.first + "|" + p.last;
      const rid = await sha1_16("import:" + label + ":" + k);
      if (seen.has(rid)) { skipped++; continue; } seen.add(rid);
      if (await env.DB.prepare("SELECT id FROM joiners WHERE id = ?").bind(rid).first()) { existing++; continue; }
      const ih = digits ? await identHash(env, digits) : "";
      if (ih && await env.DB.prepare("SELECT id FROM joiners WHERE ident_hash = ?").bind(ih).first()) { existing++; continue; }
      if (!b.dry) {
        const when = parseDate(g(r, "date")) || jerusalemNow();
        await env.DB.prepare("INSERT INTO joiners (id, submitted_at, cancelled_at, file_sha256, ident_hash, pii) VALUES (?, ?, '', '', ?, ?)")
          .bind(rid, when, ih, await encryptPii(key, rid, p)).run();
      }
      added++;
    }
    return out({ ok: true, dry: !!b.dry, total: b.rows.length, added, existing, skipped });
  } catch { return out({ error: "שגיאה בייבוא" }, 500); }
}

export async function onRequestPost({ request, env }) {
  if (!(await checkAdmin(request, env))) return noAuth();
  if (!originOk(request)) return out({ error: "הבקשה לא התקבלה (מקור לא מורשה)" }, 403);
  const b = await readJson(request, 3 * 1024 * 1024);
  if (!b || !Array.isArray(b.rows)) return out({ error: "הבקשה לא תקינה" }, 400);
  if (b.rows.length > 500) return out({ error: "עד 500 שורות בבקשה" }, 400);
  if (b.format === "mapped") return importMapped(b, env);
  let key; try { key = await importKeyForWrite(env); } catch { return out({ error: "המפתח JOINERS_KEY לא מוגדר באתר" }, 503); }
  let added = 0, existing = 0, skipped = 0;
  try {
    for (const r of b.rows) {
      const cid = g(r, "id");
      if (!/^\d{1,12}$/.test(cid)) { skipped++; continue; }
      const rid = await sha1_16("cfdb7:" + cid);
      if (await env.DB.prepare("SELECT id FROM joiners WHERE id = ?").bind(rid).first()) { existing++; continue; }
      const p = mapRow(r), when = parseDate(g(r, "date"));
      if (!when || (!p.first && !p.last && !p.phone && !p.email && !p.id)) { skipped++; continue; }
      if (!b.dry) {
        const digits = p.id.replace(/\D/g, "");
        await env.DB.prepare("INSERT INTO joiners (id, submitted_at, cancelled_at, file_sha256, ident_hash, pii) VALUES (?, ?, '', '', ?, ?)")
          .bind(rid, when, digits ? await identHash(env, digits) : "", await encryptPii(key, rid, p)).run();
      }
      added++;
    }
    return out({ ok: true, dry: !!b.dry, total: b.rows.length, added, existing, skipped });
  } catch { return out({ error: "שגיאה בייבוא" }, 500); }
}
