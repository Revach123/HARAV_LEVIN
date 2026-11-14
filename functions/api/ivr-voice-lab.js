// ============================================================================
//  functions/api/ivr-voice-lab.js — שלוחת ניסויים לזיהוי דיבור (ElevenLabs Scribe), בלי רישום הצטרפות
//
//  תפריט: 1 = שם פרטי, 2 = שם משפחה, 3 = כתובת (עיר ואחריה רחוב). אחרי כל הקלטה מוקרא:
//    "בלי הכוונה: <זיהוי בלי keyterms>. עם הכוונה: <זיהוי עם keyterms>. ברשימה: <השם שהותאם>" - וחזרה לתפריט.
//  keyterms: שם פרטי / משפחה - השמות הנפוצים במאגר (/api/name-keyterms); עיר - 1000 היישובים הגדולים; רחוב - רחובות העיר שהותאמה.
//  כל ניסיון נרשם בטבלה ivr_lab_log (לצפייה: הדף /voice-lab, שקורא את GET /api/ivr-voice-lab?log=1 עם כניסת המנהל; 50 אחרונים).
//  בלי מצב בשרת: כל סבב במשתנים חדשים (m<k> בחירה, r<k> הקלטה, s<k> הקלטת רחוב), והתמלולים במטמון (stt-cache.js).
//  ext.ini:  type=api / api_link=https://harav-levin.pages.dev/api/ivr-voice-lab / api_add_0=sk=<IVR_SECRET_NEW> / api_add_1=bk=/
//  אופציונלי: api_add_2=rf=/9 (תיקיית ההקלטות בימות = תיקיית השלוחה; ברירת מחדל /9).
// ============================================================================
import { checkAdmin } from './_shared/auth.js';
import { folderParam, parseYemot, readRecord, readTap, secretOk } from './_shared/ivr-auth.js';
import { unit, ttsClean } from './_shared/ivr_phrases.js';
import MANIFEST from './_shared/ivr_audio_manifest.js';
import { elevenConfigured, elevenTranscribe, KEYTERMS_MAX } from './_shared/stt-eleven.js';
import { downloadRecording } from './_shared/stt-azure.js';
import { sttGet, sttPut } from './_shared/stt-cache.js';
import { loadNameKeyterms } from './_shared/name-keyterms.js';
import { canonName, likeliest, loadCities, loadCitiesTop, loadStreets } from './_shared/ivr-addr.js';

const EMPTY = 'NONE', REC_MIN = 1, REC_MAX = 10, MAX_ROUNDS = 60;
const T = (txt) => `t-${ttsClean(txt)}`;
const MENU = 'לשם פרטי הקישו 1. לשם משפחה הקישו 2. לכתובת הקישו 3';

export async function onRequest({ request, env }) {
  const v = await parseYemot(request);
  if (request.method === 'GET' && new URL(request.url).searchParams.get('log')) return showLog(request, env);
  if (!secretOk(env, v.sk)) return text('id_list_message=t-שגיאת הרשאה&');
  if (v.hangup === 'yes') return text('');
  const mf = String(env.IVR_AUDIO_OFF || '') === '1' ? {} : MANIFEST;
  const P = (key) => unit(key, mf);
  const bk = folderParam(v, 'bk', env.IVR_BACK_FOLDER || '/');
  if (!elevenConfigured(env)) return text(`id_list_message=${P('v:off')}&go_to_folder=${bk}&`);
  try { return text(await step({ v, env, P, bk, origin: new URL(request.url).origin })); }
  catch (e) { console.log(`ivr-voice-lab error: ${e && e.message}`); return text(`id_list_message=${P('join:error')}&go_to_folder=${bk}&`); }
}

