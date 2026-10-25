// functions/api/joiners-nedarim-sync.js
// קליטת הרשמות מהטופס המאוחסן בנדרים פלוס (קבלת נתונים בלבד - שום דבר לא נשלח אליהם). מנהל בלבד, רק מהאתר עצמו (Origin).
// משיכה יומית אוטומטית: .github/workflows/nedarim-sync.yml עם הסוד CRON_SECRET (אותו ערך ב-Cloudflare וב-GitHub).
// דורש סוד NEDARIM_API_KEY (מפתח npk_… מוגבל להרשאה "משיכת רשומות טופס"). אופציונלי: NEDARIM_MOSAD_ID, NEDARIM_TOFES_ID (ברירת מחדל 7005939 / 800).
//   POST /api/joiners-nedarim-sync  {}  → עד BATCH רשומות חדשות (מעבר ל"נקודת ההמשך" השמורה). תשובה: { ok, added, existing, more, last_id }
// הלקוח קורא שוב ושוב עד more=false. רשומה שכבר נקלטה (אותו מזהה) לא נדרסת.
import { checkAdmin } from "./_shared/auth.js";
import { noAuth } from "./_shared/permit-docs.js";
import { importKeyForWrite, encryptPii, identHash } from "./_shared/joiners-crypto.js";
import { originOk, readJson, clean } from "./_shared/join-common.js";

const H = { "Cache-Control": "no-store" };
const out = (obj, status = 200) => Response.json(obj, { status, headers: H });
const BATCH = 15, API = "https://matara.pro/nedarimplus/Forms/Manage.aspx";
const FIELDS = Array.from({ length: 12 }, (_, i) => "Field" + (i + 1));
const sha1_16 = async s => [...new Uint8Array(await crypto.subtle.digest("SHA-1", new TextEncoder().encode(s)))].map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
const g = (f, n) => String(f[n] ?? "").trim();

// "dd/MM/yyyy HH:mm[:ss]" (או כבר ISO) -> "YYYY-MM-DD HH:MM:SS"
export function parseDate(s) {
  s = String(s || "").trim();
  let m = s.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})(?:\D+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")} ${(m[4] || "00").padStart(2, "0")}:${m[5] || "00"}:${m[6] || "00"}`;
  m = s.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2})?)/);
  return m ? `${m[1]} ${m[2].length === 5 ? m[2] + ":00" : m[2]}` : "";
}

// שדות הטופס בנדרים -> מבנה הרשומה במאגר
export function mapRow(r) {
  const extra = {};
  if (g(r, "Field5")) extra["כתובת"] = g(r, "Field5");
  if (g(r, "Field9")) extra["סוג מזהה"] = g(r, "Field9");
  if (g(r, "Field8")) extra["Field8"] = g(r, "Field8");
  for (const n of ["Field1", "Field11", "Field12"]) if (g(r, n)) extra[n] = g(r, n);
  if (r.TransactionId) extra["תשלום בנדרים"] = String(r.TransactionId);
  return {
    first: clean(g(r, "Field3"), 60), last: clean(g(r, "Field2"), 60), phone: clean(g(r, "Field6"), 40), email: clean(g(r, "Field7"), 120),
    id: clean(g(r, "Field4") || g(r, "Field10"), 20), ip: "", companies: "", all: "", pdf: "",
    extra: Object.keys(extra).length ? JSON.stringify(extra) : "",
  };
}

async function cronOk(request, env) {
  const got = request.headers.get("X-Cron-Secret") || "", want = env.CRON_SECRET || "";
  if (!want || want.length < 24 || !got) return false;
  const h = async x => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(x)));
  const [a, b] = await Promise.all([h(got), h(want)]); let d = 0; for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}
async function getSetting(env, k) { try { const r = await env.DB.prepare("SELECT value FROM admin_settings WHERE key = ?").bind(k).first(); return r ? r.value : null; } catch { return null; } }
async function setSetting(env, k, v) {
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS admin_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)").run();
  await env.DB.prepare("INSERT OR REPLACE INTO admin_settings (key, value) VALUES (?, ?)").bind(k, String(v)).run();
}

async function pull(env, tofes, lastId) {
  const body = new URLSearchParams({
    Action: "GetJson", MosadId: env.NEDARIM_MOSAD_ID || "7005939", ApiPassword: env.NEDARIM_API_KEY, TofesId: tofes,
    MaxId: String(BATCH), LastId: String(lastId),
    GetJsonParam: JSON.stringify(Object.fromEntries([...FIELDS, "UpdateDate"].map(n => [n, n]))),
  });
  const r = await fetch(API, { method: "POST", body });
  const t = await r.text();
  let j; try { j = JSON.parse(t); } catch { throw new Error("תשובה לא צפויה מנדרים פלוס: " + t.slice(0, 120)); }
  if (!Array.isArray(j)) throw new Error("נדרים פלוס: " + (j.Message || j.Status || "שגיאה"));
  return j;
}

export async function onRequestPost({ request, env }) {
  // הרצה יומית אוטומטית (GitHub Actions, .github/workflows/nedarim-sync.yml): כותרת X-Cron-Secret = הסוד CRON_SECRET. אחרת - מנהל מהאתר עצמו
  const cron = await cronOk(request, env);
  if (!cron && !(await checkAdmin(request, env))) return noAuth();
  if (!cron && !originOk(request)) return out({ error: "הבקשה לא התקבלה (מקור לא מורשה)" }, 403);
  await readJson(request, 1024);
  if (!env.NEDARIM_API_KEY) return out({ error: "המפתח NEDARIM_API_KEY לא מוגדר באתר" }, 503);
  let wkey; try { wkey = await importKeyForWrite(env); } catch { return out({ error: "המפתח JOINERS_KEY לא מוגדר באתר" }, 503); }
  const tofes = String(env.NEDARIM_TOFES_ID || "800"), SETTING = "nedarim_last_id_" + tofes;
  try {
    const saved = parseInt(await getSetting(env, SETTING), 10), since = Number.isFinite(saved) ? saved : 0;
    const rows = await pull(env, tofes, since);
    let added = 0, existing = 0, last = since;
    for (const r of rows) {
      const n = parseInt(r.ID, 10); if (Number.isFinite(n)) last = Math.max(last, n);
      const rid = await sha1_16("nedarim:" + tofes + ":" + r.ID);
      if (await env.DB.prepare("SELECT id FROM joiners WHERE id = ?").bind(rid).first()) { existing++; continue; }
      const p = mapRow(r), when = parseDate(r.CreatedDate);
      if (!when || (!p.first && !p.last && !p.phone && !p.email && !p.id)) continue;
      const digits = p.id.replace(/\D/g, "");
      await env.DB.prepare("INSERT INTO joiners (id, submitted_at, cancelled_at, file_sha256, ident_hash, pii) VALUES (?, ?, '', '', ?, ?)")
        .bind(rid, when, digits ? await identHash(env, digits) : "", await encryptPii(wkey, rid, { ...p, src: "nedarim:" + tofes + ":" + r.ID })).run();
      added++;
    }
    if (last !== since) await setSetting(env, SETTING, last);
    return out({ ok: true, added, existing, more: rows.length === BATCH, last_id: last });
  } catch (e) { return out({ error: e && e.message ? e.message : "שגיאה בסנכרון" }, 502); }
}
