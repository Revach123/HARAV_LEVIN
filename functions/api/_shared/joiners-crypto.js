// פענוח פרטי מצטרפים (נכתבו מוצפנים ב-AES-256-GCM על ידי scripts/permit_docs/joiners_import.py). המפתח: משתנה הסביבה JOINERS_KEY (base64, 32 בתים).
const b64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const enc = new TextEncoder();
export async function importKey(env) {
  if (!env.JOINERS_KEY) throw new Error("חסר JOINERS_KEY");
  return crypto.subtle.importKey("raw", b64(env.JOINERS_KEY.trim()), "AES-GCM", false, ["decrypt"]);
}
// pii = base64( nonce(12) + ciphertext+tag ), additionalData = מזהה השורה
export async function decryptPii(key, id, pii) {
  const raw = b64(pii), nonce = raw.slice(0, 12), ct = raw.slice(12);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce, additionalData: enc.encode(String(id)) }, key, ct);
  return JSON.parse(new TextDecoder().decode(pt));
}
