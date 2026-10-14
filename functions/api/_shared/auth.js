// functions/api/_shared/auth.js
// אימות מנהל. הסיסמה נשמרת (מוצפנת: מלח + SHA-256) בטבלה admin_settings ב-D1 אחרי "שינוי סיסמה" מדף הניהול.
// כל עוד לא שונתה - הסיסמה היא המשתנה ADMIN_PASSWORD. אחרי שינוי, רק הסיסמה החדשה תקפה.
// שחזור (אם נשכחה): ב-D1 להריץ  DELETE FROM admin_settings WHERE key='password';  - וחוזרים ל-ADMIN_PASSWORD.
const enc = new TextEncoder();
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
const sha = async s => hex(await crypto.subtle.digest("SHA-256", enc.encode(s)));
const same = (a, b) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };

async function storedPassword(env) {
  try { const r = await env.DB.prepare("SELECT value FROM admin_settings WHERE key = 'password'").first(); return r ? r.value : null; }
  catch { return null; }      // הטבלה עוד לא קיימת
}

export async function checkPassword(token, env) {
  token = (token || "").trim();
  if (!token) return false;
  const stored = await storedPassword(env);
  if (stored) { const [salt, h] = stored.split(":"); return same(await sha(salt + token), h); }
  return !!env.ADMIN_PASSWORD && same(token, env.ADMIN_PASSWORD);
}

// ── כניסה לפי IP (בלי סיסמה) ──
// שני האנשים הראשונים שמקלידים סיסמה נכונה נרשמים לפי ה-IP שלהם, ומכאן נכנסים בלי סיסמה.
// (אפשר גם להוסיף ידנית בלי הגבלה דרך המשתנה OWNER_IPS - רשימה מופרדת בפסיקים.)
const MAX_REGISTERED = 2;
export const clientIp = request => request.headers.get("CF-Connecting-IP") || "";
async function storedIps(env) {
  try { const r = await env.DB.prepare("SELECT value FROM admin_settings WHERE key = 'trusted_ips'").first(); return r ? JSON.parse(r.value) : []; }
  catch { return []; }
}
export async function isTrustedIp(request, env) {
  const ip = clientIp(request); if (!ip) return false;
  const owner = (env.OWNER_IPS || "").split(",").map(x => x.trim()).filter(Boolean);
  return owner.includes(ip) || (await storedIps(env)).includes(ip);
}
// נקרא אחרי הקלדת סיסמה נכונה: אם נרשמו פחות משני IP וה-IP הזה לא מורשה - רושם אותו. מחזיר true אם נרשם עכשיו.
export async function registerFirstIp(request, env) {
  const ip = clientIp(request);
  if (!ip || await isTrustedIp(request, env)) return false;
  const list = await storedIps(env);
  if (list.length >= MAX_REGISTERED) return false;
  try {
    await env.DB.prepare("CREATE TABLE IF NOT EXISTS admin_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)").run();
    await env.DB.prepare("INSERT OR REPLACE INTO admin_settings (key, value) VALUES ('trusted_ips', ?)").bind(JSON.stringify([...list, ip])).run();
    return true;
  } catch { return false; }
}

export const checkAdmin = async (request, env) =>
  (await checkPassword((request.headers.get("Authorization") || "").replace("Bearer ", ""), env)) || (await isTrustedIp(request, env));

export async function setPassword(env, pw) {
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS admin_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)").run();
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
  await env.DB.prepare("INSERT OR REPLACE INTO admin_settings (key, value) VALUES ('password', ?)").bind(salt + ":" + await sha(salt + pw)).run();
}
