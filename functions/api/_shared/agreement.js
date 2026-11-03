// נוסח שטר הרישום: ברירת המחדל כאן; מנהל יכול לערוך מדף הניהול (עורך עם עיצוב; נשמר ב-D1, admin_settings, מפתח "agreement").
// כל הצרכנים (join.html, מייל האישור, מייל ההצטרפות, AMP, הצטרפות טלפונית) קוראים דרך getAgreement - מקור אחד.
// כל פסקה היא HTML מצומצם ומנוקה (b, i, u, span עם color / font-size וכד', br).
export const DEFAULT_VERSION = "2026-11-03";
export const DEFAULT_LONG = [
 "<span style=\"color:#274d5b;font-weight:700\">הריני מצהיר ומתחייב בזה,</span>",
 "הואיל ויתכן שאעשה, או עשיתי, עסקאות עם מדינה/חברה/עירייה/מוסד/ וכל גוף או בעל עסק (להלן ה\"חברה\"), כולל רכישת והחזקת אג\"ח ושאר ניי\"ע בכל אופן שהוא, וכן כל סוג עיסקה שתהיה (להלן עיסקה), ויתכן שיש או יהיה בעסקאות אלה חשש איסור ריבית,",
 "והואיל והחברה הביעה את הסכמתה להתקשרות באופן פרטי על פי היתר עיסקא עם מי שמעוניין בכך, וזאת ע\"י חתימתה על שטר רישום חברה להיתר עיסקא פרטי, או בכל דרך שהיא, ושם החברה מופיעה ברשימת מכון היתר עיסקא למהדרין ו/או ברשימת מכון כת\"ר לכלכלה על פי התורה ו/או בכל מקום אחר המתפעל הסדר כזה של התקשרות בהיתר עיסקא באופן פרטי (להלן המכון),",
 "והואיל וברצוני שכל עיסקה תהיה כפופה לתנאי ופרטי ההיתר עיסקא של החברה, ולתנאים שבשטר רישום של החברה (במקרה שיש לחברה נוסחאות שונות, הקובע יהיה הנוסח המופיע במכון היתר עיסקא למהדרין, במידה ומופיע), ולתנאים דלהלן בשטר זה (להלן \"הסכם הנפרד\"),",
 "ע\"כ אני מצהיר ומתחייב כדלהלן.",
 "א. התקשרותי על פי הסכם הנפרד היא עם כל החברות אשר כבר רשומים במכון, וכן עם החברות שירשמו בעתיד במכון, אא\"כ הודעתי למכון שכוונתי לחברה מסויימת בלבד.",
 "ב. אני מאשר למכון להעמיד לעיון החברות איתן ביקשתי להתקשר בהסכם הנפרד, את כל פרטי האישיים שנמסרו על ידי למכון בשביל ההסכם הנפרד.",
 "ג. אני מתחייב למסור לחברות איתן בקשתי להתקשר בהסכם נפרד זה, על פי דרישתן, מידע אמיתי על שיעור ותקופת האחזקה של העיסקה, ולהחזיר להן כספים שלפי תנאי הסכם נפרד זה הם שולמו על ידן שלא כדין.",
 "ד. במקרה של קנית עיסקה ביד שניה, שיש בה התחייבות עם חשש ריבית, או במקרה שבתחילת קנית העיסקה או באיזה זמן אח\"כ היה בה התחייבות עם חשש ריבית, ויש צורך להחלת היתר העיסקא באמצע זמן העיסקה, יחולו כל תנאי הסכם הנפרד כשזה מתאפשר, בזמן הנכון ובאופן המותר, ובקנין בהנאת מחילת המלוה ו/או בשאר קנין המועיל.",
 "ה. במקרה הנ\"ל של סעיף ד' אני מצהיר ששיעור הקניה וההחזקה של העיסקה תהיה רק בשיעור המותר לגבייה על פי ההלכה היהודית, ובאופן שאין בה שום חשש איסור בהחזקתו. כמו כן כל התחייבות של החברה אלי שאינה יכולה ליכלל לפי ההלכה בתנאי הסכם הנפרד, כגון התחייבות שמחושבת בגין תקופה קודמת של החזקת העיסקה באופן שהיה בה חשש איסור - במידה ובשיעור שלא יהיה ניתן להכליל אותה בתנאי היתר העיסקא והסכם הנפרד - , וכן כל אופן אחר כיוצ\"ב, אינני רוצה לזכות בה והריני מוותר עליה.",
 "ו. במידה שבתנאי הסכם הנפרד החתום ע\"י החברה יש התחייבות של החברה ו/או תנאי נאמנות המוטל על החברה שיש בהם חשש איסור, הריני מוותר לחברה על תנאים אלה, ובית הדין יכולים להקל על החברה לפי כללי ההלכה על פי שקול דעתם, בכל הנוגע להתחייבויות ותנאי הנאמנות של החברה.",
 "ז. במכירת עיסקה על ידי, כל התחייבות אסורה של החברה כלפי הקונה, במידה וקיימת, אינה בבקשתי ולא בשליחותי אלא ע\"ד החברה בלבד.",
 "ח. בכל מקרה של עסקה עם חשש ריבית ביני לבין אדם פרטי אחר שגם הוא נרשם במכון, ולא סודר בינינו ולא חל עלינו היתר עיסקא אחר כדין וכהלכה, יחול על העסקה ההיתר עיסקא המעודכן של המכון הניתן לחברות, בהתאמה, והמכון יכול למסור לצד השני את פרטי הרישום על פי בקשת בית הדין שידון בענינו.",
 "ט. אני מודה כי כל הקנינים וההתחייבויות שאפשר לבצעם עכשיו נעשו באופן המועיל ביותר על פי ההלכה, מעכשיו, ובבית דין חשוב, על פי משפטי התנאים, דלא כאסמכתא ודלא כטופסי דשטרי. כמו כן עשיית העיסקה עם החברה בסתם, תחשב כהודאה ואישור שכל הקנינים וההתחייבויות הנצרכים עבור הסכם הנפרד נעשו באופן המועיל."
];
export const DEFAULT_SHORT = [
 "בכל עסק שיש בו חשש ריבית עם גוף שרשום במכון (כולל עוד מקומות שמפעילים הסדר כזה) והגוף רשום עם היתר עיסקא פרטי, יחולו כל פרטי ההיתר עיסקא באופן המועיל. וכל תנאי בהיתר עיסקא שהוא לטובתי ויש בו חשש איסור, הריני מוותר עליו.",
 "אני מאשר למכון למסור את פרטי האישיים שנרשמו כאן לחברות ולגופים שידרשו זאת בעקבות חלות ההיתר עיסקא, ואני מתחייב לשתף פעולה בכל הנדרש.",
 "בכל מקרה שבאיזה זמן לא חל ההיתר עיסקא, יחול ההיתר עיסקא אח\"כ באופן ובקנין המועיל. ברכישה ביד שניה כשלא היה תחילה היתר עיסקא, הרכישה וההתחייבות היא רק בשיעור המותר, ובמכירה של עסקה למי שאצלו לא חל ההיתר עיסקא, כל התחייבות אסורה היא על דעתם ולא בשליחותי.",
 "במקרה של חשש ריבית ביני לבין אדם אחר שנרשם במכון, יחול היתר עיסקא של המכון בהתאמה, ככל שאין הסדר יותר טוב הפותר חשש האיסור, והמכון יכול למסור פרטי האישיים עפ\"י דרישת בית הדין.",
 "אני מודה שעשיתי כל הנדרש להחלת ההיתר עיסקא. כמו כן ההתקשרות עם גוף באופן שיש בו חשש ריבית, תיחשב כהודאה שעשיתי כל הנדרש להחלת ההיתר עיסקא."
];

