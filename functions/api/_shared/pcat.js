// "קטגוריה עבור רשימת השטרות" (businesses.permits_category): כמה קטגוריות מופרדות ב-|.
// בלי קטגוריה = "שונות" (או "עיריות" אם בשם עירייה / מועצה); עם קטגוריה ספציפית - בלי "שונות".
const RE_MUNI = /(?:^|[\s\-–(])(?:עירייה|עיריה|עיריית)(?=$|[\s\-–)])|מועצה\s+(?:איזורית|אזורית|מקומית)/;

export function normalizePcat(value, ...names) {
  const spec = String(value || "").split("|").map(x => x.trim()).filter(x => x && x !== "שונות");
  if (spec.length) return spec.join("|");
  return names.some(n => RE_MUNI.test(String(n || ""))) ? "עיריות" : "שונות";
}
