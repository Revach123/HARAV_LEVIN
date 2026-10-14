// functions/api/lists.js
// מגיש רשימות כ-JSON או CSV, עם CORS פתוח.
//   סינון (ציבורי):
//     /api/lists?type=companies-private
//     /api/lists?type=companies-general
//   גולמי (ניהול/גיבוי — כל השורות, כל העמודות):
//     /api/lists?type=companies-all
//   אג"ח: לא כאן. קבצים סטטיים /data/bonds_list/bonds_{private,general,all}.{json,csv} (נבנים יומית ממאיה).
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
function withRegistrarNames(rows) {
  const out = rows.map(r => {
    const { _registrar, ...rest } = r;
    const reg = String(_registrar || "").replace(/\s+/g, " ").trim();
    const permit = String(r.permit_name || "").replace(/\s+/g, " ").trim();
    let name = permit;
    if (reg) name = !permit || sameName(reg, permit) ? reg : `${reg} (${permit})`;
    return { ...rest, permit_name: name };
  });
  return out.sort((a, b) => a.permit_name.localeCompare(b.permit_name, "he"));
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
      const build = (withStatus, withScope) => {
        const hideNote = withScope ? `COALESCE(notes_scope,'') = 'bonds'` : `0`;
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
               ${notesOut} AS notes
        FROM businesses
        WHERE ${whereClause} ${liquidated}
        ORDER BY permit_name`;
      };
      sql = build(true, true);
      sqlVariants = [build(true, false), build(false, true), build(false, false)];   // כשעמודה עדיין לא קיימת במסד (registry_status / notes_scope)
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

    if (type === "companies-private" || type === "companies-general") results = withRegistrarNames(results);

    if (format === "csv") {
      return csvResponse(results, type);
    }
    return json({ ok: true, type, count: results.length, rows: results });
  } catch (e) {
    return json({ ok: false, error: e.message, type }, 500);
  }
}
