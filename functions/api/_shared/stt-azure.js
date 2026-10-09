// זיהוי דיבור חיצוני לשלוחת ימות: הורדת ההקלטה מימות ושליחתה ל-Azure Speech (he-IL).
//
// env:
//   AZURE_SPEECH_KEY, AZURE_SPEECH_REGION (ברירת מחדל eastus)  - כמו בריפו revach
//   YEMOT_TOKEN  "<מספר-מערכת>:<סיסמה>"  (כמו ב-phone-today.js של revach)
//   או YEMOT_TTS  API KEY של ימות - נשלח ב-header authorization
//
// ההקלטה היא wav טלפוניה (8kHz, 16bit, mono) - Azure קורא את הפורמט מכותרת הקובץ.

const YEMOT_API = 'https://www.call2all.co.il/ym/api';
const TIMEOUT_MS = 8000;

export function sttConfigured(env) {
  return !!(env.AZURE_SPEECH_KEY && (env.YEMOT_TOKEN || env.YEMOT_TTS));
}

function withTimeout(ms) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  return { signal: ctl.signal, done: () => clearTimeout(timer) };
}

function yemotRequest(env, endpoint, params) {
  const q = new URLSearchParams(params);
  const headers = {};
  if (env.YEMOT_TOKEN) q.set('token', env.YEMOT_TOKEN);
  else headers.authorization = env.YEMOT_TTS;
  return { url: `${YEMOT_API}/${endpoint}?${q}`, headers };
}

// מנסה כל נתיב אפשרי להקלטה (ימות מחזירה בדרך כלל את הנתיב; ננסה גם את הנתיב שקבענו).
export async function downloadRecording(env, candidates) {
  for (const p of candidates) {
    const path = p.startsWith('ivr2:') ? p : `ivr2:${p.startsWith('/') ? p : '/' + p}`;
    const t = withTimeout(TIMEOUT_MS);
    try {
      const { url, headers } = yemotRequest(env, 'DownloadFile', { path });
      const res = await fetch(url, { headers, signal: t.signal });
      const buf = new Uint8Array(await res.arrayBuffer());
      t.done();
      // שגיאת API חוזרת כ-JSON ('{'); wav תקין מתחיל ב-RIFF
      if (res.ok && buf.length > 44 && buf[0] === 0x52 && buf[1] === 0x49) return { bytes: buf, path };
    } catch (e) { t.done(); }
  }
  return null;
}

export async function deleteRecording(env, path) {
  try {
    const { url, headers } = yemotRequest(env, 'FileAction', { action: 'delete', what: path });
    await fetch(url, { headers });
  } catch (e) { /* ניקוי best-effort */ }
}

export async function azureTranscribe(env, wav) {
  const region = env.AZURE_SPEECH_REGION || 'eastus';
  const url = `https://${region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1`
    + '?language=he-IL&format=simple&profanity=raw';
  const t = withTimeout(TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': env.AZURE_SPEECH_KEY,
        'Content-Type': 'audio/wav; codecs=audio/pcm; samplerate=8000',
        Accept: 'application/json',
      },
      body: wav,
      signal: t.signal,
    });
    t.done();
    if (!res.ok) return '';
    const j = await res.json();
    return j.RecognitionStatus === 'Success' ? String(j.DisplayText || '') : '';
  } catch (e) { t.done(); return ''; }
}

// הקלטה -> טקסט. מחזיר '' אם לא הצליח / לא זוהה דיבור.
export async function transcribeRecording(env, candidates) {
  const rec = await downloadRecording(env, candidates);
  if (!rec) return { text: '', error: 'download' };
  const text = await azureTranscribe(env, rec.bytes);
  await deleteRecording(env, rec.path);          // לא שומרים הקלטות של מתקשרים
  return { text, error: text ? '' : 'no-speech' };
}
