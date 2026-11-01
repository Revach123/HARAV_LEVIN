// אימות הזדהות גוגל (Google Identity Services): מקבל ID token מהדפדפן ומאמת מול גוגל.
// דורש משתנה סביבה GOOGLE_CLIENT_ID (Cloudflare Pages -> Variables): ה-OAuth Client ID מסוג Web מ-Google Cloud Console,
// עם iska.co.il ו-harav-levin.pages.dev ב-Authorized JavaScript origins.
export async function verifyGoogleToken(env, credential) {
  const cid = String(env.GOOGLE_CLIENT_ID || "").trim();
  if (!cid || !credential || typeof credential !== "string" || credential.length > 4000) return null;
  try {
    const r = await fetch("https://oauth2.googleapis.com/tokeninfo?id_token=" + encodeURIComponent(credential));
    if (!r.ok) return null;
    const j = await r.json();
    if (j.aud !== cid || !/^(accounts\.google\.com|https:\/\/accounts\.google\.com)$/.test(String(j.iss || ""))) return null;
    if (String(j.email_verified) !== "true" || !j.email) return null;
    if (Number(j.exp) * 1000 < Date.now()) return null;
    return { email: String(j.email).trim().toLowerCase(), name: String(j.name || "") };
  } catch { return null; }
}
