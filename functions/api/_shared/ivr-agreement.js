// ============================================================================
//  functions/api/_shared/ivr-agreement.js — הקראת שטר ההצטרפות המלא בטלפון בחלקים, ואחריה ההצהרה (שלוחות 1 ו-3)
//
//  השטר המלא (כ-3,000 תווים) בהודעה אחת ארוך מדי לימות ("אין מענה בשרת ה-API"), ולכן הוא מוקרא בחלקים של עד CHUNK תווים:
//  כל חלק בבקשה נפרדת, בפקודת read קצרה (שנייה המתנה, בלי צורך בהקשה), וכשנגמר - ההצהרה (1 = מאשר, 2 = שמיעה חוזרת, 3 = ביטול).
//  מצב (s_agr_*): g = כמה הקראות מלאות התחילו, on = באמצע הקראה, k = החלק הבא. משתני ימות: ap_<g*100+k> לחלקים,
//  ag (בלי הקראה) / ag_<g> (אחרי הקראה g) להצהרה - כל שאלה במשתנה חדש, כי ימות שומרת את הערך הישן.
//  קול: כל חלק מוקרא מקובץ Azure (ivr-tts-cache.js) כשכבר הופק, ואחרת ב-TTS של ימות (והקובץ מופק ברקע). ההפקה מתחילה כבר כשנשאלת
//  השאלה "לשמוע את השטר המלא?" (warmAgreement), כך שבדרך כלל הקבצים מוכנים כשמתחילים להקריא.
// ============================================================================
import { getAgreement, speakable } from './agreement.js';
import { ttsClean } from './ivr_phrases.js';
import { audioFor, warm } from './ivr-tts-cache.js';

export const CHUNK = 700;

/** פסקאות השטר -> חלקים להקראה: [{ tts: הודעות t- מחוברות בנקודה, text: הטקסט לקובץ Azure }], עד CHUNK תווים לחלק (פסקה ארוכה מפוצלת במשפטים) */
export function agreementChunks(paragraphs, max = CHUNK) {
  const parts = [];
  for (const p of paragraphs.filter(Boolean)) {
    const t = speakable(p).replace(/\s+/g, ' ').trim();
    if (t.length <= max) { parts.push(t); continue; }
    let cur = '';
    for (const s of t.split(/(?<=[.!?:;])\s+|\s+(?=[-–]\s)/)) {
      if (cur && cur.length + s.length + 1 > max) { parts.push(cur); cur = ''; }
      cur = cur ? `${cur} ${s}` : s;
      while (cur.length > max) { const cut = cur.lastIndexOf(' ', max) > 0 ? cur.lastIndexOf(' ', max) : max; parts.push(cur.slice(0, cut)); cur = cur.slice(cut).trim(); }
    }
    if (cur) parts.push(cur);
  }
  const chunks = [];
  let cur = [];
  for (const t of parts) {
    if (cur.length && cur.reduce((n, x) => n + x.length + 3, 0) + t.length > max) { chunks.push(cur); cur = []; }
    cur.push(t);
  }
  if (cur.length) chunks.push(cur);
  return chunks.map((c) => ({ tts: c.map((t) => `t-${ttsClean(t)}`).join('.'), text: c.join(' ') }));
}

const chunksOf = async (env) => { const ag = await getAgreement(env); return agreementChunks([ag.longTitle, ...ag.long]); };

/** הפקה מוקדמת של קבצי Azure לחלקי השטר (ברקע) */
export async function warmAgreement(env, waitUntil) {
  if (!waitUntil) return;
  try { await warm(env, (await chunksOf(env)).map((c) => c.text), waitUntil); } catch { /* best-effort */ }
}

/**
 * שלב ההצהרה (אחרי rd: 1 = להקריא את השטר המלא, 2 = להמשיך).
 * @returns {{ask:string}|{ok:true}|{cancel:true}}
 */
export async function agreementStep({ env, v, S, setS, P, readTap, empty = 'NONE', waitUntil = null }) {
  const has = (k) => Object.prototype.hasOwnProperty.call(v, k);
  const g = Number(S('agr', 'g') || 0);
  const decl = (n) => (n === 0 ? 'ag' : `ag_${n}`);
  const chunkVar = (n, k) => `ap_${n * 100 + k}`;
  const ask = (n) => ({ ask: readTap(P('join:declare'), decl(n), ['1', '2', '3'], { empty }) });
  const read = async (n, k) => {
    const chunks = await chunksOf(env);
    if (k >= chunks.length) { setS('agr', 'on', ''); return ask(n); }
    setS('agr', 'k', k);
    if (waitUntil) for (const c of chunks.slice(k + 1)) await audioFor(env, c.text, waitUntil);          // החלקים הבאים: מוכנים בזמן
    const f = await audioFor(env, chunks[k].text, waitUntil);
    return { ask: readTap(f || chunks[k].tts, chunkVar(n, k), null, { max: 1, min: 1, wait: 1, empty }) };          // שנייה אחת, בלי הקשה: ממשיכים לחלק הבא
  };
  const start = async () => { setS('agr', 'g', g + 1); setS('agr', 'on', '1'); return read(g + 1, 0); };

  if (S('agr', 'on') === '1') {          // באמצע הקראה: החלק הבא (אחרי שימות החזירה תשובה לחלק הנוכחי)
    const k = Number(S('agr', 'k') || 0);
    return read(g, has(chunkVar(g, k)) ? k + 1 : k);
  }
  if (g === 0 && v.rd === '1') return start();          // ביקשו לשמוע את השטר המלא
  const ans = v[decl(g)];
  if (ans === '1') return { ok: true };
  if (ans === '3') return { cancel: true };
  if (ans === '2') return start();          // שמיעה חוזרת של השטר המלא
  return ask(g);          // שתיקה / ערך אחר: ההצהרה נשאלת שוב
}
