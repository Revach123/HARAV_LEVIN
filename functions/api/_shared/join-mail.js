// מייל אישור הצטרפות (נשלח אוטומטית למי שהשאיר דוא"ל בטופס). השליחה בפועל נעשית באתר הוורדפרס (wp_mail), מכתובת הדומיין.
// הגדרה ב-Cloudflare Pages (Settings → Variables and Secrets):
//   WP_MAIL_URL     (רגיל)  https://iska.co.il/wp-json/iska/v1/send-confirmation
//   WP_MAIL_SECRET  (סוד)   אותה סיסמה שמוגדרת בסקריפט בוורדפרס (wp-mail-endpoint.php)
// בלי שניהם לא נשלח מייל וההרשמה ממשיכה כרגיל.
import { DEFAULT_LONG, getAgreement, plain } from "./agreement.js";

const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// intro = משפט פתיחה (בשליחה חוזרת מהניהול). בלי בחירה ידועה (לא "כל החברות" ולא רשימה, למשל הרשמה מנדרים פלוס) - שורות הבחירה מושמטות
export function buildConfirmation({ first, last, id, date, all, companies, origin, intro, agreement, agreementTitle }) {
  const name = `${first} ${last}`.trim();
  companies = companies || [];
  const known = !!all || companies.length > 0;
  const choice = all ? "לבחירת כל החברות שנרשמו וירשמו בהמשך" : "לבחירה מתוך רשימה: " + companies.join(", ");
  const pick = all ? "בחרת להתקשר מול כל עסקים שנרשמו למאגר, כולל עסקים שירשמו בהמשך" : "בחרת להתקשר מול החברות שנבחרו מהרשימה: " + companies.join(", ");
  const agr = agreement || DEFAULT_LONG;
  const p = t => `<p style="margin:0 0 8px;font-size:14px;line-height:1.6">${t}</p>`;          // t = HTML מנוקה מהניהול
  const html = `<!doctype html><html lang="he" dir="rtl"><body style="margin:0;background:#eef2f2;font-family:Arial,Helvetica,sans-serif;color:#1f2d2d">
<div dir="rtl" style="max-width:660px;margin:0 auto;padding:16px">
${intro ? `<p style="margin:0 0 12px;font-size:15px;font-weight:bold;text-align:center">${esc(intro)}</p>` : ""}
<div style="background:#fff;border:2px solid #1b6b52;border-radius:6px;padding:6px">
<div style="border:1px solid #9bbfb2;padding:22px 24px">
<div style="text-align:center;border-bottom:2px solid #1b6b52;padding-bottom:14px;margin-bottom:18px">
<img src="${esc(origin)}/logo.png" alt="מכון היתר עיסקא למהדרין" height="80" style="height:80px;width:auto">
<h1 style="margin:10px 0 0;font-size:24px;color:#1b6b52">אישור רישום למכון היתר עיסקא למהדרין</h1></div>
<p style="margin:0 0 10px;font-size:17px;line-height:1.7">שלום ${esc(name)} ת.ז. ${esc(id)},</p>
<p style="margin:0 0 10px;font-size:16px;line-height:1.7">הרינו לאשר בזאת שהתקבל הרישום למכון היתר עיסקא למהדרין. פרטי ההצטרפות נשמרו במכון.</p>
<p style="margin:0 0 6px;font-size:16px"><b>תאריך:</b> ${esc(date)}</p>
${known ? `<p style="margin:0 0 6px;font-size:15px"><b>התקשרות:</b> ${esc(pick)}</p>` : ""}
<div style="border-top:1px solid #cfdcdc;margin-top:16px;padding-top:14px">
<h3 style="margin:0 0 8px;font-size:18px">${esc(agreementTitle || "שטר רישום להיתר עיסקא פרטי")}</h3>
${agr.map(p).join("")}${known ? `<p style="margin:8px 0 0;font-size:14px;line-height:1.6"><b>התקשרותי על פי השטר:</b> ${esc(choice)}</p>` : ""}</div>
<div style="border-top:2px solid #1b6b52;margin-top:18px;padding-top:12px;text-align:center;font-size:14px;line-height:1.8;color:#34504a">
<b>מכון היתר עיסקא למהדרין</b><br>דוא"ל: <span dir="ltr">SL5742214@gmail.com</span> · טלפון: <span dir="ltr">052-7117041</span></div>
</div></div>
<p style="text-align:center;font-size:12px;color:#6b7b7b;margin:14px 0 0">מייל זה נשלח אוטומטית. אין צורך להשיב עליו.</p>
</div></body></html>`;
  const text = [...(intro ? [intro, ""] : []), "אישור רישום למכון היתר עיסקא למהדרין", "", `שלום ${name} ת.ז. ${id},`, "הרינו לאשר בזאת שהתקבל הרישום למכון היתר עיסקא למהדרין. פרטי ההצטרפות נשמרו במכון.", `תאריך: ${date}`, ...(known ? [`התקשרות: ${pick}`] : []), "", agreementTitle || "שטר רישום להיתר עיסקא פרטי", ...agr.map(plain), ...(known ? ["התקשרותי על פי השטר: " + choice] : []), "", "מכון היתר עיסקא למהדרין", 'דוא"ל: SL5742214@gmail.com · טלפון: 052-7117041'].join("\n");
  return { html, text };
}

