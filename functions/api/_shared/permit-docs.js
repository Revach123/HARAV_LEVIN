// עזרים משותפים לנקודות permit-docs* (קובץ בתיקיית _shared: אינו נקודת קצה)

export const TYPES = ["general", "private", "both", "unknown", "other"];     // other = לא היתר עסקה / לא קשור
export const MAX_BYTES = 50 * 1024 * 1024;
export const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
export const noAuth = () => Response.json({ error: "Unauthorized" }, { status: 401 });
export const noStore = () => Response.json({ error: "אחסון הקבצים (R2) עדיין לא הוגדר: ראה הוראות ב-wrangler.toml" }, { status: 503 });
export const newId = () => crypto.randomUUID().replace(/-/g, "").slice(0, 12);

export const SLOTS = ["general", "private"];
export const cleanSlot = v => SLOTS.filter(x => (Array.isArray(v) ? v : String(v || "").split(",")).includes(x)).join(",");

// slots: לכל מסמך { מזהה_חברה: "general" | "private" | "general,private" } - רק לחברות שהמסמך מקושר אצלן לרשימה (אחרת המפתח חסר)
export async function withBusinesses(env, rows) {
  const ids = rows.map(r => r.id);
  // מסמך בודד / מעט מסמכים (שמירה, פתיחה): שולפים רק את השורות שלהם; לרשימה המלאה שליפה אחת של הכל (בלי אלפי פרמטרים)
  const few = ids.length > 0 && ids.length <= 40, W = few ? ` WHERE doc_id IN (${ids.map(() => "?").join(",")})` : "", B = few ? ids : [];
  const links = new Map(ids.map(i => [i, []])), slots = new Map(ids.map(i => [i, {}]));
  if (ids.length) {
    // לא משתמשים ב-IN (...) עם אלפי פרמטרים: שליפה אחת של כל הקישורים
    let all;
    try { all = await env.DB.prepare("SELECT doc_id, business_id, slot FROM permit_doc_companies" + W).bind(...B).all(); }
    catch { all = await env.DB.prepare("SELECT doc_id, business_id FROM permit_doc_companies" + W).bind(...B).all(); }      // לפני מיגרציה 0007
    for (const l of all.results ?? []) if (links.has(l.doc_id)) { links.get(l.doc_id).push(l.business_id); if (l.slot) slots.get(l.doc_id)[l.business_id] = l.slot; }
  }
  const ext = new Map(ids.map(i => [i, []]));
  if (ids.length) {          // חברות שאינן במאגר (מיגרציה 0008); לפני המיגרציה - ריק
    try { for (const l of (await env.DB.prepare("SELECT doc_id, ext_id FROM permit_doc_ext" + W).bind(...B).all()).results ?? []) if (ext.has(l.doc_id)) ext.get(l.doc_id).push(l.ext_id); } catch { /* אין טבלה עדיין */ }
  }
  const specials = new Map(ids.map(i => [i, {}]));
  if (ids.length) {          // מסמכים ראשיים מיוחדים (מיגרציה 0013): { מזהה_חברה: כותרת }
    let sp;
    try { sp = await env.DB.prepare("SELECT doc_id, business_id, title, detail FROM permit_doc_special" + W).bind(...B).all(); }
    catch { try { sp = await env.DB.prepare("SELECT doc_id, business_id, title FROM permit_doc_special" + W).bind(...B).all(); } catch { sp = null; } }      // לפני מיגרציה 0014 / 0013
    for (const l of (sp && sp.results) || []) if (specials.has(l.doc_id)) specials.get(l.doc_id)[l.business_id] = { title: l.title, detail: l.detail || "" };
  }
  const bonds = new Map(ids.map(i => [i, []]));
  if (ids.length) {          // שיוך לאג"ח (מיגרציה 0009)
    let bl = null;
    try { bl = await env.DB.prepare("SELECT doc_id, security_id, name, symbol, company, chp, slot FROM permit_doc_bonds" + W).bind(...B).all(); }
    catch { try { bl = await env.DB.prepare("SELECT doc_id, security_id, name, symbol, company, chp FROM permit_doc_bonds" + W).bind(...B).all(); } catch { bl = null; } }      // לפני מיגרציה 0018 / 0009
    for (const l of (bl && bl.results) || []) if (bonds.has(l.doc_id)) bonds.get(l.doc_id).push({ id: l.security_id, name: l.name, symbol: l.symbol, company: l.company, chp: l.chp, slot: l.slot || "" });
  }
  const subs = new Map(ids.map(i => [i, []]));
  if (ids.length) {          // תיוג תת-שורה של החברה (מיגרציה 0020): [{ id: מזהה תת-השורה, slot }]
    try { for (const l of (await env.DB.prepare("SELECT doc_id, sub_id, slot FROM permit_doc_subs" + W).bind(...B).all()).results ?? []) if (subs.has(l.doc_id)) subs.get(l.doc_id).push({ id: l.sub_id, slot: l.slot || "" }); } catch { /* אין טבלה עדיין */ }
  }
  return rows.map(r => ({ ...r, business_ids: links.get(r.id) || [], slots: slots.get(r.id) || {}, ext_ids: ext.get(r.id) || [], bonds: bonds.get(r.id) || [], specials: specials.get(r.id) || {}, subs: subs.get(r.id) || [] }));
}

// קובע את הקישור לרשימות של מסמך אחד: slotMap = { מזהה_חברה: ["general","private"] }.
// לכל חברה מסמך אחד בכל רשימה: מסמך אחר שהיה מקושר לאותה רשימה אצלה מאבד את הקישור. מחזיר פקודות לאצווה.
export async function slotStatements(env, docId, slotMap) {
  const stmts = [];
  let hasSpecial = true;
  try { await env.DB.prepare("SELECT 1 FROM permit_doc_special LIMIT 1").first(); } catch { hasSpecial = false; }      // לפני מיגרציה 0013
  for (const [bid, v] of Object.entries(slotMap || {})) {
    const mine = cleanSlot(v);
    stmts.push(env.DB.prepare("UPDATE permit_doc_companies SET slot = ? WHERE doc_id = ? AND business_id = ?").bind(mine, docId, bid));
    if (!mine) continue;
    if (hasSpecial) stmts.push(env.DB.prepare("DELETE FROM permit_doc_special WHERE doc_id = ? AND business_id = ?").bind(docId, bid));      // מסמך הוא פרטי / כללי או "אחר", לא שניהם
    const others = await env.DB.prepare("SELECT doc_id, slot FROM permit_doc_companies WHERE business_id = ? AND doc_id != ? AND slot != ''").bind(bid, docId).all();
    for (const o of others.results ?? []) {
      const keep = cleanSlot(String(o.slot).split(",").filter(x => !mine.split(",").includes(x)));
      if (keep !== o.slot) stmts.push(env.DB.prepare("UPDATE permit_doc_companies SET slot = ? WHERE doc_id = ? AND business_id = ?").bind(keep, o.doc_id, bid));
    }
  }
  return stmts;
}

export async function existingBusinessIds(env, ids) {
  const clean = [...new Set((ids || []).map(String).filter(Boolean))];
  if (!clean.length) return [];
  const all = await env.DB.prepare("SELECT id FROM businesses").all();
  const have = new Set((all.results ?? []).map(r => r.id));
  return clean.filter(i => have.has(i));
}