const ALLOWED = new Set(["b", "strong", "i", "em", "u", "span", "br", "sub", "sup"]);
const escText = s => String(s).replace(/&(?!(?:amp|lt|gt|quot|nbsp|#\d{1,6});)/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const SIZE_KW = "xx-small|x-small|small|medium|large|x-large|xx-large|xxx-large";
function cleanStyle(st) {
  const out = [];
  for (const d of String(st).split(";")) {
    const i = d.indexOf(":"); if (i < 0) continue;
    const k = d.slice(0, i).trim().toLowerCase(), v = d.slice(i + 1).trim().toLowerCase();
    if (k === "color" && /^(#[0-9a-f]{3,8}|rgba?\(\s*[\d.\s,%]+\)|[a-z]{3,20})$/.test(v)) out.push("color:" + v);
    else if (k === "font-size" && new RegExp("^(\\d{1,3}(\\.\\d{1,2})?(px|pt|em|rem|%)|" + SIZE_KW + ")$").test(v)) out.push("font-size:" + v);
    else if (k === "font-weight" && /^(bold|normal|[1-9]00)$/.test(v)) out.push("font-weight:" + v);
    else if (k === "font-style" && /^(italic|normal)$/.test(v)) out.push("font-style:" + v);
    else if ((k === "text-decoration" || k === "text-decoration-line") && /^(underline|none|line-through)$/.test(v)) out.push("text-decoration:" + v);
  }
  return out.join(";");
}
// מנקה HTML של פסקה: רק תגיות מהרשימה, ורק style מצומצם. כל השאר (script, onclick, קישורים...) נמחק; הטקסט נשמר.
export function sanitizeHtml(input) {
  const stack = []; let out = "";
  for (const tok of String(input == null ? "" : input).split(/(<[^>]*>)/)) {
    if (!tok) continue;
    const m = tok.startsWith("<") && tok.endsWith(">") ? tok.match(/^<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9]*)([^>]*?)\/?\s*>$/) : null;
    if (!m) { out += escText(tok); continue; }
    const closing = !!m[1], tag = m[2].toLowerCase();
    if (!ALLOWED.has(tag)) continue;
    if (tag === "br") { if (!closing) out += "<br>"; continue; }
    if (closing) { const at = stack.lastIndexOf(tag); if (at < 0) continue; while (stack.length > at) out += `</${stack.pop()}>`; continue; }
    let attr = "";
    if (tag !== "sub" && tag !== "sup") { const sm = m[3].match(/style\s*=\s*(?:"([^"]*)"|'([^']*)')/i); const st = sm ? cleanStyle(sm[1] != null ? sm[1] : sm[2]) : ""; if (st) attr = ` style="${st}"`; }
    stack.push(tag); out += `<${tag}${attr}>`;
  }
  while (stack.length) out += `</${stack.pop()}>`;
  return out;
}
// טקסט רגיל (בלי עיצוב) מפסקת HTML: להודעות טקסט, ל-sha256, להקראה
export function plain(html) {
  return String(html == null ? "" : html).replace(/<br\s*\/?>/gi, " ").replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#(\d{1,6});/g, (_, n) => String.fromCodePoint(+n)).replace(/&amp;/g, "&")
    .replace(/\s+/g, " ").trim();
}
// מערך פסקאות מהמנהל -> פסקאות מנוקות (בלי ריקות)
export const cleanParas = arr => (Array.isArray(arr) ? arr : []).map(sanitizeHtml).filter(p => plain(p));
// תאימות לאחור: פסקה שנשמרה בפורמט הישן ("# " = מודגש, טקסט רגיל)
const legacy = p => /^#\s/.test(p) ? `<span style="color:#274d5b;font-weight:700">${escText(p.slice(2))}</span>` : p;

async function readSetting(env) {
  try { const r = await env.DB.prepare("SELECT value FROM admin_settings WHERE key = 'agreement'").first(); return r ? JSON.parse(r.value) : null; } catch { return null; }
}
// {long:[html...], short:[html...], version, custom, updated}
export async function getAgreement(env) {
  const s = await readSetting(env);
  if (s && Array.isArray(s.long) && s.long.length && Array.isArray(s.short) && s.short.length) return { long: s.long.map(legacy), short: s.short.map(legacy), version: s.version || "custom", custom: true, updated: s.updated || "" };
  return { long: DEFAULT_LONG, short: DEFAULT_SHORT, version: DEFAULT_VERSION, custom: false, updated: "" };
}
export async function saveAgreement(env, long, short) {
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS admin_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)").run();
  const now = new Date().toISOString();
  await env.DB.prepare("INSERT OR REPLACE INTO admin_settings (key, value) VALUES ('agreement', ?)").bind(JSON.stringify({ long, short, version: "A" + now.slice(0, 16).replace(/[-:T]/g, ""), updated: now })).run();
}
export async function resetAgreement(env) { await env.DB.prepare("DELETE FROM admin_settings WHERE key = 'agreement'").run(); }

// הקראה בטלפון (TTS של ימות): מרחיבים קיצורים ומספרי סעיפים כדי שיוקראו נכון
const LETTER = { "א": "אלף", "ב": "בית", "ג": "גימל", "ד": "דלת", "ה": "הא", "ו": "וו", "ז": "זין", "ח": "חית", "ט": "טית", "י": "יוד" };
const ABBR = [[/אג["״]ח/g, "אגרות חוב"], [/ניי["״]ע/g, "ניירות ערך"], [/הנ["״]ל/g, "הנזכר לעיל"], [/אח["״]כ/g, "אחר כך"], [/ע["״]י/g, "על ידי"], [/עפ["״]י/g, "על פי"], [/ע["״]כ/g, "על כן"], [/ע["״]ד/g, "על דעת"], [/כיוצ["״]ב/g, "כיוצא בזה"], [/אא["״]כ/g, "אלא אם כן"], [/ו\/או/g, "ו או"], [/מדינה\/חברה\/עירייה\/מוסד\//g, "מדינה, חברה, עירייה, מוסד, "], [/\bו?\/\b/g, " "]];
export function speakable(html) {
  let t = plain(html).replace(/\[[^\]]*\]/g, " ");
  t = t.replace(/^([א-י])\.\s+/, (_, l) => `סעיף ${LETTER[l] || l}. `).replace(/סעיף ([א-י])['׳]/g, (_, l) => `סעיף ${LETTER[l] || l}`);
  for (const [re, rep] of ABBR) t = t.replace(re, rep);
  return t.replace(/\//g, " ");
}
