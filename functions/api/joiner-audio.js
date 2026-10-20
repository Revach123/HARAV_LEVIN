// functions/api/joiner-audio.js — השמעת הקלטה של מצטרף טלפוני (מסך המנהל). מנהל בלבד.
//   GET /api/joiner-audio?id=<מזהה מצטרף>&k=<שם השדה, למשל "הקלטת שם פרטי">&sign=1  ->  { url } חתום; ה-url מחזיר audio/wav
// הנתיב נלקח מהרשומה המוצפנת של המצטרף (שדות "הקלטת ..." ב-extra, נכתבים ב-ivr-join.js) ולא מהבקשה,
// וההקלטה מורדת מימות (YEMOT_TOKEN או YEMOT_TTS של החשבון שבו נשמרות ההקלטות). בלוגים לא נרשם שום פרט אישי.
import { checkAdmin } from "./_shared/auth.js";
import { noAuth } from "./_shared/permit-docs.js";
import { importKey, decryptPii } from "./_shared/joiners-crypto.js";
import { downloadRecording } from "./_shared/stt-azure.js";

const H = { "Cache-Control": "no-store" };
const err = (msg, status) => Response.json({ error: msg }, { status, headers: H });
const SIGN_TTL_S = 300;
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
async function sign(env, id, k, exp) {
  const key = await crypto.subtle.importKey("raw", Uint8Array.from(atob(env.JOINERS_KEY.trim()), (c) => c.charCodeAt(0)), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`audio|${id}|${k}|${exp}`)));
}

// ימות שומרת לפעמים wav בקידוד טלפוני (µ-law / A-law, פורמט 7 / 6) שרוב הדפדפנים לא מנגנים: ממירים ל-PCM של 16 ביט.
export function toPcmWav(b) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const tag = (o) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
  if (b.length < 44 || tag(0) !== "RIFF" || tag(8) !== "WAVE") return b;
  let fmt = 0, ch = 1, rate = 8000, data = -1, len = 0;
  for (let o = 12; o + 8 <= b.length;) {
    const id = tag(o), n = dv.getUint32(o + 4, true);
    if (id === "fmt ") { fmt = dv.getUint16(o + 8, true); ch = dv.getUint16(o + 10, true); rate = dv.getUint32(o + 12, true); }
    if (id === "data") { data = o + 8; len = Math.min(n, b.length - data); break; }
    o += 8 + n + (n & 1);
  }
  if ((fmt !== 6 && fmt !== 7) || data < 0) return b;
  const out = new Uint8Array(44 + len * 2), ov = new DataView(out.buffer);
  const put = (o, str) => [...str].forEach((c, i) => { out[o + i] = c.charCodeAt(0); });
  put(0, "RIFF"); ov.setUint32(4, 36 + len * 2, true); put(8, "WAVE"); put(12, "fmt "); ov.setUint32(16, 16, true); ov.setUint16(20, 1, true); ov.setUint16(22, ch, true);
  ov.setUint32(24, rate, true); ov.setUint32(28, rate * ch * 2, true); ov.setUint16(32, ch * 2, true); ov.setUint16(34, 16, true); put(36, "data"); ov.setUint32(40, len * 2, true);
  for (let i = 0; i < len; i++) {
    let v = b[data + i];
    if (fmt === 7) { v = ~v & 0xff; const t = (((v & 0x0f) << 3) + 0x84) << ((v & 0x70) >> 4); v = (v & 0x80) ? 0x84 - t : t - 0x84; }       // µ-law
    else { v ^= 0x55; const e = (v & 0x70) >> 4, m = v & 0x0f; let t = e === 0 ? (m << 4) + 8 : ((m << 4) + 0x108) << (e - 1); v = (v & 0x80) ? t : -t; }  // A-law
    ov.setInt16(44 + i * 2, v, true);
  }
  return out;
}

// שני מצבים:
//  1. ?id&k&sign=1 (מנהל, בקשת JSON רגילה)  ->  { url }: כתובת חתומה קצרת-תוקף (5 דקות) להקלטה אחת.
//  2. ?id&k&exp&sig  ->  האודיו עצמו (audio/wav, עם תמיכה ב-Range), בלי כותרת הרשאה: כך הדפדפן מנגן אותו כרכיב שמע רגיל
//     (<audio src>), כמו כל קובץ שמע, ולא דרך הורדה ידנית של קובץ בינארי.
export async function onRequestGet({ request, env }) {
  const u = new URL(request.url);
  const id = u.searchParams.get("id") || "", k = u.searchParams.get("k") || "";
  if (!/^[\w-]{3,40}$/.test(id) || !k.startsWith("הקלטת ")) return err("בקשה לא תקינה", 400);
  if (!env.JOINERS_KEY) return err("המפתח JOINERS_KEY לא מוגדר באתר", 503);
  const exp = u.searchParams.get("exp"), sig = u.searchParams.get("sig");
  if (sig) {
    if (!/^\d{9,12}$/.test(exp || "") || Number(exp) < Date.now() / 1000 || (await sign(env, id, k, exp)) !== sig) return err("הקישור פג תוקף או אינו תקין", 401);
  } else if (!(await checkAdmin(request, env))) return noAuth();
  if (!(env.YEMOT_TOKEN || env.YEMOT_TTS)) return err("חסר YEMOT_TOKEN / YEMOT_TTS להורדת הקלטות מימות", 503);
  try {
    const row = await env.DB.prepare("SELECT id, pii FROM joiners WHERE id = ?").bind(id).first();
    if (!row) return err("המצטרף לא נמצא", 404);
    const p = await decryptPii(await importKey(env), row.id, row.pii);
    let extra = {}; try { extra = JSON.parse(p.extra || "{}"); } catch { /* שדות חופשיים */ }
    const path = String(extra[k] || "");
    if (!/^\/[\w\/.\-]+$/.test(path)) return err("אין הקלטה בשדה הזה", 404);
    if (u.searchParams.get("sign") === "1" && !sig) {
      const e = Math.floor(Date.now() / 1000) + SIGN_TTL_S;
      return Response.json({ url: `/api/joiner-audio?id=${encodeURIComponent(id)}&k=${encodeURIComponent(k)}&exp=${e}&sig=${await sign(env, id, k, e)}` }, { headers: H });
    }
    const rec = await downloadRecording(env, [path.replace(/\.wav$/i, "") + ".wav", path]);
    if (!rec) return err("ההקלטה לא נמצאה בימות (ייתכן שנמחקה, או שהמפתח של ימות הוא של חשבון אחר)", 404);
    const bytes = toPcmWav(rec.bytes);
    const total = bytes.length, m = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get("Range") || "");
    const base = { "Content-Type": "audio/wav", "Accept-Ranges": "bytes", ...H };
    if (m && (m[1] || m[2])) {
      const start = m[1] ? Number(m[1]) : Math.max(0, total - Number(m[2])), end = m[1] && m[2] ? Math.min(total - 1, Number(m[2])) : total - 1;
      if (start > end || start >= total) return new Response(null, { status: 416, headers: { ...base, "Content-Range": `bytes */${total}` } });
      return new Response(bytes.slice(start, end + 1), { status: 206, headers: { ...base, "Content-Range": `bytes ${start}-${end}/${total}` } });
    }
    return new Response(bytes, { headers: base });
  } catch {
    return err("שגיאה בהשמעת ההקלטה", 500);
  }
}
