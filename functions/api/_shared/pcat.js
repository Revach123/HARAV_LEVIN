// "קטגוריה עבור רשימת השטרות" (businesses.permits_category): כמה קטגוריות מופרדות ב-|.
// בלי קטגוריה = "שונות"; עם קטגוריה ספציפית - בלי "שונות".
export function normalizePcat(value) {
  const spec = String(value || "").split("|").map(x => x.trim()).filter(x => x && x !== "שונות");
  return spec.length ? spec.join("|") : "שונות";
}
