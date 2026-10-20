// מייל אישור הצטרפות (נשלח אוטומטית למי שהשאיר דוא"ל בטופס). שליחה דרך Resend (https://resend.com).
// הגדרה ב-Cloudflare Pages (Settings → Variables and Secrets):
//   RESEND_API_KEY  (סוד)   מפתח ה-API
//   MAIL_FROM       (רגיל)  למשל:  מכון היתר עיסקא <noreply@iska.co.il>  (הדומיין חייב להיות מאומת ב-Resend)
//   MAIL_REPLY_TO   (רגיל, אופציונלי)  כתובת למענה
// בלי RESEND_API_KEY או MAIL_FROM לא נשלח מייל וההרשמה ממשיכה כרגיל.
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
<p style="margin:0;font-size:15px">התקשרות: ${esc(all ? "כל החברות שנרשמו וירשמו בהמשך" : companies.length + " חברות שנבחרו מהרשימה")}</p></div>
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

// מחזיר true אם נשלח. לעולם לא זורק (כשל במייל לא פוגע בהרשמה).
export async function sendConfirmation(env, to, data) {
  if (!env.RESEND_API_KEY || !env.MAIL_FROM || !to) return false;
  try {
    const { html, text } = buildConfirmation(data);
    const body = { from: env.MAIL_FROM, to: [to], subject: "אישור הצטרפות להיתר עיסקא פרטי", html, text };
    if (env.MAIL_REPLY_TO) body.reply_to = env.MAIL_REPLY_TO;
    const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return r.ok;
  } catch { return false; }
}
