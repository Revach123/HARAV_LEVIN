// functions/api/joiners-import.js
// ייבוא מצטרפים חדשים מייצוא CSV של התוסף CFDB7 (טופס 91 באתר הישן). מנהל בלבד, רק מהאתר עצמו (Origin).
//   POST /api/joiners-import   גוף: { dry: true|false, rows: [ { id, date, private, family, "id number", "tel 760", "tel 780", email, "tel 860", companys, "checkbox 640", ... } ] }  (עד 500 שורות)
//   תשובה: { ok, total, added, existing, skipped }.  dry=true רק בודק ולא כותב.
// מזהה השורה זהה לזה של joiners_import.py (sha1 של "cfdb7:<Id>"), ולכן שורה שכבר יובאה (גם בייבוא הישן) לא תיכנס שוב, ושום רשומה קיימת לא נדרסת (עריכות וביטולים נשמרים).
import { checkAdmin } from "./_shared/auth.js";
import { noAuth } from "./_shared/permit-docs.js";
import { importKeyForWrite, encryptPii, identHash } from "./_shared/joiners-crypto.js";
import { originOk, readJson, clean } from "./_shared/join-common.js";

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

export async function onRequestPost({ request, env }) {
  if (!(await checkAdmin(request, env))) return noAuth();
  if (!originOk(request)) return out({ error: "הבקשה לא התקבלה (מקור לא מורשה)" }, 403);
  const b = await readJson(request, 3 * 1024 * 1024);
  if (!b || !Array.isArray(b.rows)) return out({ error: "הבקשה לא תקינה" }, 400);
  if (b.rows.length > 500) return out({ error: "עד 500 שורות בבקשה" }, 400);
  let key; try { key = await importKeyForWrite(env); } catch { return out({ error: "המפתח JOINERS_KEY לא מוגדר באתר" }, 503); }
  let added = 0, existing = 0, skipped = 0;
  if (b.kind === "mapped") {          // רשימה חיצונית (למשל מקהילה, מאקסל): עמודות כבר ממופות בדפדפן. כפילות לפי ת.ז. (גם מול מצטרפים קיימים מכל מקור), ובלעדיה לפי טלפון / מייל / שם
    const label = clean(String(b.label || "").trim(), 80) || "רשימה חיצונית";
    try {
      const items = [], seen = new Set(), seenIh = new Set();
      for (const r of b.rows) {
        const p = { first: clean(g(r, "first"), 60), last: clean(g(r, "last"), 60), phone: clean(g(r, "phone"), 40), email: clean(g(r, "email"), 120), id: clean(g(r, "id"), 20), ip: "",
          companies: clean(g(r, "companies"), 4000), all: "", pdf: "", src: "excel:" + label };
        const x = {}; x["מקור"] = label; if (g(r, "address")) x["כתובת"] = clean(g(r, "address"), 200); if (g(r, "note")) x["הערה"] = clean(g(r, "note"), 300); if (g(r, "phone2")) x["טלפון נוסף"] = clean(g(r, "phone2"), 40);
        p.extra = JSON.stringify(x);
        if (!p.first && !p.last && !p.phone && !p.email && !p.id) { skipped++; continue; }
        const digits = p.id.replace(/\D/g, ""), ph = p.phone.replace(/\D/g, ""), base = digits || ph || p.email.toLowerCase() || (p.first + " " + p.last).trim();
        const rid = await sha1_16("xl:" + base), ih = digits ? await identHash(env, digits) : "";
        if (seen.has(rid) || (ih && seenIh.has(ih))) { existing++; continue; }          // כפילות בתוך הקובץ עצמו
        seen.add(rid); if (ih) seenIh.add(ih);
        items.push({ rid, ih, p, when: parseDate(g(r, "date")) || new Date().toISOString().replace("T", " ").slice(0, 19) });
      }
      // בדיקת קיימים בשאילתות מרוכזות (עד 90 פרמטרים בשאילתה) במקום שאילתה לכל שורה
      const have = new Set(), haveIh = new Set(), chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, k) => arr.slice(k * n, k * n + n));
      await Promise.all([
        ...chunk(items.map(x => x.rid), 90).map(async c => { for (const row of (await env.DB.prepare(`SELECT id FROM joiners WHERE id IN (${c.map(() => "?").join(",")})`).bind(...c).all()).results ?? []) have.add(row.id); }),
        ...chunk([...new Set(items.map(x => x.ih).filter(Boolean))], 90).map(async c => { for (const row of (await env.DB.prepare(`SELECT ident_hash FROM joiners WHERE ident_hash IN (${c.map(() => "?").join(",")})`).bind(...c).all()).results ?? []) haveIh.add(row.ident_hash); }),
      ]);
      const fresh = items.filter(x => !have.has(x.rid) && !(x.ih && haveIh.has(x.ih)));
      existing += items.length - fresh.length; added = fresh.length;
      if (!b.dry) for (const c of chunk(fresh, 40)) {          // כתיבה: קריאה אחת למנה
        const stmts = []; for (const x of c) stmts.push(env.DB.prepare("INSERT INTO joiners (id, submitted_at, cancelled_at, file_sha256, ident_hash, pii) VALUES (?, ?, '', '', ?, ?)").bind(x.rid, x.when, x.ih, await encryptPii(key, x.rid, x.p)));
        await env.DB.batch(stmts);
      }
      return out({ ok: true, dry: !!b.dry, total: b.rows.length, added, existing, skipped });
    } catch { return out({ error: "שגיאה בייבוא" }, 500); }
  }
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
