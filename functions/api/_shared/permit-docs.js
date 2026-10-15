// עזרים משותפים לנקודות permit-docs* (קובץ בתיקיית _shared: אינו נקודת קצה)

export const TYPES = ["general", "private", "both", "unknown", "other"];     // other = לא היתר עסקה / לא קשור
export const MAX_BYTES = 50 * 1024 * 1024;
export const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
export const noAuth = () => Response.json({ error: "Unauthorized" }, { status: 401 });
export const noStore = () => Response.json({ error: "אחסון הקבצים (R2) עדיין לא הוגדר: ראה הוראות ב-wrangler.toml" }, { status: 503 });
export const newId = () => crypto.randomUUID().replace(/-/g, "").slice(0, 12);

export async function withBusinesses(env, rows) {
  const ids = rows.map(r => r.id);
  const links = new Map(ids.map(i => [i, []]));
  if (ids.length) {
    // לא משתמשים ב-IN (...) עם אלפי פרמטרים: שליפה אחת של כל הקישורים
    const all = await env.DB.prepare("SELECT doc_id, business_id FROM permit_doc_companies").all();
    for (const l of all.results ?? []) if (links.has(l.doc_id)) links.get(l.doc_id).push(l.business_id);
  }
  return rows.map(r => ({ ...r, business_ids: links.get(r.id) || [] }));
}

export async function existingBusinessIds(env, ids) {
  const clean = [...new Set((ids || []).map(String).filter(Boolean))];
  if (!clean.length) return [];
  const all = await env.DB.prepare("SELECT id FROM businesses").all();
  const have = new Set((all.results ?? []).map(r => r.id));
  return clean.filter(i => have.has(i));
}

