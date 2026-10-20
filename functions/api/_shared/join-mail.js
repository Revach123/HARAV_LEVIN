// מייל אישור הצטרפות (נשלח אוטומטית למי שהשאיר דוא"ל בטופס). השליחה בפועל נעשית באתר הוורדפרס (wp_mail), מכתובת הדומיין.
// הגדרה ב-Cloudflare Pages (Settings → Variables and Secrets):
//   WP_MAIL_URL     (רגיל)  https://iska.co.il/wp-json/iska/v1/send-confirmation
//   WP_MAIL_SECRET  (סוד)   אותה סיסמה שמוגדרת בסקריפט בוורדפרס (wp-mail-endpoint.php)
// בלי שניהם לא נשלח מייל וההרשמה ממשיכה כרגיל.
import { AGREEMENT_BEFORE_CHOICE, AGREEMENT_AFTER_CHOICE } from "./agreement.js";

const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function buildConfirmation({ first, last, id, date, all, companies, origin }) {
  const name = `${first} ${last}`.trim();
  const choice = all ? "לבחירת כל החברות שנרשמו וירשמו בהמשך" : "לבחירה מתוך רשימה: " + companies.join(", ");
  const p = t => `<p style="margin:0 0 8px;font-size:14px;line-height:1.6">${esc(t)}</p>`;
  const html = `<!doctype html><html lang="he" dir="rtl"><body style="margin:0;background:#f3f6f6;font-family:Arial,Helvetica,sans-serif;color:#1f2d2d">
<div dir="rtl" style="max-width:640px;margin:0 auto;padding:16px">
<div style="text-align:center;padding:8px 0 14px"><img src="${esc(origin)}/logo.png" alt="מכון היתר עיסקא למהדרין" height="72" style="height:72px;width:auto"></div>
<div style="background:#fff;border:1px solid #cfdcdc;border-radius:14px;padding:18px 20px;margin-bottom:16px">
<h2 style="margin:0 0 10px;color:#1b8a4b;font-size:22px">הרישום התקבל</h2>
<p style="margin:0 0 8px;font-size:16px">תודה, ${esc(name)}. פרטי ההצטרפות נשמרו במכון.</p>
<p style="margin:0 0 4px;font-size:15px">תאריך: ${esc(date)}</p>
<p style="margin:0;font-size:15px">התקשרות: ${esc(all ? "לבחירת כל החברות שנרשמו וירשמו בהמשך" : companies.length + " חברות שנבחרו מהרשימה")}</p></div>
<div style="background:#fff;border:1px solid #e0e8e8;border-radius:14px;padding:18px 20px">
<h3 style="margin:0 0 8px;font-size:18px">שטר רישום להיתר עיסקא פרטי</h3>
<p style="margin:0 0 10px;font-size:13px;color:#4a5a5a">${esc(name)} · ת.ז. ${esc(id)} · ${esc(date)}</p>
<p style="margin:0 0 10px;font-size:14px"><b>התקשרות:</b> ${esc(choice)}</p>
${AGREEMENT_BEFORE_CHOICE.map(p).join("")}${AGREEMENT_AFTER_CHOICE.map(p).join("")}</div>
<p style="text-align:center;font-size:12px;color:#6b7b7b;margin:14px 0 0">מייל זה נשלח אוטומטית. אין צורך להשיב עליו.</p>
</div></body></html>`;
  const text = [`הרישום התקבל`, `תודה, ${name}. פרטי ההצטרפות נשמרו במכון.`, `תאריך: ${date}`, `התקשרות: ${choice}`, "", "שטר רישום להיתר עיסקא פרטי", `${name} · ת.ז. ${id} · ${date}`, "", ...AGREEMENT_BEFORE_CHOICE, choice, ...AGREEMENT_AFTER_CHOICE].join("\n");
  return { html, text };
}

// שליחת מייל כללית דרך וורדפרס. מחזיר true אם נשלח. לעולם לא זורק (כשל במייל לא פוגע בשמירת הנתונים).
export async function sendMail(env, { to, subject, html, text }) {
  if (!env.WP_MAIL_URL || !env.WP_MAIL_SECRET || !to) return false;
  try {
    const r = await fetch(env.WP_MAIL_URL, { method: "POST", headers: { "Content-Type": "application/json", "X-Iska-Secret": env.WP_MAIL_SECRET },
      body: JSON.stringify({ to, subject, html, text }) });
    return r.ok;
  } catch { return false; }
}

export async function sendConfirmation(env, to, data) {
  if (!env.WP_MAIL_URL || !env.WP_MAIL_SECRET || !to) return false;
  try {
    const { html, text } = buildConfirmation(data);
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
