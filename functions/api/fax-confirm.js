// ============================================================================
//  functions/api/fax-confirm.js — תור אישורי ההצטרפות בפקס (_shared/join-fax-confirm.js). רק להרצה אוטומטית: כותרת X-Cron-Secret = CRON_SECRET.
//  GET            -> { items: [{ id, html }] } אישורים שממתינים ל-PDF (עד 5)
//  POST ?id=<id>  גוף = PDF מוכן לפקס -> נשלח לספק; הפרטים (מספר הפקס וה-HTML) נמחקים מהתור. מגבלות/יומן: אותו ivr_fax_log של הקו הטלפוני.
// ============================================================================
import { importKeyForWrite, decryptPii } from './_shared/joiners-crypto.js';
import { TABLE } from './_shared/join-fax-confirm.js';
import { postFax, reserve, normFax } from './_shared/ivr-fax.js';

const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });

export async function onRequest({ request, env }) {
  const cs = request.headers.get('X-Cron-Secret') || '';
  if (!env.CRON_SECRET || cs.length !== env.CRON_SECRET.length || cs !== env.CRON_SECRET) return json({ ok: false, error: 'unauthorized' }, 401);
  if (!env.DB) return json({ ok: false, error: 'no db' }, 500);
  await env.DB.prepare(TABLE).run();
  const key = await importKeyForWrite(env);
  const u = new URL(request.url);

  if (request.method === 'GET') {
    const rows = (await env.DB.prepare("SELECT id, data FROM join_fax_confirm WHERE status = 'pending' AND at > ? ORDER BY at LIMIT 5").bind(Date.now() - 3 * 24 * 3600 * 1000).all()).results || [];
    const items = [];
    for (const r of rows) { try { items.push({ id: r.id, html: (await decryptPii(key, r.id, r.data)).html }); } catch { /* שורה פגומה: מדלגים */ } }
    return json({ ok: true, items });
  }

  if (request.method === 'POST') {
    const id = String(u.searchParams.get('id') || '');
    const row = await env.DB.prepare("SELECT data FROM join_fax_confirm WHERE id = ? AND status = 'pending'").bind(id).first();
    if (!row) return json({ ok: false, error: 'not pending' }, 404);
    const bytes = await request.arrayBuffer();
    if (bytes.byteLength < 200 || new TextDecoder().decode(bytes.slice(0, 5)) !== '%PDF-') return json({ ok: false, error: 'not a pdf' }, 400);
    let status = 'failed', response = '';
    try {
      const fax = normFax((await decryptPii(key, id, row.data)).fax);
      if (!fax) throw new Error('bad fax number');
      const res = await reserve(env, { callId: 'conf-' + id, slot: 'confirm', caller: '', fax, chp: '', company: '', kind: 'אישור הצטרפות', docId: id });
      if (!res.id) throw new Error(res.limit ? 'limit' : 'duplicate');
      ({ status, response } = await postFax(env, fax, bytes, 'confirmation.pdf'));
      try { await env.DB.prepare('UPDATE ivr_fax_log SET status = ?, response = ? WHERE id = ?').bind(status, response, res.id).run(); } catch { /* ignore */ }
    } catch (e) { response = String((e && e.message) || e).slice(0, 200); }
    await env.DB.prepare('UPDATE join_fax_confirm SET status = ?, data = ?, response = ? WHERE id = ?').bind(status, '', response, id).run();          // הפרטים נמחקים
    return json({ ok: status === 'sent', status });
  }
  return json({ ok: false, error: 'method' }, 405);
}
