// קוד ההטמעה של רשימת השטרות (permits.html) באתר iska.co.il - נטען מוורדפרס בשורה אחת:
//   <script src="https://harav-levin.pages.dev/permits-embed.js"></script>
// אופציונלי: data-offset="140" = גובה הכותרת הקבועה של האתר; data-tab="private|general" = לשונית פתיחה (ברירת מחדל: פרטי, או כללי אם בכתובת/כותרת הדף "כללי").
// הקוד יוצר iframe באורך התוכן (בלי גלילה פנימית), והסרגל העליון (לשוניות, חיפוש, כותרת הקטגוריה) ותפריט הקטגוריות נצמדים מתחת לכותרת האתר בגלילה (במחשב).
(function () {
  var sc = document.currentScript, O = sc && sc.src ? new URL(sc.src).origin : "https://harav-levin.pages.dev";
  var OFFSET = Number(sc && sc.getAttribute("data-offset")) || 140;
  var P = decodeURIComponent(location.pathname) + " " + document.title;
  var T = (sc && sc.getAttribute("data-tab")) || (P.indexOf("כללי") !== -1 ? "general" : "private");
  var f = document.createElement("iframe");
  f.id = "iska-permits"; f.title = "שטרות היתר עיסקא"; f.setAttribute("scrolling", "no");
  f.style.cssText = "width:100%;height:700px;border:0;display:block";
  f.src = O + "/permits.html?embed=1&auto=1#t=" + T;
  if (sc && sc.parentNode) { sc.parentNode.insertBefore(f, sc); } else { document.body.appendChild(f); }
  var last = -1;
  window.addEventListener("message", function (e) {
    if (e.origin !== O || !e.data || e.data.source !== "harav-levin") { return; }
    if (e.data.type === "resize") { f.style.height = e.data.height + "px"; }
    if (e.data.type === "ready") { last = -1; }
  });
  function tick() {
    var r = f.getBoundingClientRect(), y = window.innerWidth >= 992 ? Math.max(0, Math.round(OFFSET - r.top)) : 0;
    if (y !== last && f.contentWindow) { last = y; f.contentWindow.postMessage({ source: "harav-parent", type: "pin", y: y }, O); }
    window.requestAnimationFrame(tick);
  }
  window.requestAnimationFrame(tick);
})();
