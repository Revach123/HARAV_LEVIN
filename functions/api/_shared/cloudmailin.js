// ============================================================================
//  functions/api/_shared/cloudmailin.js — שליחת מייל דרך CloudMailin (Outbound API), כולל חלק AMP
//
//  המייל נבנה כאן במלואו (MIME גולמי: text/plain + text/x-amp-html + text/html, בסדר הזה - כפי ש-Gmail דורש)
//  ונשלח בשדה raw של ה-API. כך אפשר לשלוח מייל דינמי (AMP) בלי שרת וורדפרס.
//
//  הגדרות (סודות ב-Cloudflare Pages):
//    CLOUDMAILIN_SMTP_URL - פרטי השליחה מ-CloudMailin, בצורה smtp://USERNAME:API_TOKEN@host:port
//                           (או CLOUDMAILIN_USERNAME + CLOUDMAILIN_API_TOKEN)
//    CLOUDMAILIN_FROM     - כתובת השולח (בדומיין שאומת ב-CloudMailin), למשל join@example.org
//    CLOUDMAILIN_FROM_NAME (לא חובה) - שם השולח
//  ה-API: POST https://api.cloudmailin.com/api/v0.1/{USERNAME}/messages  { from, to, cc, raw, test_mode }
//  test_mode: CloudMailin בודק את המייל ולא שולח.
// ============================================================================

const API = "https://api.cloudmailin.com/api/v0.1";

export function cloudmailinCreds(env) {
  const u = String(env.CLOUDMAILIN_SMTP_URL || "").trim();
  if (u) {
    try {
      const x = new URL(u);
      return { user: decodeURIComponent(x.username), token: decodeURIComponent(x.password) };
    } catch { /* נופל לשדות הנפרדים */ }
  }
  const user = String(env.CLOUDMAILIN_USERNAME || "").trim(), token = String(env.CLOUDMAILIN_API_TOKEN || "").trim();
  return user && token ? { user, token } : null;
}

const utf8b64 = (s) => {
  const bytes = new TextEncoder().encode(String(s == null ? "" : s));
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};
const wrap76 = (b64) => b64.replace(/(.{76})/g, "$1\r\n");
// כותרת בעברית: RFC 2047 (encoded-word, base64)
const encWord = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${utf8b64(s)}?=`);
const list = (v) => (Array.isArray(v) ? v : v ? [v] : []).map(String).filter(Boolean);

export function buildMime({ from, fromName, to, cc, replyTo, subject, text, html, amp }) {
  const boundary = "b" + crypto.randomUUID().replace(/-/g, "");
  const domain = String(from).split("@")[1] || "localhost";
  const head = [
    `From: ${fromName ? `${encWord(fromName)} <${from}>` : from}`,
    `To: ${list(to).join(", ")}`,
    ...(list(cc).length ? [`Cc: ${list(cc).join(", ")}`] : []),
    ...(replyTo ? [`Reply-To: ${replyTo}`] : []),
    `Subject: ${encWord(subject || "")}`,
    `Date: ${new Date().toUTCString().replace("GMT", "+0000")}`,
    `Message-ID: <${crypto.randomUUID()}@${domain}>`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ];
  const part = (type, body) => [`--${boundary}`, `Content-Type: ${type}; charset=UTF-8`, "Content-Transfer-Encoding: base64", "",
    wrap76(utf8b64(body))].join("\r\n");
  // הסדר חשוב: טקסט, AMP, ואחרון HTML (תוכנות שלא מכירות AMP מציגות את החלק האחרון שהן מבינות)
  const parts = [part("text/plain", text || ""), ...(amp ? [part("text/x-amp-html", amp)] : []), part("text/html", html || "")];
  return head.join("\r\n") + "\r\n\r\n" + parts.join("\r\n") + `\r\n--${boundary}--\r\n`;
}

// מחזיר { ok, status, body }. לעולם לא זורק.
export async function sendCloudMailin(env, { to, cc, subject, html, text, replyTo, amp }, { testMode = false } = {}) {
  const creds = cloudmailinCreds(env), from = String(env.CLOUDMAILIN_FROM || "").trim();
  if (!creds || !from || !list(to).length) return { ok: false, status: 0, body: "missing CLOUDMAILIN_SMTP_URL / CLOUDMAILIN_FROM / to" };
  const raw = buildMime({ from, fromName: env.CLOUDMAILIN_FROM_NAME || "", to, cc, replyTo, subject, text, html, amp });
  const payload = JSON.stringify({ from, to: list(to), ...(list(cc).length ? { cc: list(cc) } : {}), raw, test_mode: !!testMode });
  const url = `${API}/${encodeURIComponent(creds.user)}/messages`;
  // אימות: Bearer עם ה-API token; אם נדחה (401) - Basic עם שם המשתמש והטוקן
  const auths = [`Bearer ${creds.token}`, `Basic ${btoa(`${creds.user}:${creds.token}`)}`];
  let last = { ok: false, status: 0, body: "" };
  for (const auth of auths) {
    try {
      const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: auth }, body: payload });
      last = { ok: r.ok, status: r.status, body: (await r.text()).slice(0, 2000) };
      if (r.status !== 401) return last;
    } catch (e) {
      last = { ok: false, status: 0, body: String(e && e.message || e) };
    }
  }
  return last;
}
