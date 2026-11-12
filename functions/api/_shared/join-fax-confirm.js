// ============================================================================
//  functions/api/_shared/join-fax-confirm.js — אישור הצטרפות בפקס (אותו אישור כמו במייל: buildConfirmation)
//
//  ה-Worker לא יכול להפיק PDF, ולכן: (1) כאן נרשם תור (join_fax_confirm) עם ה-HTML של האישור ומספר הפקס, מוצפנים (אותו מפתח כמו הצטרפות);
//  (2) GitHub Actions (fax-confirm.yml) שולף את התור דרך /api/fax-confirm, מפיק PDF שחור-לבן חד (כמו גרסת הפקס של השטרות) ומחזיר אותו;
//  (3) /api/fax-confirm שולח לספק ומוחק את הפרטים מהתור. ההפעלה מיידית אם מוגדר GITHUB_DISPATCH_TOKEN, ובנוסף ריצה מתוזמנת.
// ============================================================================
import { importKeyForWrite, encryptPii } from './joiners-crypto.js';
import { buildConfirmation } from './join-mail.js';
import { getAgreement } from './agreement.js';

export const TABLE = 'CREATE TABLE IF NOT EXISTS join_fax_confirm (id TEXT PRIMARY KEY, at INTEGER, status TEXT, data TEXT, response TEXT DEFAULT \'\')';

/** רושם אישור לשליחה בפקס. conf = אותם שדות כמו ל-sendConfirmation (first,last,id,date,all,companies,origin). מחזיר true אם נרשם. */
export async function queueFaxConfirmation(env, waitUntil, callId, fax, conf, joinerId = '') {
  try {
    if (!env.DB || !fax || !env.FAX_API_KEY || String(env.FAX_OFF || '') === '1') return false;
    const ag = await getAgreement(env);
    const { html } = buildConfirmation({ ...conf, agreement: ag.long, agreementTitle: ag.longTitle });
    const id = (String(callId || '').replace(/\W/g, '') || 'x') + '_' + Date.now().toString(36);
    const key = await importKeyForWrite(env);
    await env.DB.prepare(TABLE).run();
    await env.DB.prepare('INSERT INTO join_fax_confirm (id, at, status, data) VALUES (?, ?, ?, ?)')
      .bind(id, Date.now(), 'pending', await encryptPii(key, id, { fax, html, jid: String(joinerId || '') })).run();
    trigger(env, waitUntil);
    return true;
  } catch (e) { console.log(`join-fax-confirm queue: ${e && e.message}`); return false; }
}

function trigger(env, waitUntil) {
  const token = env && (env.GITHUB_DISPATCH_TOKEN || env.GH_DISPATCH_TOKEN);
  if (!token) return;
  const repo = env.GH_DISPATCH_REPO || 'Revach123/HARAV_LEVIN';
  const p = fetch(`https://api.github.com/repos/${repo}/actions/workflows/fax-confirm.yml/dispatches`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'harav-levin-fax-confirm', 'Content-Type': 'application/json' },
    body: JSON.stringify({ ref: env.GH_DISPATCH_REF || 'main' }),
  }).catch(() => null);
  if (typeof waitUntil === 'function') waitUntil(p);
}
