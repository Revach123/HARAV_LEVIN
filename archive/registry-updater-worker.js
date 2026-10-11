// ARCHIVE — עותק של קוד ה-Worker "registry-updater" כפי שנמסר ב-2026-10-11,
// נשמר לפני מחיקתו מ-Cloudflare. לא רץ מהריפו ואינו נפרס.
// הסיסמה הקשיחה ב-/run וב-/run-bonds הוחלפה ב-"<REDACTED>" (הריפו ציבורי).
//
// Registry Auto-Updater
// ─────────────────────────────────────────────────────────────────────────────
// רץ כל שעתיים (cron: "0 */2 * * *")
// כל ריצה: מעדכן 40 עסקים (הישנים ביותר) + TASE לכולם
//
// נתיבי HTTP:
//   /run          — הרצת ה-scheduled ידנית
//   /run-bonds    — סנכרון רשימת האג"ח → טבלת bonds
//   /probe2       — אבחון: מבנה ה-JSON של market-data (זמני)

const TASE_API    = "https://datawise.tase.co.il";
const TASE_APIKEY = "OpB1TDhiRrF5kbQtjx75Qgcm6Csh31to";
const BOND_TYPES  = ["03", "05", "11", "36"];
const BATCH_SIZE  = 40;

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";

// שמות השדות ב-JSON של market-data (api.tase.co.il)
const MJ = {
  id:            "Id",           // מס' ני"ע (מרופד באפס מוביל)
  isin:          "ISIN",
  name:          "Name",
  symbol:        "Symbol",
  price:         "LastRate",     // שער אחרון
  change:        "Change",       // שינוי %
  turnover:      "TurnOverValueShekel", // מחזור (אלפי ש"ח)
  marketCap:     "MarketValue",  // שווי שוק (אלפי ש"ח)
  interest:      "AnnualInterest", // ריבית
  maturity:      "RedemptionDate", // מועד פדיון
  linkage:       "Linkage",      // הצמדה
  baseIndex:     "BaseIndices",  // מדד/מט"ח יסודי
  baseIndexDate: "BaseIndicesDate",
};

// ── SOURCES (רשם החברות) ──────────────────────────────────────────────────────

const SOURCES = [
  {
    resource:    "f004176c-b85f-4542-8901-7b3176f9a054",
    filterField: "מספר חברה",
    nameField:   "שם חברה",
    classify(rec) {
      const typeRaw  = String(rec["סוג תאגיד"] || "").trim();
      const limRaw   = String(rec["מגבלות"]    || "").trim();
      const isPublic = typeRaw.includes("ציבורית");
      const type     = isPublic ? "חברה ציבורית" : "חברה פרטית";
      const lim      = limRaw.includes("לא מוגבלת") ? "לא מוגבלת" : 'בע"מ';
      return `${type} - ${lim}`;
    },
  },
  {
    resource:    "139aa193-fabb-4f6b-a71b-0bb40fd73eb2",
    filterField: "מספר שותפות",
    nameField:   "שם שותפות",
    classify()  { return 'שותפות - לא בע"מ'; },
  },
  {
    resource:    "be5b7935-3922-45d4-9638-08871b17ec95",
    filterField: "מספר עמותה",
    nameField:   "שם עמותה בעברית",
    classify()  { return "עמותה רשומה"; },
  },
];

