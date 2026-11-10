/* funds-export.js — הורדת רשימת המסלולים והקרנות הכשרים (גלאט הון) כקובץ Excel. משותף ל-funds.html ולדף הניהול (admin.html).
 * דורש xlsx-lite.js (downloadXlsx). הסדר כמו בדף: לפי סוג מוצר (סדר הסוגים שנשמר), ובתוך כל סוג - מיטב, הראל, ואז א-ב.
 * שימוש: GlattFunds.download({ rows, type_order, updated })   (המבנה של GET /api/glatt-funds)
 */
(function () {
  const TABS = [["pension", "קרנות פנסיה, גמל והשתלמות וחיסכון לכל ילד"], ["savings", "תוכנית חיסכון, ביטוח, גמל להשקעה, קרנות סל"]];
  const FIRST = ["מיטב", "הראל"];
  const MARK = { new: "חדש", del: "הוסר" };
  // השורות של לשונית אחת (כולל שורות "both" שמוצגות בשתי הלשוניות) בסדר הקבוע
  function sortRows(rows, tab, saved) {
    const order = [...((saved && saved[tab]) || [])], rank = c => { c = String(c || "").trim(); const k = FIRST.indexOf(c); return k >= 0 ? [k, ""] : c ? [FIRST.length, c] : [FIRST.length + 1, ""]; };
    const mine = rows.filter(r => r.tab === tab || r.tab === "both");
    mine.forEach(r => { if (!order.includes(r.type)) order.push(r.type); });
    return mine.map((r, n) => ({ r, n })).sort((a, b) => (order.indexOf(a.r.type) - order.indexOf(b.r.type))
      || (rank(a.r.company)[0] - rank(b.r.company)[0]) || rank(a.r.company)[1].localeCompare(rank(b.r.company)[1], "he") || (a.n - b.n)).map(x => x.r);
  }
  function download(data) {
    if (typeof downloadXlsx !== "function") { alert("ההורדה לא זמינה כרגע. נסו לרענן את הדף."); return; }
    const rows = (data && data.rows) || [], order = (data && data.type_order) || null, seen = new Set(), out = [];
    for (const [tab, label] of TABS) for (const r of sortRows(rows, tab, order)) {          // שורה "both" - פעם אחת, ברשימה הראשונה
      if (seen.has(r)) continue; seen.add(r);
      out.push([r.tab === "both" ? "שתי הרשימות" : label, r.type || "", r.company || "", r.track || "", r.number || "", r.note || "", MARK[r.mark] || ""]);
    }
    const d = new Date(), dd = n => String(n).padStart(2, "0");
    downloadXlsx(`kosher-funds-tracks-${dd(d.getDate())}-${dd(d.getMonth() + 1)}-${d.getFullYear()}`,          // שם באנגלית: שם קובץ בעברית לפעמים יורד בשם "download"
      "מסלולים וקרנות",
      ["רשימה", "סוג מוצר", "שם חברה", "שם מסלול", "מספר קופה", "הערות", "סטטוס"], out, [false, false, false, false, false, false, false]);
  }
  window.GlattFunds = { sortRows, download };
})();
