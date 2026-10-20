// פענוח פרטי מצטרפים (נכתבו מוצפנים ב-AES-256-GCM על ידי scripts/permit_docs/joiners_import.py). המפתח: משתנה הסביבה JOINERS_KEY (base64, 32 בתים).
const b64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const enc = new TextEncoder();
export async function importKey(env) {
  if (!env.JOINERS_KEY) throw new Error("חסר JOINERS_KEY");
  return crypto.subtle.importKey("raw", b64(env.JOINERS_KEY.trim()), "AES-GCM", false, ["decrypt"]);
}
// ── כתיבה (טופס ההרשמה באתר: functions/api/join.js, join-cancel.js) ──
// אותו מפתח ואותו פורמט בדיוק כמו scripts/permit_docs/joiners_import.py, כך שמסך המנהל מפענח רשומות חדשות כמו ישנות.
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
export async function importKeyForWrite(env) {
  if (!env.JOINERS_KEY) throw new Error("חסר JOINERS_KEY");
  return crypto.subtle.importKey("raw", b64(env.JOINERS_KEY.trim()), "AES-GCM", false, ["encrypt", "decrypt"]);
}
export async function encryptPii(key, id, payload) {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, additionalData: enc.encode(String(id)) }, key, enc.encode(JSON.stringify(payload))));
  const out = new Uint8Array(nonce.length + ct.length); out.set(nonce); out.set(ct, nonce.length);
  let s = ""; for (const x of out) s += String.fromCharCode(x);
  return btoa(s);
}
// ident_hash = HMAC-SHA256(מפתח, ספרות ת.ז.) - זהה לחישוב ב-joiners_import.py (לאיתור כפילויות בלי לחשוף את המספר)
export async function identHash(env, idDigits) {
  if (!idDigits) return "";
  const k = await crypto.subtle.importKey("raw", b64(env.JOINERS_KEY.trim()), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", k, enc.encode(idDigits)));
}
// pii = base64( nonce(12) + ciphertext+tag ), additionalData = מזהה השורה
export async function decryptPii(key, id, pii) {
  const raw = b64(pii), nonce = raw.slice(0, 12), ct = raw.slice(12);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce, additionalData: enc.encode(String(id)) }, key, ct);
  return JSON.parse(new TextDecoder().decode(pt));
}
