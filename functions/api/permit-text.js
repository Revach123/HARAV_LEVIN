import { checkAdmin } from "./_shared/auth.js";
import { noAuth } from "./_shared/permit-docs.js";
// חיפוש בטקסט המסמכים ובמספרי תאגיד / שמות שנמצאו בהם - מנהל בלבד, קריאה בלבד.
// GET /api/permit-text?q=ביטוי          → { results: [{ id, name, page, snippet }] }  (FTS; אחרת LIKE)
// GET /api/permit-text?hp=513429035     → { docs: [{ id, name, n, src, status }] }
// GET /api/permit-text?hints=1          → { hp: [{ id, hp, src, n }] }  כל ה-ח.פ. שנמצאו, לכל מסמך (להצעות שיוך)
// GET /api/permit-text?names=1          → { names: [{ id, name, src }] }  שמות שנמצאו במסמכים (טקסט / חותמת / כתב יד), להצעות שיוך לפי שם
const norm = s => String(s || "").replace(/["'`״׳]/g, "").replace(/\s+/g, " ").trim();
export async function onRequestGet({ request, env }) {
  const u = new URL(request.url);
  // בדיקת השמות בלבד (קריאה בלבד) מותרת גם להרצה אוטומטית (GitHub Actions) עם הסוד CRON_SECRET בכותרת X-Cron-Secret
  const cs = request.headers.get("X-Cron-Secret") || "", cronOk = u.searchParams.get("namecheck") && !!env.CRON_SECRET && cs.length === env.CRON_SECRET.length && cs === env.CRON_SECRET;
  if (!cronOk && !(await checkAdmin(request, env))) return noAuth();
  try {
    if (u.searchParams.get("namecheck")) return Response.json(await nameCheck(env, Math.max(0, Number(u.searchParams.get("offset")) || 0), Math.min(40, Number(u.searchParams.get("limit")) || 20)));
    if (u.searchParams.get("names")) {
      const r = await env.DB.prepare("SELECT d.id AS id, n.name AS name, n.src AS src FROM permit_doc_name n JOIN permit_docs d ON d.sha256 = n.sha256 WHERE length(n.name) BETWEEN 4 AND 90").all();
      return Response.json({ names: r.results ?? [] });
    }
    if (u.searchParams.get("hints")) {
      const r = await env.DB.prepare("SELECT d.id AS id, h.hp AS hp, h.src AS src, h.n AS n FROM permit_doc_hp h JOIN permit_docs d ON d.sha256 = h.sha256").all();
      return Response.json({ hp: r.results ?? [] });
    }
    const hp = (u.searchParams.get("hp") || "").replace(/\D/g, "");
    if (hp) {
      const r = await env.DB.prepare("SELECT d.id AS id, d.original_name AS name, h.n AS n, h.src AS src, h.status AS status FROM permit_doc_hp h JOIN permit_docs d ON d.sha256 = h.sha256 WHERE h.hp = ? ORDER BY h.n DESC LIMIT 100").bind(hp).all();
      return Response.json({ docs: r.results ?? [] });
    }
    const q = norm(u.searchParams.get("q"));
    if (q.length < 2) return Response.json({ results: [] });
    let rows;
    if (q.length >= 3) {
      try {
        rows = (await env.DB.prepare("SELECT d.id AS id, d.original_name AS name, f.page AS page, snippet(permit_doc_fts, 0, '[', ']', '…', 14) AS snippet FROM permit_doc_fts f JOIN permit_docs d ON d.sha256 = f.sha256 WHERE permit_doc_fts MATCH ? LIMIT 60")
          .bind('"' + q.replace(/"/g, '""') + '"').all()).results;
      } catch { rows = null; }      // אין עדיין אינדקס FTS (מיגרציה 0016)
    }
    if (!rows) {
      const like = "%" + q.replace(/[%_\\]/g, m => "\\" + m) + "%";
      rows = (await env.DB.prepare("SELECT d.id AS id, d.original_name AS name, p.page AS page, substr(p.text, max(1, instr(p.text, ?) - 40), 120) AS snippet FROM permit_doc_page p JOIN permit_docs d ON d.sha256 = p.sha256 WHERE p.text LIKE ? ESCAPE '\\' LIMIT 60").bind(q, like).all()).results;
    }
    return Response.json({ results: rows ?? [] });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}

// ── בדיקה: האם שם החברה (השם בהיתר עסקה / השם ברשם) מופיע בטקסט השטר המשויך (מהאינדקס). בקשות במנות: offset / limit.
// כל שורה: חברה + השטר הראשי שלה (slot לא ריק, גם של תת-שורה). status: ok (השם המלא) | partial (רוב המילים) | none | notext (אין טקסט באינדקס)
const STOP = new Set(["בעמ", "ובעמ", "חברה", "חב", "ל", "של", "את", "ו", "בע", "מ"]);
const nz = s => String(s || "").toLowerCase().replace(/["'`״׳]/g, "").replace(/[\u0591-\u05C7]/g, "").replace(/[^0-9a-z\u05d0-\u05ea]+/g, " ").replace(/\s+/g, " ").trim();
const toks = s => nz(s).split(" ").filter(t => t && !STOP.has(t) && (t.length > 1 || /\d/.test(t)));
async function nameCheck(env, offset, limit) {
  const base = `SELECT c.doc_id AS doc_id, d.sha256 AS sha, d.original_name AS doc_name, b.id AS bid, b.permit_name AS permit_name, b.registrar_name AS registrar_name, b.chp_number AS chp, c.slot AS slot FROM permit_doc_companies c JOIN permit_docs d ON d.id = c.doc_id JOIN businesses b ON b.id = c.business_id WHERE c.slot != ''
    UNION ALL SELECT s.doc_id, d.sha256, d.original_name, b.id, b.permit_name, b.registrar_name, b.chp_number, s.slot FROM permit_doc_subs s JOIN permit_docs d ON d.id = s.doc_id JOIN businesses b ON b.id = s.sub_id WHERE s.slot != ''`;
  const total = (await env.DB.prepare(`SELECT count(*) AS n FROM (${base})`).first())?.n ?? 0;
  const rows = (await env.DB.prepare(`SELECT * FROM (${base}) ORDER BY permit_name, bid LIMIT ? OFFSET ?`).bind(limit, offset).all()).results ?? [];
  const shas = [...new Set(rows.map(r => r.sha))], text = new Map();
  for (const sha of shas) {
    const pg = (await env.DB.prepare("SELECT text FROM permit_doc_page WHERE sha256 = ? ORDER BY page, rowid").bind(sha).all()).results ?? [];
    text.set(sha, nz(pg.map(x => x.text).join(" ")));
  }
  const out = rows.map(r => {
    const t = text.get(r.sha) || "";
    if (!t) return { ...r, sha: undefined, status: "notext", cover: 0, best: "" };
    let best = { cover: -1, name: "", full: false };
    for (const name of [r.permit_name, r.registrar_name]) {
      const tk = toks(name); if (!tk.length) continue;
      const full = nz(name).length > 2 && t.includes(nz(name).replace(/\s?בעמ$/, "").trim());
      const cover = tk.filter(x => t.includes(x)).length / tk.length;
      if (full || cover > best.cover) best = { cover: full ? 1 : cover, name, full: full || best.full };
      if (full) break;
    }
    const status = best.cover >= 1 ? "ok" : best.cover >= 0.6 ? "partial" : "none";
    return { ...r, sha: undefined, status, cover: Math.round(Math.max(best.cover, 0) * 100), best: best.name };
  });
  return { total, offset, next: offset + rows.length < total ? offset + rows.length : null, rows: out };
}
