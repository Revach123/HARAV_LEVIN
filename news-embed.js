// תיבת העדכונים באתר iska.co.il - פס צר צף בראש כל דף, באמצע. שורה אחת בוורדפרס (WPCode, בכל האתר, בסוף ה-body):
//   <script src="https://harav-levin.pages.dev/news-embed.js" defer></script>
// אופציונלי:
//   data-top="90"              המרחק מראש החלון בפיקסלים (למשל מתחת לכותרת קבועה של האתר). ברירת מחדל 0.
//   data-companies-url="..."   קישור לרשימת החברות באתר (מוצג בחלון "כל העדכונים" בלשונית החברות)
//   data-bonds-url="..."       קישור לרשימת האג"ח באתר
//   data-delay="5"             כמה שניות עוצר על כל עדכון
// העדכונים: /api/news (ידניים מדף הניהול news-admin.html + חברות ואג"ח חדשות אוטומטית).
// הפס מתגלגל (עוצר על כל עדכון ועובר לבא; עצירה כשהעכבר עליו), כפתור לחלון גדול עם כל העדכונים לפי חברות / אג"ח / עדכונים אחרים,
// וכפתור הסתרה: הפס מתקפל ללשונית קטנה עד סוף הביקור (וחוזר מיד כשיש עדכון חדש).
// בחלון יש גם "שליחת עדכון": טופס קצר; העדכון נשמר כממתין לאישור ומופיע בדף הניהול (news-admin.html) לאישור / עריכה.
(function () {
  if (window.__inbLoaded) { return; } window.__inbLoaded = true;
  var sc = document.currentScript, O = sc && sc.src ? new URL(sc.src).origin : "https://harav-levin.pages.dev";
  var attr = function (n) { return (sc && sc.getAttribute(n)) || ""; };
  var TOP = Number(attr("data-top")) || 0, DELAY = Math.max(2, Number(attr("data-delay")) || 5) * 1000;
  var LINKS = { companies: attr("data-companies-url"), bonds: attr("data-bonds-url") };
  var CATS = [["companies", "חברות"], ["bonds", "אג\"ח"], ["other", "עדכונים אחרים"]];
  var TAG = { companies: "חברות", bonds: "אג\"ח", other: "עדכון" };
  var PER_CAT = 6;          // בפס המתגלגל: עד 6 עדכונים אוטומטיים מכל סוג, ואחריהם "ועוד N"
  var KEY = "inb-hidden";
  var store = { get: function () { try { return sessionStorage.getItem(KEY) || ""; } catch (e) { return ""; } }, set: function (v) { try { if (v) { sessionStorage.setItem(KEY, v); } else { sessionStorage.removeItem(KEY); } } catch (e) {} } };

  var css = document.createElement("style");
  css.textContent =
    "#inb,#inb *,#inb-tab,#inb-pop,#inb-pop *{box-sizing:border-box}" +
    "#inb{position:fixed;left:50%;transform:translateX(-50%);z-index:99990;width:min(780px,calc(100% - 16px));height:54px;display:flex;align-items:center;gap:8px;padding:0 8px 0 8px;direction:rtl;font-family:inherit;font-size:15px;line-height:1.25;background:#274d5b;color:#fff;border-radius:0 0 12px 12px;box-shadow:0 3px 10px rgba(0,0,0,.18)}" +
    "#inb .inb-lbl{flex:none;background:#2aada1;color:#fff;font-weight:700;font-size:13px;padding:5px 9px;border-radius:999px;white-space:nowrap}" +
    "#inb .inb-view{flex:1;min-width:0;height:100%;overflow:hidden;position:relative}" +
    "#inb .inb-it{position:absolute;inset:0;display:flex;align-items:center;gap:7px;white-space:nowrap;cursor:pointer;color:#fff;text-decoration:none;transition:transform .45s ease,opacity .45s ease}" +
    "#inb .inb-it.in{transform:translateY(100%);opacity:0}#inb .inb-it.out{transform:translateY(-100%);opacity:0}" +
    "#inb .inb-it .tx{display:flex;flex-direction:column;justify-content:center;gap:2px;min-width:0;flex:1}" +
    "#inb .inb-it .t1{display:flex;gap:8px;align-items:baseline;font-size:13px;font-weight:700;color:#bfe9e4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
    "#inb .inb-it .t2{font-size:15px;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
    "#inb .inb-it:hover .t2,#inb .inb-it:focus .t2{text-decoration:underline}" +
    "#inb .inb-d{flex:none;font-size:12px;font-weight:400;color:#bcd0d5}" +
    "#inb button,#inb-tab,#inb-pop button{font:inherit;cursor:pointer;margin:0;text-transform:none;letter-spacing:normal;box-shadow:none}" +
    "#inb .inb-b{flex:none;height:28px;min-width:28px;padding:0 8px;border:0;border-radius:7px;background:rgba(255,255,255,.13);color:#fff;font-size:13px;font-weight:700;line-height:28px;white-space:nowrap}" +
    "#inb .inb-b:hover,#inb .inb-b:focus-visible{background:rgba(255,255,255,.28)}" +
    "#inb-tab{position:fixed;left:50%;transform:translateX(-50%);z-index:99990;direction:rtl;font-family:inherit;font-size:13px;font-weight:700;padding:5px 14px;border:0;border-radius:0 0 10px 10px;background:#274d5b;color:#fff;box-shadow:0 2px 8px rgba(0,0,0,.18)}" +
    "#inb-tab .n{display:inline-block;margin-inline-start:6px;background:#2aada1;border-radius:999px;padding:1px 7px;font-size:12px}" +
    "#inb-pop{position:fixed;inset:0;z-index:99995;background:rgba(20,40,48,.45);display:flex;align-items:flex-start;justify-content:center;padding:6vh 12px 12px;direction:rtl;font-family:inherit}" +
    "#inb-pop .box{background:#fff;color:#1f2d2d;width:min(720px,100%);max-height:86vh;display:flex;flex-direction:column;border-radius:14px;box-shadow:0 10px 40px rgba(0,0,0,.3);overflow:hidden}" +
    "#inb-pop .hd{display:flex;align-items:center;gap:10px;padding:14px 18px;background:#274d5b;color:#fff}" +
    "#inb-pop .hd h2{flex:1;margin:0;font-size:20px;font-weight:700;color:#fff;font-family:inherit;line-height:1.3}" +
    "#inb-pop .x{border:0;background:rgba(255,255,255,.15);color:#fff;border-radius:8px;width:34px;height:34px;font-size:18px;line-height:34px;padding:0}" +
    "#inb-pop .tabs{display:flex;border-bottom:1px solid #dfe7e8;background:#fff}" +
    "#inb-pop .tabs button{flex:1;min-width:0;padding:.7rem .5rem;border:0;border-top:3px solid transparent;border-radius:0;background:transparent;color:#274d5b;font-size:16px;font-weight:700}" +
    "#inb-pop .tabs button.on{color:#1e8f85;border-top-color:#2aada1;background:#e9f6f5}" +
    "#inb-pop .tabs .c{font-weight:400;font-size:13px;color:#6a7c82;margin-inline-start:4px}" +
    "#inb-pop .lst{overflow-y:auto;padding:6px 18px 14px;margin:0;list-style:none}" +
    "#inb-pop .lst li{display:flex;gap:12px;align-items:baseline;padding:10px 0;border-bottom:1px solid #eef2f2;font-size:16px;line-height:1.5}" +
    "#inb-pop .lst li.pin{background:#f4fbfa;margin:0 -18px;padding:10px 18px}" +
    "#inb-pop .lst .d{flex:none;width:84px;font-size:13px;color:#6a7c82}" +
    "#inb-pop .lst a{color:#1e8f85}#inb-pop .lst .tt{display:block;font-size:14px;font-weight:700;color:#274d5b}" +
    "#inb-pop .empty{padding:24px 0;text-align:center;color:#6a7c82;font-size:16px}" +
    "#inb-pop .ft{display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between;padding:10px 18px;border-top:1px solid #eef2f2;font-size:15px}#inb-pop .ft a{color:#1e8f85;font-weight:700}" +
    "#inb-pop .snd{border:0;border-radius:8px;background:#2aada1;color:#fff;font-size:15px;font-weight:700;padding:8px 14px}#inb-pop .snd:hover{background:#1e8f85}" +
    "#inb-pop form{overflow-y:auto;padding:14px 18px;margin:0}#inb-pop form label{display:block;font-size:14px;font-weight:700;color:#274d5b;margin:10px 0 4px}#inb-pop form .h{font-weight:400;color:#6a7c82}" +
    "#inb-pop form input,#inb-pop form select,#inb-pop form textarea{display:block;width:100%;padding:8px 10px;font:inherit;font-size:15px;border:1px solid #b7c9c4;border-radius:7px;background:#fff;color:#1f2d2d;margin:0}" +
    "#inb-pop form textarea{min-height:80px;resize:vertical}#inb-pop form .two{display:flex;gap:10px}#inb-pop form .two>div{flex:1;min-width:0}" +
    "#inb-pop form .hp{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}" +
    "#inb-pop form .row{display:flex;gap:10px;margin-top:14px}#inb-pop form .back{border:0;border-radius:8px;background:#e9f0f1;color:#274d5b;font-size:15px;font-weight:700;padding:8px 14px}" +
    "#inb-pop .msg{margin:10px 0 0;font-weight:700}#inb-pop .msg.bad{color:#b3261e}#inb-pop .msg.ok{color:#1e8f85;font-size:17px;line-height:1.5}" +
    "@media (max-width:600px){#inb{height:50px;gap:6px}#inb .inb-it .t1{font-size:12px}#inb .inb-it .t2{font-size:14px}#inb .inb-lbl,#inb .inb-d{display:none}#inb .inb-b .w{display:none}#inb-pop .lst .d{width:70px}#inb-pop .tabs button{font-size:14px}}" +
    "@media (prefers-reduced-motion:reduce){#inb .inb-it{transition:none}}" +
    "@media print{#inb,#inb-tab,#inb-pop{display:none!important}}";
  document.head.appendChild(css);

  var fmt = function (d) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d || ""); return m ? m[3] + "/" + m[2] + "/" + m[1] : ""; };
  var el = function (tag, cls, text) { var e = document.createElement(tag); if (cls) { e.className = cls; } if (text != null) { e.textContent = text; } return e; };
  var topPx = function () { var ab = document.getElementById("wpadminbar"); return TOP + (ab && getComputedStyle(ab).position === "fixed" ? ab.offsetHeight : 0); };

  var items = [], ticker = [], idx = 0, timer = null, paused = false, bar, view, tab, pop, newest = "";

  function buildTicker() {
    var out = [], cnt = {};
    items.forEach(function (it) {
      if (!it.auto) { out.push(it); return; }
      cnt[it.cat] = (cnt[it.cat] || 0) + 1;
      if (cnt[it.cat] <= PER_CAT) { out.push(it); }
    });
    CATS.forEach(function (c) {
      var more = (cnt[c[0]] || 0) - PER_CAT;
      if (more > 0) { out.push({ id: "more-" + c[0], cat: c[0], title: c[0] === "companies" ? "ועוד " + more + " חברות חדשות" : "ועוד " + more + " עדכוני אג\"ח", text: "לחצו לרשימה המלאה של כל העדכונים", more: true }); }
    });
    return out;
  }

  function itemNode(it) {
    var a = el(it.link ? "a" : "div", "inb-it");
    if (it.link) { a.href = it.link; if (!/^https?:\/\/(www\.)?iska\.co\.il/i.test(it.link)) { a.target = "_blank"; a.rel = "noopener"; } }
    else { a.tabIndex = 0; a.setAttribute("role", "button"); a.addEventListener("click", function () { openPop(it.cat); }); a.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openPop(it.cat); } }); }
    var tx = el("span", "tx"), t1 = el("span", "t1");
    t1.appendChild(el("span", "", it.title || TAG[it.cat] || "עדכון"));
    if (it.date && !it.more) { t1.appendChild(el("span", "inb-d", fmt(it.date))); }
    tx.appendChild(t1); tx.appendChild(el("span", "t2", it.text)); a.appendChild(tx);
    a.title = (it.title ? it.title + "\n" : "") + it.text;
    return a;
  }

  function show(i, animate) {
    var cur = view.querySelector(".inb-it:not(.out)"), nx = itemNode(ticker[i]);
    if (animate && cur) { nx.classList.add("in"); }
    view.appendChild(nx);
    if (cur) {
      if (animate) { cur.classList.add("out"); setTimeout(function () { if (cur.parentNode) { cur.parentNode.removeChild(cur); } }, 500); }
      else { view.removeChild(cur); }
    }
    if (animate) { void nx.offsetWidth; nx.classList.remove("in"); }
  }
  function schedule() {
    clearTimeout(timer);
    if (ticker.length < 2) { return; }
    timer = setTimeout(function () { if (!paused && !document.hidden && bar.style.display !== "none") { idx = (idx + 1) % ticker.length; show(idx, true); } schedule(); }, DELAY);
  }

  function place() { var t = topPx() + "px"; if (bar) { bar.style.top = t; } if (tab) { tab.style.top = t; } }
  function setHidden(h) {
    bar.style.display = h ? "none" : "flex"; tab.style.display = h ? "block" : "none";
    store.set(h ? newest : "");
  }

  function openPop(cat) {
    if (pop) { pop.parentNode.removeChild(pop); }
    pop = el("div"); pop.id = "inb-pop";
    var box = el("div", "box"); box.setAttribute("role", "dialog"); box.setAttribute("aria-modal", "true"); box.setAttribute("aria-label", "עדכונים וחדשות");
    var hd = el("div", "hd"); hd.appendChild(el("h2", "", "עדכונים וחדשות"));
    var x = el("button", "x", "✕"); x.type = "button"; x.setAttribute("aria-label", "סגירה"); x.addEventListener("click", closePop); hd.appendChild(x);
    var tabs = el("div", "tabs"), lst = el("ul", "lst"), ft = el("div", "ft");
    var counts = {}; items.forEach(function (it) { counts[it.cat] = (counts[it.cat] || 0) + 1; });
    if (!cat || !counts[cat]) { cat = (CATS.filter(function (c) { return counts[c[0]]; })[0] || CATS[0])[0]; }
    var sendBtn = el("button", "snd", "＋ שליחת עדכון"); sendBtn.type = "button";
    sendBtn.addEventListener("click", function () { showForm(cur); });
    var cur = cat, form = null;
    function showForm(c) {
      lst.style.display = "none"; ft.style.display = "none"; tabs.style.display = "none";
      form = el("form"); form.noValidate = true;
      form.innerHTML = '<p style="margin:0;font-size:15px;color:#34504a">יש לכם עדכון בנושא חברות, אג"ח או היתר עיסקא? כתבו אותו כאן. העדכון יפורסם אחרי בדיקה ואישור.</p>' +
        '<div class="two"><div><label for="inb-fc">נושא</label><select id="inb-fc" name="cat"><option value="companies">חברות</option><option value="bonds">אג"ח</option><option value="other">עדכונים אחרים</option></select></div>' +
        '<div><label for="inb-ft">כותרת <span class="h">(לא חובה)</span></label><input id="inb-ft" name="title" maxlength="120"></div></div>' +
        '<label for="inb-fx">נוסח העדכון</label><textarea id="inb-fx" name="text" maxlength="400" required></textarea>' +
        '<label for="inb-fl">קישור למקור <span class="h">(לא חובה)</span></label><input id="inb-fl" name="link" type="url" dir="ltr" maxlength="500" placeholder="https://">' +
        '<div class="two"><div><label for="inb-fn">שם <span class="h">(לא חובה)</span></label><input id="inb-fn" name="name" maxlength="80" autocomplete="name"></div>' +
        '<div><label for="inb-fp">טלפון או מייל <span class="h">(לא חובה, לבירורים)</span></label><input id="inb-fp" name="contact" maxlength="120" dir="ltr"></div></div>' +
        '<div class="hp" aria-hidden="true"><input name="website" tabindex="-1" autocomplete="off"></div>' +
        '<div class="row"><button type="submit" class="snd">שליחה</button><button type="button" class="back">חזרה לעדכונים</button></div><p class="msg" aria-live="polite"></p>';
      form.querySelector("select").value = c || "other";
      box.appendChild(form);
      var msg = form.querySelector(".msg"), sb = form.querySelector("button[type=submit]");
      form.querySelector(".back").addEventListener("click", hideForm);
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        var v = function (n) { return form.elements[n].value.trim(); };
        if (v("text").length < 5) { msg.className = "msg bad"; msg.textContent = "נא לכתוב את נוסח העדכון"; form.elements.text.focus(); return; }
        if (v("link") && !/^https?:\/\//i.test(v("link"))) { msg.className = "msg bad"; msg.textContent = "הקישור צריך להתחיל ב-https://"; return; }
        sb.disabled = true; msg.className = "msg"; msg.textContent = "שולח…";
        fetch(O + "/api/news", { method: "POST", headers: { "Content-Type": "text/plain;charset=UTF-8" }, body: JSON.stringify({ submit: 1, cat: v("cat"), title: v("title"), text: v("text"), link: v("link"), name: v("name"), contact: v("contact"), website: v("website") }) })
          .then(function (r) { return r.json(); }).then(function (d) {
            if (!d.ok) { sb.disabled = false; msg.className = "msg bad"; msg.textContent = d.error || "השליחה נכשלה"; return; }
            Array.prototype.forEach.call(form.querySelectorAll("label,.two,textarea,input,select,p:first-child,button[type=submit]"), function (x) { x.style.display = "none"; });
            msg.className = "msg ok"; msg.textContent = d.message || "תודה! העדכון נשלח, ויפורסם אחרי אישור.";
          }).catch(function () { sb.disabled = false; msg.className = "msg bad"; msg.textContent = "השליחה נכשלה. נסו שוב."; });
      });
      form.elements.text.focus();
    }
    function hideForm() { if (form && form.parentNode) { form.parentNode.removeChild(form); } form = null; lst.style.display = ""; ft.style.display = ""; tabs.style.display = ""; }
    function fill(c) {
      cur = c;
      Array.prototype.forEach.call(tabs.children, function (b) { b.className = b.getAttribute("data-c") === c ? "on" : ""; });
      lst.innerHTML = ""; ft.innerHTML = "";
      var rows = items.filter(function (it) { return it.cat === c; });
      if (!rows.length) { lst.appendChild(el("li", "empty", "אין כרגע עדכונים בנושא הזה")); }
      rows.forEach(function (it) {
        var li = el("li", it.pinned ? "pin" : ""); li.appendChild(el("span", "d", fmt(it.date)));
        var t = el("span"); if (it.title) { t.appendChild(el("span", "tt", it.title)); } if (it.link) { var a = el("a", "", it.text); a.href = it.link; if (!/^https?:\/\/(www\.)?iska\.co\.il/i.test(it.link)) { a.target = "_blank"; a.rel = "noopener"; } t.appendChild(a); } else { t.appendChild(document.createTextNode(it.text)); }
        li.appendChild(t); lst.appendChild(li);
      });
      ft.appendChild(sendBtn);
      if (LINKS[c]) { var l = el("a", "", c === "companies" ? "לרשימת החברות המלאה ←" : "לרשימת האג\"ח המלאה ←"); l.href = LINKS[c]; ft.appendChild(l); }
      lst.scrollTop = 0;
    }
    CATS.forEach(function (c) { var b = el("button"); b.type = "button"; b.setAttribute("data-c", c[0]); b.appendChild(document.createTextNode(c[1])); b.appendChild(el("span", "c", "(" + (counts[c[0]] || 0) + ")")); b.addEventListener("click", function () { fill(c[0]); }); tabs.appendChild(b); });
    box.appendChild(hd); box.appendChild(tabs); box.appendChild(lst); box.appendChild(ft); pop.appendChild(box);
    pop.addEventListener("click", function (e) { if (e.target === pop) { closePop(); } });
    document.body.appendChild(pop); fill(cat); paused = true; x.focus();
  }
  function closePop() { if (pop && pop.parentNode) { pop.parentNode.removeChild(pop); } pop = null; paused = false; }
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && pop) { closePop(); } });

  function mount() {
    bar = el("div"); bar.id = "inb"; bar.setAttribute("role", "region"); bar.setAttribute("aria-label", "עדכונים");
    bar.appendChild(el("span", "inb-lbl", "עדכונים"));
    view = el("div", "inb-view"); view.setAttribute("aria-live", "polite"); bar.appendChild(view);
    var all = el("button", "inb-b"); all.type = "button"; all.title = "כל העדכונים"; all.innerHTML = '⤢<span class="w"> כל העדכונים</span>'; all.addEventListener("click", function () { openPop(ticker[idx] && ticker[idx].cat); });
    var hide = el("button", "inb-b", "✕"); hide.type = "button"; hide.title = "הסתרה"; hide.setAttribute("aria-label", "הסתרת העדכונים"); hide.addEventListener("click", function () { setHidden(true); });
    bar.appendChild(all); bar.appendChild(hide);
    bar.addEventListener("mouseenter", function () { paused = true; }); bar.addEventListener("mouseleave", function () { if (!pop) { paused = false; } });
    bar.addEventListener("focusin", function () { paused = true; }); bar.addEventListener("focusout", function () { if (!pop) { paused = false; } });
    tab = el("button"); tab.id = "inb-tab"; tab.type = "button"; tab.textContent = "עדכונים"; tab.appendChild(el("span", "n", String(items.length)));
    tab.addEventListener("click", function () { setHidden(false); });
    document.body.appendChild(bar); document.body.appendChild(tab);
    place(); window.addEventListener("resize", place);
    show(0, false); schedule();
    var h = store.get(); setHidden(!!h && h === newest);
  }

  function start() {
    fetch(O + "/api/news").then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
      items = (d && d.items) || [];
      if (!items.length) { return; }
      ticker = buildTicker();
      newest = items.map(function (it) { return (it.date || "") + "|" + it.id; }).sort().pop() || "";
      mount();
    }).catch(function () {});
  }
  if (document.body) { start(); } else { document.addEventListener("DOMContentLoaded", start); }
})();
