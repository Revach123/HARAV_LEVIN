// פונקציות משותפות לטפסי ההרשמה והביטול באתר (join.js, join-cancel.js). ללא תלות ב-Cloudflare, כדי שאפשר לבדוק ב-Node.
export const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
export const reply = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: JSON_HEADERS });

// ת.ז. ישראלית: 5-9 ספרות, מרופדת באפסים ל-9, בדיקת ספרת ביקורת (אלגוריתם לון)
export function normalizeId(v) {
  const d = String(v || "").replace(/\D/g, "");
  if (d.length < 5 || d.length > 9) return "";
  const p = d.padStart(9, "0");
  let sum = 0;
  for (let i = 0; i < 9; i++) { let n = Number(p[i]) * (i % 2 === 0 ? 1 : 2); if (n > 9) n -= 9; sum += n; }
  return sum % 10 === 0 ? p : "";
}
// טלפון ישראלי: 9-10 ספרות (אחרי הסרת קידומת 972); מחזיר ספרות בלבד, או "" אם לא תקין
export function normalizePhone(v) {
  let d = String(v || "").replace(/\D/g, "");
  if (d.startsWith("972")) d = "0" + d.slice(3);
  return /^0\d{8,9}$/.test(d) ? d : "";
}
// אותיות לועזיות בלבד (תווי ASCII ללא רווחים)
export const validEmail = v => v.length <= 120 && /^[\x21-\x7e]+@[\x21-\x7e]+\.[\x21-\x7e]{2,}$/.test(v) && !/[<>"']/.test(v);
// טקסט חופשי: מסיר תווי בקרה, מקצץ רווחים ומגביל אורך
export const clean = (v, max) => String(v == null ? "" : v).replace(/[\u0000-\u001f\u007f\u200e\u200f\u202a-\u202e]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

// הבקשה חייבת לבוא מהאתר עצמו (Origin זהה למארח), מכתובות האתר הידועות, או מ-localhost בפיתוח. בקשה בלי Origin (כלי שורת פקודה) נדחית.
const ALLOWED = ["harav-levin.pages.dev", "iska.co.il", "www.iska.co.il"];
export function originOk(request) {
  const o = request.headers.get("Origin");
  if (!o) return false;
  let h; try { h = new URL(o).hostname; } catch { return false; }
  const self = new URL(request.url).hostname;
  return h === self || ALLOWED.includes(h) || h.endsWith(".harav-levin.pages.dev") || h === "localhost" || h === "127.0.0.1";
}

export async function readJson(request, maxBytes) {
  const len = Number(request.headers.get("Content-Length") || 0);
  if (len > maxBytes) return null;
  const text = await request.text();
  if (text.length > maxBytes) return null;
  try { const j = JSON.parse(text); return j && typeof j === "object" && !Array.isArray(j) ? j : null; } catch { return null; }
}

// "YYYY-MM-DD HH:MM:SS" בשעון ישראל (כמו התאריכים שיובאו מהטפסים הישנים)
export function jerusalemNow(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(d).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}
export const newRowId = () => "w" + [...crypto.getRandomValues(new Uint8Array(8))].map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 15);
