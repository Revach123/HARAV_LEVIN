// functions/api/lists.js
// מגיש רשימות כ-JSON או CSV, עם CORS פתוח.
//   סינון (ציבורי):
//     /api/lists?type=companies-private
//     /api/lists?type=companies-general
//   גולמי (ניהול/גיבוי — כל השורות, כל העמודות):
//     /api/lists?type=companies-all
//   אג"ח: לא כאן. קבצים סטטיים /data/bonds_list/bonds_{private,general,all}.{json,csv} (נבנים יומית ממאיה).
//   תשובת JSON של companies-private / companies-general כוללת גם תאריך עדכון: updated ("24/10/2026 - י"ג חשוון תשפ"ז")
//   פורמט:
//     &format=csv   → מוריד CSV (BOM + כותרות, לאקסל)
//     (ברירת מחדל)  → JSON

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" },
  });

// שם להצגה: שם החברה ברשם; אם השם בהיתר העסקה שונה ממנו - מוצג בסוגריים אחריו.
// השוואה בלי "בע"מ", רווחים וסימני פיסוק; שם שהוא קידומת של השני (שם חתוך) נחשב זהה.
const normName = s => String(s || "").toLowerCase().replace(/בע"?מ|בע״מ|בע''מ|\bltd\b|\blimited\b/g, "").replace(/[^0-9a-z\u0590-\u05ff]/g, "");
const sameName = (a, b) => {
  const x = normName(a), y = normName(b);
  if (x === y) return true;
  const [s, l] = x.length <= y.length ? [x, y] : [y, x];
  return s.length >= 20 && l.startsWith(s);
};
// הנפקות עתידיות/פתוחות (data/bonds_list/offerings.json, נבנה יומית): ח"פ -> "open" | "upcoming".
// הנפקה בלי ח.פ. (חברה חדשה שעוד לא נכנסה לבנייה, או שם מקוצר) מותאמת לפי שם: מילות השם המקוצר הן תחילת שם של חברה אחת בלבד.
// כשל = אין הנפקות.
async function loadOfferings(request, env) {
  try {
    const url = new URL("/data/bonds_list/offerings.json", request.url);
    const res = await (env.ASSETS ? env.ASSETS.fetch(url) : fetch(url));
    if (!res.ok) return { byChp: new Map(), byName: [] };
    const d = await res.json();
    const byChp = new Map(), byName = [];
    const add = (chp, name, kind) => {
      if (chp) { const k = String(chp); if (byChp.get(k) !== "open") byChp.set(k, kind); }
      else if (name) byName.push({ name, kind });
    };
    for (const o of d.open || []) add(o.chp_number, o.issuer_name, "open");
    for (const o of d.upcoming || []) add(o.chp_number, o.company_name, "upcoming");
    return { byChp, byName };
  } catch { return { byChp: new Map(), byName: [] }; }
}

const nameWords = n => String(n || "").toLowerCase().replace(/בע"?מ|בע״מ|בע''מ/g, " ").split(/\s+/).map(w => w.replace(/[^0-9a-z\u0590-\u05ff]/g, "")).filter(Boolean);
const startsWithWords = (full, short) => { const f = nameWords(full), w = short; return w.length > 0 && f.length >= w.length && w.every((v, i) => f[i] === v); };

function withRegistrarNames(rows, offerings = { byChp: new Map(), byName: [] }) {
  // הנפקות בלי ח.פ.: מותאמות לשורה רק אם הן תחילת שם של שורה אחת בלבד
  const byRow = new Map();
  for (const o of offerings.byName) {
    const w = nameWords(o.name);
    const hit = rows.filter(r => startsWithWords(r._registrar, w) || startsWithWords(r.permit_name, w));
    if (hit.length === 1) { const cur = byRow.get(hit[0]); if (cur !== "open") byRow.set(hit[0], o.kind); }
  }
  const out = rows.map(r => {
    const { _registrar, _bonds_note_all, _selective, ...rest } = r;
    // חברה בלי אג"ח בבורסה אבל עם הנפקה: "יש אג"ח בהנפקה" (או עתידית), והערת אישור האג"ח חוזרת להופיע
    const off = rest.bonds_status === 'אין אג"ח' ? (offerings.byChp.get(String(rest.chp_number || "").trim()) || byRow.get(r)) : "";
    if (off) { rest.bonds_status = off === "open" ? 'יש אג"ח בהנפקה' : 'יש אג"ח בהנפקה עתידית'; rest.bonds_note = _bonds_note_all || ""; }
    const reg = String(_registrar || "").replace(/\s+/g, " ").trim();
    const permit = String(r.permit_name || "").replace(/\s+/g, " ").trim();
    let name = permit;
    if (reg) name = !permit || sameName(reg, permit) ? reg : `${reg} (${permit})`;
    return { ...rest, permit_name: name };
  });
  const key = n => String(n || "").replace(/^[\s"'`״׳“”‘’]+/, "");          // מיון א-ב: מדלגים על גרשיים בתחילת המילה הראשונה
  return out.sort((a, b) => key(a.permit_name).localeCompare(key(b.permit_name), "he"));
}

// "בחירת אג"ח מסוימים": הערה אוטומטית "רק לאג"ח ו', ז' בלבד" לפי האג"ח שנבחרו לרשימה הזו (approved_bonds), לפני הערה ידנית אם יש
const bondSeries = (name, symbol) => {
  const m = String(name || "").replace(/["'׳״`]/g, "").replace(/\s+/g, " ").trim().match(/אגח\s*([א-ת]{1,3}|\d{1,2})$/);
  if (!m) return String(symbol || name || "").trim();
  const x = m[1]; return /^\d/.test(x) ? x : x.length === 1 ? x + "'" : x.slice(0, -1) + '"' + x.slice(-1);
};
async function addSelectiveNotes(request, env, rows, scope) {
  if (!rows.some(r => r._selective)) return;
  let ab;
  try { ab = (await env.DB.prepare("SELECT security_id, chp_number, bond_name, symbol FROM approved_bonds WHERE scope IN (?, 'both') ORDER BY security_id").bind(scope).all()).results ?? []; } catch { return; }      // לפני מיגרציה 0003
  let live = null;          // רק אג"ח שעדיין קיימות ברשימת האג"ח העדכנית (נפדתה / נמחקה = לא נכללת בהערה)
  try { const url = new URL("/data/bonds_list/bonds_all.json", request.url), res = await (env.ASSETS ? env.ASSETS.fetch(url) : fetch(url)); if (res.ok) live = new Set(((await res.json()).rows || []).map(r => String(r.security_id))); } catch { live = null; }
  if (live && !live.size) live = null;
  const by = new Map();
  for (const b of ab) {
    if (live && !live.has(String(b.security_id))) continue; const k = String(b.chp_number || "").trim(), ser = bondSeries(b.bond_name, b.symbol); if (!k || !ser) continue; if (!by.has(k)) by.set(k, []); if (!by.get(k).includes(ser)) by.get(k).push(ser); }
  const heb = x => /^[א-ת]/.test(x) ? 1 : 0;
  for (const r of rows) {
    if (!r._selective) continue;
    const list = (by.get(String(r.chp_number || "").trim()) || []).sort((a, b) => heb(b) - heb(a) || a.localeCompare(b, "he", { numeric: true }));
    if (!list.length) continue;
    const auto = `רק לאג"ח ${list.join(", ")} בלבד`;
    r.bonds_note = r.bonds_note ? auto + "; " + r.bonds_note : auto;
    r._bonds_note_all = r._bonds_note_all ? auto + "; " + r._bonds_note_all : auto;
  }
}

// תאריך עדכון הרשימה: הריצה היומית האחרונה של בניית הרשימות (data/bonds_list/verification.json) - אותו תאריך שמוצג באתר.
// updated = שדה אחד: תאריך לועזי ועברי, למשל "24/10/2026 - י"ג חשוון תשפ"ז"
const hebNum = n => {
  const H = ["", "ק", "ר", "ש", "ת"], T = ["", "י", "כ", "ל", "מ", "נ", "ס", "ע", "פ", "צ"], U = ["", "א", "ב", "ג", "ד", "ה", "ו", "ז", "ח", "ט"];
  let out = ""; while (n >= 400) { out += "ת"; n -= 400; }
  out += H[Math.floor(n / 100)]; n %= 100;
  if (n === 15) out += "טו"; else if (n === 16) out += "טז"; else out += T[Math.floor(n / 10)] + U[n % 10];
  return out.length > 1 ? out.slice(0, -1) + '"' + out.slice(-1) : out + "'";
};
async function listUpdated(request, env) {
  try {
    const url = new URL("/data/bonds_list/verification.json", request.url), res = await (env.ASSETS ? env.ASSETS.fetch(url) : fetch(url));
    const m = res.ok ? /^(\d{4})-(\d{2})-(\d{2})/.exec(((await res.json()) || {}).updated || "") : null;
    if (!m) return null;
    let heb = "";
    try {
      const parts = new Intl.DateTimeFormat("he-u-ca-hebrew", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).formatToParts(new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12)));
      const get = t => (parts.find(p => p.type === t) || {}).value || "";
      const day = parseInt(get("day"), 10), yr = parseInt(get("year") || get("relatedYear"), 10), month = get("month").replace(/^ב(?=[א-ת])/, "");
      if (day && yr && month) heb = `${hebNum(day)} ${month} ${hebNum(yr % 1000)}`;
    } catch { /* בלי תאריך עברי */ }
    return { updated: `${m[3]}/${m[2]}/${m[1]}` + (heb ? ` - ${heb}` : "") };
  } catch { return null; }
}

// המרת שורות ל-CSV עם BOM (כדי שאקסל יזהה UTF-8 ויציג עברית)
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

const csvResponse = (rows, name) =>
  new Response(toCsv(rows), {
    status: 200,
    headers: {
      ...CORS,
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}.csv"`,
    },
  });

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const params = new URL(request.url).searchParams;
  const type = params.get("type") || "";
  const format = (params.get("format") || "").toLowerCase();

  try {
    let sql, sqlVariants = [];

    if (type === "companies-private" || type === "companies-general") {
      const isPrivate = type === "companies-private";
      const approvedCond = isPrivate
        ? "agch_approved IN ('כן','רק פרטי')"
        : "agch_approved IN ('כן','רק כללי')";
      // כלל אחד: חברה בלי אג"ח (לפי הבורסה, tase_has_agch) = "אין אג"ח" - גם אם סומנה כמאושרת.
      // חברה עם אג"ח = "יש אג"ח - מאושר" או "יש אג"ח - לא מאושר". "בחירת אג"ח מסוימים" רק קובע איזו אג"ח מאושרת (ברשימת האג"ח), והסטטוס כאן נקבע באותו כלל.
      const selective = `agch_approved = 'בחירת אג"ח מסוימים'`;
      const hasBonds = `COALESCE(tase_has_agch,'') = 'יש'`;
      const approvedExpr = `CASE WHEN ${hasBonds} AND (${approvedCond} OR ${selective}) THEN 1 ELSE 0 END`;
      const bondsStatusExpr = `CASE WHEN NOT (${hasBonds}) THEN 'אין אג"ח'
                                    WHEN ${approvedCond} OR ${selective} THEN 'יש אג"ח - מאושר'
                                    ELSE 'יש אג"ח - לא מאושר' END`;
      // "קיים היתר עסקה פרטי": העסק מסומן פרטי (visibility = 'פרטי'), או "רק פרטי" במפורש
      const hasPrivateExpr = `CASE WHEN COALESCE(visibility,'') IN ('פרטי','רק פרטי') THEN 'כן' ELSE 'לא' END`;
      // "רק פרטי" על החברה עצמה (היתר העסקה): visibility = 'רק פרטי', או הערה שכתוב בה במפורש "רק פרטי"/"פרטי בלבד".
      // הערות שנוגעות לאג"ח (למשל "מאושר רק לאג"ח פרטי בלבד") הן על אישור האג"ח ולא על החברה, ולכן לא נספרות כאן.
      const onlyPrivateExplicit = `(COALESCE(visibility,'') = 'רק פרטי'
        OR ((COALESCE(notes,'') LIKE '%רק פרטי%' OR COALESCE(notes,'') LIKE '%פרטי בלבד%')
            AND COALESCE(notes,'') NOT LIKE '%אג"ח%' AND COALESCE(notes,'') NOT LIKE '%אגח%'))`;
      // הערה על אישור האג"ח (מוצגת בעמודת האג"ח): הערות שמזכירות אג"ח
      const isBondNote = `(COALESCE(notes,'') LIKE '%אג"ח%' OR COALESCE(notes,'') LIKE '%אגח%')`;
      const bondsNoteExprBase = `CASE WHEN ${isBondNote} THEN TRIM(REPLACE(notes, char(160), ' ')) ELSE '' END`;
      // שאר ההערות: פתוחות לציבור (עמודת "הערות")
      const notesExprBase = `CASE WHEN ${isBondNote} THEN '' ELSE TRIM(REPLACE(COALESCE(notes,''), char(160), ' ')) END`;
      // פרטי = עסקים המסומנים פרטי. כללי = כל העסקים חוץ מאלה שמסומנים במפורש "רק פרטי"
      // (כלומר גם עסקים עם היתר פרטי נכללים ברשימה הכללית, ויש עמודה שמראה מי מהם).
      const whereClause = isPrivate ? "COALESCE(visibility,'') IN ('פרטי','רק פרטי')" : `NOT ${onlyPrivateExplicit}`;
      // סטטוס ברשם (עמודת registry_status, נקבעת ע"י registry-refresh): מחוסלות/מחוקות (מחוסלת.../חיסול.../מחוקה/נגרעה מהמרשם) לא מוצגות;
      // בפירוק (בפרוק...) נשארות ומקבלות הערה "בפירוק" בתחילת עמודת ההערות. אם העמודה עדיין לא קיימת - בלי סינון.
      // notes_scope (באיזו רשימה מוצגת ההערה): 'bonds' = רק ברשימת האג"ח, כלומר לא מוצגת כאן. כל ערך אחר (ריק/companies/both) מוצג.
      const build = (withStatus, withScope, withPcat = false) => {
        const hideNote = withScope ? `COALESCE(notes_scope,'') = 'bonds'` : `0`;
        const bondsNoteAll = `CASE WHEN ${hideNote} THEN '' ELSE ${bondsNoteExprBase} END`;
        const bondsNoteExpr = `CASE WHEN ${hideNote} OR NOT (${hasBonds}) THEN '' ELSE ${bondsNoteExprBase} END`;   // חברה בלי אג"ח: אין הערת אישור אג"ח
        const notesExpr = `CASE WHEN ${hideNote} THEN '' ELSE ${notesExprBase} END`;
        const liquidated = withStatus ? `AND COALESCE(registry_status,'') NOT LIKE 'מחוסל%' AND COALESCE(registry_status,'') NOT LIKE 'חיסול%' AND COALESCE(registry_status,'') NOT LIKE 'מחוק%' AND COALESCE(registry_status,'') NOT LIKE 'נגרע%'` : "";
        const notesOut = withStatus
          ? `CASE WHEN COALESCE(registry_status,'') LIKE 'בפרוק%'
                  THEN 'בפירוק' || CASE WHEN ${notesExpr} != '' THEN '; ' || ${notesExpr} ELSE '' END
                  ELSE ${notesExpr} END`
          : notesExpr;
        return `
        SELECT permit_name, registrar_name AS _registrar, chp_number, category, region,
               ${hasPrivateExpr} AS has_private_permit,
               ${approvedExpr} AS approved,
               ${bondsStatusExpr} AS bonds_status,
               ${bondsNoteExpr} AS bonds_note,
               ${bondsNoteAll} AS _bonds_note_all,
               CASE WHEN ${selective} THEN 1 ELSE 0 END AS _selective,
               ${notesOut} AS notes${withPcat ? ",\n               COALESCE(permits_category,'') AS permits_category" : ""}
        FROM businesses
        WHERE ${whereClause} ${liquidated}
        ORDER BY permit_name`;
      };
      sql = build(true, true, true);
      sqlVariants = [build(true, false, true), build(false, true, true), build(false, false, true), build(true, true), build(true, false), build(false, true), build(false, false)];   // כשעמודה עדיין לא קיימת במסד (registry_status / notes_scope / permits_category)
    }


    // ── ייצוא גולמי מלא ──
    else if (type === "companies-all") {
      sql = `SELECT * FROM businesses ORDER BY permit_name`;
    }
    // אג"ח: רשימה אחת בלבד - קבצים סטטיים שנבנים כל יום מדף החברה במאיה (scripts/bonds_list), בלי טבלת bonds.
    else if (type.startsWith("bonds-")) {
      return json({ ok: false, error: "moved", type,
        message: 'רשימת האג"ח היא קבצים סטטיים: /data/bonds_list/bonds_private|bonds_general|bonds_all (.json / .csv)' }, 410);
    }

    else {
      return json({ ok: false, error: "unknown_type", type }, 400);
    }

    let results;
    const missingCol = e => /no such column: (registry_status|notes_scope)/i.test(String(e.message));
    try {
      ({ results } = await env.DB.prepare(sql).all());
    } catch (e) {
      if (!sqlVariants.length || !missingCol(e)) throw e;
      let last = e;
      for (const v of sqlVariants) {      // עמודה שעדיין לא נוספה למסד: מנסים בלעדיה
        try { ({ results } = await env.DB.prepare(v).all()); last = null; break; }
        catch (e2) { if (!missingCol(e2)) throw e2; last = e2; }
      }
      if (last) throw last;
    }

    if (type === "companies-private" || type === "companies-general") {
      await addSelectiveNotes(request, env, results, type === "companies-private" ? "private" : "general");
      results = withRegistrarNames(results, await loadOfferings(request, env));
    }

    if (format === "csv") {
      return csvResponse(results, type);
    }
    const upd = (type === "companies-private" || type === "companies-general") ? await listUpdated(request, env) : null;
    return json({ ok: true, type, count: results.length, ...(upd || {}), rows: results });
  } catch (e) {
    return json({ ok: false, error: e.message, type }, 500);
  }
}