async function step({ v, env, P, bk, origin }) {
  const folder = folderParam(v, 'rf', '/9').replace(/\/$/, '');
  const call = String(v.ApiCallId || 'x').replace(/\W/g, '');
  const file = (key) => `lab${call}_${key}`;
  const rec = (msg, key) => readRecord(msg, key, folder, file(key), REC_MIN, REC_MAX);
  const menu = (k, pre = '') => readTap(pre + T(MENU), `m${k}`, null, { max: 1, min: 1, wait: 10, empty: EMPTY });
  const got = (k) => Object.prototype.hasOwnProperty.call(v, k) && v[k] && v[k] !== EMPTY;

  // תמלול פעמיים (בלי / עם keyterms), פעם אחת לכל הקלטה (מטמון לפי סבב ומיקום)
  const transcribe = async (key, slot, terms) => {
    const cached = await sttGet(env, `lab${call}`, slot);
    if (cached != null) { try { return JSON.parse(cached); } catch {} }
    const value = String(v[key] || '');
    const recd = await downloadRecording(env, [...(/\.(wav|mp3|ogg)$/i.test(value) || /^\/.*\//.test(value) ? [value] : []), `${folder}/${file(key)}.wav`, `${folder}/${file(key)}`]);
    let out = ['', null], sent = terms.length;
    if (recd && terms.length > KEYTERMS_MAX) {          // רשימה גדולה (רחובות בעיר גדולה): קודם בלי הכוונה, ואז 1000 הדומים ביותר למה שזוהה
      const plain = await elevenTranscribe(env, recd.bytes, 'he');
      const pick = plain ? likeliest(terms, plain, KEYTERMS_MAX) : [];
      sent = pick.length;
      out = [plain, pick.length ? await elevenTranscribe(env, recd.bytes, 'he', pick) : null];
    } else if (recd) out = await Promise.all([elevenTranscribe(env, recd.bytes, 'he'), terms.length ? elevenTranscribe(env, recd.bytes, 'he', terms) : Promise.resolve(null)]);
    const res = { plain: clean(out[0]), kt: out[1] == null ? null : clean(out[1]), n: sent };
    await sttPut(env, `lab${call}`, slot, JSON.stringify(res));
    return res;
  };
  const say = (label, r, matched) => {
    const parts = [label, `בלי הכוונה: ${r.plain || 'לא זוהה'}`];
    if (r.kt != null) parts.push(`עם הכוונה: ${r.kt || 'לא זוהה'}`); else parts.push('אין רשימת הכוונה');
    if (matched !== undefined) parts.push(matched ? `ברשימה: ${matched}` : 'לא נמצא ברשימה');
    return parts.map(T).join('.') + '.';
  };

  for (let k = 0; k < MAX_ROUNDS; k++) {
    const m = `m${k}`, r = `r${k}`, s = `s${k}`;
    if (!got(m)) return menu(k, k ? '' : T('שלוחת ניסויים לזיהוי דיבור') + '.');
    const c = v[m];
    if (!['1', '2', '3'].includes(c)) { if (!got(`m${k + 1}`)) return menu(k + 1); continue; }
    if (c === '1' || c === '2') {
      if (!got(r)) return rec(P(c === '1' ? 'join:askFirst' : 'join:askLast'), r);
      if (got(`m${k + 1}`)) continue;          // הסבב הסתיים
      const kind = c === '1' ? 'first' : 'last';
      const res = await transcribe(r, k * 10 + 1, await loadNameKeyterms(env, kind));
      await logRow(env, kind, res, '');
      return menu(k + 1, say(c === '1' ? 'שם פרטי' : 'שם משפחה', res));
    }
    // 3 = כתובת: עיר ואחריה רחוב (עם רחובות העיר שהותאמה)
    if (!got(r)) return rec(P('v:askCity'), r);
    const cities = await loadCities(env, origin), names = cities ? cities.map((x) => x[1]) : null;
    const cr = await transcribe(r, k * 10 + 1, await loadCitiesTop(env, origin));
    const city = canonName(names, cr.kt || cr.plain) || canonName(names, cr.plain);
    const code = (city && cities && (cities.find((x) => x[1] === city) || [])[0]) || '';
    const streets = code ? (await loadStreets(env, origin, code)) || [] : [];
    if (got(`m${k + 1}`)) continue;          // הסבב הסתיים
    if (!got(s)) {
      await logRow(env, 'city', cr, city);
      if (city && !streets.length) return menu(k + 1, say('עיר', cr, city) + T('ביישוב אין רחובות ברשימה') + '.');
      return rec(say('עיר', cr, city) + (city ? '' : T('הרחוב יזוהה בלי רשימת רחובות') + '.') + P('v:askStreet'), s);
    }
    const sr = await transcribe(s, k * 10 + 2, streets);
    const street = streets.length ? (canonName(streets, sr.kt || sr.plain) || canonName(streets, sr.plain)) : undefined;
    await logRow(env, 'street', sr, street || '', city);
    return menu(k + 1, say('רחוב', sr, street));
  }
  return `id_list_message=${T('תודה')}&go_to_folder=${bk}&`;
}

const clean = (s) => String(s || '').replace(/[.,!?]+$/g, '').replace(/\s+/g, ' ').trim().slice(0, 200);

// ---- יומן הניסויים ----
const LOG_TABLE = 'CREATE TABLE IF NOT EXISTS ivr_lab_log (at TEXT, kind TEXT, plain TEXT, kt TEXT, n INTEGER, matched TEXT, ctx TEXT)';
async function logRow(env, kind, r, matched, ctx = '') {
  try {
    await env.DB.prepare(LOG_TABLE).run();
    await env.DB.prepare('INSERT INTO ivr_lab_log (at, kind, plain, kt, n, matched, ctx) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(new Date().toISOString(), kind, r.plain, r.kt == null ? '' : r.kt, r.n, matched || '', ctx || '').run();
  } catch (e) { console.log('lab log error'); }
}
async function showLog(request, env) {
  if (!(await checkAdmin(request, env))) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    await env.DB.prepare(LOG_TABLE).run();
    const rows = (await env.DB.prepare('SELECT * FROM ivr_lab_log ORDER BY at DESC LIMIT 50').all()).results ?? [];
    return Response.json({ rows }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) { return Response.json({ error: String(e.message || e) }, { status: 500 }); }
}

const text = (body) => new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
