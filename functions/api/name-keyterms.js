// POST /api/name-keyterms[?min=2] — בניית רשימות השמות הנפוצים (פרטי / משפחה) מטבלת המצטרפים, להכוונת זיהוי הדיבור בשלוחה 3.
// מנהל (מהאתר) או X-Cron-Secret (workflow ידני name-keyterms). מחזיר רק מספרים, בלי שמות.
import { checkAdmin } from './_shared/auth.js';
import { buildNameKeyterms } from './_shared/name-keyterms.js';

export async function onRequestPost({ request, env }) {
  const cs = request.headers.get('X-Cron-Secret') || '';
  const cron = !!env.CRON_SECRET && cs.length === env.CRON_SECRET.length && cs === env.CRON_SECRET;
  if (!cron && !(await checkAdmin(request, env))) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const min = Math.max(1, Math.min(50, Number(new URL(request.url).searchParams.get('min')) || 2));
  try { return Response.json(await buildNameKeyterms(env, { min }), { headers: { 'Cache-Control': 'no-store' } }); }
  catch (e) { return Response.json({ error: String((e && e.message) || e) }, { status: 500 }); }
}
