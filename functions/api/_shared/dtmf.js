// זיהוי צלילי DTMF (הקשות) בתוך הקלטת wav טלפוניה (8kHz, 16bit, mono), כדי לשלב דיבור והקשות באותה הקלטה:
// הקשות שנשמעות בהקלטה מומרות לספרות, והדיבור שביניהן מתומלל בנפרד. אם בהקלטה אין צלילים - מחזיר קטע דיבור אחד (כמו קודם).
const ROWS = [697, 770, 852, 941], COLS = [1209, 1336, 1477, 1633];
const KEYS = ['123A', '456B', '789C', '*0#D'];

function parseWav(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let rate = 8000, pos = 12, start = 44, len = bytes.length - 44;
  for (; pos + 8 <= bytes.length;) {
    const id = String.fromCharCode(...bytes.subarray(pos, pos + 4)), size = dv.getUint32(pos + 4, true);
    if (id === 'fmt ') rate = dv.getUint32(pos + 12, true);
    if (id === 'data') { start = pos + 8; len = Math.min(size, bytes.length - start); break; }
    pos += 8 + size + (size & 1);
  }
  const n = len >> 1, pcm = new Int16Array(n);
  for (let i = 0; i < n; i++) pcm[i] = dv.getInt16(start + 2 * i, true);
  return { rate, pcm };
}

function wavOf(pcm, rate) {
  const out = new Uint8Array(44 + pcm.length * 2), dv = new DataView(out.buffer);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) out[o + i] = s.charCodeAt(i); };
  w(0, 'RIFF'); dv.setUint32(4, 36 + pcm.length * 2, true); w(8, 'WAVEfmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true);
  dv.setUint16(22, 1, true); dv.setUint32(24, rate, true); dv.setUint32(28, rate * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
  w(36, 'data'); dv.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) dv.setInt16(44 + 2 * i, pcm[i], true);
  return out;
}

function goertzel(pcm, from, N, f, rate) {
  const k = 2 * Math.cos((2 * Math.PI * f) / rate);
  let s1 = 0, s2 = 0;
  for (let i = 0; i < N; i++) { const s = pcm[from + i] + k * s1 - s2; s2 = s1; s1 = s; }
  return s1 * s1 + s2 * s2 - k * s1 * s2;
}

// ספרה בחלון אחד, או '' (חייב: אנרגיה משמעותית, שורה ועמודה בולטות על פני האחרות ועל פני האנרגיה הכללית)
function frameDigit(pcm, from, N, rate) {
  let tot = 0;
  for (let i = 0; i < N; i++) tot += pcm[from + i] * pcm[from + i];
  if (tot < N * 400 * 400) return '';                          // שקט / חלש מדי
  const r = ROWS.map((f) => goertzel(pcm, from, N, f, rate)), c = COLS.map((f) => goertzel(pcm, from, N, f, rate));
  const ri = r.indexOf(Math.max(...r)), ci = c.indexOf(Math.max(...c));
  const rs = [...r].sort((a, b) => b - a), cs = [...c].sort((a, b) => b - a);
  if (rs[0] < 8 * rs[1] || cs[0] < 8 * cs[1]) return '';
  if (r[ri] + c[ci] < 0.45 * tot * N / 2) return '';          // שני הצלילים חייבים להיות רוב האנרגיה (דיבור לא עובר)
  if (Math.max(r[ri], c[ci]) > 6 * Math.min(r[ri], c[ci])) return '';
  return KEYS[ri][ci];
}

/** מחזיר רצף מסודר: [{ type: 'speech', wav }, { type: 'digits', digits }, ...]. בלי צלילים: קטע דיבור אחד (ההקלטה כולה). */
export function splitSpeechAndDigits(bytes) {
  let wav;
  try { wav = parseWav(bytes); } catch { return [{ type: 'speech', wav: bytes }]; }
  const { rate, pcm } = wav, N = Math.round(rate * 0.0256);     // ~25ms
  const hits = [];                                              // {d, a, b} בדגימות
  let cur = null;
  for (let p = 0; p + N <= pcm.length; p += N >> 1) {
    const d = frameDigit(pcm, p, N, rate);
    if (d && cur && cur.d === d) cur.b = p + N;
    else if (d) { cur = { d, a: p, b: p + N, n: 1 }; hits.push(cur); }
    else cur = null;
  }
  const tones = hits.filter((h) => h.b - h.a >= N * 2 + (N >> 1) - 1 && /[0-9*#]/.test(h.d));   // לפחות ~50ms
  if (!tones.length) return [{ type: 'speech', wav: bytes }];
  const out = [];
  let at = 0, run = null;
  const flushSpeech = (to) => {
    if (to - at >= rate * 0.35) out.push({ type: 'speech', wav: wavOf(pcm.slice(at, to), rate) });
  };
  for (const t of tones) {
    const a = Math.max(at, t.a - (N >> 1)), b = Math.min(pcm.length, t.b + (N >> 1));
    if (run && t.a - run.end <= rate * 0.8) { if (/\d/.test(t.d)) run.digits += t.d; run.end = t.b; at = b; continue; }   // המשך אותה רצף הקשות
    if (run) out.push({ type: 'digits', digits: run.digits });
    run = null;
    flushSpeech(a);
    run = { digits: /\d/.test(t.d) ? t.d : '', end: t.b };
    at = b;
  }
  if (run) out.push({ type: 'digits', digits: run.digits });
  flushSpeech(pcm.length);
  return out.filter((x) => x.type === 'speech' || x.digits);
}
export { wavOf };