// שליחת מייל כללית דרך וורדפרס. מחזיר true אם נשלח. לעולם לא זורק (כשל במייל לא פוגע בשמירת הנתונים).
// replyTo: כתובת לתשובות (Reply-To), למשל כתובת ההצטרפות במייל (דורש את גרסת wp-mail-endpoint.php שמכירה reply_to)
// amp: חלק AMP (text/x-amp-html) אופציונלי - דורש את גרסת wp-mail-endpoint.php שמכירה amp
// cc: עותק (דורש את גרסת wp-mail-endpoint.php שמכירה cc)
export async function sendMail(env, { to, subject, html, text, replyTo, amp, cc }) {
  if (!env.WP_MAIL_URL || !env.WP_MAIL_SECRET || !to) return false;
  try {
    const r = await fetch(env.WP_MAIL_URL, { method: "POST", headers: { "Content-Type": "application/json", "X-Iska-Secret": env.WP_MAIL_SECRET },
      body: JSON.stringify({ to, subject, html, text, ...(replyTo ? { reply_to: replyTo } : {}), ...(amp ? { amp } : {}), ...(cc ? { cc } : {}) }) });
    return r.ok;
  } catch { return false; }
}

// רישום בטבלת joiner_mail (אותה טבלה של joiners-confirm.js) שמייל האישור נשלח למצטרף - לתצוגת "אישור" ברשימת המצטרפים
export async function markMailSent(env, joinerId) {
  if (!env.DB || !joinerId) return;
  try {
    await env.DB.prepare("CREATE TABLE IF NOT EXISTS joiner_mail (id TEXT PRIMARY KEY, sent_at TEXT NOT NULL)").run();
    await env.DB.prepare("INSERT OR REPLACE INTO joiner_mail (id, sent_at) VALUES (?, datetime('now'))").bind(String(joinerId)).run();
  } catch { /* תצוגה בלבד: לא פוגע בהרשמה */ }
}
// מצב אישור הפקס של מצטרף: 'pending' (בתור), 'failed', או זמן השליחה (state = 'sent')
export async function markFaxSent(env, joinerId, state = 'sent') {
  if (!env.DB || !joinerId) return;
  try {
    await env.DB.prepare("CREATE TABLE IF NOT EXISTS joiner_fax (id TEXT PRIMARY KEY, sent_at TEXT NOT NULL)").run();
    await env.DB.prepare("INSERT OR REPLACE INTO joiner_fax (id, sent_at) VALUES (?, " + (state === 'sent' ? "datetime('now')" : '?') + ")").bind(...(state === 'sent' ? [String(joinerId)] : [String(joinerId), state])).run();
  } catch { /* תצוגה בלבד */ }
}

export async function sendConfirmation(env, to, data) {
  if (!env.WP_MAIL_URL || !env.WP_MAIL_SECRET || !to) return false;
  try {
    const ag = await getAgreement(env);
    const { html, text } = buildConfirmation({ ...data, agreement: ag.long, agreementTitle: ag.longTitle });
    return await sendMail(env, { to, subject: "אישור הצטרפות להיתר עיסקא פרטי", html, text });
  } catch { return false; }
}

// התראה לבעל האתר על בקשת ביטול הצטרפות חדשה
export const CANCEL_NOTIFY_TO = "sl5742214@gmail.com";
export async function sendCancelNotice(env, d) {
  const rows = [["שם", d.name], ["טלפון", d.phone], ["דוא\"ל", d.email], ["ת.ז.", d.id], ["תאריך הבקשה", d.when], ["הותאם מצטרף ונסמן כמבוטל", d.matched ? "כן" : "לא (יש להתאים ידנית)"]].filter(r => r[1]);
  const html = `<div dir="rtl" style="font-family:Arial,Helvetica,sans-serif;font-size:16px;color:#1f2d2d"><h2 style="color:#b3261e;margin:0 0 10px">בקשת ביטול הצטרפות</h2><table style="border-collapse:collapse">`
    + rows.map(([k, v]) => `<tr><td style="padding:4px 14px 4px 0;color:#555">${esc(k)}</td><td style="padding:4px 0"><b>${esc(v)}</b></td></tr>`).join("") + `</table></div>`;
  const text = "בקשת ביטול הצטרפות\n" + rows.map(([k, v]) => `${k}: ${v}`).join("\n");
  return sendMail(env, { to: env.CANCEL_NOTIFY_TO || CANCEL_NOTIFY_TO, subject: "בקשת ביטול הצטרפות להיתר עיסקא: " + (d.name || ""), html, text });
}

// קובץ האישור (HTML) נשמר בדלי הפרטי (R2) ומשויך למצטרף (joiner_files). מחזיר את ה-sha256, או "" אם לא נשמר.
export async function saveConfirmationFile(env, conf) {
  if (!env.JOINERS) return "";
  try {
    const ag = await getAgreement(env), html = buildConfirmation({ ...conf, agreement: ag.long, agreementTitle: ag.longTitle }).html, buf = new TextEncoder().encode(html);
    const sha = [...new Uint8Array(await crypto.subtle.digest("SHA-256", buf))].map(x => x.toString(16).padStart(2, "0")).join("");
    const key = `forms/site/${sha}.html`;
    await env.JOINERS.put(key, buf, { httpMetadata: { contentType: "text/html; charset=utf-8" } });
    await env.DB.prepare("INSERT OR REPLACE INTO joiner_files (sha256, original_name, r2_key, size) VALUES (?, ?, ?, ?)").bind(sha, "אישור הצטרפות.html", key, buf.length).run();
    return sha;
  } catch { return ""; }
}
