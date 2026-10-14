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

export const checkAdmin = (request, env) => checkPassword((request.headers.get("Authorization") || "").replace("Bearer ", ""), env);

export async function setPassword(env, pw) {
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS admin_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)").run();
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
  await env.DB.prepare("INSERT OR REPLACE INTO admin_settings (key, value) VALUES ('password', ?)").bind(salt + ":" + await sha(salt + pw)).run();
}
