// ============================================================================
//  functions/api/_shared/stt-eleven.js — זיהוי דיבור (עברית) דרך ElevenLabs Speech to Text (Scribe)
//
//  POST https://api.elevenlabs.io/v1/speech-to-text  (multipart: model_id, file, language_code)  כותרת xi-api-key.
//  סוד: ELEVENLABS_API_KEY (Cloudflare Pages -> Settings -> Variables and Secrets). בלי מפתח - elevenConfigured() = false.
//  אופציונלי: ELEVENLABS_STT_MODEL (ברירת מחדל scribe_v1; אם המודל נדחה מנסים scribe_v2).
//  ההקלטה עצמה מורדת מימות (downloadRecording ב-stt-azure.js, דורש YEMOT_TOKEN).
// ============================================================================
import { downloadRecording } from './stt-azure.js';

const URL_STT = 'https://api.elevenlabs.io/v1/speech-to-text';
const TIMEOUT_MS = 20000;

export const elevenConfigured = (env) => !!String(env.ELEVENLABS_API_KEY || '').trim();

/** wav -> טקסט. lang = 'he' (ברירת מחדל) או '' (זיהוי שפה אוטומטי, למשל לכתובת מייל). '' אם לא זוהה / שגיאה (השגיאה נרשמת בלוג בלי תוכן). */
export async function elevenTranscribe(env, wav, lang = 'he') {
  const models = [...new Set([String(env.ELEVENLABS_STT_MODEL || '').trim() || 'scribe_v1', 'scribe_v2'])];
  for (const model of models) {
    const fd = new FormData();
    fd.append('model_id', model);
    if (lang) fd.append('language_code', lang);
    fd.append('tag_audio_events', 'false');
    fd.append('diarize', 'false');
    fd.append('file', new Blob([wav], { type: 'audio/wav' }), 'rec.wav');
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(URL_STT, { method: 'POST', headers: { 'xi-api-key': String(env.ELEVENLABS_API_KEY).trim() }, body: fd, signal: ctl.signal });
      clearTimeout(t);
      if (res.ok) { const j = await res.json(); return String((j && j.text) || '').replace(/\s+/g, ' ').trim(); }
      const err = (await res.text()).slice(0, 200);
      console.log(`stt-eleven ${model}: HTTP ${res.status}`);
      if (!/model/i.test(err)) return '';          // שגיאה שאינה בגלל המודל: לא מנסים מודל אחר
    } catch (e) { clearTimeout(t); console.log(`stt-eleven ${model}: ${e && e.name}`); return ''; }
  }
  return '';
}

/** הקלטה בימות (נתיבים אפשריים) -> טקסט בכל אחת מהשפות (הורדה אחת). ['he'] = עברית בלבד. */
export async function elevenTranscribeRecording(env, candidates, langs = ['he']) {
  const rec = await downloadRecording(env, candidates);
  if (!rec) return langs.map(() => '');
  return Promise.all(langs.map((l) => elevenTranscribe(env, rec.bytes, l)));
}

// ---- ספרות מדיבור: "אפס חמש אחת", "052", "שלושים ושתיים" -> ספרות ----
const UNITS = { 'אפס': 0, 'אחת': 1, 'אחד': 1, 'שתיים': 2, 'שתים': 2, 'שניים': 2, 'שנים': 2, 'שני': 2, 'שתי': 2, 'שלוש': 3, 'שלש': 3, 'שלושה': 3, 'שלשה': 3,
  'ארבע': 4, 'ארבעה': 4, 'חמש': 5, 'חמישה': 5, 'חמשה': 5, 'שש': 6, 'שישה': 6, 'ששה': 6, 'שבע': 7, 'שבעה': 7, 'שמונה': 8, 'תשע': 9, 'תשעה': 9 };
const TENS = { 'עשר': 1, 'עשרה': 1, 'עשרים': 2, 'שלושים': 3, 'שלשים': 3, 'ארבעים': 4, 'חמישים': 5, 'שישים': 6, 'ששים': 6, 'שבעים': 7, 'שמונים': 8, 'תשעים': 9 };
export function digitsFromSpeech(text) {
  const toks = String(text || '').replace(/[״"'׳.,\-–]/g, ' ').split(/\s+/).filter(Boolean);
  let out = '';
  for (let i = 0; i < toks.length; i++) {
    let w = toks[i];
    if (/^\d+$/.test(w)) { out += w; continue; }
    if (/^ו/.test(w) && !(w in UNITS) && !(w in TENS)) w = w.slice(1);          // "ושתיים" -> "שתיים"
    if (w in TENS) {
      let nx = toks[i + 1] || '';
      if (/^ו/.test(nx)) nx = nx.slice(1);
      if (TENS[w] > 1 && nx in UNITS) { out += String(TENS[w]) + String(UNITS[nx]); i++; }          // "שלושים ושתיים" -> 32
      else out += TENS[w] === 1 ? '10' : `${TENS[w]}0`;
      continue;
    }
    if (w in UNITS) out += String(UNITS[w]);
  }
  return out;
}
