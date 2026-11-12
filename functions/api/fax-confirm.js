// ============================================================================
//  functions/api/fax-confirm.js — תור אישורי ההצטרפות בפקס (_shared/join-fax-confirm.js). רק להרצה אוטומטית: כותרת X-Cron-Secret = CRON_SECRET.
//  GET            -> { items: [{ id, html }] } אישורים שממתינים ל-PDF (עד 5)
//  POST ?id=<id>  גוף = PDF מוכן לפקס -> נשלח לספק; הפרטים (מספר הפקס וה-HTML) נמחקים מהתור. מגבלות/יומן: אותו ivr_fax_log של הקו הטלפוני.
// ============================================================================
import { importKeyForWrite, decryptPii, encryptPii } from './_shared/joiners-crypto.js';
import { TABLE } from './_shared/join-fax-confirm.js';
import { postFax, reserve, normFax } from './_shared/ivr-fax.js';
import { markFaxSent } from './_shared/join-mail.js';

const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });

export async function onRequest({ request, env }) {
  const cs = request.headers.get('X-Cron-Secret') || '';
  if (!env.CRON_SECRET || cs.length !== env.CRON_SECRET.length || cs !== env.CRON_SECRET) return json({ ok: false, error: 'unauthorized' }, 401);
  if (!env.DB) return json({ ok: false, error: 'no db' }, 500);
  await env.DB.prepare(TABLE).run();
  const key = await importKeyForWrite(env);
  const u = new URL(request.url);

  // ניסוי איכות (רק הרצה אוטומטית): GET ?trial=<מספר פקס> רושם שורה במצב 'trial' (לא נקראת ע"י ההפקה הרגילה), ו-POST ?id=<id> עם PDF שולח אותו למספר הזה
  if (request.method === 'GET' && u.searchParams.get('trial')) {
    const fax = normFax(u.searchParams.get('trial'));
    if (!fax) return json({ ok: false, error: 'bad fax number' }, 400);
    const id = 'trial_' + Date.now().toString(36);
    await env.DB.prepare('INSERT INTO join_fax_confirm (id, at, status, data) VALUES (?, ?, ?, ?)').bind(id, Date.now(), 'trial', await encryptPii(key, id, { fax, html: '', jid: '' })).run();
    return json({ ok: true, id });
  }

  if (request.method === 'GET') {
    const rows = (await env.DB.prepare("SELECT id, data FROM join_fax_confirm WHERE status = 'pending' AND at > ? ORDER BY at LIMIT 5").bind(Date.now() - 3 * 24 * 3600 * 1000).all()).results || [];
    const items = [];
    for (const r of rows) { try { items.push({ id: r.id, html: (await decryptPii(key, r.id, r.data)).html }); } catch { /* שורה פגומה: מדלגים */ } }
    // אבחון (בלי פרטים אישיים): התור לפי מצב, והרשומות האחרונות
    const last = ((await env.DB.prepare('SELECT at, status, response FROM join_fax_confirm ORDER BY at DESC LIMIT 5').all()).results || []).map((r) => ({ at: new Date(r.at).toISOString(), status: r.status, response: String(r.response || '').slice(0, 120) }));
    return json({ ok: true, items, last });
  }

  if (request.method === 'POST') {
    const id = String(u.searchParams.get('id') || '');
    const row = await env.DB.prepare("SELECT data, status FROM join_fax_confirm WHERE id = ? AND status IN ('pending', 'trial')").bind(id).first();
    if (!row) return json({ ok: false, error: 'not pending' }, 404);
    const bytes = await request.arrayBuffer();
    if (bytes.byteLength < 200 || new TextDecoder().decode(bytes.slice(0, 5)) !== '%PDF-') return json({ ok: false, error: 'not a pdf' }, 400);
    let status = 'failed', response = '', jid = '';
    try {
      const d = await decryptPii(key, id, row.data), fax = normFax(d.fax);
      jid = d.jid || '';
      if (!fax) throw new Error('bad fax number');
      const res = await reserve(env, { callId: 'conf-' + id, slot: 'confirm', caller: '', fax, chp: '', company: '', kind: row.status === 'trial' ? 'ניסוי שטר' : 'אישור הצטרפות', docId: id });
      if (!res.id) throw new Error(res.limit ? 'limit' : 'duplicate');
      ({ status, response } = await postFax(env, fax, bytes, 'confirmation.pdf'));
      try { await env.DB.prepare('UPDATE ivr_fax_log SET status = ?, response = ? WHERE id = ?').bind(status, response, res.id).run(); } catch { /* ignore */ }
    } catch (e) { response = String((e && e.message) || e).slice(0, 200); }
    await markFaxSent(env, jid, status === 'sent' ? 'sent' : 'failed');
    await env.DB.prepare('UPDATE join_fax_confirm SET status = ?, data = ?, response = ? WHERE id = ?').bind(status, '', response, id).run();          // הפרטים נמחקים
    return json({ ok: status === 'sent', status });
  }
  return json({ ok: false, error: 'method' }, 405);
}
