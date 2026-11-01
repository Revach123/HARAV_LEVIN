// תווית "איפה נרשם" לרישום מצטרף (src + שדה הערוץ ב-extra)
export function srcLabel(src, extra) {
  const s = String(src || "");
  let o = {}; try { const j = typeof extra === "string" ? JSON.parse(extra || "{}") : extra; if (j && typeof j === "object") o = j; } catch { /* טקסט חופשי */ }
  if (/טלפון/.test(o["ערוץ"] || "") || s === "ivr") return "טלפון";
  if (/^nedarim/.test(s)) return "נדרים פלוס";
  if (s === "site:embed") return "אתר";
  if (s === "site:kehilot") return "קהילות (אתר)";
  if (/^excel:/.test(s)) return "קהילה: " + (o["מקור"] || s.slice(6));
  if (/^(cfdb7|advcf7)/.test(s)) return "אתר ישן (טופס " + (s.split(":")[1] || "") + ")";
  if (s === "admin") return "ידני (מנהל)";
  return s || "";
}
