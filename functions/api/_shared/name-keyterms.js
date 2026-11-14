// ============================================================================
//  functions/api/_shared/name-keyterms.js — שמות פרטיים ושמות משפחה נפוצים מטבלת המצטרפים, כ-keyterms לזיהוי הדיבור
//  (ElevenLabs Scribe, שלוחה 3). נבנה פעם אחת (POST /api/name-keyterms, workflow ידני name-keyterms) ונשמר מוצפן
//  בטבלה ivr_keyterms באותו מפתח כמו פרטי המצטרפים (JOINERS_KEY). השמות לא נשמרים בגלוי ולא נרשמים ללוג.
// ============================================================================
import { importKey, importKeyForWrite, decryptPii, encryptPii } from './joiners-crypto.js';
import { KEYTERMS_MAX, KEYTERM_LEN } from './stt-eleven.js';

const TABLE = 'CREATE TABLE IF NOT EXISTS ivr_keyterms (kind TEXT PRIMARY KEY, data TEXT, at INTEGER)';

// שם "אמיתי" מהמאגר (נספר לפי מילים): אותיות עבריות (ורווח / מקף / גרש), בלי ניקוד; בלי ערכי מקום ("טלפוני (ראו הקלטת שם פרטי)" וכו')
export function cleanName(s) {
  let t = String(s || '').replace(/[֑-ׇ]/g, '').replace(/[״"]/g, '').replace(/[׳`]/g, "'").replace(/\s+/g, ' ').trim();
  if (!t || /[()]|טלפוני|ראו הקלטת/.test(t)) return '';
  if (!/^[א-ת][א-ת' \-]*$/.test(t)) return '';
  t = t.replace(/\s*-\s*/g, '-');
  return t.length >= 2 && t.length <= KEYTERM_LEN ? t : '';
}

/** סופר את השמות בכל המצטרפים ושומר את הנפוצים (לפחות min פעמים, עד 1000 לכל סוג). מחזיר רק מספרים. */
export async function buildNameKeyterms(env, { min = 2 } = {}) {
  const key = await importKeyForWrite(env);
  const counts = { first: new Map(), last: new Map() };
  let total = 0, bad = 0;
  for (let off = 0; ; off += 500) {
    const rs = (await env.DB.prepare('SELECT id, pii FROM joiners ORDER BY id LIMIT 500 OFFSET ?').bind(off).all()).results ?? [];
    if (!rs.length) break;
    for (const r of rs) {
      total++;
      let p; try { p = await decryptPii(key, r.id, r.pii); } catch { bad++; continue; }
      for (const f of Object.keys(counts)) {          // לפי מילים: "שמואל פרידי בונים" -> שמואל, פרידי, בונים (יותר צירופים באותן 1000 משבצות)
        for (const w of new Set(cleanName(p && p[f]).split(' '))) if (w.replace(/['\-]/g, '').length >= 2) counts[f].set(w, (counts[f].get(w) || 0) + 1);
      }
    }
  }
  await env.DB.prepare(TABLE).run();
  const at = Date.now(), res = { joiners: total, undecryptable: bad, min, at: new Date(at).toISOString() };
  for (const [f, m] of Object.entries(counts)) {
    const terms = [...m.entries()].filter(([, n]) => n >= min).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'he')).slice(0, KEYTERMS_MAX).map(([t]) => t);
    await env.DB.prepare('INSERT OR REPLACE INTO ivr_keyterms (kind, data, at) VALUES (?, ?, ?)').bind(f, await encryptPii(key, `kt_${f}`, { terms }), at).run();
    res[f] = { distinct: m.size, saved: terms.length };
  }
  cache.clear();
  return res;
}

// ---- קריאה (שלוחה 3): נשמר בזיכרון 10 דקות; כל שגיאה = [] (הזיהוי ממשיך בלי הכוונה) ----
const cache = new Map(), TTL = 10 * 60 * 1000;
export async function loadNameKeyterms(env, kind) {
  const c = cache.get(kind);
  if (c && Date.now() - c.t < TTL) return c.terms;
  let terms = [];
  try {
    const r = await env.DB.prepare('SELECT data FROM ivr_keyterms WHERE kind = ?').bind(kind).first();
    if (r) { const p = await decryptPii(await importKey(env), `kt_${kind}`, r.data); terms = Array.isArray(p && p.terms) ? p.terms : []; }
  } catch (e) { if (!/no such table/i.test(String(e && e.message))) console.log('name keyterms load error'); }
  cache.set(kind, { t: Date.now(), terms });
  return terms;
}
