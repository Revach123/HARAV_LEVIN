import { checkAdmin } from "./_shared/auth.js";
// אג"ח שנבחרו ידנית (אישור "בחירת אג"ח מסוימים"). טבלה: approved_bonds (migrations/0003).
//   GET  /api/approved-bonds[?chp=ח"פ]   → {ok, rows}   (פתוח; נקרא גם ע"י בניית רשימת האג"ח)
//   PUT  /api/approved-bonds             → ניהול בלבד. גוף: {chp, items:[{security_id, bond_name, symbol, scope}], remove:[security_id]}
//        items = הוספה/עדכון. remove = מחיקה מפורשת בלבד (אג"ח שנעלמה ממאיה *לא* נמחקת אוטומטית).

const SCOPES = ["private", "general", "both"];

const isAuthed = (request, env) => checkAdmin(request, env);

// אחרי שמירת בחירה: מפעיל מיד את בניית רשימת האג"ח (workflow bonds-list), כדי שהאג"ח הנבחרות יופיעו בלי לחכות לריצה היומית.
// דורש env.GITHUB_DISPATCH_TOKEN (אותו סוד של sync-tase.js). בלעדיו - הבחירה נשמרת והרשימה תתעדכן בריצה הבאה.
async function triggerBondsBuild(env, chp) {
  if (!env.GITHUB_DISPATCH_TOKEN) return { triggered: false, reason: "missing_secret" };
  try {
    const res = await fetch("https://api.github.com/repos/Revach123/HARAV_LEVIN/actions/workflows/bonds-list.yml/dispatches", {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${env.GITHUB_DISPATCH_TOKEN}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "harav-levin-admin",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ref: "main", inputs: { mode: "fast", chp: String(chp || "") } }),   // בנייה מהירה (כדקה); אם אין בסיס, היא עוברת לבנייה מלאה
    });
    return res.status === 204 ? { triggered: true } : { triggered: false, reason: `github_${res.status}` };
  } catch { return { triggered: false, reason: "github_unreachable" }; }
}

export async function onRequestGet({ request, env }) {
  const chp = (new URL(request.url).searchParams.get("chp") || "").trim();
  try {
    const stmt = chp
      ? env.DB.prepare("SELECT * FROM approved_bonds WHERE chp_number = ? ORDER BY security_id").bind(chp)
      : env.DB.prepare("SELECT * FROM approved_bonds ORDER BY chp_number, security_id");
    const { results } = await stmt.all();
    return Response.json({ ok: true, rows: results ?? [] });
  } catch (e) {
    if (/no such table/i.test(String(e.message))) return Response.json({ ok: true, rows: [], table: "missing" });
    return Response.json({ ok: false, error: e.message }, { status: 500 });
  }
}

export async function onRequestPut({ request, env }) {
  if (!(await isAuthed(request, env))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await request.json();
    const chp = String(body.chp || "").trim();
    if (!chp) return Response.json({ error: "Missing chp" }, { status: 400 });
    const items = Array.isArray(body.items) ? body.items : [];
    const remove = Array.isArray(body.remove) ? body.remove : [];
    const stmts = [];
    for (const it of items) {
      const sid = Number(it.security_id);
      if (!Number.isInteger(sid) || sid <= 0) return Response.json({ error: "Bad security_id" }, { status: 400 });
      if (!SCOPES.includes(it.scope)) return Response.json({ error: "Bad scope" }, { status: 400 });
      stmts.push(env.DB.prepare(
        `INSERT INTO approved_bonds (security_id, chp_number, bond_name, symbol, scope)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(security_id) DO UPDATE SET chp_number = excluded.chp_number, bond_name = excluded.bond_name,
           symbol = excluded.symbol, scope = excluded.scope, updated_at = datetime('now')`
      ).bind(sid, chp, String(it.bond_name || ""), String(it.symbol || ""), it.scope));
    }
    for (const r of remove) {
      const sid = Number(r);
      if (Number.isInteger(sid) && sid > 0) stmts.push(env.DB.prepare("DELETE FROM approved_bonds WHERE security_id = ? AND chp_number = ?").bind(sid, chp));
    }
    if (stmts.length) await env.DB.batch(stmts);
    const refresh = stmts.length ? await triggerBondsBuild(env, chp) : { triggered: false, reason: "no_changes" };
    return Response.json({ success: true, saved: items.length, removed: remove.length, refresh });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
