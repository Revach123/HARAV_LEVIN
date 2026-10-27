// קוד ההטמעה של רשימת השטרות (permits.html) באתר iska.co.il - נטען מוורדפרס בשורה אחת:
//   <script src="https://harav-levin.pages.dev/permits-embed.js"></script>
// אופציונלי: data-offset="140" = גובה הכותרת הקבועה של האתר; data-tab="private|general" = לשונית פתיחה (ברירת מחדל: פרטי, או כללי אם בכתובת/כותרת הדף "כללי").
// הקוד בונה בעמוד סרגל עליון (לשוניות, חיפוש, בחירת קטגוריה, כותרת הקטגוריה) שנצמד מתחת לכותרת האתר בגלילה (position:fixed, במחשב מעל 992 פיקסלים, כמו ברשימת החברות),
// ו-iframe באורך התוכן. הסרגל שולט ברשימה שב-iframe בהודעות (setTab / setCat / setQ).
(function () {
  var sc = document.currentScript, O = sc && sc.src ? new URL(sc.src).origin : "https://harav-levin.pages.dev";
  var OFF0 = Number(sc && sc.getAttribute("data-offset")) || 140, OFFSET = OFF0;
  var P = decodeURIComponent(location.pathname) + " " + document.title;
  var T = (sc && sc.getAttribute("data-tab")) || (P.indexOf("כללי") !== -1 ? "general" : "private");
  var css = document.createElement("style");
  css.textContent =
    "#ipb{background:#fff;box-sizing:border-box;direction:rtl;font-family:inherit;border-bottom:1px solid #dfe7e8}" +
    "#ipb.pin{box-shadow:0 3px 8px rgba(0,0,0,.12)}" +
    "#ipb .ipb-tabs{display:flex;border-bottom:1px solid #dfe7e8;margin:0;padding:0}" +
    "#ipb .ipb-tabs button{flex:1;min-width:0;margin:0;padding:.7rem 1rem;font:inherit;font-size:18px;font-weight:700;line-height:1.3;background:transparent;color:#274d5b;border:0;border-top:3px solid transparent;border-radius:0;box-shadow:none;text-transform:none;cursor:pointer}" +
    "#ipb .ipb-tabs button:hover{color:#1e8f85}" +
    "#ipb .ipb-tabs button.on{color:#1e8f85;border-top-color:#2aada1;background:#e9f6f5}" +
    "#ipb .ipb-row{display:flex;gap:.5rem;align-items:center;padding:.5rem .6rem;flex-wrap:wrap}" +
    "#ipb input,#ipb select{box-sizing:border-box;margin:0;font:inherit;font-size:16px;padding:.4rem .8rem;border:2px solid #b9e3de;border-radius:10px;background:#fff;color:#3b3d3d;min-height:42px;height:auto;box-shadow:none}" +
    "#ipb input{flex:1;min-width:160px}#ipb select{min-width:190px}#ipb.nar select{display:none}#ipb.nar{margin-right:auto;margin-left:0}" +
    "#ipb .ipb-cnt{font-size:14px;color:#6a7c82}" +
    "#ipb-side{position:fixed;display:none;z-index:98;direction:rtl;box-sizing:border-box;overflow-y:auto;background:#fff;font-family:inherit}" +
    "#ipb-side button{display:flex;width:100%;justify-content:space-between;align-items:center;margin:0;font:inherit;font-size:18px;line-height:1.15;color:#274d5b;background:none;border:0;border-bottom:1px solid #dfe7e8;border-radius:0;box-shadow:none;text-transform:none;padding:.18rem .4rem;cursor:pointer;text-align:start}" +
    "#ipb-side button::after{content:\"\\2039\";font-size:20px;line-height:1;color:#6a7c82;order:2;margin-inline-start:.4rem}" +
    "#ipb-side button small{color:#6a7c82;font-size:13px;margin-inline-start:auto;padding-inline:.5rem}" +
    "#ipb-side button:hover{background:#eef4f5}#ipb-side button.on{font-weight:700;color:#1e8f85;border-bottom-color:#2aada1}" +
    "#ipb .ipb-title{font-size:21px;font-weight:700;color:#274d5b;text-align:center;padding:.25rem .6rem .45rem;border-top:2px solid #b9e3de}";
  document.head.appendChild(css);
  var ph = document.createElement("div"), bar = document.createElement("div"), f = document.createElement("iframe");
  ph.id = "ipb-ph"; bar.id = "ipb";
  bar.innerHTML = '<div class="ipb-tabs"></div><div class="ipb-row"><input type="search" placeholder="חיפוש חברה…" aria-label="חיפוש חברה" autocomplete="off"><select aria-label="קטגוריה"></select><span class="ipb-cnt"></span></div><div class="ipb-title" hidden></div>';
  ph.appendChild(bar);
  var sidebar = document.createElement("nav"); sidebar.id = "ipb-side"; sidebar.setAttribute("aria-label", "קטגוריות"); document.body.appendChild(sidebar);
  var narOn = null, barWOn = -1, GEO = null, sideKey = "", extOn = null, sL = -1, sW = -1, sT = -1, sM = -1;
  f.id = "iska-permits"; f.title = "שטרות היתר עיסקא"; f.setAttribute("scrolling", "no");
  f.style.cssText = "width:100%;height:700px;border:0;display:block";
  f.src = O + "/permits.html?embed=1&auto=1";
  // גובה ה-iframe מתחיל מהגובה האחרון שנשמר ללשונית (ולא מ-700 הקבועים), וירידה בגובה מתעכבת - כדי שהדף לא יקפוץ בטעינה
  var curTab = "all", st = null;
  function hk() { return "ip-h-" + curTab; }
  try { var H0 = Number(window.localStorage.getItem(hk())); if (H0 > 0) { f.style.height = H0 + "px"; } } catch (x) { }
  function applyH(h) { f.style.height = h + "px"; try { window.localStorage.setItem(hk(), String(h)); } catch (x) { } }
  function setH(h) { var c = f.offsetHeight; clearTimeout(st); if (h >= c - 50) { applyH(h); } else { st = setTimeout(function () { applyH(h); }, 1500); } }
  if (sc && sc.parentNode) { sc.parentNode.insertBefore(ph, sc); sc.parentNode.insertBefore(f, sc); } else { document.body.appendChild(ph); document.body.appendChild(f); }
  var tabsEl = bar.querySelector(".ipb-tabs"), q = bar.querySelector("input"), sel = bar.querySelector("select"), cnt = bar.querySelector(".ipb-cnt"), ttl = bar.querySelector(".ipb-title");
  function send(m) { m.source = "harav-parent"; if (f.contentWindow) { f.contentWindow.postMessage(m, O); } }
  // הלשוניות נבנות מיד (לפני שהרשימה נטענת), כדי שהסרגל לא יגדל ויזיז את הדף כשהנתונים מגיעים
  var TABS0 = {};          // רשימה אחת: אין לשוניות
  var tabsKey = JSON.stringify(TABS0), catsKey = "", qt = null;
  tabsEl.innerHTML = Object.keys(TABS0).map(function (k) { return '<button type="button" data-t="' + k + '"' + (k === T ? ' class="on"' : "") + ">" + TABS0[k] + "</button>"; }).join("");
  sel.innerHTML = '<option value="">כל הקטגוריות</option>'; cnt.textContent = "\u00a0";
  tabsEl.style.display = "none";
  tabsEl.addEventListener("click", function (e) { var b = e.target.closest("button"); if (b) { send({ type: "setTab", value: b.getAttribute("data-t") }); } });
  sel.addEventListener("change", function () { send({ type: "setCat", value: sel.value }); });
  q.addEventListener("input", function () { clearTimeout(qt); qt = setTimeout(function () { send({ type: "setQ", value: q.value }); }, 120); });
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function spec(d) {
    var tk = JSON.stringify(d.tabs);
    if (tk !== tabsKey) { tabsKey = tk; tabsEl.innerHTML = Object.keys(d.tabs).map(function (k) { return '<button type="button" data-t="' + k + '">' + esc(d.tabs[k]) + "</button>"; }).join(""); }
    Array.prototype.forEach.call(tabsEl.children, function (b) { b.className = b.getAttribute("data-t") === d.tab ? "on" : ""; });
    var ck = d.total + "|" + JSON.stringify(d.cats);
    if (ck !== catsKey) { catsKey = ck; sel.innerHTML = '<option value="">כל הקטגוריות (' + d.total + ")</option>" + d.cats.map(function (c) { return '<option value="' + esc(c[0]) + '">' + esc(c[0]) + " (" + c[1] + ")</option>"; }).join(""); }
    var sk = ck + "|" + d.cat;
    if (sk !== sideKey) { sideKey = sk; sidebar.innerHTML = '<button type="button" data-c=""' + (d.cat ? "" : ' class="on"') + ">כל הקטגוריות<small>" + d.total + "</small></button>" + d.cats.map(function (c) { return '<button type="button" data-c="' + esc(c[0]) + '"' + (c[0] === d.cat ? ' class="on"' : "") + ">" + esc(c[0]) + "<small>" + c[1] + "</small></button>"; }).join(""); }
    sel.value = d.cat;
    cnt.textContent = d.count + " חברות";
    ttl.hidden = !d.cat; ttl.textContent = d.cat;
  }
  window.addEventListener("message", function (e) {
    if (e.origin !== O || !e.data || e.data.source !== "harav-levin") { return; }
    if (e.data.type === "resize") { setH(e.data.height); GEO = e.data.side || null; }
    if (e.data.type === "permits-spec") { curTab = e.data.tab; spec(e.data); }
  });
  sidebar.addEventListener("click", function (e) { var b = e.target.closest("button"); if (b) { send({ type: "setCat", value: b.getAttribute("data-c") }); } });
  var pinned = false, lastL = -1, lastW = -1;
  // גובה הכותרת הקבועה של האתר נמדד בכל פריים (אוואדה מכווצת אותה בגלילה); אם אין כותרת קבועה - data-offset
  function hdrBottom() {
    var w = window.innerWidth, best = 0, pts = [w / 2, w * 0.25, w * 0.75];
    for (var y = 3; y < 250; y += 30) {
      for (var p = 0; p < pts.length; p++) {
        var els = document.elementsFromPoint(pts[p], y);
        for (var i = 0; i < els.length; i++) {
          var e = els[i];
          while (e && e !== document.documentElement && e.nodeType === 1) {
            var cs = window.getComputedStyle(e);
            if (cs.position === "fixed" || cs.position === "sticky") {
              var r = e.getBoundingClientRect();
              if (e.id !== "ipb" && r.width >= w * 0.6 && r.top <= 40 && r.bottom <= 260 && r.bottom > best) { best = r.bottom; }
              break;
            }
            e = e.parentNode;
          }
        }
      }
    }
    return best > 40 ? Math.round(best) : 0;   // סרגל הניהול של וורדפרס (32px) בלבד אינו כותרת האתר
  }
  function tick() {
    var hb = hdrBottom(); OFFSET = hb > 0 ? hb : OFF0;
    var pr = ph.getBoundingClientRect(), fr = f.getBoundingClientRect(), bh = bar.offsetHeight, wide = window.innerWidth >= 992;
    var nar = wide && !!GEO && sidebar.children.length > 0, barW = nar ? Math.max(300, GEO.l - 16) : 0;     // רחב: הסרגל רק מעל עמודת הרשימה, התפריט בצד מתחיל בגובה הסרגל
    if (nar !== narOn || barW !== barWOn) { narOn = nar; barWOn = barW; bar.classList.toggle("nar", nar); bar.style.width = nar ? barW + "px" : ""; }
    var pin = wide && pr.top < OFFSET && fr.bottom - bh - 60 > OFFSET;
    if (pin) {
      if (!pinned) { ph.style.height = bh + "px"; bar.style.position = "fixed"; bar.style.top = OFFSET + "px"; bar.style.zIndex = "99"; bar.className = "pin" + (nar ? " nar" : ""); pinned = true; lastL = lastW = -1; }
      bar.style.top = OFFSET + "px";
      var l = Math.round(fr.left), w = nar ? barW : Math.round(fr.width);
      if (l !== lastL || w !== lastW) { bar.style.left = l + "px"; bar.style.width = w + "px"; lastL = l; lastW = w; }
    } else if (pinned) {
      ph.style.height = ""; bar.style.position = ""; bar.style.top = ""; bar.style.left = ""; bar.style.zIndex = ""; bar.className = nar ? "nar" : ""; if (!nar) bar.style.width = ""; pinned = false;
    }
    var ext = wide && !!GEO && sidebar.children.length > 0;     // התפריט בצד נשאר קבוע בעמוד האב (כמו הסרגל העליון) - באותו פריים של הגלילה, בלי מעבר הודעות
    if (ext !== extOn) { extOn = ext; send({ type: "ext", on: ext }); sidebar.style.display = ext ? "block" : "none"; }
    if (ext) {
      var pinTop = OFFSET + 10, nat = fr.top + GEO.t, lb = fr.top + GEO.t + GEO.h, mh = Math.max(160, window.innerHeight - pinTop - 12);
      if (sidebar.style.maxHeight !== mh + "px") { sidebar.style.maxHeight = mh + "px"; }
      var tp = Math.round(Math.min(Math.max(nat, pinTop), lb - sidebar.offsetHeight)), lf = Math.round(fr.left + GEO.l), wd = GEO.w;
      if (tp !== sT) { sidebar.style.top = tp + "px"; sT = tp; }
      if (lf !== sL) { sidebar.style.left = lf + "px"; sL = lf; }
      if (wd !== sW) { sidebar.style.width = wd + "px"; sW = wd; }
    }
    window.requestAnimationFrame(tick);
  }
  window.requestAnimationFrame(tick);
})();
