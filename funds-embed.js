// הטמעת רשימת המסלולים והקרנות (funds.html) באתר iska.co.il - שורה אחת בוורדפרס (Avada → Code Block):
//   <script src="https://harav-levin.pages.dev/funds-embed.js"></script>
// אופציונלי: data-offset="140" = גובה הכותרת הקבועה של האתר (אם לא מזוהה אוטומטית).
// בעמוד נבנה סרגל (לשוניות, חיפוש, תאריך עדכון) שנצמד לראש העמוד מתחת לכותרת האתר בגלילה (כמו ברשימת החברות),
// ומתחתיו iframe באורך התוכן (בלי גלילה פנימית). הסרגל שולט ברשימה שב-iframe בהודעות (setTab / setQ). העדכונים מהניהול מופיעים מיד.
(function () {
  var sc = document.currentScript, O = sc && sc.src ? new URL(sc.src).origin : "https://harav-levin.pages.dev";
  var OFF0 = Number(sc && sc.getAttribute("data-offset")) || 0;
  var css = document.createElement("style");
  css.textContent =
    "#ifb{background:#fff;box-sizing:border-box;direction:rtl;font-family:inherit;padding-bottom:.4rem}" +
    "#ifb.pin{box-shadow:0 3px 8px rgba(0,0,0,.12)}" +
    "#ifb .ifb-tabs{display:flex;border-bottom:1px solid #dfe7e8;margin:0 0 .5rem;padding:0}" +
    "#ifb .ifb-tabs button{flex:1;min-width:0;margin:0;padding:.75rem 1rem;font:inherit;font-size:17px;font-weight:700;line-height:1.3;background:transparent;color:#274d5b;border:0;border-top:3px solid transparent;border-radius:0;box-shadow:none;text-transform:none;cursor:pointer}" +
    "#ifb .ifb-tabs button:hover{color:#1e8f85}" +
    "#ifb .ifb-tabs button.on{color:#1e8f85;border-top-color:#2aada1;background:#e9f6f5}" +
    "#ifb .ifb-row{display:flex;gap:.6rem;align-items:center;flex-wrap:wrap;padding:0 .2rem}" +
    "#ifb input{flex:1;min-width:180px;box-sizing:border-box;margin:0;font:inherit;font-size:16px;padding:.4rem .8rem;border:2px solid #b9e3de;border-radius:10px;background:#fff;color:#3b3d3d;min-height:42px;height:auto;box-shadow:none}" +
    "#ifb .ifb-upd{font-size:14px;color:#6a7c82;white-space:nowrap}" +
    "@media (max-width:560px){#ifb .ifb-tabs button{font-size:15px;padding:.6rem .5rem}}";
  document.head.appendChild(css);
  var ph = document.createElement("div"), bar = document.createElement("div"), f = document.createElement("iframe");
  ph.id = "ifb-ph"; bar.id = "ifb";
  bar.innerHTML = '<div class="ifb-tabs"><button type="button" data-t="pension" class="on">קרנות פנסיה, גמל והשתלמות וחיסכון לכל ילד</button><button type="button" data-t="savings">תוכנית חיסכון, ביטוח, גמל להשקעה, קרנות סל</button></div>' +
    '<div class="ifb-row"><input type="search" placeholder="חיפוש: חברה, מסלול, סוג או מספר קופה" aria-label="חיפוש" autocomplete="off"><span class="ifb-upd"></span></div>';
  ph.appendChild(bar);
  f.title = "רשימת הקרנות ומסלולים המאושרים"; f.setAttribute("scrolling", "no");
  f.style.cssText = "width:100%;border:0;min-height:600px;display:block;background:transparent";
  f.src = O + "/funds.html?embed=1";
  if (sc && sc.parentNode) { sc.parentNode.insertBefore(ph, sc); sc.parentNode.insertBefore(f, sc); } else { document.body.appendChild(ph); document.body.appendChild(f); }
  var tabsEl = bar.querySelector(".ifb-tabs"), q = bar.querySelector("input"), upd = bar.querySelector(".ifb-upd"), qt = null;
  function send(m) { m.source = "harav-parent"; if (f.contentWindow) { f.contentWindow.postMessage(m, O); } }
  tabsEl.addEventListener("click", function (e) {
    var b = e.target.closest("button"); if (!b) { return; }
    Array.prototype.forEach.call(tabsEl.children, function (x) { x.className = x === b ? "on" : ""; });
    send({ type: "setTab", value: b.getAttribute("data-t") });
    if (pinned) { window.scrollTo({ top: window.pageYOffset + ph.getBoundingClientRect().top - OFFSET, behavior: "smooth" }); }          // מעבר לשונית בזמן גלילה: חוזרים לראש הרשימה
  });
  q.addEventListener("input", function () { clearTimeout(qt); qt = setTimeout(function () { send({ type: "setQ", value: q.value }); }, 150); });
  f.addEventListener("load", function () { send({ type: "hello" }); });
  window.addEventListener("message", function (e) {
    if (e.origin !== O || e.source !== f.contentWindow || !e.data) { return; }
    if (e.data.type === "iska-funds-height") { f.style.height = (e.data.h + 10) + "px"; }
    if (e.data.type === "funds-spec") {
      upd.textContent = e.data.updated || "";
      Array.prototype.forEach.call(tabsEl.children, function (x) { x.className = x.getAttribute("data-t") === e.data.tab ? "on" : ""; });
    }
  });
  // גובה הכותרת הקבועה של האתר נמדד בכל פריים (אוואדה מכווצת אותה בגלילה); אם אין כותרת קבועה - data-offset (ברירת מחדל 0)
  function hdrBottom() {
    var w = window.innerWidth, best = 0, pts = [w / 2, w * 0.25, w * 0.75];
    for (var y = 3; y < 250; y += 30) {
      for (var p = 0; p < pts.length; p++) {
        var els = document.elementsFromPoint(pts[p], y);
        for (var i = 0; i < els.length; i++) {
          var el = els[i];
          while (el && el !== document.documentElement && el.nodeType === 1) {
            var cs = window.getComputedStyle(el);
            if (cs.position === "fixed" || cs.position === "sticky") {
              var r = el.getBoundingClientRect();
              if (el.id !== "ifb" && r.width >= w * 0.6 && r.top <= 40 && r.bottom <= 260 && r.bottom > best) { best = r.bottom; }
              break;
            }
            el = el.parentNode;
          }
        }
      }
    }
    return best > 40 ? Math.round(best) : 0;   // סרגל הניהול של וורדפרס (32px) בלבד אינו כותרת האתר
  }
  var pinned = false, lastL = -1, lastW = -1, OFFSET = OFF0, n = 0;
  function tick() {
    if ((n++ % 6) === 0) { var hb = hdrBottom(); OFFSET = hb > 0 ? hb : OFF0; }
    var pr = ph.getBoundingClientRect(), fr = f.getBoundingClientRect(), bh = bar.offsetHeight;
    var pin = pr.top < OFFSET && fr.bottom - bh - 60 > OFFSET;
    if (pin) {
      if (!pinned) { ph.style.height = bh + "px"; bar.style.position = "fixed"; bar.style.zIndex = "99"; bar.className = "pin"; pinned = true; lastL = lastW = -1; }
      bar.style.top = OFFSET + "px";
      var l = Math.round(pr.left), w = Math.round(pr.width);
      if (l !== lastL || w !== lastW) { bar.style.left = l + "px"; bar.style.width = w + "px"; lastL = l; lastW = w; }
    } else if (pinned) {
      ph.style.height = ""; bar.style.position = ""; bar.style.top = ""; bar.style.left = ""; bar.style.width = ""; bar.style.zIndex = ""; bar.className = ""; pinned = false;
    }
    window.requestAnimationFrame(tick);
  }
  window.requestAnimationFrame(tick);
})();
