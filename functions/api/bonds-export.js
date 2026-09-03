// GET /api/bonds-export
//
// Live CSV of TASE bonds belonging to companies we track. No D1 writes, no
// bonds table — fetches the same general securities feed sync-tase.js
// already reads (datawise trade-securities-list, one request for the whole
// market), joins it in memory against `SELECT chp_number FROM businesses`
// (the only D1 read here), and streams the matched rows out as CSV.
// No filtering beyond "belongs to a company we track".
//
// One handler serves two callers, so there's nothing to keep in sync:
//   - the admin "ייצוא אג״ח" button in index.html (browser fetch with the
//     admin Bearer token, since a plain <a href> can't carry an auth header)
//   - any external system holding the same token, calling this URL directly
//
// Auth reuses ADMIN_PASSWORD (same Bearer-token check as every other
// admin-gated endpoint in this repo, e.g. sync-tase.js / businesses.js).

const TASE_API   = "https://datawise.tase.co.il";
const TASE_KEY   = "OpB1TDhiRrF5kbQtjx75Qgcm6Csh31to";
const BOND_TYPES = ["03", "05", "11", "36"];

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function isAuthed(request, env) {
  return (request.headers.get("Authorization") || "").replace("Bearer ", "").trim() === env.ADMIN_PASSWORD;
}

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json; charset=utf-8", ...extra },
  });
}

// תקרת קצב בסיסית לכל IP — אותו דפוס (upsert על חלון זמן ב-D1) כמו
// guard.js ב-revach, בלי חלק ה-Origin/Turnstile/alert שלא מתאים ל-endpoint
// שכבר מוגן ב-Bearer: מגן על מקרה שבו ה-token דלף או מנוצל לרעה בתדירות
// גבוהה, כדי שזה לא יחזור להיות עומס/בעיית מכסה על fetch מ-TASE + D1.
// דורש טבלת bonds_export_rate_limit (migrations/0002_bonds_export_rate_limit.sql);
// אם הטבלה עוד לא קיימת (או כל שגיאת D1 אחרת) — נכשל פתוח (לא חוסם בקשה
// לגיטימית), בדיוק כמו guard.js.
const RATE_LIMIT  = 30; // בקשות מקסימום לחלון
const RATE_WINDOW = 60; // שניות

async function checkRateLimit(env, ip) {
  const now = Math.floor(Date.now() / 1000);
  try {
    const row = await env.DB.prepare(
      "SELECT count, window_start FROM bonds_export_rate_limit WHERE ip = ?"
    ).bind(ip).first();

    if (!row || now - row.window_start >= RATE_WINDOW) {
      await env.DB.prepare(
        `INSERT INTO bonds_export_rate_limit (ip, count, window_start) VALUES (?, 1, ?)
         ON CONFLICT(ip) DO UPDATE SET count = 1, window_start = ?`
      ).bind(ip, now, now).run();
      return true;
    }
    if (row.count >= RATE_LIMIT) return false;

    await env.DB.prepare(
      "UPDATE bonds_export_rate_limit SET count = count + 1 WHERE ip = ?"
    ).bind(ip).run();
    return true;
  } catch {
    return true;
  }
}

// זהה ל-fetchTaseBondIds ב-sync-tase.js: מנסה יום המסחר האחרון, וחוזר עד
// שבוע אחורה אם אין נתונים (סופ"ש/חג). כאן, בניגוד ל-sync-tase.js, אנחנו
// שומרים את השורות המלאות (לא רק סט של corporateId) כי אנחנו בונים CSV.
async function fetchTaseBondRows() {
  for (let d = 0; d <= 7; d++) {
    const dt    = new Date();
    dt.setDate(dt.getDate() - d);
    const year  = dt.getFullYear();
    const month = String(dt.getMonth() + 1).padStart(2, "0");
    const day   = String(dt.getDate()).padStart(2, "0");

    try {
      const res = await fetch(
        `${TASE_API}/v1/basic-securities/trade-securities-list/${year}/${month}/${day}`,
        { headers: { accept: "application/json", "accept-language": "he-IL", apikey: TASE_KEY } }
      );
      if (!res.ok) continue;

      const data = await res.json();
      const list = data?.tradeSecuritiesList?.result;
      if (!list?.length) continue;

      const bonds = list.filter(s => BOND_TYPES.includes(String(s.securityFullTypeCode || "").slice(0, 2)));
      return { bonds, dateUsed: `${year}-${month}-${day}` };
    } catch {
      continue;
    }
  }
  return null;
}

// אותו דפוס CSV (BOM + escaping) כמו functions/api/lists.js, כדי לשמור על
// עקביות עם הייצוא הקיים של רשימת החברות.
function toCsv(rows) {
  if (!rows.length) return "\uFEFF";
  const cols = Object.keys(rows[0]);
  const esc = v => {
    const s = v == null ? "" : String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lines = [cols.join(",")];
  for (const r of rows) lines.push(cols.map(c => esc(r[c])).join(","));
  return "\uFEFF" + lines.join("\r\n");
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestGet({ request, env }) {
  if (!isAuthed(request, env)) {
    return json({ error: "Unauthorized" }, 401);
  }

  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  if (!(await checkRateLimit(env, ip))) {
    return json({ error: "rate_limited" }, 429, { "Retry-After": String(RATE_WINDOW) });
  }

  const fetched = await fetchTaseBondRows();
  if (!fetched) {
    return json({ error: "לא הצלחנו לקבל נתונים מהבורסה" }, 502);
  }
  const { bonds, dateUsed } = fetched;

  const { results: businesses } = await env.DB
    .prepare(`SELECT chp_number FROM businesses WHERE chp_number IS NOT NULL AND chp_number != ''`)
    .all();
  const knownChp = new Set(businesses.map(b => String(b.chp_number).trim()));

  const rows = bonds
    .filter(s => knownChp.has(String(s.corporateId || "").trim()))
    .map(s => ({
      security_id:  s.securityId ?? "",
      bond_name:    s.securityName || "",
      symbol:       s.symbol || "",
      isin:         s.isin || "",
      corporate_id: s.corporateId || "",
      company_name: s.companyName || "",
      security_type_code: s.securityFullTypeCode || "",
      trade_date:   dateUsed,
    }));

  const csv  = toCsv(rows);
  const date = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    status: 200,
    headers: {
      ...CORS,
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="bonds-${date}.csv"`,
    },
  });
}
