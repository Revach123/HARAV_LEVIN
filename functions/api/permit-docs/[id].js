import { checkAdmin } from "../_shared/auth.js";
import { TYPES, noAuth, withBusinesses, existingBusinessIds, slotStatements } from "../_shared/permit-docs.js";
// GET    /api/permit-docs/:id   → מסמך אחד
// PUT    /api/permit-docs/:id   → עדכון { pages?, doc_dates? (מערך YYYY-MM-DD), bonds? (שיוך לאג"ח: [{id,name,symbol,company,chp}]), ext_ids? (חברות שאינן במאגר), doc_type?, business_ids? (החלפה מלאה של השיוכים; הקישור לרשימה נשמר לחברות שנשארו), slots? ({חברה: ["general","private"]}), note? }
// DELETE /api/permit-docs/:id   → מחיקה מלאה של המסמך (השיוכים והקובץ)

export async function onRequestGet({ request, env, params }) {
  if (!(await checkAdmin(request, env))) return noAuth();
  try {
    const row = await env.DB.prepare("SELECT * FROM permit_docs WHERE id = ?").bind(params.id).first();
    if (!row) return Response.json({ error: "לא נמצא" }, { status: 404 });
    return Response.json({ doc: (await withBusinesses(env, [row]))[0] });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}

export async function onRequestPut({ request, env, params }) {
  if (!(await checkAdmin(request, env))) return noAuth();
  try {
    const row = await env.DB.prepare("SELECT * FROM permit_docs WHERE id = ?").bind(params.id).first();
    if (!row) return Response.json({ error: "לא נמצא" }, { status: 404 });
    const body = await request.json();
    const stmts = [];
    const docType = body.doc_type !== undefined ? body.doc_type : row.doc_type;
    if (!TYPES.includes(docType)) return Response.json({ error: "סיווג לא תקין" }, { status: 400 });
    const note = body.note !== undefined ? String(body.note) : row.note;
    stmts.push(env.DB.prepare("UPDATE permit_docs SET doc_type=?, note=?, updated_at=datetime('now') WHERE id=?").bind(docType, note, params.id));
    if (Array.isArray(body.business_ids)) {
      const ids = await existingBusinessIds(env, body.business_ids);
      const old = {};
      try { for (const l of (await env.DB.prepare("SELECT business_id, slot FROM permit_doc_companies WHERE doc_id = ?").bind(params.id).all()).results ?? []) old[l.business_id] = l.slot || ""; } catch { /* לפני מיגרציה 0007 */ }
      stmts.push(env.DB.prepare("DELETE FROM permit_doc_companies WHERE doc_id = ?").bind(params.id));
      for (const b of ids) stmts.push(env.DB.prepare("INSERT OR IGNORE INTO permit_doc_companies (doc_id, business_id) VALUES (?, ?)").bind(params.id, b));
      for (const b of ids) if (old[b] && !(body.slots && typeof body.slots === "object" && b in body.slots)) stmts.push(env.DB.prepare("UPDATE permit_doc_companies SET slot = ? WHERE doc_id = ? AND business_id = ?").bind(old[b], params.id, b));
    }
    if (body.slots && typeof body.slots === "object") {
      stmts.push(...await slotStatements(env, params.id, body.slots));
    }
    if (Array.isArray(body.ext_ids)) {        // חברות שאינן במאגר (permit_ext_companies): החלפה מלאה
      const have = new Set(((await env.DB.prepare("SELECT id FROM permit_ext_companies").all()).results ?? []).map(r => r.id));
      stmts.push(env.DB.prepare("DELETE FROM permit_doc_ext WHERE doc_id = ?").bind(params.id));
      for (const x of [...new Set(body.ext_ids.map(String))].filter(i => have.has(i))) stmts.push(env.DB.prepare("INSERT OR IGNORE INTO permit_doc_ext (doc_id, ext_id) VALUES (?, ?)").bind(params.id, x));
    }
    if (Array.isArray(body.bonds)) {        // שיוך לאג"ח: החלפה מלאה { id, name, symbol, company, chp }
      stmts.push(env.DB.prepare("DELETE FROM permit_doc_bonds WHERE doc_id = ?").bind(params.id));
      const seen = new Set();
      for (const x of body.bonds.slice(0, 300)) {
        const sid = String(x && x.id || "").trim(); if (!sid || seen.has(sid)) continue; seen.add(sid);
        stmts.push(env.DB.prepare("INSERT INTO permit_doc_bonds (doc_id, security_id, name, symbol, company, chp) VALUES (?,?,?,?,?,?)")
          .bind(params.id, sid, String(x.name || "").slice(0, 200), String(x.symbol || "").slice(0, 60), String(x.company || "").slice(0, 200), String(x.chp || "").slice(0, 20)));
      }
    }
    if (body.pages !== undefined || body.doc_dates !== undefined) {          // מספר עמודים ותאריכים שנשלפו מהמסמך (מיגרציה 0010)
      const pages = Math.max(0, Math.min(5000, parseInt(body.pages, 10) || 0));
      const dates = (Array.isArray(body.doc_dates) ? body.doc_dates : []).map(String).filter(x => /^\d{4}-\d{2}-\d{2}$/.test(x)).slice(0, 12);
      stmts.push(env.DB.prepare("UPDATE permit_docs SET pages = ?, doc_dates = ? WHERE id = ?").bind(pages, dates.length ? JSON.stringify(dates) : "", params.id));
    }
    await env.DB.batch(stmts);
    const fresh = await env.DB.prepare("SELECT * FROM permit_docs WHERE id = ?").bind(params.id).first();
    return Response.json({ success: true, doc: (await withBusinesses(env, [fresh]))[0] });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}

export async function onRequestDelete({ request, env, params }) {
  if (!(await checkAdmin(request, env))) return noAuth();
  try {
    const row = await env.DB.prepare("SELECT * FROM permit_docs WHERE id = ?").bind(params.id).first();
    if (!row) return Response.json({ error: "לא נמצא" }, { status: 404 });
    await env.DB.batch([
      env.DB.prepare("DELETE FROM permit_doc_companies WHERE doc_id = ?").bind(params.id),
      env.DB.prepare("DELETE FROM permit_docs WHERE id = ?").bind(params.id),
    ]);
    if (env.PERMITS) await env.PERMITS.delete(row.file_key).catch(() => {});
    return Response.json({ success: true });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
