// הטמעת רשימת המסלולים והקרנות (funds.html) באתר iska.co.il - שורה אחת בוורדפרס (Avada → Code Block):
//   <script src="https://harav-levin.pages.dev/funds-embed.js"></script>
// נוצר iframe באורך התוכן (הגובה מתעדכן אוטומטית, בלי גלילה פנימית); העדכונים מהניהול מופיעים מיד.
(function () {
  var sc = document.currentScript, O = sc && sc.src ? new URL(sc.src).origin : "https://harav-levin.pages.dev";
  var f = document.createElement("iframe");
  f.src = O + "/funds.html?embed=1";
  f.title = "רשימת הקרנות ומסלולים המאושרים";
  f.setAttribute("scrolling", "no");
  f.style.cssText = "width:100%;border:0;min-height:600px;display:block;background:transparent";
  sc.parentNode.insertBefore(f, sc);
  window.addEventListener("message", function (e) {
    if (e.origin !== O || e.source !== f.contentWindow || !e.data || e.data.type !== "iska-funds-height") return;
    f.style.height = (e.data.h + 10) + "px";
  });
})();