function cleanName(name) {
  return (name || "")
    .replace(/~/g, '"')
    .replace(/שותפות מוגבלת/g, "")
    .trim()
    .replace(/[.,\-!?~"]+$/, "")
    .trim();
}

const GOV_HEADERS = {
  "User-Agent":      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  "Accept":          "application/json",
  "Accept-Language": "he-IL,he;q=0.9",
  "Referer":         "https://data.gov.il/",
};

async function lookupOne(chp) {
  for (const src of SOURCES) {
    try {
      const filters = encodeURIComponent(JSON.stringify({ [src.filterField]: chp }));
      const url     = `https://data.gov.il/api/3/action/datastore_search` +
        `?resource_id=${src.resource}&filters=${filters}&limit=1`;
      const res  = await fetch(url, { headers: GOV_HEADERS });
      const text = await res.text();
      if (text.trimStart().startsWith("<")) continue;
      const json = JSON.parse(text);
      const rec  = json?.result?.records?.[0];
      if (!rec) continue;
      const name = cleanName(rec[src.nameField]);
      if (!name) continue;
      return { name, bizType: src.classify(rec) };
    } catch {}
  }
  return null;
}

// ── TASE: דגל אג"ח לעסקים (scheduled) ─────────────────────────────────────────

async function fetchTaseBondIds() {
  for (let d = 0; d <= 7; d++) {
    const dt = new Date(); dt.setDate(dt.getDate() - d);
    const year = dt.getFullYear();
    const month = String(dt.getMonth() + 1).padStart(2, "0");
    const day = String(dt.getDate()).padStart(2, "0");
    try {
      const res = await fetch(
        `${TASE_API}/v1/basic-securities/trade-securities-list/${year}/${month}/${day}`,
        { headers: { accept: "application/json", "accept-language": "he-IL", apikey: TASE_APIKEY } }
      );
      const json = await res.json();
      const list = json?.tradeSecuritiesList?.result;
      if (!list?.length) continue;
      const ids = new Set(
        list
          .filter(s => BOND_TYPES.includes(String(s.securityFullTypeCode || "").slice(0, 2)))
          .map(s => String(s.corporateId || "").trim())
          .filter(Boolean)
      );
      console.log(`TASE: ${ids.size} אג"ח (${year}-${month}-${day})`);
      return ids;
      ctx.waitUntil(syncBonds(env)); // קוד מת: אחרי return, ו-ctx/env לא מוגדרים כאן
    } catch(e) { console.warn(`TASE (${d}):`, e.message); }
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════
//  BONDS SYNC — רשימת האג"ח → טבלת bonds
// ═══════════════════════════════════════════════════════════════

function bNum(v) {
  if (v == null) return null;
  const s = String(v).replace(/,/g, "").replace(/[^\d.\-]/g, "").trim();
  if (s === "" || s === "-") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
function bTxt(v) {
  const s = String(v ?? "").trim();
  return s === "" || s === "-" ? null : s;
}

const DW_HEADERS = { accept: "application/json", "accept-language": "he-IL", apikey: TASE_APIKEY };

// spine: רשימת ניירות ליום המסחר האחרון, מסונן לאג"ח
async function fetchBondSecurities() {
  for (let d = 0; d <= 7; d++) {
    const dt = new Date(); dt.setDate(dt.getDate() - d);
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, "0");
    const day = String(dt.getDate()).padStart(2, "0");
    try {
      const res = await fetch(`${TASE_API}/v1/basic-securities/trade-securities-list/${y}/${m}/${day}`, { headers: DW_HEADERS });
      const json = await res.json();
      const list = json?.tradeSecuritiesList?.result;
      if (!list?.length) continue;
      const bonds = list.filter(s => BOND_TYPES.includes(String(s.securityFullTypeCode || "").slice(0, 2)));
      console.log(`securities-list: ${bonds.length} אג"ח מתוך ${list.length} (${y}-${m}-${day})`);
      return { bonds, tradeDate: `${y}-${m}-${day}` };
    } catch (e) { console.warn(`securities-list (${d}):`, e.message); }
  }
  return { bonds: [], tradeDate: null };
}

async function fetchTypesMap() {
  const map = new Map();
  try {
    const res = await fetch(`${TASE_API}/v1/basic-securities/securities-types`, { headers: DW_HEADERS });
    const json = await res.json();
    for (const r of (json?.securitiesTypes?.result || []))
      if (r.securityFullTypeCode != null) map.set(String(r.securityFullTypeCode), r.securityTypeDesc);
  } catch (e) { console.warn("securities-types:", e.message); }
  return map;
}

async function fetchCompaniesMap() {
  const map = new Map();
  try {
    const res = await fetch(`${TASE_API}/v1/basic-securities/companies-list`, { headers: DW_HEADERS });
    const json = await res.json();
    for (const r of (json?.companiesList?.result || []))
      if (r.issuerId != null) map.set(String(r.issuerId), r.companyFullName);
  } catch (e) { console.warn("companies-list:", e.message); }
  return map;
}

// market-data מ-endpoint ה-JSON (api.tase.co.il) — עם pagination מלא
// מפתחות: לפי מס' ני"ע וגם לפי "ISIN:<isin>" כגיבוי
async function fetchMarketMap() {
  const map = new Map();
  const headers = {
    "accept": "application/json, text/plain, */*", "accept-language": "he-IL",
    "content-type": "application/json;charset=UTF-8", "User-Agent": UA,
    "Origin": "https://market.tase.co.il", "Referer": "https://market.tase.co.il/",
  };
  const getPage = async (page) => {
    const res = await fetch("https://api.tase.co.il/api/security/securitiesmarketdata", {
      method: "POST", headers,
      body: JSON.stringify({ dType: 1, TotalRec: 1, pageNum: page, cl1: "2", lang: "0" }),
    });
    if (!res.ok) { console.warn("market-json page", page, res.status); return null; }
    return res.json();
  };
  const store = (items) => {
    for (const it of (items || [])) {
      const sid = bNum(it[MJ.id]);
      if (sid != null) map.set(String(sid), it);
      const isin = bTxt(it[MJ.isin]);
      if (isin) map.set("ISIN:" + isin, it);
    }
  };
  try {
    const first = await getPage(1);
    if (!first) return map;
    store(first.Items);
    const total    = Number(first.TotalRec) || 0;
    const pageSize = first.Items?.length || 30;
    const pages    = pageSize > 0 ? Math.ceil(total / pageSize) : 1;
    for (let p = 2; p <= pages && p <= 45; p++) {
      const j = await getPage(p);
      if (!j || !j.Items?.length) break;
      store(j.Items);
    }
    console.log(`market-json: total=${total}, pages=${pages}`);
  } catch (e) { console.warn("market-json:", e.message); }
  return map;
}

async function syncBonds(env) {
  const [{ bonds, tradeDate }, typesMap, companiesMap, marketMap] = await Promise.all([
    fetchBondSecurities(), fetchTypesMap(), fetchCompaniesMap(), fetchMarketMap(),
  ]);

  // הגנה 1: ה-spine (datawise) חייב להחזיר רשימה סבירה
  if (!bonds.length || !tradeDate) {
    console.warn("syncBonds ABORT: אין רשימת ניירות");
    return { ok: false, error: "no_securities", tradeDate };
  }

  // הגנה 2: market-data חייב להחזיר מספר סביר (לפחות 700 אג"ח).
  // אם פחות — כנראה נחסם/כשל, לא דורסים נתונים ישנים.
  const marketCount = [...marketMap.keys()].filter(k => !k.startsWith("ISIN:")).length;
  const MIN_MARKET = 700;
  if (marketCount < MIN_MARKET) {
    console.warn(`syncBonds ABORT: market-data חלקי (${marketCount} < ${MIN_MARKET}) — משאיר נתונים ישנים`);
    return { ok: false, error: "market_partial", marketCount, tradeDate };
  }

  const now = new Date().toISOString();
  let withMarket = 0;
  const rows = bonds.map(s => {
    const sid = bNum(s.securityId);
    const fullCode = String(s.securityFullTypeCode || "");
    const isin = bTxt(s.isin);
    const it = marketMap.get(String(sid)) || (isin ? marketMap.get("ISIN:" + isin) : null);
    if (it) withMarket++;
    return [
      sid, isin, fullCode || null, typesMap.get(fullCode) ?? null,
      bNum(s.issuerId), bNum(s.corporateId), companiesMap.get(String(s.issuerId)) ?? null,
      it ? bTxt(String(it[MJ.name] ?? "").replace(/\s+/g, " ")) : null,
      it ? bTxt(it[MJ.symbol])        : null,
      it ? bNum(it[MJ.price])         : null,
      it ? bNum(it[MJ.change])        : null,
      it ? bNum(it[MJ.turnover])      : null,
      it ? bNum(it[MJ.marketCap])     : null,
      it ? bTxt(it[MJ.linkage])       : null,
      it ? bTxt(it[MJ.interest])      : null,
      it ? bTxt(it[MJ.maturity])      : null,
      it ? bTxt(it[MJ.baseIndex])     : null,
      it ? bTxt(it[MJ.baseIndexDate]) : null,
      tradeDate, now,
    ];
  }).filter(r => r[0] != null);

  const SQL = `INSERT OR REPLACE INTO bonds
    (security_id, isin, security_type_code, security_type_desc, issuer_id,
     corporate_id, company_full_name, bond_name, symbol, last_price, change_pct,
     turnover_kils, market_cap_kils, linkage, interest, maturity_date,
     base_index, base_index_date, trade_date, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;
  const stmt = env.DB.prepare(SQL);
  let inserted = 0;
  for (let i = 0; i < rows.length; i += 50) {
    const chunk = rows.slice(i, i + 50).map(r => stmt.bind(...r));
    await env.DB.batch(chunk);
    inserted += chunk.length;
  }

  // הגנה 3: מחיקת ישנים רק אחרי החדרה מוצלחת
  const del = await env.DB.prepare(`DELETE FROM bonds WHERE trade_date != ?`).bind(tradeDate).run();

  const summary = { ok: true, tradeDate, bondsTotal: bonds.length, marketCount, withMarketData: withMarket, inserted, removedStale: del?.meta?.changes ?? 0 };
  console.log("syncBonds:", JSON.stringify(summary));
  return summary;
}
// ── SCHEDULED ────────────────────────────────────────────────────────────────

export default {
  async scheduled(event, env, ctx) {
    console.log("=== Scheduled started ===");
    try {
      const { results: batch } = await env.DB.prepare(`
        SELECT id, chp_number, registrar_name, biz_type
        FROM businesses
        WHERE chp_number IS NOT NULL AND chp_number != ''
        ORDER BY updated_at ASC NULLS FIRST
        LIMIT ${BATCH_SIZE}
      `).all();

      const { results: allBiz } = await env.DB.prepare(`
        SELECT id, chp_number, tase_has_agch
        FROM businesses
        WHERE chp_number IS NOT NULL AND chp_number != ''
      `).all();

      console.log(`מנה: ${batch.length} עסקים | סה"כ לTASE: ${allBiz.length}`);

      let nameUpdated = 0, typeUpdated = 0;
      for (const biz of batch) {
        const chp  = String(biz.chp_number).trim();
        const data = await lookupOne(chp);
        if (!data) continue;
        const fields = [], values = [];
        if (data.name && data.name !== (biz.registrar_name || "").trim()) {
          fields.push("registrar_name=?"); values.push(data.name); nameUpdated++;
        }
        if (data.bizType && data.bizType !== (biz.biz_type || "").trim()) {
          fields.push("biz_type=?"); values.push(data.bizType); typeUpdated++;
        }
        if (fields.length) {
          fields.push("updated_at=datetime('now')");
          values.push(biz.id);
          await env.DB.prepare(`UPDATE businesses SET ${fields.join(",")} WHERE id=?`).bind(...values).run();
        } else {
          await env.DB.prepare(`UPDATE businesses SET updated_at=datetime('now') WHERE id=?`).bind(biz.id).run();
        }
      }

      const bondIds = await fetchTaseBondIds();
      let taseUpdated = 0;
      if (bondIds) {
        for (const biz of allBiz) {
          const hasAgch = bondIds.has(String(biz.chp_number).trim()) ? "יש" : "אין";
          if (hasAgch !== (biz.tase_has_agch || "").trim()) {
            await env.DB.prepare(`UPDATE businesses SET tase_has_agch=?, updated_at=datetime('now') WHERE id=?`)
              .bind(hasAgch, biz.id).run();
            taseUpdated++;
          }
        }
      }
      console.log(`סיום — שמות: ${nameUpdated} | סוג: ${typeUpdated} | TASE: ${taseUpdated}`);
    } catch(e) {
      console.error("=== CRASH ===", e.message, e.stack);
    }
  },

  async fetch(request, env, ctx) {
    const cors = {
      "Access-Control-Allow-Origin":  "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    };
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    const url    = new URL(request.url);
    const secret = url.searchParams.get("secret") || "";
    const valid  = "<REDACTED>";

    if (url.pathname === "/run") {
      if (secret !== valid) return new Response("Unauthorized", { status: 401, headers: cors });
      ctx.waitUntil(this.scheduled({}, env, ctx));
      return new Response("Update started — check Cloudflare logs", { status: 200, headers: cors });
    }

    if (url.pathname === "/run-bonds") {
      if (secret !== valid) return new Response("Unauthorized", { status: 401, headers: cors });
      const summary = await syncBonds(env);
      const code = summary.ok ? 200 : 500;
      return new Response(JSON.stringify(summary), { status: code, headers: { ...cors, "Content-Type": "application/json" } });
    }

    return new Response("Registry Auto-Updater is running.", { status: 200, headers: cors });
  },
};
