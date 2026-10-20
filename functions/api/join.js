// functions/api/join.js
// קליטת טופס "רישום לקוח להיתר עיסקא פרטי" מהאתר (join.html) לרשימת המצטרפים שמוצגת במסך המנהל.
//   POST /api/join   Content-Type: application/json
//   גוף: { first, last, id, phone, phone2, email, fax, address, choice: "all"|"list", companies: [שם,...], consent: true,
//          agreement_sha256, agreement_version, form_date, t (אלפיות שנייה מטעינת הדף), website (honeypot, חייב להיות ריק) }
//   תשובה: { ok: true, ref } - מספר אסמכתא קצר, בלי שום פרט אישי.
// הפרטים האישיים מוצפנים כאן (AES-256-GCM, המפתח JOINERS_KEY) באותו פורמט של joiners_import.py, ונכתבים לטבלה joiners (migrations/0017).
// בלוגים לא נרשם שום פרט אישי.
import { importKeyForWrite, encryptPii, identHash } from "./_shared/joiners-crypto.js";
import { reply, normalizeId, normalizePhone, validEmail, clean, originOk, readJson, jerusalemNow, newRowId } from "./_shared/join-common.js";

const MAX_BODY = 40 * 1024, MAX_COMPANIES = 300, MIN_FILL_MS = 4000;

export async function onRequestPost({ request, env }) {
  if (!originOk(request)) return reply({ ok: false, error: "הבקשה לא התקבלה" }, 403);
  const b = await readJson(request, MAX_BODY);
  if (!b) return reply({ ok: false, error: "הבקשה לא תקינה" }, 400);

  // בוטים: שדה מלכודת מלא, או טופס שנשלח מהר מדי. מחזירים "הצלחה" בלי לשמור, כדי לא לעזור להם ללמוד מה נדחה.
  if (clean(b.website, 50) || (Number(b.t) || 0) < MIN_FILL_MS) return reply({ ok: true, ref: "0" });

  const first = clean(b.first, 40), last = clean(b.last, 40), address = clean(b.address, 160);
  const id = normalizeId(b.id), phone = normalizePhone(b.phone), phone2 = b.phone2 ? normalizePhone(b.phone2) : "";
  const email = clean(b.email, 120), fax = clean(b.fax, 30);
  const errors = {};
  if (first.length < 2) errors.first = "נא למלא שם פרטי";
  if (last.length < 2) errors.last = "נא למלא שם משפחה";
  if (!id) errors.id = "מספר תעודת הזהות אינו תקין";
  if (!phone) errors.phone = "מספר הטלפון אינו תקין";
  if (clean(b.phone2, 30) && !phone2) errors.phone2 = "מספר הטלפון הנוסף אינו תקין";
  if (email && !validEmail(email)) errors.email = "כתובת הדוא\"ל אינה תקינה";
  if (address.length < 3) errors.address = "נא למלא כתובת";
  if (b.consent !== true) errors.consent = "יש לאשר את תנאי שטר הרישום";
  const choice = b.choice === "all" ? "all" : b.choice === "list" ? "list" : "";
  if (!choice) errors.choice = "נא לבחור אחת משתי האפשרויות";
  let companies = [];
  if (choice === "list") {
    companies = Array.isArray(b.companies) ? [...new Set(b.companies.map(c => clean(c, 120)).filter(Boolean))].slice(0, MAX_COMPANIES) : [];
    if (!companies.length) errors.companies = "נא לבחור לפחות חברה אחת";
  }
  if (Object.keys(errors).length) return reply({ ok: false, errors }, 422);

  let key;
  try { key = await importKeyForWrite(env); } catch { return reply({ ok: false, error: "השירות אינו זמין כרגע. נא לנסות שוב מאוחר יותר." }, 503); }
  try {
    const ih = await identHash(env, id);
    // הגנה מלחיצה כפולה: אותה ת.ז. שנשלחה ב-3 הדקות האחרונות לא נרשמת שוב (הגשות חוזרות מאוחר יותר כן נרשמות, והמנהל רואה "n הגשות")
    const recent = await env.DB.prepare("SELECT id FROM joiners WHERE ident_hash = ? AND submitted_at >= ? LIMIT 1").bind(ih, jerusalemNow(new Date(Date.now() - 3 * 60000))).first();
    if (recent) return reply({ ok: true, ref: recent.id.slice(-6).toUpperCase() });

    const rid = newRowId(), now = jerusalemNow();
    const extra = {};
    if (phone2) extra["טלפון נוסף"] = phone2;
    if (fax) extra["פקס"] = fax;
    extra["כתובת"] = address;
    extra["תאריך בטופס"] = clean(b.form_date, 20);
    extra["גרסת שטר"] = clean(b.agreement_version, 40);
    extra["sha256 של נוסח השטר שהוצג"] = /^[0-9a-f]{64}$/.test(String(b.agreement_sha256 || "")) ? b.agreement_sha256 : "";
    extra["אושרו התנאים"] = "כן";
    const payload = {
      first, last, phone, email, id,
      ip: request.headers.get("CF-Connecting-IP") || "",
      companies: companies.join(", "),
      all: choice === "all" ? "כן" : "",
      pdf: "", extra: JSON.stringify(extra), src: "site:kehilot",
    };
    await env.DB.prepare("INSERT INTO joiners (id, submitted_at, cancelled_at, file_sha256, ident_hash, pii) VALUES (?, ?, '', '', ?, ?)")
      .bind(rid, now, ih, await encryptPii(key, rid, payload)).run();
    return reply({ ok: true, ref: rid.slice(-6).toUpperCase() });
  } catch {
    return reply({ ok: false, error: "אירעה שגיאה בשמירת הטופס. נא לנסות שוב." }, 500);
  }
}
