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
    const total = rec.bytes.length, m = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get("Range") || "");
    const base = { "Content-Type": "audio/wav", "Accept-Ranges": "bytes", ...H };
    if (m && (m[1] || m[2])) {
      const start = m[1] ? Number(m[1]) : Math.max(0, total - Number(m[2])), end = m[1] && m[2] ? Math.min(total - 1, Number(m[2])) : total - 1;
      if (start > end || start >= total) return new Response(null, { status: 416, headers: { ...base, "Content-Range": `bytes */${total}` } });
      return new Response(rec.bytes.slice(start, end + 1), { status: 206, headers: { ...base, "Content-Range": `bytes ${start}-${end}/${total}` } });
    }
    return new Response(rec.bytes, { headers: base });
  } catch {
    return err("שגיאה בהשמעת ההקלטה", 500);
  }
}
