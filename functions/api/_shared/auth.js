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

// ── כניסה בלי סיסמה לפי מכשיר (לא לפי IP: ברשת סלולרית / משותפת הרבה אנשים חולקים IP) ──
// שני האנשים הראשונים שמקלידים סיסמה נכונה מקבלים עוגיית מכשיר אקראית (HttpOnly); בשרת נשמרת רק הצפנה שלה (SHA-256).
// מי שיש לו עוגייה כזו נכנס בלי סיסמה.
const MAX_DEVICES = 2, COOKIE = "adm_dev";
async function storedDevices(env) {
  try { const r = await env.DB.prepare("SELECT value FROM admin_settings WHERE key = 'trusted_devices'").first(); return r ? JSON.parse(r.value) : []; }
  catch { return []; }
}
const deviceCookie = request => { const m = (request.headers.get("Cookie") || "").match(new RegExp("(?:^|;\\s*)" + COOKIE + "=([0-9a-f]{64})")); return m ? m[1] : ""; };
export async function isTrustedDevice(request, env) {
  const c = deviceCookie(request); if (!c) return false;
  return (await storedDevices(env)).includes(await sha(c));
}
// אחרי סיסמה נכונה: אם המכשיר לא מורשה ויש מקום (עד שניים) - רושם אותו. מחזיר כותרת Set-Cookie, או null.
export async function registerDevice(request, env) {
  if (await isTrustedDevice(request, env)) return null;
  const list = await storedDevices(env);
  if (list.length >= MAX_DEVICES) return null;
  const token = hex(crypto.getRandomValues(new Uint8Array(32)));
  try {
    await env.DB.prepare("CREATE TABLE IF NOT EXISTS admin_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)").run();
    await env.DB.prepare("INSERT OR REPLACE INTO admin_settings (key, value) VALUES ('trusted_devices', ?)").bind(JSON.stringify([...list, await sha(token)])).run();
  } catch { return null; }
  return `${COOKIE}=${token}; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Lax`;
}

export const checkAdmin = async (request, env) =>
  (await checkPassword((request.headers.get("Authorization") || "").replace("Bearer ", ""), env)) || (await isTrustedDevice(request, env));

export async function setPassword(env, pw) {
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS admin_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)").run();
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
  await env.DB.prepare("INSERT OR REPLACE INTO admin_settings (key, value) VALUES ('password', ?)").bind(salt + ":" + await sha(salt + pw)).run();
}
