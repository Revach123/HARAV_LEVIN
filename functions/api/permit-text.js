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
// התאמה עמידה ל-OCR: מילת שם נחשבת נמצאה אם יש בשטר מילה זהה או קרובה (עד 1 שגיאה במילה של 4-6 אותיות, עד 2 במילה ארוכה יותר)
function lev(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]; let mn = i;
    for (let j = 1; j <= b.length; j++) { const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); cur.push(v); if (v < mn) mn = v; }
    if (mn > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}
function matchName(name, t, dt) {
  const tk = toks(name); if (!tk.length) return { cover: 0, snippet: "" };
  const full = nz(name).replace(/\s?בעמ$/, "").trim();
  if (full.length > 2 && t.includes(full)) { const k = t.indexOf(full); return { cover: 1, snippet: t.slice(Math.max(0, k - 10), k + full.length + 30) }; }
  const pos = new Map();      // מילת שם -> מיקומים בשטר (מדויק או קרוב)
  for (const w of tk) {
    const mx = w.length <= 3 ? 0 : w.length <= 6 ? 1 : 2, at = [];
    for (let i = 0; i < dt.length; i++) { const d = dt[i]; if (d === w || (mx && d.length > 2 && lev(w, d, mx) <= mx)) at.push(i); }
    if (at.length) pos.set(w, at);
  }
  const cover = pos.size / tk.length;
  let bestI = -1, bestC = 0; const L = tk.length + 3;      // חלון הטקסט עם מירב מילות השם
  for (const at of pos.values()) for (const i0 of at) {
    const c = [...pos.values()].filter(a2 => a2.some(x => x >= i0 && x < i0 + L)).length;
    if (c > bestC) { bestC = c; bestI = i0; }
  }
  return { cover, snippet: bestI >= 0 ? dt.slice(Math.max(0, bestI - 2), bestI + L).join(" ") : "" };
}
async function nameCheck(env, offset, limit) {
  const base = `SELECT c.doc_id AS doc_id, d.sha256 AS sha, d.original_name AS doc_name, d.intel AS intel, b.id AS bid, b.permit_name AS permit_name, b.registrar_name AS registrar_name, b.chp_number AS chp, c.slot AS slot FROM permit_doc_companies c JOIN permit_docs d ON d.id = c.doc_id JOIN businesses b ON b.id = c.business_id WHERE c.slot != ''
    UNION ALL SELECT s.doc_id, d.sha256, d.original_name, d.intel, b.id, b.permit_name, b.registrar_name, b.chp_number, s.slot FROM permit_doc_subs s JOIN permit_docs d ON d.id = s.doc_id JOIN businesses b ON b.id = s.sub_id WHERE s.slot != ''`;
  const total = (await env.DB.prepare(`SELECT count(*) AS n FROM (${base})`).first())?.n ?? 0;
  const rows = (await env.DB.prepare(`SELECT * FROM (${base}) ORDER BY permit_name, bid LIMIT ? OFFSET ?`).bind(limit, offset).all()).results ?? [];
  const shas = [...new Set(rows.map(r => r.sha))], text = new Map();
  for (const sha of shas) {
    const pg = (await env.DB.prepare("SELECT text FROM permit_doc_page WHERE sha256 = ? ORDER BY page, rowid").bind(sha).all()).results ?? [];
    text.set(sha, nz(pg.map(x => x.text).join(" ")));
  }
  const hps = new Map();      // sha -> קבוצת ח.פ. שנמצאו בשטר (permit_doc_hp)
  if (shas.length) for (const h of (await env.DB.prepare(`SELECT sha256, hp FROM permit_doc_hp WHERE sha256 IN (${shas.map(() => "?").join(",")})`).bind(...shas).all()).results ?? []) { if (!hps.has(h.sha256)) hps.set(h.sha256, new Set()); hps.get(h.sha256).add(String(h.hp)); }
  const dn = new Map();      // sha -> השמות שנמצאו בשטר (permit_doc_name: ביטויים עם בע"מ / שורות פתיחה), עד 6
  if (shas.length) for (const h of (await env.DB.prepare(`SELECT sha256, name FROM permit_doc_name WHERE sha256 IN (${shas.map(() => "?").join(",")}) AND length(name) BETWEEN 4 AND 90 ORDER BY (name LIKE '%בע%מ%') DESC, length(name)`).bind(...shas).all()).results ?? []) { const a = dn.get(h.sha256) || []; if (a.length < 6 && !a.includes(h.name)) { a.push(h.name); dn.set(h.sha256, a); } }
  const dtoks = new Map();
  const out = rows.map(r => {
    let prev = "";      // ממצא הסריקה הקודמת (build_cases.py, נשמר ב-permit_docs.intel): שם הפוסט באתר הישן מול השם במסמך
    try { prev = (JSON.parse(r.intel || "{}").f || []).filter(x => x.c === "name_differs").map(x => x.d).join(" ; "); } catch { /* intel לא תקין */ }
    const t = text.get(r.sha) || "", hpIn = r.chp ? (hps.get(r.sha)?.has(String(r.chp).trim()) ? 1 : 0) : -1, len = t.length;
    if (!t) return { ...r, sha: undefined, intel: undefined, prev_scan: prev, status: "notext", cover: 0, best: "", hp_in_doc: hpIn, len, doc_names: (dn.get(r.sha) || []).join(" | ") };
    const dt = dtoks.get(r.sha) || dtoks.set(r.sha, t.split(" ")).get(r.sha);
    const pn = (r.permit_name || "").trim() || (r.registrar_name || "").trim();      // השם שבאתר = "שם בהיתר עסקה" (אם ריק - השם ברשם)
    const m = matchName(pn, t, dt);
    const m2 = r.registrar_name && r.registrar_name.trim() && r.registrar_name.trim() !== pn ? matchName(r.registrar_name, t, dt) : null;
    const status = m.cover >= 1 ? "ok" : m.cover >= 0.6 ? "partial" : "none";
    return { ...r, sha: undefined, intel: undefined, prev_scan: prev, status, cover: Math.round(m.cover * 100), best: pn, snippet: m.snippet, reg_cover: m2 ? Math.round(m2.cover * 100) : "", hp_in_doc: hpIn, len, doc_names: (dn.get(r.sha) || []).join(" | ") };
  });
  return { total, offset, next: offset + rows.length < total ? offset + rows.length : null, rows: out };
}
