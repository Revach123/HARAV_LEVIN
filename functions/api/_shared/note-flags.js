// סימון "ריעותא" ברשימת החברות (חברה עם בעיה בהיתר העסקה מוצגת באדום).
// אותם כללים בדיוק כמו באתר Revach (scripts/securities/fetch_securities.py, _classify_notes + UNKNOWN_NEG, שלב 9):
//   הערה מהרשימה DISQUALIFY = ריעותא; הערה שאינה מוכרת (לא באף רשימה ולא "אג"ח X'") + אישור אג"ח "לא" או מילים כמו
//   "אין חותמת" / "אין היתר" / "לא מאושר" / "חשש" = ריעותא - אלא אם ההערה עוסקת באג"ח (למשל "לגבי אג"ח חשש נכסים
//   אסורים"): אז הבעיה באג"ח בלבד (BOND_FLAW ב-Revach), והחברה לא מסומנת. כשמשנים כאן - לשנות גם שם.
const S = a => new Set(a);
const NOTES_DISQUALIFY = S(["בעיה בתוקף החתימה", "ההיתר עיסקא לא מספק", "חסר דברים המותרים", "חסר דברים המותרים - צריך מסלול כשר", "חסר דברים המותרים. הנוסח צ\"ע", "חסר חותמת", "ריעותא בחכמ\"א ועדים - צריך מסלול כשר", "ריעותא בחתימה", "ריעותא בתנאי החכמ\"א", "ריעותא בתנאי החכמ\"א והעדים"]);
const NOTES_WEAK = S(["הנוסח חלש", "הנוסח חלש - צריך מסלול כשר"]);
const NOTES_CONTRACT = S(["יש סעיף בחוזה", "מוזכר בחוזה"]);
const NOTES_GOYIM_SINGLE = S(["בעלות גוי", "מאושר מצד בעלות גוי"]);
const NOTES_GOYIM_MAJORITY = S(["על סמך בנקים בחו\"ל רוב גוים"]);
const NOTES_ONLY_PRIVATE = S(["מאושר רק לאג\"ח פרטי בלבד"]);
const NOTES_OK = S(["ההת\"ע על שם הבעלים", "היתר עיסקא לאג\"ח בלבד (היום אין אג\"ח)", "הלוואות בבנק הדואר", "הנוסח עדיף משל שאר הבנקים", "חנות - לא חברה בע\"מ**", "לאג\"ח בלבד", "לאג\"ח בלבד - נוסח מהודר", "מטעם תאגיד מי שבע בלבד", "מצורף לכל חוזה", "עמותה - לא חברה בע\"מ*", "צריך השקעה כשרה", "צריך מסלול כשר", "רק לאג\"ח בלבד", "רשום בחוזה", "שותפות לא רשומה"]);
const SERIES_RE = [/(אג["״]ח|אגח)\s+[א-ת]['׳]/, /[א-ת]['׳]\s+מאושר/];
const UNKNOWN_NEG = /אין חותמת|אין היתר|לא מאושר|חשש/;
const BOND_NOTE = /אג["״]?ח|אגח/;          // הערה על האג"ח - לא על החברה
const KNOWN = [NOTES_WEAK, NOTES_CONTRACT, NOTES_GOYIM_SINGLE, NOTES_GOYIM_MAJORITY, NOTES_ONLY_PRIVATE, NOTES_OK];

// true = יש ריעותא / בעיה בהיתר העסקה (לפי ההערה ואישור האג"ח)
export function hasPermitFlaw(notes, agch) {
  const n = String(notes || "").replace(/\u00a0/g, " ").trim();
  if (!n) return false;
  if (NOTES_DISQUALIFY.has(n)) return true;
  if (KNOWN.some(s => s.has(n)) || SERIES_RE.some(re => re.test(n))) return false;
  if (BOND_NOTE.test(n)) return false;          // הערה לא מוכרת על האג"ח: הבעיה באג"ח בלבד (אישור האג"ח קובע)
  return String(agch || "").trim() === "לא" || UNKNOWN_NEG.test(n);          // הערה לא מוכרת
}
