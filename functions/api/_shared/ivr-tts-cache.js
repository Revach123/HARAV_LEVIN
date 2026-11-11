// ============================================================================
//  functions/api/_shared/ivr-tts-cache.js — קבצי שמע של Azure לטקסט משתנה (כמו נוסח השטר, שנערך בניהול)
//
//  הביטויים הקבועים מופקים מראש (scripts/ivr_audio/build_audio.py). טקסט שמשתנה בניהול לא יכול להיות שם, ולכן:
//  audioFor(text) מחזיר f-<נתיב בימות> אם כבר הופק קובץ לטקסט הזה, ואחרת null (ההקראה ב-TTS של ימות) ומפיק ברקע:
//  Azure Speech (אותו קול ופורמט כמו הביטויים הקבועים) -> UploadFile לשלוחת השמע בימות (99) -> רישום בטבלה ivr_tts_cache.
//  טקסט ששונה = מפתח אחר (sha1 של הקול והטקסט) = קובץ חדש; הישנים פשוט לא בשימוש.
//  דרישות: AZURE_SPEECH_KEY (+ AZURE_SPEECH_REGION, ברירת מחדל eastus), YEMOT_TOKEN או YEMOT_TTS. בלי אחד מהם - תמיד TTS של ימות.
//  IVR_AUDIO_OFF=1 מכבה (כמו בביטויים הקבועים).
// ============================================================================
import { VOICE, AUDIO_FOLDER } from './ivr_phrases.js';

const TABLE = 'CREATE TABLE IF NOT EXISTS ivr_tts_cache (k TEXT PRIMARY KEY, path TEXT NOT NULL, at TEXT DEFAULT (datetime(\'now\')))';
const UPLOAD_URL = 'https://www.call2all.co.il/ym/api/UploadFile';
const inFlight = new Set();          // באותו isolate: לא מפיקים אותו טקסט פעמיים במקביל

export const ttsCacheEnabled = (env) => String(env.IVR_AUDIO_OFF || '') !== '1' && !!String(env.AZURE_SPEECH_KEY || '').trim() && !!(env.YEMOT_TOKEN || env.YEMOT_TTS);

async function keyOf(text) {
  const h = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(`${VOICE}\n${text}`));
  return 'ag_' + [...new Uint8Array(h)].slice(0, 6).map((b) => b.toString(16).padStart(2, '0')).join('');
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

async function produce(env, k, text) {
  const region = env.AZURE_SPEECH_REGION || 'eastus';
  const ssml = `<speak version='1.0' xml:lang='he-IL' xmlns='http://www.w3.org/2001/10/synthesis'><voice name='${VOICE}'>${esc(text)}</voice></speak>`;
  const tts = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
    method: 'POST',
    headers: { 'Ocp-Apim-Subscription-Key': String(env.AZURE_SPEECH_KEY).trim(), 'Content-Type': 'application/ssml+xml; charset=utf-8', 'X-Microsoft-OutputFormat': 'riff-8khz-16bit-mono-pcm', 'User-Agent': 'harav-levin-ivr' },
    body: ssml,
  });
  const wav = new Uint8Array(await tts.arrayBuffer());
  if (!tts.ok || wav[0] !== 0x52) throw new Error(`azure tts ${tts.status}`);
  const fd = new FormData();
  fd.append('path', `ivr2:${AUDIO_FOLDER}/${k}.wav`);
  fd.append('convertAudio', '1');
  if (env.YEMOT_TOKEN) fd.append('token', env.YEMOT_TOKEN);
  fd.append('file', new Blob([wav], { type: 'audio/wav' }), `${k}.wav`);
  const up = await fetch(UPLOAD_URL, { method: 'POST', body: fd, headers: env.YEMOT_TOKEN ? {} : { authorization: env.YEMOT_TTS } });
  const j = await up.json().catch(() => ({}));
  if (j.responseStatus !== 'OK') throw new Error(`yemot upload ${j.responseStatus || up.status}`);
  await env.DB.prepare(TABLE).run();
  await env.DB.prepare('INSERT OR REPLACE INTO ivr_tts_cache (k, path) VALUES (?, ?)').bind(k, `/${AUDIO_FOLDER}/${k}`).run();
}

/** f-<נתיב> לקובץ Azure של הטקסט, או null (ואז מופק ברקע דרך waitUntil, לפעם הבאה) */
export async function audioFor(env, text, waitUntil) {
  if (!ttsCacheEnabled(env) || !text) return null;
  const k = await keyOf(text);
  try {
    const r = await env.DB.prepare('SELECT path FROM ivr_tts_cache WHERE k = ?').bind(k).first();
    if (r && r.path) return `f-${r.path}`;
  } catch { /* הטבלה עוד לא קיימת */ }
  if (waitUntil && !inFlight.has(k)) {
    inFlight.add(k);
    waitUntil(produce(env, k, text).catch((e) => console.log(`ivr-tts-cache: ${e && e.message}`)).finally(() => inFlight.delete(k)));
  }
  return null;
}

/** הפקה מוקדמת ברקע (למשל כשנשאלת השאלה "לשמוע את השטר המלא?"), כדי שהקבצים יהיו מוכנים */
export async function warm(env, texts, waitUntil) {
  for (const t of texts) await audioFor(env, t, waitUntil);
}
