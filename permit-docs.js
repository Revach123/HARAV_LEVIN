/* מאגר מסמכי היתר עסקה (admin.html): עם קישור מסמך לרשימות כללי / פרטי של כל חברה, וחלון "ניהול מסמכים".
   תלוי בגלובלים של דף הניהול: businesses, adminToken, apiFetch, escHtml, displayName, showStatus, render, view.
   חשיפה: window.PD (cell, slotCell, extraCell, openManage, homeCards, load, openUpload, openUnassigned, openCompany, openDoc ...) */
(function () {
  "use strict";
  const S = { ext: [], docs: [], byBiz: new Map(), byId: new Map(), loaded: false, loading: false, err: "", stale: false, freshP: Promise.resolve(), cacheTried: false };
  const DOCS_CACHE = "hl_pd_docs_v1";
  const TL = { general: "כללי", private: "רק פרטי", both: "פרטי", unknown: "לא ידוע", other: "לא קשור / לא היתר" };
  const TCOL = { general: "#1e4570", private: "#7a3b8f", both: "#1e7e4a", unknown: "#8a6d00", other: "#777" };
  const $ = id => document.getElementById(id);
  const E = s => escHtml(s);
  const PDFJS = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
  const PDFJS_WORKER = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  const TESS = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";

  const authH = () => (adminToken ? { Authorization: "Bearer " + adminToken } : {});
  async function api(path, method, body) {
    if (method && method !== "GET" && S.stale) {          // מוצג עותק שמור של המסמכים: לא שומרים על בסיסו. מחכים לנתונים העדכניים ומבקשים לבדוק שוב
      await S.freshP;
      refresh();
      throw new Error(S.stale ? "אין חיבור לשרת: מוצג עותק שמור, ולכן אי אפשר לשמור כרגע" : "הנתונים התעדכנו מהשרת. בדקו שוב את המצב ונסו שנית");
    }
    const res = await fetch("/api" + path, {
      method: method || "GET",
      headers: { ...authH(), ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (window.noteDataVer) window.noteDataVer(res.headers.get("X-Data-Ver"), path, method);          // גרסת הנתונים (בדיקת עדכונים, admin.html)
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(data.error || res.statusText); e.status = res.status; e.data = data; throw e; }
    return data;
  }
  function refresh() {      // בטופס עריכה לא מציירים מחדש את כל הדף (כדי לא לאבד שינויים שלא נשמרו): רק את פס ההיתרים
    const v = typeof view !== "undefined" ? view : "";
    if (v === "form") { const el = document.getElementById("pd-form-strip"); if (el && typeof editBiz !== "undefined" && editBiz) el.innerHTML = cell(editBiz); }
    else if (typeof render === "function") render();
    if ($("pd-manage") && S._paintMg) S._paintMg();
  }
  const say = () => {};          // הודעות הצלחה שגרתיות בוטלו (המצב החדש נראה על המסך); שגיאות וחלונות אישור נשארים
  const bizList = () => (typeof businesses !== "undefined" ? businesses : []);
  const bizById = id => bizList().find(b => b.id === id);
  const bizName = id => { const b = bizById(id); return b ? displayName(b) : "(חברה שנמחקה)"; };
  const SLOT_HE = { private: "פרטי", general: "כללי" };
  const EXT_HE = { deleted: "מחוקה", merged: "מוזגה", not_in_db: "אינה במאגר" };
  const GONE = ["deleted", "merged"];          // "מחוקות": כל סוגי החברות שכבר לא קיימות היום (מחוקה / מוזגה / בפרוק); "שאינן במאגר": חברות קיימות שאינן במאגר העסקים שלנו
  const extGroup = x => (GONE.includes(x.status) ? "gone" : "nodb");
  const extCount = g => S.ext.filter(x => extGroup(x) === g).length;
  const extById = id => S.ext.find(x => x.id === id);
  const extName = id => { const x = extById(id); return x ? x.name : "(חברה שנמחקה מהרשימה)"; };
  const extGuess = st => (/מיזוג|מוזג/.test(st || "") ? "merged" : /מחוק|נמחק|מבוטל|פירוק|מפורק|מחוסל|חוסל|חיסול/.test(st || "") ? "deleted" : "not_in_db");
  const subTag = (d, sid) => (d.subs || []).find(x => x.id === sid);          // תיוג תת-שורה על המסמך (המסמך עצמו משויך לחברה הראשית)
  const slotsOf = (d, b) => String((d.slots || {})[b] || (subTag(d, b) || {}).slot || "").split(",").filter(Boolean);       // לאילו רשימות (general / private) המסמך מקושר אצל החברה / תת-השורה
  const liveDocs = bizId => (S.byBiz.get(bizId) || []).filter(d => d.doc_type !== "other");
  const sameChpRows = b => b && digitsOf(b.chp_number) ? bizList().filter(x => x.id !== b.id && digitsOf(x.chp_number) === digitsOf(b.chp_number)) : [];          // תתי-שורות של אותה חברה (אותו ח.פ., למשל "מסלול הלכה")
  const mainOf = b => { if (!b) return null; const fam = sameChpRows(b); if (!fam.length) return null;          // תת-שורה: הרשומה הראשית של החברה (שם בהיתר ריק או כמו ברשם); לשורה ראשית - null
    const isMain = x => !String(x.permit_name || "").trim() || NORMN(x.permit_name) === NORMN(x.registrar_name);
    return isMain(b) ? null : fam.find(isMain) || null; };
  const otherCos = (d, bizId) => { const b = bizById(bizId), fam = new Set(sameChpRows(b).map(x => x.id)); return (d.business_ids || []).filter(x => x !== bizId && !fam.has(x)); };          // חברות אחרות במסמך (בלי תתי-שורות של אותה חברה)
  const slotDoc = (bizId, t) => liveDocs(bizId).find(d => slotsOf(d, bizId).includes(t)) || null;
  const needOf = b => ({ private: b.visibility === "פרטי" || b.visibility === "רק פרטי", general: b.visibility !== "רק פרטי" });
  const extrasOf = bizId => liveDocs(bizId).filter(d => !slotsOf(d, bizId).length && !(d.subs || []).some(x => x.id !== bizId));          // מסמך שמתויג לתת-שורה מוצג בכרטיסיית תת-השורה, לא כמסמך נוסף של החברה
  function manageOrder(bizId) {          // סדר המסמכים בחלון הניהול ובחצים: פרטי, כללי, ואז הנוספים
    const out = [];
    for (const d of [slotDoc(bizId, "private"), slotDoc(bizId, "general"), ...extrasOf(bizId)]) if (d && !out.includes(d.id)) out.push(d.id);
    return out;
  }
  const fmtSize = n => (n > 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB");

  // ───────── מספר עמודים ותאריכים מהמסמך ─────────
  const pad2 = n => String(n).padStart(2, "0");
  function extractDates(text) {          // תאריכים לועזיים (dd/mm/yyyy, dd.mm.yy, yyyy-mm-dd) בטווח סביר; מהמאוחר למוקדם
    const now = new Date().getFullYear(), out = new Set(), t = String(text || "");
    const add = (y, m, d) => { y = +y; m = +m; d = +d; if (y < 100) y += 2000; if (y < 1990 || y > now + 1 || m < 1 || m > 12 || d < 1 || d > 31) return; out.add(`${y}-${pad2(m)}-${pad2(d)}`); };
    for (const m of t.matchAll(/(?<!\d)(\d{1,2})[./\-](\d{1,2})[./\-](\d{4}|\d{2})(?!\d)/g)) add(m[3], m[2], m[1]);
    for (const m of t.matchAll(/(?<!\d)(\d{4})[./\-](\d{1,2})[./\-](\d{1,2})(?!\d)/g)) add(m[1], m[2], m[3]);
    const r = x => [...x].reverse().join("");          // טקסט עברי שחולץ הפוך (אותיות / ספרות בסדר הפוך): 0202/11/03 = 30/11/2020
    for (const m of t.matchAll(/(?<!\d)(\d{4})[./\-](\d{1,2})[./\-](\d{1,2})(?!\d)/g)) add(r(m[1]), r(m[2]), r(m[3]));
    return [...out].sort().reverse();
  }
  const datesOf = d => { try { return JSON.parse(d.doc_dates || "[]"); } catch { return []; } };
  const fmtDate = iso => iso ? iso.split("-").reverse().join("/") : "";
  function metaText(d) {
    const ds = datesOf(d), parts = [];
    if (d.pages) parts.push(d.pages + " עמ'");
    if (ds.length) parts.push(fmtDate(ds[0]));
    return parts.join(" · ");
  }
  const bdi = t => `<bdi>${E(t)}</bdi>`;          // כל חלק בנפרד, כדי שסדר המספרים והיחידות לא יתהפך בתוך טקסט עברי
  const sizeHtml = n => bdi(fmtSize(n));
  const metaHtml = d => `<span data-meta="${d.id}" title="${E(datesOf(d).length ? "תאריכים שנמצאו במסמך: " + datesOf(d).map(fmtDate).join(", ") : "")}">${metaText(d).split(" · ").filter(Boolean).map(bdi).join(" · ")}</span>`;
  const pgHtml = d => `<div class="pd-mg-pg" data-pg="${d.id}">${d.pages ? bdi(d.pages + " עמ'") : ""}</div>`;          // מספר עמודים מתחת לתמונה הממוזערת
  const dateHtml = d => `<span data-dt="${d.id}">${datesOf(d).length ? bdi(fmtDate(datesOf(d)[0])) : ""}</span>`;
  const metaBusy = new Set();
  async function ensureMeta(docId, pdf) {          // ממלא מספר עמודים ותאריכים פעם אחת לכל מסמך, כשהוא נפתח / נטענת לו תמונה
    const d = S.byId.get(docId); if (!d || d.pages || metaBusy.has(docId) || S.metaOff) return;
    metaBusy.add(docId);
    try {
      const n = pdf.numPages, want = [...new Set([1, 2, n - 1, n].filter(p => p >= 1 && p <= n))]; let text = "";
      for (const p of want) { try { text += "\n" + (await (await pdf.getPage(p)).getTextContent()).items.map(x => x.str).join(" "); } catch { /* עמוד בלי טקסט */ } }
      const r = await api("/permit-docs/" + docId, "PUT", { pages: n, doc_dates: extractDates(text) });
      replaceDoc(r.doc); const nd = S.byId.get(docId);
      document.querySelectorAll(`[data-pg="${docId}"]`).forEach(el => { el.textContent = nd.pages ? nd.pages + " עמ'" : ""; });
      document.querySelectorAll(`[data-dt="${docId}"]`).forEach(el => { el.textContent = datesOf(nd).length ? fmtDate(datesOf(nd)[0]) : ""; });
      document.querySelectorAll(`[data-meta="${docId}"]`).forEach(el => { el.textContent = metaText(nd); el.title = datesOf(nd).length ? "תאריכים שנמצאו במסמך: " + datesOf(nd).map(fmtDate).join(", ") : ""; });
    } catch (e) { if (/no such column/.test(e.message || "")) S.metaOff = true; }      // לפני מיגרציה 0010: לא מנסים שוב
    metaBusy.delete(docId);
  }

  // ───────── חיפוש חברה: במאגר שלנו, ובמאגר הרשם (חברות שאינן במאגר: כרטיסייה אדומה; סימון חברות מחוסלות/נמחקו) ─────────
  const DEFUNCT = /מחוק|נמחק|מבוטל|פירוק|מפורק|מחוסל|חוסל|חיסול/;
  const stTag = st => (st ? `<span class="pd-st${DEFUNCT.test(st) ? " bad" : ""}">${E(st)}</span>` : "");
  // ח.פ. או ח.צ.: חברה ציבורית (לפי סוג התאגיד ברשם, ובלעדיו לפי מספר שמתחיל ב-52) מוצגת "ח.צ."
  const chpLbl = (chp, type) => /ציבורית/.test(type || "") || (!/פרטית|שותפות|עמותה|אגודה|חל"צ|ציבורית/.test(type || "") && /^52\d{7}$/.test(String(chp || "").replace(/\D/g, ""))) ? "ח.צ." : "ח.פ.";
  const digitsOf = x => String(x || "").replace(/\D/g, "").replace(/^0+/, "");
  const markText = r => `חסר במאגר: ${r.name} (${chpLbl(r.id, r.type)} ${r.id}${r.status ? ", " + r.status : ""})`;
  function runCompanySearch(q, out, o) {
    q = (q || "").trim();
    clearTimeout(out._t);
    if (q.length < 2) { out.innerHTML = ""; out._seq = (out._seq || 0) + 1; return; }
    const dg = q.replace(/\D/g, "");
    const local = bizList().filter(b => !o.exclude(b.id) && ((b.registrar_name || "").includes(q) || (b.permit_name || "").includes(q) || (dg.length >= 4 && (b.chp_number || "").includes(dg)))).slice(0, 10);
    out.innerHTML = (local.map(b => o.card ? o.card(b) : `<button class="pd-pick" data-pick="${b.id}">${displayName(b, true)} <span class="pd-sub">${E(b.chp_number || "")}</span>${stTag(b.registry_status)}</button>`).join("") ||
      `<div class="pd-sub">לא נמצאה חברה במאגר שלנו</div>`) +
      (o.extpick ? S.ext.filter(x => (x.name || "").includes(q) || (dg.length >= 4 && (x.chp || "").includes(dg))).slice(0, 6).map(x => `<button class="pd-pick" data-extpick="${x.id}" style="border-color:#c9b46a;background:#fffaf0">${E(x.name)} <span class="pd-sub">${E(x.chp || "")}</span> <span class="pd-st bad">${EXT_HE[x.status] || x.status} · ברשימת החברות שאינן במאגר</span></button>`).join("") : "") + `<div class="pd-regbox"></div>`;
    out.onclick = e => {
      const pk = e.target.closest("[data-pick]"); if (pk) return o.pick(pk.dataset.pick);
      const mk = e.target.closest("[data-mark]"); if (mk) return o.mark({ id: mk.dataset.mark, name: mk.dataset.name, status: mk.dataset.status });
      const ex = e.target.closest("[data-ext]"); if (ex) return o.ext({ id: ex.dataset.id, name: ex.dataset.name, status: ex.dataset.status }, ex.dataset.ext);
      const xp = e.target.closest("[data-extpick]"); if (xp) return o.extpick(xp.dataset.extpick);
      const ad = e.target.closest("[data-addreg]"); if (ad && o.newpick) return o.newpick(ad.dataset.addreg, ad.dataset.name || ad.dataset.addreg); if (ad) return addReg(ad.dataset.addreg, ad.dataset.defunct === "1", o.mkAdded && o.mkAdded());
    };
    if (q.length >= 3) out._t = setTimeout(() => regLookup(q, out, o), 450);
  }
  async function regLookup(q, out, o) {
    const box = out.querySelector(".pd-regbox"); if (!box) return;
    const seq = out._seq = (out._seq || 0) + 1;
    box.innerHTML = `<div class="pd-sub">בודק גם ברשם החברות…</div>`;
    let d;
    try { d = await api("/registry-name-search?q=" + encodeURIComponent(q)); }
    catch (e) { if (seq === out._seq && out.contains(box)) box.innerHTML = `<div class="pd-sub">הבדיקה ברשם לא זמינה (${E(e.message)})</div>`; return; }
    if (seq !== out._seq || !out.contains(box)) return;
    const byChp = new Map(bizList().filter(b => digitsOf(b.chp_number)).map(b => [digitsOf(b.chp_number), b]));
    const rs = d.results || [];
    const dg = q.replace(/\D/g, ""), shown = new Set(bizList().filter(b => !o.exclude(b.id) && ((b.registrar_name || "").includes(q) || (b.permit_name || "").includes(q) || (dg.length >= 4 && (b.chp_number || "").includes(dg)))).slice(0, 10).map(b => b.id));      // כבר מוצגות ברשימה המקומית למעלה
    const seenB = new Set(), seenM = new Set();
    const inDb = rs.map(r => ({ r, b: byChp.get(digitsOf(r.id)) })).filter(x => x.b && !o.exclude(x.b.id) && !shown.has(x.b.id) && !seenB.has(x.b.id) && seenB.add(x.b.id));      // בלי כפילויות (הרשם מחזיר לפעמים את אותה חברה כמה פעמים)
    const miss = rs.filter(r => !byChp.has(digitsOf(r.id)) && !seenM.has(digitsOf(r.id)) && seenM.add(digitsOf(r.id)));
    box.innerHTML = (inDb.length ? `<div class="pd-grp weak">במאגר שלנו (לפי הרשם)</div>` + inDb.slice(0, 6).map(x => o.card ? o.card(x.b) : `<button class="pd-pick" data-pick="${x.b.id}">${displayName(x.b, true)} <span class="pd-sub">${E(x.r.id)}</span>${stTag(x.r.status)}</button>`).join("") : "") +
      (miss.length ? `<div class="pd-grp" style="color:#c0392b">לא במאגר שלנו (נמצאו ברשם)</div>` + miss.slice(0, 8).map(r => `
        <div class="pd-reg"><div><b>${E(r.name)}</b> <span class="pd-tag red">לא במאגר</span>${r.defunct ? ' <span class="pd-tag red">⚠ מחוסלת / נמחקה</span>' : ""}</div>
          <div class="pd-sub">${E(r.type || "")} · ${chpLbl(r.id, r.type)} ${E(r.id)}${r.status ? " · " + E(r.status) : ""}</div>
          <div class="pd-btns" style="margin-top:4px">${o.newpick ? `<button class="pd-btn pd-ac-addbtn" data-addreg="${E(r.id)}" data-name="${E(r.name)}" data-defunct="${r.defunct ? 1 : 0}">➕ הוספת העסק לרשימת המאושרים</button> <button class="pd-mini pd-ac-plain" data-ext="${extGuess(r.status)}" data-id="${E(r.id)}" data-name="${E(r.name)}" data-status="${E(r.status || "")}" title="המסמך משויך לחברה בלי להוסיף אותה למאגר (תופיע ברשימת החברות שאינן במאגר)">שיוך המסמך בלבד</button></div></div>` : `${o.ext ? `<button class="pd-btn primary" data-ext="${extGuess(r.status)}" data-id="${E(r.id)}" data-name="${E(r.name)}" data-status="${E(r.status || "")}" title="הסטטוס (${EXT_HE[extGuess(r.status)]}) נקבע לפי הרשם, ואפשר לשנות אותו ברשימת החברות שאינן במאגר">שיוך</button>` : `<button class="pd-btn" data-mark="${E(r.id)}" data-name="${E(r.name)}" data-status="${E(r.status || "")}">סמן במסמך: חסר במאגר</button>`}
            <button class="pd-btn" data-addreg="${E(r.id)}" data-name="${E(r.name)}" data-defunct="${r.defunct ? 1 : 0}">הוספה למאגר…</button></div></div>`}`).join("") +
        (d.more ? `<div class="pd-sub">יש עוד תוצאות: חדדו את החיפוש</div>` : "") : (inDb.length ? "" : `<div class="pd-sub">לא נמצאה גם ברשם</div>`));
  }
  let pendingAdd = null;
  function addReg(id, defunct, added, vis, pcat) {        // הוספת חברה שנמצאה ברשם למאגר: פותח את טופס "הוספת עסק" הרגיל עם ח.פ. ממולא; אם יש added - אחרי השמירה הוא משייך אוטומטית
    if (defunct && !confirm("החברה מחוסלת / נמחקה ברשם. להוסיף אותה למאגר בכל זאת?")) return;
    pendingAdd = added ? { chp: digitsOf(id), added } : null;
    ["pd-confirm", "pd-un", "pd-upload", "pd-doc", "pd-manage", "pd-company"].forEach(close);
    if (typeof openForm === "function") {
      openForm(null, true);          // חלון צף מעל הדף (ולא מעבר לתצוגת הטופס הרגילה)
      setTimeout(() => { if (typeof addCompany === "function") addCompany(String(id)); }, 150);
      if (vis !== undefined) for (const ms of [250, 900, 2000]) setTimeout(() => { const v = document.getElementById("f-visibility"); if (v && (v.value === "?" || v.value === "")) v.value = vis; }, ms);
      if (pcat) for (const ms of [250, 900, 2000]) setTimeout(() => { const f = document.getElementById("f-pcat"); if (f && !f.value) { f.value = pcat; if (window.pcatRender) pcatRender(); } }, ms);          // קטגוריה לרשימת השטרות שנבחרה בחלון ההעלאה          // פרטי / כללי לפי בחירת סוג השטר בחלון ההעלאה
    }
  }

  function addNoChp(name, added, vis, pcat) {        // הוספת עסק חדש בלי ח.פ.: פותח את טופס "הוספת עסק" במצב "עסק בלי ח.פ." עם השם ממולא; אחרי השמירה משייך אוטומטית (החדש בלי ח.פ. הוא שלנו)
    pendingAdd = added ? { chp: "", added } : null;
    ["pd-confirm", "pd-un", "pd-upload", "pd-doc", "pd-manage", "pd-company"].forEach(close);
    if (typeof openForm !== "function") return;
    openForm(null, true);          // חלון צף מעל הדף
    const fill = () => {
      if (typeof toggleNoChp === "function" && typeof noChp !== "undefined" && !noChp) toggleNoChp();
      const f = document.getElementById("f-permit"); if (f && !f.value) { f.value = name; f.dispatchEvent(new Event("input", { bubbles: true })); }
      if (vis !== undefined) { const v = document.getElementById("f-visibility"); if (v && (v.value === "?" || v.value === "")) v.value = vis; }
      if (pcat) { const f = document.getElementById("f-pcat"); if (f && !f.value) { f.value = pcat; if (window.pcatRender) pcatRender(); } }
    };
    for (const ms of [150, 500, 1200]) setTimeout(fill, ms);
  }
  function bizAdded(b) {        // נקרא מטופס העסקים אחרי שמירת עסק חדש
    const p = pendingAdd; pendingAdd = null;
    if (p && b && digitsOf(b.chp_number) === p.chp) p.added(b.id);          // p.chp ריק = חברה בלי ח.פ.: הרישום החדש בלי ח.פ. הוא שלה
  }

  // ───────── טעינה ואינדקס ─────────
  function reindex() {
    S.byBiz = new Map(); S.byId = new Map();
    for (const d of S.docs) {
      S.byId.set(d.id, d);
      for (const b of new Set([...(d.business_ids || []), ...(d.subs || []).map(x => x.id)])) { if (!S.byBiz.has(b)) S.byBiz.set(b, []); S.byBiz.get(b).push(d); }
    }
  }
  async function load() {
    if (S.loading) return;
    S.loading = true;
    // עותק שמור בדפדפן (מהכניסה הקודמת): מוצג מיד, רק לתצוגה ורק בטעינה הראשונה. שמירה ופתיחת חלונות מחכות לנתונים העדכניים מהשרת
    S.freshP = new Promise(r => { S._freshDone = r; });
    if (!S.cacheTried) {
      S.cacheTried = true;
      let c = null; try { c = JSON.parse(localStorage.getItem(DOCS_CACHE) || "null"); } catch { c = null; }
      if (c && Array.isArray(c.docs) && c.docs.length) { S.docs = c.docs; S.appr = new Map(c.appr || []); reindex(); S.loaded = true; S.stale = true; refresh(); }
    }
    // כל הבקשות יוצאות יחד (ברשת איטית: זמן אחד במקום חמישה ברצף); הטבלה מתעדכנת כבר כשמגיעים המסמכים
    const pDocs = api("/permit-docs"), pExt = api("/permit-ext"), pHp = api("/permit-text?hints=1"), pRev = api("/permit-review"), pAppr = apprReload();
    [pExt, pHp, pRev].forEach(p => p.catch(() => {}));
    let fresh = false;
    try { const r = await pDocs; S.docs = r.docs || []; S.err = ""; reindex(); S.loaded = true; fresh = true; }
    catch (e) { if (!S.stale) S.err = e.message || "שגיאה"; S.loaded = true; }
    try { await pAppr; } catch { /* לפני מיגרציה */ }
    if (fresh) { S.stale = false; try { localStorage.setItem(DOCS_CACHE, JSON.stringify({ docs: S.docs, appr: [...(S.appr || new Map())] })); } catch { /* אין מקום */ } }
    S._freshDone();
    refresh();
    try { S.ext = (await pExt).companies || []; S.extErr = ""; } catch (e) { S.ext = []; S.extErr = e.message || "שגיאה"; }      // לפני מיגרציה 0008 אין חברות שאינן במאגר
    try { S.hp = (await pHp).hp || []; S.hpDocs = null; S.hpBy = null; } catch { S.hp = null; }      // ח.פ. שנמצאו במסמכים (אחרי ייבוא 0015); בלי זה אין הצעות לפי ח.פ.
    try { S.rev = new Map(((await pRev).items || []).map(x => [x.key, x])); } catch { S.rev = new Map(); }      // לפני מיגרציה 0012 אין מצבי בדיקה
    S.loading = false;
    refresh();
  }
  function replaceDoc(doc) {
    S._fm = null;
    const i = S.docs.findIndex(d => d.id === doc.id);
    if (i >= 0) S.docs[i] = doc; else S.docs.unshift(doc);
    reindex();
  }

  // ───────── תא בטבלת הניהול ─────────
  function cell(b) {
    if (!S.loaded) { if (!S.loading && typeof isAdmin !== "undefined" && isAdmin) load(); return `<span class="pd-na">…</span>`; }
    if (S.err) return `<span class="pd-na" title="${E(S.err)}">—</span>`;
    const ds = S.byBiz.get(b.id) || [];
    if (!ds.length) return `<button type="button" class="pd-missing" onclick="PD.openCompany('${b.id}')" title="אין אף מסמך משויך לחברה">⚠ חסר היתר עסקה</button>`;
    const n = t => ds.filter(d => d.doc_type === t).length;
    const chips = ["general", "private", "both", "unknown"].filter(t => n(t)).map(t => `<span class="pd-chip" style="background:${TCOL[t]}">${TL[t]}${n(t) > 1 ? " ×" + n(t) : ""}</span>`).join("");
    const hasG = ds.some(d => d.doc_type === "general" || d.doc_type === "both"), hasP = ds.some(d => d.doc_type === "private" || d.doc_type === "both");
    const wantP = b.visibility === "פרטי" || b.visibility === "רק פרטי", wantG = b.visibility !== "רק פרטי";
    const warn = (wantP && !hasP && (hasG || ds.some(d => d.doc_type === "unknown")) ? "חסר פרטי" : "") || (wantG && !hasG && hasP ? "חסר כללי" : "");
    return `<button type="button" class="pd-ok" onclick="PD.openCompany('${b.id}')">📄 ${ds.length} ${chips}</button>${warn ? `<div class="pd-warn2" title="לפי הרישום במאגר (פרטי/כללי) חסר סוג מסמך">⚠ ${warn}</div>` : ""}`;
  }

  // ───────── מסגרת חלונות ─────────
  function overlay(id, inner, wide) {
    $(id)?.remove();
    const r = document.createElement("div");
    r.id = id;
    r.innerHTML = `<div class="pd-ov" onmousedown="if(event.target===this)PD._close('${id}')"><div class="pd-box ${wide ? "wide" : ""}${wide === "full" ? " full" : ""}">${inner}</div></div>`;
    document.body.appendChild(r);
    return r;
  }
  const closers = {};
  function close(id) { $(id)?.remove(); if (closers[id]) { closers[id](); delete closers[id]; } }
  document.addEventListener("keydown", e => {
    if (e.key !== "Escape") return;
    for (const id of ["pd-ac-doc", "pd-ac-big", "pd-confirm", "pd-reg", "pd-ext", "pd-recent", "pd-assign", "pd-doc", "pd-upload", "pd-manage", "pd-company", "pd-cd", "pd-jedit", "pd-jdel"]) if ($(id)) { close(id); break; }
  });

  // כרטיסי הדף הראשי: "מסמכי היתר עיסקא"
  function homeCards(compact) {
    if (!S.loaded && !S.loading && typeof isAdmin !== "undefined" && isAdmin) load();
    const n = t => (S.loaded && !S.err ? ` (${ndCount(t)})` : "");
    if (compact) {          // כפתור אחד לניהול השטרות (הלשוניות בתוך הדשבורד), והמספרים בשורה מתחת
      const c = t => (S.loaded && !S.err ? ndCount(t) : "…");
      return `<button class="home-card" onclick="PD.openDash('a')"><span class="ico">🗂</span><b>ניהול שטרות היתר עיסקא</b><span class="chips"><span class="chip">חסרים שטרות <i>${c("a")}</i></span><span class="chip">מחכים לשיוך <i>${c("b")}</i></span><span class="chip">לא רשומות <i>${c("c")}</i></span></span></button>`;
    }
    return `<h3 class="pd-homeh">ניהול שטרות היתר עיסקא</h3><div class="home-grid" style="grid-template-columns:repeat(3,minmax(0,1fr));max-width:960px">
      <button class="home-card" onclick="PD.openDash('a')"><span class="ico">📋</span><b>חברות שחסרים להן שטרות${n("a")}</b></button>
      <button class="home-card" onclick="PD.openDash('b')"><span class="ico">📥</span><b>שטרות שמחכים לשיוך${n("b")}</b></button>
      <button class="home-card" onclick="PD.openDash('c')"><span class="ico">🏢</span><b>חברות לא רשומות${n("c")}</b></button></div>`;
  }

  const openCompany = bizId => openManage(bizId);

  // הורדת קובץ המסמך. ברשת עם סינון תוכן (נטפרי) הורדת PDF נחסמת ("Blocked by NetFree"): במקרה כזה עוברים אוטומטית להעברה כ-JSON (base64) ושומרים את הבחירה
  const pdfCache = new Map();      // מטמון של הבטחות (גם טעינה מראש): פתיחה חוזרת של אותו מסמך מיידית
  function fetchPdfBlob(id) {
    if (pdfCache.has(id)) return pdfCache.get(id);
    const t0 = performance.now();
    const p = fetchPdfBlobNet(id).then(b => { S.lastMs = Math.round(performance.now() - t0); return b; }, e => { pdfCache.delete(id); throw e; });
    pdfCache.set(id, p);
    if (pdfCache.size > 16) pdfCache.delete(pdfCache.keys().next().value);
    return p;
  }
  async function fetchPdfBlobNet(id) {
    const viaJson = async () => {
      const r = await fetch(`/api/permit-docs/${id}/file?enc=b64`, { headers: authH() });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || r.statusText || "HTTP " + r.status);
      const bin = atob(j.data), u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      return new Blob([u8], { type: "application/pdf" });
    };
    let pref = false; try { const t = +localStorage.getItem("pd_b64") || 0; pref = t > Date.now() - 3600e3; } catch {}      // המעבר ל-JSON נזכר שעה בלבד: אחרי שהחסימה תוקנה חוזרים להורדה הרגילה
    if (pref) return viaJson();
    try {
      const r = await fetch(`/api/permit-docs/${id}/file`, { headers: authH() });
      if (!r.ok) throw new Error(r.statusText || "HTTP " + r.status);
      const b = await r.blob();
      if (new TextDecoder().decode(await b.slice(0, 5).arrayBuffer()) !== "%PDF-") throw new Error("לא PDF");
      return new Blob([b], { type: "application/pdf" });
    } catch (e) {
      try { localStorage.setItem("pd_b64", String(Date.now())); } catch {}
      return viaJson();
    }
  }

  // ───────── חלון: צפייה ועריכה של מסמך ─────────
  // הת"ע מיוחד לאג"ח: תת-שורה לכל אג"ח שיש לה מסמך אצל החברה, עם המסמך הפרטי והכללי שלה (לפי השיוך לאג"ח; שיוך שטרם סווג - לפי סיווג המסמך).
  // גם מסמך שהוא ההת"ע הראשי של החברה נספר, אם שויך לאג"ח
  async function apprReload() {          // אג"ח שנבחרו ידנית ("בחירת אג"ח מסוימים"): ח.פ. -> [{ id, name, symbol, scope }]
    const m = new Map();
    try { for (const r of (await api("/approved-bonds")).rows || []) { const k = digitsOf(r.chp_number); if (!m.has(k)) m.set(k, []); m.get(k).push({ id: String(r.security_id), name: r.bond_name || "", symbol: r.symbol || "", scope: r.scope }); } } catch { /* בלי טבלה */ }
    S.appr = m;
  }
  function bondDocsOf(bid) {
    const by = new Map(), b = bizById(bid);
    // תת-שורה לכל אג"ח שנבחרה לחברה (גם בלי שטר), עם הרשימות שבהן היא מאושרת
    if (b && b.agch_approved === 'בחירת אג"ח מסוימים' && S.appr) for (const x of S.appr.get(digitsOf(b.chp_number)) || [])
      by.set(x.id, { bond: x.id, label: bondLabel(x), private: [], general: [], need: { private: x.scope !== "general", general: x.scope !== "private" } });
    for (const d of S.docs) {
      if (!(d.business_ids || []).includes(bid) || d.doc_type === "other") continue;
      for (const x of d.bonds || []) {
        let rl = bRoles(x.slot);
        if (!rl.length) rl = d.doc_type === "general" ? ["general"] : d.doc_type === "private" ? ["private"] : ["general", "private"];
        const e = by.get(x.id) || { bond: x.id, label: bondLabel(x), private: [], general: [] };
        for (const t of rl) if (!e[t].some(y => y.id === d.id)) e[t].push({ id: d.id, name: d.original_name || d.id });
        by.set(x.id, e);
      }
    }
    return [...by.values()].map(e => ({ need: { private: false, general: false }, ...e, priv: e.private[0] || null, gen: e.general[0] || null })).sort((a, b) => a.label.localeCompare(b.label, "he"));
  }
  // "שטרות אחרות של החברה" ו"הצעות נוספות" (בחלון המסמך ובחלון ניהול המסמכים של החברה)
  const docRole = (d, bid) => { const sl = slotsOf(d, bid); return sl.length ? sl.map(t => `הת"ע ${SLOT_HE[t]}`).join(" + ") : (d.bonds || []).length ? bondKey(d) : "נוסף"; };
  function otherDocsHtml(bid, curId) {
    const ds = liveDocs(bid).filter(d => d.id !== curId).sort((a, b) => manageOrder(bid).indexOf(a.id) - manageOrder(bid).indexOf(b.id));
    return `<h4>שטרות אחרות של החברה (${ds.length})</h4>` + (ds.length ? ds.map(d => `<div class="pd-co"><a href="#" onclick="PD._goDoc('${d.id}','${bid}');return false" title="${E(d.original_name || "")}">${E(d.original_name || d.id)}</a> <span class="pd-sub">${E(docRole(d, bid))}</span></div>`).join("") : `<div class="pd-sub">אין שטרות אחרים לחברה.</div>`);
  }
  function sugCard(x, bid) {          // הצעה לשטר ככרטיסייה: תמונה ממוזערת, שם, מקור ההצעה, ואישור שיוך
    const d = x.d, th = thumbUrls.get(d.id), open = `PD.openDoc('${d.id}','',false,'${bid}')`;
    return `<div class="pd-mg-card"><div class="pd-mg-l"><div class="pd-mg-th" onclick="${open}" title="פתיחה בגדול"><img data-thumb="${d.id}" alt="" ${th ? `src="${th}"` : ""}><span class="pd-mg-ld" ${th ? 'style="display:none"' : ""}>טוען…</span></div>${pgHtml(d)}</div>
      <div class="pd-mg-r"><div class="pd-name" style="cursor:pointer;text-decoration:underline" onclick="${open}" title="פתיחה בגדול">${E(d.original_name || d.id)}</div>
        <div class="pd-sub">${sizeHtml(d.size)} ${dateHtml(d)}</div>
        <div class="pd-sub">${E(x.why)} · ${(d.business_ids || []).length ? "משויך: " + E((d.business_ids || []).map(bizName).join(", ")) : "לא משויך"}</div>
        <div class="pd-btns"><button class="pd-btn primary" onclick="PD._sugAssign('${d.id}','${bid}')" title="שיוך המסמך לחברה (כמסמך נוסף)">✔ אישור שיוך</button><button class="pd-mini" onclick="${open}">צפייה</button></div></div></div>`;
  }
  function suggestHtml(bid, narrow) {
    const b = bizById(bid); if (!b) return "";
    const sg = hintDocs(b, SUG_TYPES);          // אותה רשימה בדיוק כמו בטבלת הדשבורד
    return `<h4 style="margin:18px 0 8px">הצעות נוספות (${sg.length})</h4>` + (sg.length ? `<div class="pd-mg-grid"${narrow ? ' style="grid-template-columns:1fr"' : ""}>${sg.slice(0, 12).map(x => sugCard(x, bid)).join("")}</div>` + (sg.length > 12 ? `<div class="pd-sub">ועוד ${sg.length - 12}</div>` : "")
      : `<div class="pd-sub">${S.hp ? "אין הצעות נוספות (לא נמצא מסמך לא משויך עם ח.פ. או שם החברה)." : "אין נתוני טקסט (צריך לייבא את מיפוי המסמכים)."}</div>`);
  }
  const REJ_KEY = "pd_sug_rej";          // הצעות שיוך שבוטלו (מסמך|חברה): לא יוצעו שוב; נשמר בדפדפן הזה
  const rejSet = () => { try { return new Set(JSON.parse(localStorage.getItem(REJ_KEY) || "[]")); } catch { return new Set(); } };
  function sugRej(docId, bid) {
    const r = rejSet(); r.add(docId + "|" + bid);
    try { localStorage.setItem(REJ_KEY, JSON.stringify([...r])); } catch { /* בלי אחסון */ }
    close("pd-doc"); if (S._paintMg && $("pd-mg")) S._paintMg(); if ($("pd-nd")) ndShow();
  }
  async function sugOk(docId, bid) {          // אישור שיוך מתוך חלון המסמך: המסמך משויך לחברה (כמסמך נוסף) והחלון נפתח מחדש בהקשר החברה, כדי שאפשר יהיה לקשר אותו להת"ע
    const d = S.byId.get(docId); if (!d) return;
    if (!(d.business_ids || []).includes(bid) && !(await updateDoc(docId, { business_ids: [...(d.business_ids || []), bid] }))) return;
    const fl = S.docFromList; S._nav = true; close("pd-doc"); S._nav = false; openDoc(docId, bid, fl);
  }
  async function goDoc(id, bid) { const fl = S.docFromList; S._nav = true; close("pd-doc"); S._nav = false; openDoc(id, bid, fl); }
  async function sugAssign(docId, bid) {
    const d = S.byId.get(docId); if (!d || (d.business_ids || []).includes(bid)) return;
    if (await updateDoc(docId, { business_ids: [...(d.business_ids || []), bid] })) { if ($("pd-doc") && S._paintDoc) S._paintDoc(); if ($("pd-manage") && S._paintMg) S._paintMg(); }
  }
  async function openDoc(docId, fromBiz, fromList, sugBiz) {
    const d = S.byId.get(docId); if (!d) return;
    close("pd-manage");
    S.docFromList = !!fromList;          // נפתח מהרשימה הראשית: בסגירה חוזרים אליה ולא לחלון הניהול
    let blobUrl = "", fileErr = "";
    overlay("pd-doc", `<div class="pd-body">טוען…</div>`, true);
    closers["pd-doc"] = () => { if (blobUrl) URL.revokeObjectURL(blobUrl); const ret = fromBiz || sugBiz; if (ret && !S._nav && !fromList && bizById(ret)) openManage(ret); };
    try {
      const blob = await fetchPdfBlob(docId);
      blobUrl = URL.createObjectURL(blob);
      if (!d.pages) blob.arrayBuffer().then(buf => pdfDoc(buf)).then(pdf => ensureMeta(docId, pdf)).catch(() => {});
      try { S.integrity = S.integrity || {}; S.integrity[docId] = (await sha256(await blob.arrayBuffer())) === d.sha256; } catch { /* בלי בדיקה */ }
    } catch (e) { blobUrl = ""; fileErr = e.message; }
    const paint = () => {
      const doc = S.byId.get(docId); if (!doc) { close("pd-doc"); return; }
      const side = $("pd-doc-side"), keep = side ? side.scrollTop : 0;
      const ids = doc.business_ids || [];
      const ctx = fromBiz || sugBiz || ids[0] || "";
      const sugOpen = sugBiz && !fromBiz && !ids.includes(sugBiz) && bizById(sugBiz);          // נפתח כהצעה לחברה: כפתור אישור שיוך
      const sugBar = sugOpen ? `<div class="pd-dup" style="margin:0 0 10px;cursor:pointer" onclick="if(!event.target.closest('button'))PD.openManage('${sugBiz}')" title="לחיצה: פתיחת נתוני החברה ומסמכיה"><div class="pd-sub">הצעה לשיוך לחברה (להשוואה מול המסמך):</div><b style="font-size:15px">${displayName(bizById(sugBiz), true)}</b><div style="margin-top:4px">ח.פ.: <b><bdi>${E(bizById(sugBiz).chp_number || "—")}</bdi></b> · רישום: <b>${regLabel(bizById(sugBiz))}</b>${stTag(bizById(sugBiz).registry_status)}</div><div class="pd-btns" style="margin-top:8px"><button class="pd-btn primary" onclick="PD._sugOk('${docId}','${sugBiz}')">✔ אישור שיוך</button><button class="pd-btn" onclick="PD._sugRej('${docId}','${sugBiz}')" title="המסמך לא מתאים לחברה הזו: לא יוצע לה שוב">✖ ביטול הצעת שיוך</button></div></div>` : "";
      const chips = ids.map(b => `<div class="pd-co"><span>${E(bizName(b))}</span><button class="pd-link" onclick="PD._unassign('${docId}','${b}')" title="ביטול שיוך המסמך לחברה הזו">ביטול שיוך</button></div>`).join("") || `<div class="pd-sub">המסמך לא משויך לאף חברה</div>`;
      const ord = fromBiz ? manageOrder(fromBiz) : [], pos = ord.indexOf(docId);
      const nav = fromBiz && ord.length > 1 ? `<button class="pd-btn" onclick="PD._nav('${docId}','${fromBiz}',-1)" title="המסמך הקודם של החברה">→</button><span class="pd-sub">${pos + 1} / ${ord.length}</span><button class="pd-btn" onclick="PD._nav('${docId}','${fromBiz}',1)" title="המסמך הבא של החברה">←</button>` : "";
      const slotBtns = fromBiz ? `<h4>קישור לרשימה של ${E(bizName(fromBiz))}</h4><div class="pd-btns">${["private", "general"].map(t => `<button class="pd-btn ${slotsOf(doc, fromBiz).includes(t) ? "sel" : ""}" onclick="PD._slot('${docId}','${fromBiz}','${t}')">${slotsOf(doc, fromBiz).includes(t) ? "✓ " : ""}הת"ע ${SLOT_HE[t]}</button>`).join("")}</div>` : "";
      const headHtml = `<div class="pd-head">${nav}<b>${E(doc.original_name || doc.id)}</b><span class="pd-sub">${sizeHtml(doc.size)}${metaText(doc) ? " · " + metaText(doc).split(" · ").map(bdi).join(" · ") : ""}${S.lastMs ? " · נטען ב-" + (S.lastMs / 1000).toFixed(1) + " שנ'" : ""}</span>${S.integrity && S.integrity[docId] === false ? ' <span style="color:#c0392b;font-weight:600">⚠ הקובץ שהתקבל שונה מהקובץ שנשמר (ייתכן סינון תוכן ברשת)</span>' : ""}<button class="pd-btn" onclick="PD._home()" title="סגירת החלונות וחזרה לדף הראשי של הניהול">🏠 ראשי</button><button class="pd-x" onclick="PD._close('pd-doc')">✕</button></div>`;
      const sideHtml = `
            ${sugBar}${slotBtns}${ctx ? otherDocsHtml(ctx, docId) + suggestHtml(ctx, true) : ""}
            <h4>חברות משויכות (${ids.length})</h4>${chips}
            <div style="margin-top:6px"><input class="pd-in" id="pd-add-q" placeholder="הוספת / שינוי שיוך: שם או ח.פ." oninput="PD._addSearch('${docId}',this.value)" autocomplete="off"><div id="pd-add-res"></div></div>
            <h4>הערה</h4><textarea class="pd-in" id="pd-note" rows="2" onchange="PD._setNote('${docId}',this.value)">${E(doc.note || "")}</textarea>
            <div class="pd-danger"><button class="pd-btn danger" onclick="PD._askDelete('${docId}')">🗑 מחיקת המסמך לגמרי</button></div>`;
      const box = $("pd-doc").querySelector(".pd-box");
      if (box.querySelector(".pd-view") && box.dataset.docId === docId) {      // רענון חלקי (שינוי סיווג וכו'): הקובץ עצמו לא נטען מחדש
        box.querySelector(".pd-head").outerHTML = headHtml;
        $("pd-doc-side").innerHTML = sideHtml;
      } else {
        box.dataset.docId = docId;
        box.innerHTML = headHtml + `<div class="pd-split"><div class="pd-view">${blobUrl ? `<iframe src="${blobUrl}#toolbar=0&navpanes=0&view=FitH" title="המסמך"></iframe>` : `<div class="pd-empty">${E(fileErr || "הקובץ לא זמין")}</div>`}</div><div class="pd-side" id="pd-doc-side">` + sideHtml + `</div></div>`;
      }
      const s2 = $("pd-doc-side"); if (s2) { s2.scrollTop = keep; s2.querySelectorAll("img[data-thumb]").forEach(img => thumb(img.dataset.thumb).then(u => { if (img.isConnected && u) { img.src = u; if (img.nextElementSibling) img.nextElementSibling.style.display = "none"; } })); }
    };
    S._paintDoc = paint; paint();
    loadNames().then(() => { if (S._paintDoc === paint && $("pd-doc")) paint(); });          // הצעות לפי שם החברה
  }
  async function updateDoc(id, patch) {
    try {
      const r = await api("/permit-docs/" + id, "PUT", patch);
      replaceDoc(r.doc); if (S._paintDoc && $("pd-doc")) S._paintDoc();
      refresh();
      return true;
    } catch (e) { alert("השמירה נכשלה: " + e.message); return false; }
  }
  const setType = (id, t) => updateDoc(id, { doc_type: t });
  const setNote = (id, v) => updateDoc(id, { note: v });
  function unassign(id, bizId) {
    const d = S.byId.get(id); if (!d) return;
    const rest = d.business_ids.filter(x => x !== bizId);
    if (!rest.length && !confirm("זו החברה האחרונה של המסמך. אחרי ביטול השיוך המסמך יישאר במאגר בלי שיוך לאף חברה. להמשיך?")) return;
    updateDoc(id, { business_ids: rest });
  }
  function addSearch(id, q) {
    const out = $("pd-add-res"); if (!out) return;
    runCompanySearch(q, out, { exclude: x => ((S.byId.get(id) || {}).business_ids || []).includes(x), pick: b => assign(id, b),
      mkAdded: () => async bid => { const d = S.byId.get(id); if (d && await updateDoc(id, { business_ids: [...(d.business_ids || []), bid] })) openDoc(id); },
      mark: r => { const d = S.byId.get(id); updateDoc(id, { note: (d.note ? d.note + " | " : "") + markText(r) }); } });
  }
  function assign(id, bizId) { const d = S.byId.get(id); updateDoc(id, { business_ids: [...(d.business_ids || []), bizId] }); }
  function askDelete(id) {
    const d = S.byId.get(id); if (!d) return;
    const n = (d.business_ids || []).length;
    overlay("pd-confirm", `
      <div class="pd-head" style="background:#c0392b;color:#fff"><b>⚠ מחיקת מסמך לצמיתות</b></div>
      <div class="pd-body">
        <p><b>${E(d.original_name || d.id)}</b> יימחק לגמרי מהמאגר${n ? ` ויוסר מכל ${n} החברות המשויכות אליו` : ""}. הקובץ עצמו נמחק גם מהאחסון ולא ניתן לשחזר אותו.</p>
        <p class="pd-sub">אם רק רוצים להפסיק לשייך אותו לחברה מסוימת — השתמשו ב"ביטול שיוך" במקום.</p>
        <p>להמשך, הקלידו <b>מחק</b>:</p><input class="pd-in" id="pd-del-q" oninput="document.getElementById('pd-del-go').disabled=this.value.trim()!=='מחק'" autocomplete="off">
        <div class="pd-btns" style="margin-top:12px"><button class="pd-btn" onclick="PD._close('pd-confirm')">ביטול</button><button class="pd-btn danger" id="pd-del-go" disabled onclick="PD._doDelete('${id}')">מחיקה לצמיתות</button></div>
      </div>`);
  }
  async function doDelete(id) {
    try {
      await api("/permit-docs/" + id, "DELETE");
      S.docs = S.docs.filter(d => d.id !== id); reindex(); pdfCache.delete(id);
      close("pd-confirm"); close("pd-doc");
      if ($("pd-un")) { Q.curId = ""; uqShow(); }
      say("המסמך נמחק");
      refresh();
    } catch (e) { alert("המחיקה נכשלה: " + e.message); }
  }

  // ───────── זיהוי חברה מתאימה (בדפדפן) ─────────
  const hebOnly = w => w.replace(/[^א-ת]/g, "");
  function hpOk(h) { if (!/^\d{9}$/.test(h)) return false; let t = 0; for (let i = 0; i < 9; i++) { const v = +h[i] * (i % 2 ? 2 : 1); t += v > 9 ? v - 9 : v; } return t % 10 === 0; }
  function normText(t) {
    return String(t || "").toLowerCase().replace(/["'׳״`()\-–_,.:\/\\]/g, " ").replace(/\s+/g, " ").replace(/(^|\s)(בעמ|בע מ|בע)(?=\s|$)/g, "$1").replace(/\s+/g, " ").trim();
  }
  const revWords = s => s.split(" ").reverse().join(" ");
  const revLetters = s => s.split(" ").map(w => [...w].reverse().join("")).join(" ");
  const textVariants = t => { const a = String(t || ""); return [a, revWords(a), revLetters(a), [...a].reverse().join("")]; };   // חילוץ טקסט מ-PDF בעברית מחזיר לפעמים מילים או אותיות בסדר הפוך
  let nameIdx = null, nameIdxFor = null;
  function nameIndex() {
    const list = bizList();
    if (nameIdx && nameIdxFor === list) return nameIdx;
    nameIdx = list.map(b => {
      const names = new Set();
      for (const raw of [b.registrar_name, b.permit_name]) for (const part of String(raw || "").split(/[;|\n/]+/)) {
        for (const v of [part, part.replace(/\([^)]*\)/g, " ")]) { const n = normText(v); if (n.length >= 6) names.add(n); }
      }
      return { b, names: [...names] };
    }).filter(x => x.names.length);
    nameIdxFor = list; return nameIdx;
  }
  // משפטי מפתח (אותם כללים כמו בבדיקה המקומית private_wording.py): "החברה מאשרת בזאת..." = משולב; "הביעה את הסכמתה..." = רק פרטי; "אנו מאשרים בזאת, התקשרות אישית..." = גם פרטי (משולב רק אם מסמך יחיד)
  const PO = "החברה הביעה הסכמתה התקשרות באופן פרטי פי היתר עיסקא עם מי שמעו חתימתה שטר רישום חברה".split(" "), PO_MUST = ["הסכמתה", "הביעה", "שטר", "חתימתה"];
  const CB = "החברה מאשרת בזאת התקשרות היתר עיסקא באופן פרטי עם כל המעוניין בכך".split(" "), CB_MUST = ["מאשרת", "בזאת", "המעוניין"];
  function phraseAt(win, words, must, need) {
    const e = new Set(win); for (const x of win) if (x.length > 3) e.add(x.slice(1));
    let c = 0; for (const k of new Set(words)) if (e.has(k)) c++;
    return c >= need && must.some(k => e.has(k)) && e.has("פרטי") && (e.has("עיסקא") || e.has("התקשרות"));
  }
  function phraseKind(text) {
    let po = false, pe = false;
    for (const tv of textVariants(text)) {
      const seq = tv.split(/\s+/).map(hebOnly).filter(Boolean);
      for (let i = 0; i < seq.length; i++) {
        if (seq[i] === "מאשרים") {        // "אנו מאשרים בזאת, התקשרות אישית לפי היתר עיסקא... עם כל המעוניין בכך": משפט מפתח נוסף: גם כללי וגם פרטי
          const w = new Set(seq.slice(Math.max(0, i - 8), i + 14)); for (const x of [...w]) if (x.length > 3) w.add(x.slice(1));
          if (w.has("בזאת") && (w.has("אישית") || w.has("פרטית")) && (w.has("עיסקא") || w.has("היתר")) && (w.has("המעוניין") || w.has("התקשרות"))) pe = true;
        }
        if (seq[i] === "המעוניין") {          // הסעיף "...היתר עיסקא... עם כל המעוניין בכך, באמצעות רישום..." גם כשהטקסט משובש
          const w5 = new Set(seq.slice(Math.max(0, i - 14), i + 16)); for (const x of [...w5]) if (x.length > 3) w5.add(x.slice(1));
          if (w5.has("בכך") && w5.has("רישום") && (w5.has("עיסקא") || w5.has("היתר"))) pe = true;
        }
        if (seq[i] === "מעוניינת") {          // "הואיל והחברה מעוניינת להתקשר בהיתר עיסקא זה גם באופן אישי" (שטר רישום חברה): גם פרטי
          const w3 = new Set(seq.slice(Math.max(0, i - 4), i + 14)); for (const x of [...w3]) if (x.length > 3) w3.add(x.slice(1));
          if ((w3.has("אישי") || w3.has("אישית")) && (w3.has("עיסקא") || w3.has("היתר"))) pe = true;
        }
        if (seq[i] === "שטר") {          // כותרת "שטר רישום חברה להיתר עיסקא פרטי"
          const w4 = new Set(seq.slice(i, i + 9)); for (const x of [...w4]) if (x.length > 3) w4.add(x.slice(1));
          if (w4.has("רישום") && (w4.has("חברה") || w4.has("לחברה")) && (w4.has("פרטי") || w4.has("פרטית")) && (w4.has("עיסקא") || w4.has("היתר"))) po = true;
        }
        if (seq[i] === "מאשרת") {          // "החברה מאשרת להתקשר בהיתר עיסקא זה גם באופן אישי עם כל המעוניין בכך": נוסח נוסף של "גם פרטי"
          const w2 = new Set(seq.slice(Math.max(0, i - 8), i + 16)); for (const x of [...w2]) if (x.length > 3) w2.add(x.slice(1));
          if ((w2.has("אישי") || w2.has("אישית")) && (w2.has("עיסקא") || w2.has("היתר")) && w2.has("המעוניין")) pe = true;
        }
        if (seq[i] === "מאשרת") { const w = new Set(seq.slice(Math.max(0, i - 4), i + 5)); if (w.has("בזאת") && (w.has("החברה") || w.has("חברה"))) return "combined"; }
        if (!["פרטי", "עיסקא", "התקשרות", "המעוניין", "הסכמתה"].includes(seq[i])) continue;
        const win = seq.slice(Math.max(0, i - 14), i + 14);
        if (phraseAt(win, CB, CB_MUST, 6)) return "combined";
        if (phraseAt(win, PO, PO_MUST, 7)) po = true;
      }
    }
    return pe ? "personal" : po ? "private" : "";
  }
  function suggest(text, fileName) {
    const nts = textVariants(normText(text)), fn = normText(String(fileName || "").replace(/\.pdf$/i, ""));
    const byChp = new Map(bizList().filter(b => (b.chp_number || "").trim()).map(b => [String(b.chp_number).trim().padStart(9, "0"), b]));
    const found = new Map(), outside = new Set();
    const add = (b, key, why, len) => { const c = found.get(b.id) || { b, hp: false, name: false, why: [], nameLen: 0 }; c[key] = true; c.nameLen = Math.max(c.nameLen, len || 0); if (!c.why.includes(why)) c.why.push(why); found.set(b.id, c); };
    const hps = new Set((String(text || "").replace(/,/g, "").match(/(?<!\d)\d{8,9}(?!\d)/g) || []).map(x => x.padStart(9, "0")));
    for (const h of hps) { if (!hpOk(h) || h[0] !== "5") continue; const b = byChp.get(h); if (b) add(b, "hp", chpLbl(h) + " " + h + " בקובץ"); else outside.add(h); }
    for (const { b, names } of nameIndex()) {
      const hit = names.find(n => nts.some(t => t.includes(n)));
      if (hit) add(b, "name", "השם בקובץ", hit.length);
      else if (fn.length >= 6 && names.some(n => n.includes(fn) || fn.includes(n))) add(b, "file", "שם הקובץ", fn.length);
    }
    // ציון התאמה: ח.פ. (3, ועוד חצי אם גם השם), שם בקובץ (2 + עד חצי לפי אורך השם), שם הקובץ בלבד (1)
    for (const c of found.values()) c.score = (c.hp ? 3 + (c.name ? 0.5 : 0) : c.name ? 2 + Math.min(c.nameLen, 40) / 80 : 1);
    const cands = [...found.values()].sort((a, b) => b.score - a.score);
    const strong = cands.filter(c => c.hp);
    const kind = phraseKind(text), readable = nts[0].length >= 40;
    // "אנו מאשרים בזאת, התקשרות אישית" (גם פרטי): משולב רק אם זה המסמך היחיד של החברה; אם יש לה מסמך כללי אחר - פרטי
    let ptype = "", pwhy = "";
    if (kind === "personal") {
      const top = (strong.length ? strong : cands.slice(0, 1)).map(c => c.b.id), dsOf = id => (S.byBiz.get(id) || []).filter(d => d.doc_type !== "other");
      if (top.some(id => dsOf(id).some(d => d.doc_type === "general" || d.doc_type === "both"))) { ptype = "private"; pwhy = "נוסח \"התקשרות אישית\": לחברה יש כבר מסמך כללי, ולכן פרטי"; }
      else if (!top.some(id => dsOf(id).length)) { ptype = "both"; pwhy = "נוסח \"התקשרות אישית\": המסמך היחיד של החברה, ולכן כללי ופרטי ביחד"; }
      else { ptype = "unknown"; pwhy = "נוסח \"התקשרות אישית\": לחברה יש מסמכים אחרים ואף אחד אינו כללי: לבחור ידנית"; }
    }
    // סיווג מוצע: משפט "החברה מאשרת בזאת" = כללי+פרטי; "הביעה את הסכמתה" = פרטי; אחרת, אם יש טקסט קריא ואין נוסח פרטי = כללי
    return { cands, outside: [...outside], shared: strong.length > 1, doubt: !strong.length && cands.length > 1, readable,
             type: kind === "personal" ? ptype : kind === "combined" ? "both" : kind === "private" ? "private" : readable ? "general" : "unknown",
             typeWhy: kind === "personal" ? pwhy : kind === "combined" ? "נוסח \"החברה מאשרת בזאת\" = כללי ופרטי ביחד" : kind === "private" ? "נוסח \"הביעה את הסכמתה\" = פרטי בלבד" : readable ? "לא נמצא נוסח פרטי בטקסט, ולכן כללי" : "" };
  }

  // ───────── קריאת טקסט מ-PDF (pdf.js; OCR רק לפי בקשה) ─────────
  const loaded = {};
  function loadScript(src) {
    if (loaded[src]) return loaded[src];
    return (loaded[src] = new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = () => rej(new Error("טעינת ספרייה נכשלה")); document.head.appendChild(s); }));
  }
  async function pdfDoc(buf) {
    await loadScript(PDFJS);
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
    return window.pdfjsLib.getDocument({ data: buf.slice(0) }).promise;
  }
  async function extractText(buf, maxPages) {
    const pdf = await pdfDoc(buf); let text = "";
    for (let i = 1; i <= Math.min(pdf.numPages, maxPages || 15); i++) {
      const tc = await (await pdf.getPage(i)).getTextContent();
      text += tc.items.map(x => x.str).join(" ") + "\n";
    }
    return { text, pages: pdf.numPages };
  }
  async function ocrText(buf, onProgress) {
    await loadScript(TESS);
    const pdf = await pdfDoc(buf); let text = "";
    const worker = await window.Tesseract.createWorker("heb+eng");
    for (let i = 1; i <= Math.min(pdf.numPages, 3); i++) {
      onProgress && onProgress(i);
      const page = await pdf.getPage(i), vp = page.getViewport({ scale: 2 });
      const cv = document.createElement("canvas"); cv.width = vp.width; cv.height = vp.height;
      await page.render({ canvasContext: cv.getContext("2d"), viewport: vp }).promise;
      text += (await worker.recognize(cv)).data.text + "\n";
    }
    await worker.terminate();
    return text;
  }
  const sha256 = async buf => [...new Uint8Array(await crypto.subtle.digest("SHA-256", buf))].map(b => b.toString(16).padStart(2, "0")).join("");

  // ───────── חלון: העלאת היתר עסקה ─────────
  const U = { queue: [], cur: null, preset: null, jobs: [], jchain: Promise.resolve() };
  function openUpload(opts) {
    if (!(opts && opts.resume)) { U.queue = []; U.cur = null; U.list = null; U.formFlow = false; U.keep = false; }
    U.preset = opts && opts.bizId || null; U.addCompany = !!(opts && opts.addCompany); U.jobs = U.jobs.filter(j => j.status === "run");
    overlay("pd-upload", `<div class="pd-head"><b>העלאת היתר עסקה</b><button class="pd-btn" onclick="PD._home()" title="סגירת החלונות וחזרה לדף הראשי של הניהול">🏠 ראשי</button><button class="pd-x" onclick="PD._close('pd-upload')">✕</button></div>
      <div id="pd-up-bg"></div><div class="pd-body" id="pd-up-body"></div>`, U.addCompany ? "full" : true);
    if (U.addCompany) $("pd-upload").querySelector(".pd-box").classList.add("fs");          // תופס את כל המסך
    closers["pd-upload"] = () => {
      if (U.keep) { U.keep = false; return; }          // מעבר זמני לטופס הוספת עסק: ממשיכים אחריו באותה רשימת קבצים
      acCleanup();
      if (U.cur && U.cur.url) URL.revokeObjectURL(U.cur.url); U.cur = null;
    };
    if (opts && opts.resume && U.list) { upBg(); acNextOrEnd(true); } else { upPick(); upBg(); }
  }
  function acCleanup() { if (U.list) U.list.forEach(e => { if (e.c && e.c.url) { try { URL.revokeObjectURL(e.c.url); } catch { /* ללא */ } } }); U.list = null; U.formFlow = false; }
  function upPick(msg) {
    $("pd-up-body").classList.remove("acfs");
    $("pd-up-body").innerHTML = `
      ${msg ? `<div class="pd-ok-msg">${msg}</div>` : ""}
      <div class="pd-drop" id="pd-drop" onclick="document.getElementById('pd-file').click()">
        <div style="font-size:34px">📄</div><b>גררו לכאן קובצי PDF או לחצו לבחירה</b>
        <div class="pd-sub" style="font-weight:700;color:#1a3a5c">אפשר להעלות כמה קבצים בבת אחת (בחירה מרובה או גרירה של כמה קבצים).</div><div class="pd-sub">הקבצים יופיעו כתמונות ממוזערות, ואחרי הבחירה המערכת תחפש חברה מתאימה ותציע שיוך לכל קובץ.</div>
        <input type="file" id="pd-file" accept="application/pdf,.pdf" multiple style="display:none" onchange="PD._files(this.files)">
      </div>
      ${U.preset ? `<p class="pd-sub">המסמך ישויך מראש לחברה: <b>${E(bizName(U.preset))}</b> (אפשר לשנות בשלב הבא)</p>` : ""}`;
    const dz = $("pd-drop");
    ["dragenter", "dragover"].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add("over"); }));
    ["dragleave", "drop"].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove("over"); }));
    dz.addEventListener("drop", e => upFiles(e.dataTransfer.files));
  }
  function upFiles(files) {
    const fl = [...files].filter(f => /\.pdf$/i.test(f.name) || f.type === "application/pdf"); if (!fl.length) return;
    if (U.addCompany) { acStart(fl); return; }
    U.queue = fl; upNext();
  }
  // הכנה ברקע של כל קובץ: קריאה, חתימה, בדיקת כפילות וחילוץ טקסט (בתור אחד, כדי לא להעמיס). הקובץ הנוכחי מוצג מיד, וההצעות מגיעות כשהניתוח מסתיים
  const UP_PREP = new WeakMap(); let UP_CHAIN = Promise.resolve();
  function upPrep(file) {
    let o = UP_PREP.get(file); if (o) return o;
    o = { file }; UP_PREP.set(file, o);
    o.bufP = file.arrayBuffer().then(b => (o.buf = b));
    o.promise = UP_CHAIN = UP_CHAIN.then(async () => {
      try { const buf = await o.bufP; o.sha = await sha256(buf); const ex = await api("/permit-docs?sha=" + o.sha); if (ex.exists) o.dup = ex.doc; } catch (e) { o.err = e.message; }
      if (!o.dup) { try { const r = await extractText(o.buf, 15); o.text = r.text; o.pages = r.pages; } catch (e) { o.textErr = e.message; } }
      o.done = true;
    }).catch(() => { o.done = true; });
    return o;
  }
  const upPrefetch = () => U.queue.slice(0, 2).forEach(upPrep);
  async function upNext() {
    if (U.addCompany && U.list) return acSkip();
    if (U.cur && U.cur.url) URL.revokeObjectURL(U.cur.url);
    const file = U.queue.shift();
    if (!file) { upPick(U.cur ? "✓ כל הקבצים טופלו." : ""); U.cur = null; return; }
    const o = upPrep(file), buf = await o.bufP;
    const c = U.cur = { file, buf, url: URL.createObjectURL(file), text: "", sel: new Set(), type: "unknown", note: "", ocr: false, analyzing: !o.done };
    $("pd-up-body").innerHTML = "";
    upReview(true);
    upPrefetch();
    o.promise.then(() => {
      if (U.cur !== c) return;
      c.analyzing = false; c.sha = o.sha;
      if (o.dup) { upDuplicate(o.dup); return; }
      c.text = o.text || ""; c.pages = o.pages; c.textErr = o.textErr;
      upReview(true);
      findBonds(c.text).then(b => { if (U.cur === c && b.length) { c.bonds = b; c.bondSel = new Set(b.map(x => x.row.id)); upReview(false); } }).catch(() => {});
    });
  }
  // "שטר זה כרגע מסומן כשטר "פרטי" של חברה X" - לכל חברה שהמסמך משויך אליה
  function dupRoleHtml(doc, btn) {
    const d = S.byId.get(doc.id) || doc;
    return (d.business_ids || []).map(id => { const sl = slotsOf(d, id);
      const role = sl.length === 2 ? "משותף פרטי וכללי" : sl[0] === "private" ? "פרטי" : sl[0] === "general" ? "כללי" : "";
      return `<div style="margin-top:6px">${role ? `שטר זה כרגע מסומן כשטר "${role}"` : "שטר זה כרגע משויך (כמסמך נוסף, לא כהת\"ע פרטי / כללי)"} של חברה <b>${E(bizName(id))}</b>${btn === "pick" ? ` <button class="pd-mini link" onclick="PD._acPick('biz','${id}')" title="בחירת החברה: למטה מופיעות האפשרויות פרטי / כללי / משותף">לשינוי</button>` : btn ? ` <button class="pd-mini link" onclick="PD._close('pd-upload');PD.openManage('${id}')">לשינוי</button>` : ""}</div>`; }).join("");
  }
  function upDuplicate(doc) {
    $("pd-up-body").innerHTML = `<div class="pd-dup"><b>⚠ קובץ זהה בדיוק כבר קיים במאגר</b> (${E(doc.original_name || doc.id)}).${(doc.business_ids || []).length ? dupRoleHtml(doc, true) : "<br>המסמך עדיין לא משויך לאף חברה."}<div class="pd-sub" style="margin-top:6px">קובץ זהה לא נכנס פעמיים. אפשר לפתוח את המסמך הקיים ולהוסיף לו שיוך.</div></div>
      <div class="pd-btns" style="margin-top:12px"><button class="pd-btn primary" onclick="PD._close('pd-upload');PD.openDoc('${doc.id}')">פתיחת המסמך הקיים</button><button class="pd-btn" onclick="PD._next()">${U.queue.length ? "דילוג לקובץ הבא" : "סיום"}</button></div>`;
  }
  function upReview(fresh) {
    if (U.addCompany) return upReviewAC(fresh);
    const c = U.cur;
    const qEl = $("pd-up-q"), nEl = $("pd-up-note"), q0 = qEl ? qEl.value : "", f0 = document.activeElement && document.activeElement.id;          // התצוגה מתרעננת כשהניתוח ברקע מסתיים: לא מאבדים מה שהמשתמש כבר הקליד
    if (nEl) c.note = nEl.value;
    if (fresh || !c.sug) {      // ההצעה מחושבת פעם אחת לכל טקסט; בחירות ידניות נשמרות בעת רענון התצוגה
      c.sug = suggest(c.text, c.file.name);
      if (!c.sel) c.sel = new Set(); if (U.preset) c.sel.add(U.preset);      // אין בחירה אוטומטית של חברות: המשתמש בוחר
      if (!c.typeTouched) c.type = c.sug.type;
    }
    const sug = c.sug;
    const noText = !c.analyzing && normText(c.text).length < 40;
    if (noText && !c.ocr && !c.textErr && !c.dupDoc) ocrBg(c);          // סריקה בלי טקסט: זיהוי טקסט אוטומטי ברקע
    const card = x => `<label class="pd-cand"><input type="checkbox" ${c.sel.has(x.b.id) ? "checked" : ""} onchange="PD._tog('${x.b.id}',this.checked)"> <span class="pd-grow"><b>${displayName(x.b, true)}</b> <span class="pd-sub">${E(x.b.chp_number || "")} · ${x.hp ? "התאמה לפי ח.פ." : "התאמה לפי שם"} (${E(x.why.join(", "))})</span>${stTag(x.b.registry_status)}</span></label>`;
    const extra = [...c.sel].filter(id => !sug.cands.some(x => x.b.id === id)).map(id => bizById(id)).filter(Boolean).map(b => card({ b, hp: false, why: ["נבחר ידנית"] }));
    const tb = Object.keys(TL).map(t => `<button class="pd-btn ${c.type === t ? "sel" : ""}" onclick="PD._type('${t}')">${TL[t]}</button>`).join("");
    $("pd-up-body").innerHTML = `
      <div class="pd-split">
        <div class="pd-view"><iframe src="${c.url}#toolbar=0&navpanes=0&view=FitH" title="תצוגה מקדימה"></iframe></div>
        <div class="pd-side">
          <div class="pd-sub">${E(c.file.name)} · ${fmtSize(c.file.size)}${c.pages ? " · " + c.pages + " עמ'" : ""}${U.queue.length ? " · נותרו בתור: " + U.queue.length : ""}</div>
          ${ocrBox(c, noText)}
          ${c.analyzing ? `<div class="pd-warnbox" style="background:#eef3fb;border-color:#b9c9e6;color:#1a3a5c">⏳ מנתח את המסמך ברקע (טקסט, ח.פ., הצעות שיוך). אפשר כבר לבחור חברה, סיווג ולשמור.</div>` : ""}
          <h4>שיוך לחברה ${sug.shared ? '<span class="pd-tag">מסמך משותף: כמה חברות</span>' : ""}${sug.doubt ? '<span class="pd-tag warn">יש ספק: כמה התאמות לפי שם</span>' : ""}</h4>
          ${sug.cands.length ? candGroups(sug.cands.slice(0, 20), card) : c.analyzing ? "" : `<div class="pd-sub">לא נמצאה חברה מתאימה בקובץ. אפשר לחפש ידנית.</div>`}${extra.join("")}
          ${sug.outside.length ? `<h4>${U.addCompany ? "הוספת חברה חדשה למאגר" : "תאגידים במסמך שאינם במאגר"}</h4>` + sug.outside.map(h => { const nm = nameNear(c.text, h); return `<div class="pd-uc ext" style="margin-top:5px"><div class="pd-uc-top" style="cursor:default"><b>${E(nm || "שם החברה לא זוהה במסמך")}</b><div class="pd-sub">ח.פ. ${E(h)} · תאגיד שנמצא במסמך ואינו במאגר${nm ? "" : " (השם יושלם מהרשם)"}</div></div>
            <div class="pd-uc-act"><button class="pd-btn primary" onclick="PD._upNewCo('${h}')" title="שומר את המסמך, פותח את טופס הוספת העסק עם הנתונים (השלמה מהרשם) ומשייך אליו את המסמך אחרי השמירה">הוספת החברה למאגר</button><button class="pd-link2" onclick="PD._upExtCo('${h}')" title="חברה מחוקה / שאינה במאגר: נרשמת ברשימת החברות שאינן במאגר">שיוך כחברה שאינה במאגר</button></div></div>`; }).join("") : (U.addCompany ? `<div class="pd-warnbox">לא נמצא במסמך ח.פ. של תאגיד שאינו במאגר. אפשר לחפש ברשם בשדה "חיפוש חברה אחרת" ולבחור "הוספה למאגר".</div>` : "")}
          ${c.bonds && c.bonds.length ? `<h4>אג"ח שמוזכרות במסמך</h4>` + c.bonds.map(x => `<label class="pd-cand"><input type="checkbox" ${c.bondSel.has(x.row.id) ? "checked" : ""} onchange="PD._upBond('${E(x.row.id)}',this.checked)"> <span class="pd-grow"><b>${E(x.row.name)}</b> <span class="pd-sub">${E(bondLabel(x.row))} · נייר ${E(x.row.id)} · ${E(x.row.company)}<br>במסמך: ${E(x.snippet)}</span></span></label>`).join("") : ""}
          <input class="pd-in" id="pd-up-q" placeholder="חיפוש חברה אחרת: שם או ח.פ." oninput="PD._upSearch(this.value)" autocomplete="off" style="margin-top:6px"><div id="pd-up-res"></div>
          <h4>סיווג</h4><div class="pd-btns">${tb}</div>${sug.typeWhy && !c.typeTouched ? `<div class="pd-sub">הצעה אוטומטית: ${E(sug.typeWhy)}</div>` : ""}
          <h4>הערה (אופציונלי)</h4><textarea class="pd-in" id="pd-up-note" rows="2" onchange="PD._upNote(this.value)">${E(c.note)}</textarea>
          <div class="pd-btns" style="margin-top:12px"><button class="pd-btn primary" id="pd-save" onclick="PD._save()">${c.sel.size ? `שמירה ושיוך ל-${c.sel.size} חברות` : "שמירה בלי שיוך"}</button><button class="pd-btn" onclick="PD._next()">דילוג על הקובץ</button></div>
          <div id="pd-up-err" style="color:#c0392b;margin-top:6px"></div>
        </div></div>`;
    if (q0) { const e = $("pd-up-q"); if (e) { e.value = q0; upSearch(q0); } }
    if (f0 === "pd-up-q" || f0 === "pd-up-note") { const e = $(f0); if (e) { e.focus(); try { e.setSelectionRange(e.value.length, e.value.length); } catch { /* ללא */ } } }
  }
  // ───────── הוספת חברה ע"י העלאת היתר: שטר ממוזער בצד ימין למעלה, חברות מוצעות באמצע, ובחירת חברה פותחת למעלה כרטיסייה עם פרטי / כללי / משותף ─────────
  const PLUS_T = '<svg viewBox="0 0 24 24" width="1.1em" height="1.1em" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" style="vertical-align:-.15em" aria-hidden="true"><path d="M3 19h18"/><path d="M12 19V4"/></svg>';
  function acPick(kind, id, name) {
    const c = U.cur; if (!c) return;
    c.pick = kind === "nochp" ? { kind, name } : kind === "new" ? { kind, hp: id, name: name || nameNear(c.text, id) || id } : { kind, id };
    upReviewAC(false);
    const t = $("pd-ac-top"); if (t) t.scrollIntoView({ block: "nearest" });
  }
  async function acDoc(id) {          // הצגת שטר קיים: רק המסמך וכפתור "חזור" לחלון ההוספה (בלי כל פרטי הניהול של המסמך)
    const d = S.byId.get(id);
    overlay("pd-ac-doc", `<div class="pd-head"><button class="pd-btn" onclick="PD._close('pd-ac-doc')">← חזור</button><b style="margin-inline-start:12px">${E(d ? (d.original_name || d.id) : "")}</b></div><div style="height:84vh;background:#777" id="pd-ac-doc-v"><div class="pd-empty" style="color:#fff">טוען מסמך…</div></div>`, true);
    try { const blob = await fetchPdfBlob(id), v = $("pd-ac-doc-v"); if (v) v.innerHTML = `<iframe src="${URL.createObjectURL(blob)}#toolbar=0&navpanes=0&view=FitH" title="המסמך" style="width:100%;height:100%;border:0;background:#fff"></iframe>`; }
    catch (e) { const v = $("pd-ac-doc-v"); if (v) v.innerHTML = `<div class="pd-empty" style="color:#fff">הקובץ לא נטען: ${E(e.message)}</div>`; }
  }
  const AC_VIS = { "": "רק כללי", "פרטי": "יש פרטי", "רק פרטי": "רק פרטי" };
  function acState(b, t) {          // מצב הת"ע של סוג אחד: ok (קיים) / miss (חסר) / na (לא נדרש)
    const d = slotDoc(b.id, t), need = t === "private" ? b.visibility === "פרטי" || b.visibility === "רק פרטי" : b.visibility !== "רק פרטי";
    const cls = d ? "ok" : need ? "miss" : "na";
    return { d, cls, st: d ? "✓" : need ? "חסר" : "לא נדרש" };
  }
  function acChip(b, t) {          // שבב מצב: סמל מסמך, כיתוב פרטי / כללי מעל, וסימן: ✓ ירוק אם קיים, "חסר" אדום אם חסר, "לא נדרש" אפור
    const he = t === "private" ? "פרטי" : "כללי", x = acState(b, t);
    return `<span class="pd-chipx ${x.cls}" title="הת&quot;ע ${he}: ${x.d ? "קיים" : x.cls === "miss" ? "חסר" : "לא נדרש"}"><span class="pd-chipx-t">📄 ${he}</span><span class="pd-chipx-s">${x.st}</span></span>`;
  }
  const acShared = b => { const dp = slotDoc(b.id, "private"), dg = slotDoc(b.id, "general"); return !!(dp && dg && dp.id === dg.id); };
  function acChips(b) {          // מסמך משותף לפרטי ולכללי: שבב אחד מחובר עם הכיתוב "מסמך משותף"
    if (acShared(b)) return `<span class="pd-chipx shared ok" title="מסמך משותף: פרטי + כללי"><span class="pd-chipx-t">📄 מסמך משותף</span><span class="pd-chipx-s2"><span>פרטי ✓</span><span>כללי ✓</span></span></span>`;
    return ["private", "general"].filter(t => acState(b, t).cls !== "na").map(t => acChip(b, t)).join("");          // סוג שהחברה לא רשומה בו ואין לו מסמך: בלי שבב בכלל
  }
  function acBizCard(b, why, on, inline) {          // כרטיסייה שלמה לעסק קיים (כמו לחברה חדשה): שם, ח.פ., קטגוריה, אזור, סוג, סטטוס, רישום ומצב ההיתרים
    const reg = (b.registrar_name || "").trim(), pn = (b.permit_name || "").trim();
    const line = [b.chp_number ? chpLbl(b.chp_number, b.biz_type) + " " + b.chp_number : "", b.category, b.region, b.biz_type].filter(x => String(x || "").trim()).map(E).join(" · ");
    return `<div class="pd-ac-card pd-ac-bc${on ? " on" : ""}" data-pick="${b.id}"${inline ? ` onclick="PD._acPick('biz','${b.id}')"` : ""}><div><b>${displayName(b, true)}</b> ${stTag(b.registry_status)}${why ? ` <span class="pd-tag">${E(why)}</span>` : ""}</div>
      ${reg && pn && reg !== pn ? `<div class="pd-sub">שם ברשם: ${E(reg)}</div>` : ""}${line ? `<div class="pd-sub">${line}</div>` : ""}
      <div class="pd-sub" style="font-weight:700;color:#1a3a5c">${E(AC_VIS[b.visibility || ""] || b.visibility || "")}</div><div class="pd-ac-chips">${acChips(b)}</div>${(b.notes || "").trim() ? `<div class="pd-sub">הערה: ${E(b.notes)}</div>` : ""}</div>`;
  }
  function acExt(hp, name, status) {          // שיוך המסמך בלבד: לחברה שאינה במאגר (נרשמת ברשימת החברות שאינן במאגר), בלי להוסיף אותה למאגר
    const c = U.cur; if (!c) return;
    const job = { c, ids: [], type: c.type || "unknown", note: c.note || "", name: c.file.name, status: "run", msg: "", ext: { chp: hp, name: name || nameNear(c.text, hp) || hp, status: status || "not_in_db" } };
    U.jobs.push(job); upBg();
    U.jchain = U.jchain.then(() => upSend(job));
    acDone();
  }
  const PSEP = "|", pcatSp = s => String(s || "").split(PSEP).map(x => x.trim()).filter(Boolean);          // כמה קטגוריות לעסק: מופרדות ב-|
  const pcatList = () => [...new Set(bizList().flatMap(x => pcatSp(x.permits_category)))].sort((a, b) => a.localeCompare(b, "he"));
  function pcatSelect(cur) {          // "קטגוריות עבור רשימת השטרות": אפשר כמה; הסרה, בחירת קיימת או יצירת חדשה
    const cs = pcatSp(cur), l = pcatList().filter(x => !cs.includes(x));
    return `<span class="pd-pcats">${cs.map((x, i) => `<span class="pd-tag">${E(x)} <a href="#" style="color:#a00;text-decoration:none" onclick="PD._acPcat('del',${i});return false" title="הסר">✕</a></span>`).join(" ") || '<span class="pd-sub">ללא</span>'}</span> <select class="pd-in pd-ac-pcat" onchange="PD._acPcat('add',this)"><option value="">➕ הוספת קטגוריה…</option>${l.map(x => `<option value="${E(x)}">${E(x)}</option>`).join("")}<option value="__new">קטגוריה חדשה…</option></select>`;
  }
  async function acPcat(op, arg) {
    const c = U.cur; if (!c || !c.pick) return;
    const b = c.pick.kind === "biz" ? bizById(c.pick.id) : null, cs = pcatSp(b ? b.permits_category : c.pick.pcat);
    if (op === "del") cs.splice(arg, 1);
    else {
      let v = arg.value;
      if (v === "__new") v = (prompt("שם הקטגוריה החדשה (לרשימת השטרות):") || "").trim();
      if (!v) { upReviewAC(false); return; }
      if (!cs.includes(v)) cs.push(v);
    }
    const val = cs.join(PSEP);
    if (b) { if (typeof inlineUpdateMany === "function") await inlineUpdateMany(c.pick.id, { permits_category: val }); }
    else c.pick.pcat = val;
    upReviewAC(false);
  }
  function acUnpick() { if (U.cur) { U.cur.pick = null; upReviewAC(false); } }
  function acBig() {
    const c = U.cur; if (!c) return;
    overlay("pd-ac-big", `<div class="pd-head"><b>${E(c.file.name)}</b><button class="pd-x" onclick="PD._close('pd-ac-big')">✕</button></div><div style="height:82vh"><iframe src="${c.url}#view=FitH" title="המסמך" style="width:100%;height:100%;border:0"></iframe></div>`, true);
  }
  function acTop(c) {
    const p = c.pick; if (!p) return "";
    const isNew = p.kind !== "biz", nc = p.kind === "nochp", b = isNew ? null : bizById(p.id); if (!isNew && !b) return "";
    const lnk = d => `<span class="pd-ac-lnk" role="link" tabindex="0" onclick="event.stopPropagation();PD._acDoc('${d.id}')">הצגת השטר הקיים</span>`;
    const dup = c.dupDoc ? (S.byId.get(c.dupDoc.id) || c.dupDoc) : null, dupSl = dup && b ? slotsOf(dup, b.id) : [];          // הקובץ החדש הוא מסמך שכבר קיים במאגר
    const warn = (t, label) => { const cur = b ? slotDoc(b.id, t) : null; if (cur && dup && cur.id === dup.id) return ""; return cur ? `<span class="pd-ac-warn">${label ? E(label) + ": " : ""}בחירת השטר החדש יבטל השטר הקיים במאגר ${lnk(cur)}</span>` : ""; };
    const det = !b ? "" : (() => {          // כרטיסיית פרטי העסק (עסק קיים במאגר)
      const reg = (b.registrar_name || "").trim(), pn = (b.permit_name || "").trim();
      const items = [["שם ברשם", reg], ["שם בהיתר עסקה", pn && pn !== reg ? pn : ""], [chpLbl(b.chp_number, b.biz_type), b.chp_number], ["קטגוריה", b.category], ["אזור", b.region], ["סוג עסק", b.biz_type], ["סטטוס ברשם", b.registry_status], ["אישור אג\"ח", b.agch_approved], ["הערה", b.notes]]
        .filter(x => String(x[1] || "").trim());
      return `<div class="pd-ac-det"><div style="grid-column:1/-1;font-weight:700;color:#1a3a5c">${E(AC_VIS[b.visibility || ""] || b.visibility || "")}</div><div style="grid-column:1/-1"><span class="pd-sub">קטגוריה עבור רשימת השטרות:</span> ${pcatSelect((b.permits_category || "").trim())}</div>${items.map(([k, v]) => `<div><span class="pd-sub">${E(k)}:</span> <b>${E(String(v))}</b></div>`).join("")}</div>`;
    })();
    // הפיצרים הם גם כפתורי הבחירה. מסמך משותף קיים / חברה חדשה: למעלה "החלפת המסמך המשותף" ומתחתיו פרטי / כללי. אחרת: פרטי / כללי למעלה והמשותף מתחת
    const sharedFirst = isNew || acShared(b);
    const big = (t, withWarn) => { const he = t === "private" ? "פרטי" : "כללי", x = b ? acState(b, t) : null;
      if (b && dupSl.length) {          // אותו מסמך כבר מסומן אצל החברה: "רק" (בסוג שהוא כבר מסומן בו) או "גם" (בסוג השני)
        const mine = dupSl.includes(t), go = mine ? t : "both";
        const cap = mine ? (dupSl.length === 2 ? `לסמן שטר זה רק כשטר ${he}` : `שטר זה כבר מסומן כשטר ${he}`) : `לסמן שטר זה גם כשטר ${he}`;
        return `<button type="button" class="pd-chipx big ${mine ? "ok" : x.cls}" onclick="PD._acGo('${go}')"><span class="pd-chipx-t">📄 ${he}</span><span class="pd-chipx-s">${mine ? "✓ " : ""}${cap}</span>${!mine && x.d ? `<span class="pd-ac-warn">השטר הקיים כ${he} יעבור למסמכים נוספים ${lnk(x.d)}</span>` : ""}</button>`;
      }
      if (x && x.cls === "na") return `<button type="button" class="pd-chipx big chg" onclick="PD._acGo('${t}')" title="שינוי רישום החברה והוספת המסמך כהת&quot;ע ${he}"><span class="pd-chipx-t">📄 ${he}</span><span class="pd-chipx-s">לשנות רישום החברה ל"${he}"</span></button>`;
      return `<button type="button" class="pd-chipx big ${x ? x.cls : "new"}" onclick="PD._acGo('${t}')"><span class="pd-chipx-t">📄 ${he}</span>${x ? `<span class="pd-chipx-s">${x.st}</span>` : ""}${b && withWarn ? warn(t, "") : ""}</button>`; };
    const sp = b ? acState(b, "private") : null, sg = b ? acState(b, "general") : null;
    const bothTitle = b && dupSl.length ? (dupSl.length === 2 ? "שטר זה כבר מסומן כשטר פרטי וכללי" : "לסמן שטר זה כשטר פרטי וכללי") : b && sharedFirst ? "החלפת המסמך המשותף: כללי + פרטי" : "מסמך משותף: פרטי + כללי";
    const needChg = b && (sp.cls === "na" || sg.cls === "na");
    const dupOther = b && dupSl.length ? [sp.d, sg.d].find(d => d && d.id !== dup.id) : null;
    const bothWarn = !b ? "" : dupSl.length ? (dupOther ? `<span class="pd-ac-warn">השטר הקיים השני יעבור למסמכים נוספים ${lnk(dupOther)}</span>` : "") : (sharedFirst ? warn("private", "") : (sp.d || sg.d) ? `<span class="pd-ac-warn">בחירת השטר החדש יבטל את השטרות הקיימים במאגר</span>` : "");          // אותו מסמך: קישור אחד להצגה
    const both = `<button type="button" class="pd-chipx big wide both ${b ? (sharedFirst ? "ok" : "") : "new"}" onclick="PD._acGo('both')"><span class="pd-chipx-t"><span class="pd-ac-plus">${PLUS_T}</span> ${bothTitle}</span>${b ? `<span class="pd-chipx-s2"><span class="${sp.cls === "na" ? "chg" : sp.cls}">${sp.cls === "na" ? 'לשנות רישום החברה ל"פרטי"' : "פרטי " + sp.st}</span><span class="${sg.cls === "na" ? "chg" : sg.cls}">${sg.cls === "na" ? 'לשנות רישום החברה ל"כללי"' : "כללי " + sg.st}</span></span>` : ""}${bothWarn}</button>`;
    const pair = w => `<div class="pd-ac-row">${big("private", w)}${big("general", w)}</div>`;
    const body = sharedFirst ? `${both}<div class="pd-sub" style="margin:8px 0 4px">או לסמן את המסמך החדש רק כ:</div>${pair(false)}` : `${pair(true)}${both}`;
    return `<div class="pd-ac-topcard"><div class="pd-ac-head"><div><b>${isNew ? E(p.name) : displayName(b, true)}</b> <span class="pd-sub">${nc ? "בלי ח.פ." : isNew ? chpLbl(p.hp) + " " + E(p.hp) : (b.chp_number ? chpLbl(b.chp_number, b.biz_type) + " " + E(b.chp_number) : "")}</span>${isNew ? ` <span class="pd-tag red">${nc ? "עסק חדש בלי ח.פ.: יתווסף למאגר" : "חברה חדשה: תתווסף למאגר"}</span>` : ""}</div><button class="pd-x" style="position:static" onclick="PD._acUnpick()" title="ביטול הבחירה">✕</button></div>
      ${isNew ? `<div class="pd-ac-det"><div style="grid-column:1/-1"><span class="pd-sub">קטגוריה עבור רשימת השטרות:</span> ${pcatSelect(p.pcat || "")}</div></div>` : det}<div class="pd-sub" style="margin:2px 0 6px">לאיזה היתר עיסקא של החברה המסמך הזה? (לחיצה על פיצר שומרת ועוברת הלאה)</div>
      ${body}
      ${isNew && !nc ? `<div style="margin:8px 0 0"><button class="pd-mini pd-ac-plain" onclick="PD._acExt('${E(p.hp)}')" title="המסמך משויך לחברה בלי להוסיף אותה למאגר">שיוך המסמך בלבד (בלי הוספה למאגר)</button></div>` : ""}</div>`;
  }
  // ───────── ריבוי קבצים: רשימת קבצים (U.list) עם תמונות ממוזערות בצד, המסמך הנוכחי באמצע והכרטיסיות בצד שמאל; מעבר בין קבצים בלחיצה על התמונה הממוזערת ─────────
  function similarBiz(name, excludeId) {          // עסקים ברשימה בשם דומה לשם שמוקלד (הכלה או דמיון מקורב); לאזהרה "קיים עסק ברשימה על שם..." לפני הוספת עסק חדש
    const q = String(name || "").trim(); if (NORMN(q).length < 3) return [];
    return bizList().filter(b => b.id !== excludeId).map(b => ({ b, sc: Math.max(fuzzy(q, b.registrar_name || ""), fuzzy(q, b.permit_name || "")) })).filter(x => x.sc >= 0.62).sort((x, y) => y.sc - x.sc).slice(0, 6).map(x => x.b);
  }
  const simHtml = (name, excludeId) => { const l = similarBiz(name, excludeId); return l.length ? `<div class="pd-ac-sim">⚠ קיים עסק${l.length > 1 ? "ים" : ""} ברשימה על שם דומה:<ul>${l.map(b => `<li>${displayName(b, true)} <span class="pd-sub">${E((b.chp_number || "").trim() || "בלי ח.פ.")}</span></li>`).join("")}</ul></div>` : ""; };
  function acStart(files) {
    U.list = files.map(f => ({ file: f, st: "pending", c: null })); U.idx = 0;
    if (U.list.length > 1) U.list.forEach((_, i) => acThumb(i));
    acShow(0);
  }
  async function acMake(e) {
    const o = upPrep(e.file), buf = await o.bufP;
    const c = e.c = { file: e.file, buf, url: URL.createObjectURL(e.file), text: "", sel: new Set(), type: "unknown", note: "", ocr: false, analyzing: !o.done, entry: e };
    const fin = () => {
      c.analyzing = false; c.sha = o.sha; c.dupDoc = o.dup || null;
      if (!o.dup) { c.text = o.text || ""; c.pages = o.pages; c.textErr = o.textErr; }
      if (U.cur === c) upReviewAC(true);
      if (!o.dup) findBonds(c.text).then(bb => { if (bb.length) c.bonds = bb; }).catch(() => {});
    };
    if (o.done) fin(); else o.promise.then(fin);
    return c;
  }
  async function acShow(i) {
    if (!U.list || !U.list[i]) return;
    U.idx = i; const e = U.list[i];
    if (!e.c) await acMake(e);
    U.cur = e.c;
    for (let k = 1; k <= 3; k++) { const n = U.list[i + k]; if (n && n.st === "pending") upPrep(n.file); }          // הכנה מראש של הקבצים הבאים
    upReviewAC(true);
  }
  function acNextOrEnd() {
    if (!U.list) return;
    let n = U.list.findIndex((e, i) => i > U.idx && e.st === "pending");
    if (n < 0) n = U.list.findIndex(e => e.st === "pending");
    if (n >= 0) return acShow(n);
    acFinish();
  }
  function acSkip() { if (U.list && U.list[U.idx]) U.list[U.idx].st = "skip"; acNextOrEnd(); }
  function acDone() { if (U.list && U.list[U.idx]) U.list[U.idx].st = "sent"; acNextOrEnd(); }
  function acFinish() {
    if (U.preset) { close("pd-upload"); return; }          // העלאה משורת חברה: חוזרים לטבלה
    U.cur = null;
    if ($("pd-up-body")) { upPick("✓ כל הקבצים טופלו. השמירה ממשיכה ברקע."); }
  }
  let TH_CHAIN = Promise.resolve();
  function acThumb(i) {
    const e = U.list && U.list[i]; if (!e || e.thumb !== undefined) return; e.thumb = "";
    TH_CHAIN = TH_CHAIN.then(async () => {
      try {
        const buf = await upPrep(e.file).bufP, pdf = await pdfDoc(buf), page = await pdf.getPage(1), v0 = page.getViewport({ scale: 1 }), vp = page.getViewport({ scale: 220 / v0.width });
        const cv = document.createElement("canvas"); cv.width = vp.width; cv.height = vp.height;
        await page.render({ canvasContext: cv.getContext("2d"), viewport: vp }).promise;
        e.thumb = cv.toDataURL("image/jpeg", 0.7);
        const img = $("pd-thi-" + i); if (img) { img.src = e.thumb; img.style.display = "block"; const ph = $("pd-thp-" + i); if (ph) ph.style.display = "none"; }
      } catch { /* בלי תצוגה ממוזערת: נשאר שם הקובץ */ }
    });
  }
  const acThumbs = () => !U.list || U.list.length < 2 ? "" : `<div class="pd-ac-thumbs">${U.list.map((e, i) => `<div class="pd-ac-th ${i === U.idx ? "on" : ""} st-${e.st}" onclick="PD._acShow(${i})" title="${E(e.file.name)}"><img id="pd-thi-${i}" alt="" style="${e.thumb ? "display:block" : "display:none"}"${e.thumb ? ` src="${e.thumb}"` : ""}><div class="pd-ac-thp" id="pd-thp-${i}" style="${e.thumb ? "display:none" : ""}">📄</div><div class="pd-ac-thn">${E(e.file.name)}</div>${e.st === "sent" ? '<span class="pd-ac-thb ok">✓</span>' : e.st === "skip" ? '<span class="pd-ac-thb sk">דולג</span>' : ""}</div>`).join("")}</div>`;
  function upReviewAC(fresh) {
    const c = U.cur; if (!c) return;
    const qEl = $("pd-up-q"), q0 = qEl ? qEl.value : "", f0 = document.activeElement && document.activeElement.id;          // התצוגה מתרעננת כשהניתוח ברקע מסתיים: לא מאבדים מה שהוקלד
    const keepView = $("pd-ac-frame") && $("pd-ac-frame").dataset.u === c.url;
    if (fresh || !c.sug) c.sug = suggest(c.text, c.file.name);
    if (U.preset && !c.pickInit) { c.pickInit = true; if (!c.pick && bizById(U.preset)) c.pick = { kind: "biz", id: U.preset }; }          // העלאה משורת חברה: החברה נבחרת אוטומטית
    const sug = c.sug, noText = !c.analyzing && normText(c.text).length < 40, pend = U.list ? U.list.filter(e => e.st === "pending").length : 0;
    if (noText && !c.ocr && !c.textErr && !c.dupDoc) ocrBg(c);          // סריקה בלי טקסט: זיהוי טקסט אוטומטי ברקע
    const cardB = x => acBizCard(x.b, x.hp ? "לפי ח.פ. במסמך" : "לפי שם", c.pick && c.pick.kind === "biz" && c.pick.id === x.b.id, true);
    const cardN = h => { const nm = nameNear(c.text, h) || h, on = c.pick && c.pick.kind === "new" && c.pick.hp === h; return `<div class="pd-ac-card new${on ? " on" : ""}" onclick="PD._acPick('new','${E(h)}')"><div><b>${E(nm)}</b> <span class="pd-tag red">לא במאגר</span></div><div class="pd-sub">ח.פ. ${E(h)} · יתווסף למאגר</div>${simHtml(nm)}</div>`; };
    const cards = [...sug.cands.slice(0, 20).map(cardB), ...sug.outside.map(cardN)].join("");
    const body = $("pd-up-body"); body.classList.add("acfs");
    const side = `${U.list && U.list.length > 1 ? `<div class="pd-sub">קובץ ${U.idx + 1} מתוך ${U.list.length} · ממתינים: ${pend}</div>` : ""}
        ${c.analyzing ? `<div class="pd-warnbox" style="background:#eef3fb;border-color:#b9c9e6;color:#1a3a5c">⏳ מנתח את המסמך ברקע (טקסט, ח.פ., הצעות). אפשר כבר לחפש חברה ידנית.</div>` : ""}
        ${c.dupDoc ? `<div class="pd-warnbox">⚠ קובץ זהה כבר קיים במאגר (${E(c.dupDoc.original_name || c.dupDoc.id)}).${dupRoleHtml(c.dupDoc, "pick")}</div>` : ""}
        ${ocrBox(c, noText)}
        <div id="pd-ac-top">${acTop(c)}</div>
        <div class="pd-ac-sugs">
          <h4>חברות מוצעות לפי הכתוב במסמך</h4>
          ${cards ? `<div class="pd-ac-grid">${cards}</div>` : (c.analyzing ? "" : `<div class="pd-sub">לא זוהתה חברה במסמך. אפשר לחפש ידנית.</div>`)}
          <input class="pd-in" id="pd-up-q" placeholder="חיפוש חברה אחרת: שם או ח.פ." oninput="PD._upSearch(this.value)" autocomplete="off" style="margin-top:8px"><div id="pd-up-res"></div>
          <div style="margin-top:8px">${c.ncOpen ? `<div class="pd-ac-nc"><b>עסק חדש בלי ח.פ.</b><div style="display:flex;gap:6px;margin-top:4px"><input class="pd-in" id="pd-ac-ncn" value="${E(c.ncVal || "")}" placeholder="שם העסק" oninput="PD._acNcVal(this.value)" onkeydown="if(event.key==='Enter')PD._acNcGo()" autocomplete="off" style="flex:1"><button class="pd-btn primary" onclick="PD._acNcGo()">המשך</button><button class="pd-btn" onclick="PD._acNc(0)">ביטול</button></div><div id="pd-ac-ncsim">${simHtml(c.ncVal || "")}</div></div>` : `<button class="pd-btn" onclick="PD._acNc(1)" title="הוספת עסק חדש שאין לו ח.פ.: מקלידים שם, ובוחרים פרטי / כללי / משותף">🏷️ עסק חדש בלי ח.פ.</button>`}</div>
        </div>
        <div class="pd-btns" style="margin-top:8px"><button class="pd-btn" onclick="PD._next()">${c.dupDoc ? "סיום עם קובץ זה ומעבר לבא" : "דילוג על הקובץ"}</button></div>
        <div id="pd-up-err" style="color:#c0392b;margin-top:6px"></div>`;
    const multi = !!(U.list && U.list.length > 1);
    if (keepView) {          // המסמך עצמו לא נטען מחדש: מרעננים רק את התמונות הממוזערות ואת הכרטיסיות
      $("pd-ac-root").className = "pd-ac " + (multi ? "multi" : "single");
      $("pd-ac-thw").innerHTML = acThumbs(); $("pd-ac-side").innerHTML = side;
      $("pd-ac-fname").textContent = `${c.file.name} · ${fmtSize(c.file.size)}${c.pages ? " · " + c.pages + " עמ'" : ""}`;
    } else {
      body.innerHTML = `<div class="pd-ac ${multi ? "multi" : "single"}" id="pd-ac-root"><div id="pd-ac-thw">${acThumbs()}</div>
        <div class="pd-ac-view" id="pd-ac-viewbox"><div class="pd-sub" style="padding:2px 6px" id="pd-ac-fname">${E(c.file.name)} · ${fmtSize(c.file.size)}${c.pages ? " · " + c.pages + " עמ'" : ""}</div></div>
        <div class="pd-ac-side" id="pd-ac-side">${side}</div></div>`;
      const f = document.createElement("iframe"); f.id = "pd-ac-frame"; f.dataset.u = c.url; f.title = "המסמך"; f.src = `${c.url}#navpanes=0&view=FitH`; $("pd-ac-viewbox").appendChild(f);
    }
    if (q0) { const e = $("pd-up-q"); if (e) { e.value = q0; upSearch(q0); } }
    if (f0 === "pd-up-q" || f0 === "pd-ac-ncn") { const e = $(f0); if (e) { e.focus(); try { e.setSelectionRange(e.value.length, e.value.length); } catch { /* ללא */ } } }
  }
  function acNc(on) { const c = U.cur; if (!c) return; c.ncOpen = !!on; upReviewAC(false); if (on) { const e = $("pd-ac-ncn"); if (e) e.focus(); } }
  function acNcGo() {
    const c = U.cur; if (!c) return; const v = (c.ncVal || "").trim();
    if (v.length < 2) { const e = $("pd-up-err"); if (e) e.textContent = "יש להקליד שם עסק (לפחות 2 תווים)"; return; }
    c.ncOpen = false; acPick("nochp", "", v);
  }
  function acGo(kind) {          // לחיצה על פרטי / כללי / משותף: שמירה ברקע ומעבר לקובץ הבא
    const c = U.cur; if (!c || !c.pick) return;
    const slots = kind === "both" ? ["private", "general"] : [kind];
    if (c.pick.kind === "nochp") return upNewCo("", { slots, type: kind, noChp: true, name: c.pick.name, pcat: c.pick.pcat });
    if (c.pick.kind === "new") return upNewCo(c.pick.hp, { slots, type: kind, pcat: c.pick.pcat });
    const id = c.pick.id, bz = bizById(id);
    const job = { c, ids: [id], type: kind, note: c.note || "", name: c.file.name, status: "run", msg: "", slots: { [id]: slots } };
    if (bz && slots.some(t => acState(bz, t).cls === "na")) job.vis = { id, value: "פרטי" };          // החברה לא רשומה בסוג הזה: משנים את הרישום ל"יש פרטי" (כלומר גם פרטי וגם כללי)
    U.jobs.push(job); upBg();
    if (c.dupDoc) {          // קובץ שכבר קיים: נשארים באותו קובץ (ייתכן שצריך כמה שינויים, לכמה חברות) ומרעננים את "כרגע מסומן כ..."
      c.pick = null; upReviewAC(false);
      U.jchain = U.jchain.then(() => upSend(job)).then(() => { if (U.cur === c) upReviewAC(false); });
      return;
    }
    U.jchain = U.jchain.then(() => upSend(job));
    acDone();          // עוברים מיד לקובץ הבא (או סיום)
  }
  // התאמות מובילות למעלה (ח.פ. או שם ברור), פחות מתאימות מתחת
  function candGroups(cands, card) {
    const top = cands.filter(x => x.score >= 2.5), rest = cands.filter(x => x.score < 2.5);
    return (top.length ? `<div class="pd-grp">התאמות מובילות</div>` + top.map(card).join("") : "") +
           (rest.length ? `<div class="pd-grp weak">התאמות נוספות (פחות מתאימות)</div>` + rest.map(card).join("") : "");
  }
  // זיהוי טקסט (OCR) לסריקה בלי טקסט: רץ אוטומטית ברקע, עם ספינר; בסיום ההצעות מחושבות מחדש
  async function ocrBg(c) {
    if (c.ocr) return; c.ocr = true; c.ocrRun = true;
    try { const t = await ocrText(c.buf, i => { const el = $("pd-ocr-st"); if (el && U.cur === c) el.textContent = `מזהה טקסט בסריקה… עמוד ${i}`; }); c.text += "\n" + t; }
    catch (e) { c.textErr = "זיהוי הטקסט נכשל: " + e.message; }
    c.ocrRun = false;
    if (U.cur === c) { if (U.addCompany) upReviewAC(true); else upReview(true); }
    if (normText(c.text).length >= 40) findBonds(c.text).then(bb => { if (bb.length) c.bonds = bb; }).catch(() => {});
  }
  const ocrBox = (c, noText) => c.ocrRun ? `<div class="pd-warnbox" style="background:#eef3fb;border-color:#b9c9e6;color:#1a3a5c"><span class="pd-spin"></span> <span id="pd-ocr-st">מזהה טקסט בסריקה…</span> <span class="pd-sub">אפשר להמשיך לעבוד בינתיים.</span></div>`
    : noText ? `<div class="pd-warnbox">${c.textErr ? E(c.textErr) : c.ocr ? "לא זוהה טקסט במסמך." : "אין בקובץ טקסט (כנראה סריקה)."}</div>` : "";
  const upOcr = () => U.cur && ocrBg(U.cur);
  function upTog(id, on) { on ? U.cur.sel.add(id) : U.cur.sel.delete(id); const b = $("pd-save"); if (b) b.textContent = U.cur.sel.size ? `שמירה ושיוך ל-${U.cur.sel.size} חברות` : "שמירה בלי שיוך"; }
  function upSearch(q) {
    const out = $("pd-up-res"); if (!out) return;
    if (U.addCompany) return runCompanySearch(q, out, { exclude: () => false, card: b => acBizCard(b, "", U.cur && U.cur.pick && U.cur.pick.kind === "biz" && U.cur.pick.id === b.id, false), pick: id => acPick("biz", id), newpick: (hp, name) => acPick("new", hp, name), ext: (r, st) => acExt(r.id, r.name, st) });
    runCompanySearch(q, out, { exclude: x => U.cur.sel.has(x), pick: id => { U.cur.sel.add(id); upReview(); },
      mark: r => { U.cur.note = (U.cur.note ? U.cur.note + " | " : "") + markText(r); upReview(); } });
  }
  function nameNear(text, hp) {          // שם חברה (מסתיים ב"בע"מ") הקרוב ביותר ל-ח.פ. בטקסט המסמך
    const t = String(text || "").replace(/\s+/g, " "), i = t.indexOf(hp); if (i < 0) return "";
    const from = Math.max(0, i - 160), win = t.slice(from, i + 160);
    let best = "", bestD = 1e9;
    for (const m of win.matchAll(/([א-ת][א-ת0-9'"׳״.\-()\s]{1,50}?)\s*בע["״']?מ/g)) {
      const d = Math.abs(from + m.index - i), nm = m[1].replace(/^(של|את|החברה|חברת)\s+/, "").trim();
      if (nm.length >= 3 && d < bestD) { best = nm + ' בע"מ'; bestD = d; }
    }
    return best;
  }
  // ───────── זיהוי אזכור אג"ח במסמך: "...למטרת השקעה ע"י רכישה או החזקת אג"ח (סדרה ו' של חברה בע"מ)" ─────────
  const bondSer = x => /^\d/.test(x) ? x : x.length === 1 ? x + "'" : x.slice(0, -1) + '"' + x.slice(-1);
  const bondLabel = x => { const k = bondSeries(x.name); return k ? 'אג"ח ' + bondSer(k) : (x.name || x.symbol || ""); };          // "אג"ח ח'" ולא סימול הנייר
  const bondSeries = nm => { const m = String(nm || "").replace(/["'׳״`]/g, "").replace(/\s+/g, " ").trim().match(/אגח\s*([א-ת]{1,3}|\d{1,2})(?:\s|$)/); return m ? m[1] : ""; };
  async function findBonds(text) {
    const rows = await bondList(); if (!rows.length || !text) return [];
    const out = new Map();
    const bySeries = new Map();
    for (const r of rows) { const k = bondSeries(r.name); if (k) { if (!bySeries.has(k)) bySeries.set(k, []); bySeries.get(k).push(r); } }
    const issuer = new Map();
    const iss = r => { if (!issuer.has(r.chp + r.company)) issuer.set(r.chp + r.company, normText(r.company)); return issuer.get(r.chp + r.company); };
    const re = /אגח\s*(?:\(\s*)?סדרה\s+([א-ת]{1,3}|\d{1,2})(?:\s+של)?\s*((?:[א-ת0-9]+\s?){0,6})/g;
    for (const tv of textVariants(text)) {
      const t = tv.replace(/["'׳״`]/g, "").replace(/[()\-–_,.:;\/\\]/g, " ").replace(/\s+/g, " ");
      for (const m of t.matchAll(re)) {
        const cands = bySeries.get(m[1]); if (!cands) continue;
        const after = normText(m[2]).split(" ").filter(Boolean);
        for (const r of cands) {
          const nm = iss(r).split(" ").filter(Boolean);
          const hit = after.length && nm.length && nm.slice(0, 2).every(w => after.includes(w) || after.some(a => a.length > 3 && (a.startsWith(w) || w.startsWith(a))));
          const ex = out.get(r.id);
          const why = hit ? 'סדרה ' + m[1] + ' של ' + r.company : 'סדרה ' + m[1] + ' (החברה לא זוהתה לידה)';
          if (!ex || (hit && !ex.hit)) out.set(r.id, { row: r, hit, why, snippet: ("אג\"ח סדרה " + m[1] + " " + m[2]).trim() });
        }
      }
    }
    return [...out.values()].filter(x => x.hit).sort((a, b) => a.row.name.localeCompare(b.row.name, "he"));
  }
  const bondSugHtml = (list, have, fn) => {
    const ok = list.filter(x => !have.has(x.row.id)); if (!ok.length) return "";
    return `<h4>אג"ח שמוזכרות במסמך</h4>` + ok.map(x => `<div class="pd-uc bond"><div class="pd-uc-top" style="cursor:default"><b>${E(x.row.name)}</b><div class="pd-sub">${E(bondLabel(x.row))} · נייר ${E(x.row.id)} · ${E(x.row.company)}</div><div class="pd-sub">במסמך: ${E(x.snippet)}</div></div><div class="pd-uc-act">${fn(x.row.id)}</div></div>`).join("");
  };
  async function upPost(c, ids) {          // שמירת המסמך באתר; מסמך זהה שכבר קיים מוחזר כמות שהוא
    const u8 = new Uint8Array(c.buf); let bin = "";
    for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    const res = await fetch("/api/permit-docs", { method: "POST", headers: { ...authH(), "Content-Type": "application/json" },
      body: JSON.stringify({ file_b64: btoa(bin), name: c.file.name, doc_type: c.type, business_ids: ids, note: c.note || "" }) });
    const data = await res.json().catch(() => ({}));
    if (res.status === 409 && data.doc) return data.doc;
    if (!res.ok) throw new Error(data.error || res.statusText);
    return data.doc;
  }
  async function upNewCo(hp, o) {          // שמירת המסמך, ואז הוספת החברה למאגר (טופס הוספת עסק עם ח.פ. ממולא) ושיוך המסמך אליה אחרי השמירה (o: { slots, type } מהבחירה פרטי / כללי / משותף)
    const c = U.cur; if (!c) return;
    try {
      if (o && o.type) c.type = o.type;
      const doc = await upPost(c, [...c.sel]); replaceDoc(doc);
      if (U.list && U.list[U.idx]) { U.list[U.idx].st = "sent"; U.keep = true; U.formFlow = true; }          // הקובץ הועלה: אחרי יצירת העסק חוזרים לחלון ההעלאה ועוברים לקובץ הבא
      const type = c.type, vis = o && o.slots ? (o.slots.length === 2 ? "פרטי" : o.slots[0] === "private" ? "רק פרטי" : "") : undefined;
      const cb = async bid => {
        try { const d = S.byId.get(doc.id), r = await api("/permit-docs/" + doc.id, "PUT", { business_ids: [...new Set([...((d && d.business_ids) || []), bid])], doc_type: type, ...(o && o.slots ? { slots: { [bid]: o.slots } } : {}) }); replaceDoc(r.doc); refresh(); }
        catch (e) { alert("החברה נוספה, אך שיוך המסמך נכשל: " + e.message); }
      };
      if (o && o.noChp) addNoChp(o.name, cb, vis, o.pcat); else addReg(hp, false, cb, vis, o && o.pcat);
    } catch (e) { const el = $("pd-up-err"); if (el) el.textContent = "השמירה נכשלה: " + e.message; }
  }
  async function upExtCo(hp) {
    const c = U.cur; if (!c) return;
    try {
      const doc = await upPost(c, [...c.sel]); replaceDoc(doc);
      const co = await extEnsure({ chp: hp, name: nameNear(c.text, hp) || hp, status: "not_in_db" });
      await extAssign(doc.id, co.id);
      if (U.queue.length) upNext(); else { U.cur = { ...c, url: "" }; upPick(`✓ נשמר ושויך לחברה שאינה במאגר: ${E(co.name)}`); }
    } catch (e) { const el = $("pd-up-err"); if (el) el.textContent = "השמירה נכשלה: " + e.message; }
  }
  // שמירה ברקע: לחיצה על "שמירה" עוברת מיד לקובץ הבא; ההעלאה לאתר ממשיכה בתור, והמצב מוצג בראש החלון
  function upSave() {
    const c = U.cur; if (!c) return;
    const job = { c, ids: [...c.sel], type: c.type, note: c.note || "", name: c.file.name, status: "run", msg: "" };
    U.jobs.push(job); upBg();
    if (U.queue.length) upNext(); else { U.cur = { ...c, url: "" }; upPick("✓ כל הקבצים נשלחו לשמירה. השמירה ממשיכה ברקע."); }
    U.jchain = U.jchain.then(() => upSend(job));
  }
  async function upSend(job) {
    const c = job.c; job.status = "run"; job.msg = ""; upBg();
    try {
      const u8 = new Uint8Array(c.buf); let bin = "";
      for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
      const res = await fetch("/api/permit-docs", { method: "POST", headers: { ...authH(), "Content-Type": "application/json" },
        body: JSON.stringify({ file_b64: btoa(bin), name: c.file.name, doc_type: job.type, business_ids: job.ids, note: job.note }) });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409 && data.doc) {
        replaceDoc(data.doc); job.doc = data.doc.id;
        if (job.ext) { const co = await extEnsure(job.ext); await extAssign(data.doc.id, co.id); job.status = "ok"; job.msg = "קובץ זהה כבר היה במאגר: שויך מחדש"; S._fm = null; refresh(); upBg(); return; }
        if (job.vis && typeof inlineUpdateMany === "function") await inlineUpdateMany(job.vis.id, { visibility: job.vis.value });
        if (job.slots) { await upLink(job, data.doc); job.status = "ok"; job.msg = "קובץ זהה כבר היה במאגר: שויך מחדש"; S._fm = null; refresh(); upBg(); return; }
        job.status = "dup"; job.msg = "קובץ זהה כבר קיים (" + (data.doc.original_name || data.doc.id) + ")"; upBg(); return;
      }
      if (!res.ok) throw new Error(data.error || res.statusText);
      replaceDoc(data.doc); job.doc = data.doc.id;
      if (job.vis && typeof inlineUpdateMany === "function") await inlineUpdateMany(job.vis.id, { visibility: job.vis.value });
      if (job.slots) await upLink(job, data.doc);
      if (job.ext) { const co = await extEnsure(job.ext); await extAssign(data.doc.id, co.id); }
      if (c.bonds && c.bondSel && c.bondSel.size) { try { replaceDoc((await api("/permit-docs/" + data.doc.id, "PUT", { bonds: c.bonds.filter(x => c.bondSel.has(x.row.id)).map(x => x.row) })).doc); } catch (e) { job.msg = "נשמר, אך שיוך האג\"ח נכשל: " + e.message; } }
      job.status = "ok"; S._fm = null; refresh(); upBg(); if (!$("pd-up-bg")) say("המסמך נשמר ושויך: " + job.name);
    } catch (e) { job.status = "fail"; job.msg = e.message; upBg(); if (!$("pd-up-bg")) alert("השמירה של " + job.name + " נכשלה: " + e.message); }
  }
  async function upLink(job, doc) {          // שיוך לסלוט (פרטי / כללי / שניהם); השטר הקיים באותו סלוט עובר למסמכים נוספים (השרת מחליף), וטוענים אותו מחדש
    const bid = Object.keys(job.slots)[0], slots = job.slots[bid];
    const displaced = slots.map(t => slotDoc(bid, t)).filter(d => d && d.id !== doc.id).map(d => d.id);
    const ids = [...new Set([...(doc.business_ids || []), bid])];
    const r = await api("/permit-docs/" + doc.id, "PUT", { business_ids: ids, doc_type: job.type, slots: { [bid]: slots } });
    replaceDoc(r.doc); if (displaced.length) await refetchDocs(displaced);
  }
  function upBg() {
    const el = $("pd-up-bg"); if (!el) return;
    const run = U.jobs.filter(j => j.status === "run"), ok = U.jobs.filter(j => j.status === "ok").length;
    const bad = U.jobs.map((j, i) => ({ j, i })).filter(x => x.j.status === "fail" || x.j.status === "dup" || (x.j.status === "ok" && x.j.msg));
    el.innerHTML = U.jobs.length ? `<div class="pd-sub" style="padding:6px 14px;background:#eef3fb;border-bottom:1px solid #d5e0f0">${run.length ? `⏳ שומר ברקע: ${run.length}` : "✓ אין שמירות פעילות"}${ok ? ` · נשמרו: <b>${ok}</b>` : ""}
      ${bad.map(({ j, i }) => `<div style="color:${j.status === "fail" ? "#c0392b" : "#7a5a00"}">${j.status === "fail" ? "✗" : "ℹ"} ${E(j.name)}: ${E(j.msg)} ${j.status === "fail" ? `<button class="pd-mini" onclick="PD._upRetry(${i})">נסה שוב</button>` : j.doc ? `<button class="pd-mini" onclick="PD._close('pd-upload');PD.openDoc('${j.doc}')">פתיחה</button>` : ""}</div>`).join("")}</div>` : "";
  }
  function upRetry(i) { const j = U.jobs[i]; if (j && j.status === "fail") U.jchain = U.jchain.then(() => upSend(j)); }


  // ───────── דשבורד מסמכי היתר: לא משויכים / לבדיקה / לחברות שאינן במאגר / מסמכים אחרים ─────────

  // ───────── העלאה מהירה של כמה קבצים: בלי שיוך ובלי בדיקה אחד אחד, ואחר כך דשבורד שיוך רק לקבצים שהועלו ─────────
  const BK = { batch: "", ok: [], dup: [], fail: [], total: 0, stop: false };
  async function bulkRun(files) {
    const list = [...files].filter(f => /\.pdf$/i.test(f.name) || f.type === "application/pdf");
    if (!list.length) return;
    Object.assign(BK, { batch: "upload-" + Date.now().toString(36), ok: [], dup: [], fail: [], total: list.length, stop: false });
    const body = $("pd-up-body"), paint = (i, cur) => { if (!$("pd-up-body")) return; body.innerHTML = `<div class="pd-empty"><b>מעלה ${list.length} קבצים</b><br><span class="pd-sub">${i} מתוך ${list.length}${cur ? " · " + E(cur) : ""}</span><br><span class="pd-sub">הועלו: ${BK.ok.length} · קיימים כבר: ${BK.dup.length} · נכשלו: ${BK.fail.length}</span></div><div class="pd-btns" style="justify-content:center"><button class="pd-btn" onclick="PD._bulkStop()">עצירה</button></div>`; };
    for (let i = 0; i < list.length && !BK.stop; i++) {
      const file = list[i]; paint(i, file.name);
      try {
        const buf = await file.arrayBuffer(), sha = await sha256(buf);
        const ex = await api("/permit-docs?sha=" + sha);
        if (ex.exists) { BK.dup.push({ name: file.name, doc: ex.doc }); continue; }
        let sg = [];
        try { const r = await extractText(buf, 5); sg = suggest(r.text, file.name).cands.slice(0, 5).map(c => ({ id: c.b.id, s: Math.round(c.score * 100) / 100, w: c.why[0] || "" })); } catch { /* בלי טקסט: ללא הצעות */ }
        const u8 = new Uint8Array(buf); let bin = "";
        for (let k = 0; k < u8.length; k += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(k, k + 0x8000));
        const res = await fetch("/api/permit-docs", { method: "POST", headers: { ...authH(), "Content-Type": "application/json" },
          body: JSON.stringify({ file_b64: btoa(bin), name: file.name, doc_type: "unknown", business_ids: [], source: "upload", source_ref: BK.batch, source_title: file.name, suggest: sg }) });
        const data = await res.json().catch(() => ({}));
        if (res.status === 409 && data.doc) { BK.dup.push({ name: file.name, doc: data.doc }); continue; }
        if (!res.ok) throw new Error(data.error || res.statusText);
        replaceDoc(data.doc); BK.ok.push({ name: file.name, doc: data.doc });
      } catch (e) { BK.fail.push({ name: file.name, err: e.message || "שגיאה" }); }
    }
    refresh();
    if (!$("pd-up-body")) return;
    $("pd-up-body").innerHTML = `<div class="pd-ok-msg">${BK.stop ? "העלאה נעצרה. " : ""}הועלו <b>${BK.ok.length}</b> קבצים${BK.dup.length ? `, <b>${BK.dup.length}</b> כבר היו במאגר (לא הועלו שוב)` : ""}${BK.fail.length ? `, <b style="color:#c0392b">${BK.fail.length}</b> נכשלו` : ""}.</div>
      <div class="pd-btns" style="margin:10px 0">${BK.ok.length ? `<button class="pd-btn primary" onclick="PD._bulkOpen()">פתיחת דשבורד שיוך לקבצים שהועלו (${BK.ok.length})</button>` : ""}<button class="pd-btn" onclick="PD._upPick()">העלאה נוספת</button></div>
      ${BK.dup.length ? `<h4>כבר במאגר</h4>` + BK.dup.map(x => `<div class="pd-sub">${E(x.name)} · <a href="#" onclick="PD._close('pd-upload');PD.openDoc('${x.doc.id}');return false">פתיחת המסמך הקיים</a> · ${(x.doc.business_ids || []).map(b => E(bizName(b))).join(", ") || "ללא שיוך"}</div>`).join("") : ""}
      ${BK.fail.length ? `<h4 style="color:#c0392b">נכשלו</h4>` + BK.fail.map(x => `<div class="pd-sub">${E(x.name)}: ${E(x.err)}</div>`).join("") : ""}`;
  }
  function bulkOpen() { close("pd-upload"); openUnassigned("un", BK.batch); }

  const Q = { batch: "", bondPicker: false, bondQ: "", view: "un", picker: null, replace: null, shared: false, i: 0, skipped: new Set(), curId: "", busy: new Set(), token: 0, sel: new Set(), type: "unknown", typeTouched: false, cands: new Map(), note: "", filter: "", blobUrl: "", readable: null };
  const VIEWS = [["un", "לא משויכים כלל"], ["sug", "עם הצעת שיוך נוספת"], ["other", "מסמכים אחרים"]];
  const ALLV = ["un", "sug", "review", "ext", "gone", "other"];
  const sugOf = d => { try { return JSON.parse(d.suggest || "[]"); } catch { return []; } };
  const isUnassigned = d => !(d.business_ids || []).length && !(d.ext_ids || []).length;
  const missingMarked = d => /חסר במאגר:/.test(d.note || "");      // סימון ישן: "חסר במאגר" בהערה (לפני רשימת החברות שאינן במאגר)
  const isOther = d => d.doc_type === "other";          // "מסמכים אחרים" = רק מה שסומן "לא קשור" (סימון ישן בהערה "חסר במאגר" כבר לא משפיע)
  function reviewReasons(d) {          // למה מסמך משויך עדיין צריך בדיקה ידנית
    const out = [];
    if (d.doc_type === "unknown") out.push("ללא סיווג");
    for (const bid of d.business_ids || []) {
      const b = bizById(bid); if (!b || docStatus(b) !== "review") continue;
      const need = needOf(b);
      const cover = ["general", "private"].filter(t => need[t] && (d.doc_type === t || d.doc_type === "both") && !slotDoc(bid, t));
      if (!slotsOf(d, bid).length && cover.length) out.push(`מועמד להת"ע ${cover.map(t => SLOT_HE[t]).join("/")} של ${bizName(bid)}`);
    }
    return out;
  }
  const inView = (d, v) => {
    if (v === "other") return isOther(d);
    if (isOther(d)) return false;
    if (v === "un") return isUnassigned(d);
    if (v === "ext" || v === "gone") return !(d.business_ids || []).length && (d.ext_ids || []).some(id => { const x = extById(id); return x && extGroup(x) === (v === "gone" ? "gone" : "nodb"); });
    if (v === "review") return (d.business_ids || []).length > 0 && reviewReasons(d).length > 0;
    if (v === "sug") return !isUnassigned(d) && (intelOf(d).s || []).some(x => !(d.business_ids || []).includes(x.b) && (x.s >= 3.5 || (intelOf(d).m || []).includes(x.b)) && bizById(x.b));
    return false;
  };
  const isApproved = k => !!(S.rev && S.rev.get(k) && S.rev.get(k).status === "approved");          // רק "אושר" מוציא פריט מהרשימות
  const unassignedCount = () => S.docs.filter(d => inView(d, "un")).length;
  // מקור המסמכים בחלון הלא משויכים: הכל / רק מסמכים מהפוסטים באתר הישן / רק מסמכים נוספים (שלא היו בפוסט)
  const SRC = [["all", "כל המסמכים"], ["post", "רק מפוסטים באתר הישן"], ["extra", "רק מסמכים נוספים"]];
  let srcMode = "all"; try { srcMode = localStorage.getItem("pd_src") || "all"; } catch { /* בלי אחסון */ }
  const fromPost = d => ["g", "p", "gp"].includes(intelOf(d).o);
  const srcOk = d => srcMode === "all" || (srcMode === "post" ? fromPost(d) : !fromPost(d));
  const viewCounts = () => { const c = {}; for (const v of ALLV) c[v] = 0; for (const d of S.docs) for (const v of ALLV) if (inView(d, v) && (v === "review" || srcOk(d))) c[v]++; return c; };
  function docHay(d) {        // טקסט לסינון: שם קובץ, כותרת, הערה, ושמות / ח.פ. של החברות המשויכות (גם שאינן במאגר)
    if (d._hay && d._hayN === S.docs.length + ":" + S.ext.length) return d._hay;
    const cos = (d.business_ids || []).map(bizById).filter(Boolean).flatMap(b => [displayName(b), b.chp_number, b.registrar_name, b.permit_name]);
    const exts = (d.ext_ids || []).map(extById).filter(Boolean).flatMap(x => [x.name, x.chp]);
    d._hayN = S.docs.length + ":" + S.ext.length;
    return (d._hay = [d.original_name, d.source_title, d.note, ...cos, ...exts].map(x => String(x || "").toLowerCase()).join(" | "));
  }
  function unassignedList() {
    const f = Q.filter.trim().toLowerCase();
    const l = S.docs.filter(d => (inView(d, Q.view) || (d.id === Q.curId && !isOther(d))) && (!Q.batch || d.source_ref === Q.batch) && srcOk(d) && !Q.skipped.has(d.id) && !Q.busy.has(d.id) && !isApproved("doc:" + d.id) &&
        (!f || docHay(d).includes(f)));
    if (Q.view === "review") return l.sort((a, b) => String(bizName((a.business_ids || [])[0])).localeCompare(String(bizName((b.business_ids || [])[0])), "he") || String(a.original_name || "").localeCompare(String(b.original_name || ""), "he") || String(a.id).localeCompare(String(b.id)));      // מסמכים של אותה חברה צמודים; סדר יציב
    return l.sort((a, b) => sugOf(b).length - sugOf(a).length || String(a.source_title || a.original_name).localeCompare(String(b.source_title || b.original_name), "he"));
  }
  const posKey = v => "pd_pos_" + v;          // המקום האחרון בכל לשונית: המשך מאותו מסמך בפתיחה הבאה
  const readPos = v => { try { return JSON.parse(localStorage.getItem(posKey(v)) || "null"); } catch { return null; } };
  const savePos = (v, id, i) => { try { localStorage.setItem(posKey(v), JSON.stringify({ id, i })); } catch { /* בלי אחסון */ } };
  // שלוש הבחירות הראשיות של "בדיקת מאגר המסמכים" (משותפות לחלון לפי מסמכים ולחלון לפי חברות)
  function topTabs() { return ""; }          // הלשוניות הישנות של "בדיקת מאגר המסמכים" הוסרו (הוחלפו בדשבורד "ניהול שטרות היתר עיסקא")
  function topGo(t) {
    for (const id of ["pd-un", "pd-cd"]) if ($(id)) close(id);
    if (t === "un") openUnassigned("un"); else openCompanyDash(t);
  }
  function openUnassigned(view, batch) {
    Q.batch = batch || ""; Q.view = view || "un"; Q.resume = readPos(Q.view); Q.i = 0; Q.curId = ""; Q.filter = ""; Q.shared = false; Q.skipped = new Set(); Q.replace = null;      // דילוג תקף רק לפתיחה הזו של החלון
    overlay("pd-un", `<div class="pd-rv"><div class="pd-viewcol">
        <div class="pd-toolbar">
          <div class="pd-tbrow"><div class="pd-tabs" id="pd-un-tabs"></div><span style="flex:1"></span>
            <button class="pd-btn" onclick="PD._home()" title="סגירת החלונות וחזרה לדף הראשי של הניהול">🏠 ראשי</button><button class="pd-x" onclick="PD._close('pd-un')">✕</button></div>
          <div class="pd-tbrow"><div class="pd-nav"><button class="pd-btn" onclick="PD._unGo(-1)" title="המסמך הקודם">→ הקודם</button><span class="pd-navpos" id="pd-un-pos"></span><button class="pd-btn" onclick="PD._unGo(1)" title="המסמך הבא">הבא ←</button><button class="pd-btn" onclick="PD._unSkip()" title="מסתיר את המסמך עד לפתיחה הבאה של החלון">דילוג</button></div>
            <span class="pd-btns" id="pd-un-src" title="איזה מסמכים להציג">${SRC.map(([k, l]) => `<button class="pd-mini ${srcMode === k ? "sel" : ""}" onclick="PD._unSrc('${k}')">${l}</button>`).join("")}</span>
            <input class="pd-in" style="flex:1;min-width:180px" placeholder="חיפוש / סינון המסמכים: שם קובץ, חברה, ח.פ., הערה" oninput="PD._unFilter(this.value)" autocomplete="off">
            <span class="pd-sub"><span id="pd-un-count"></span><span id="pd-un-skipped"></span></span>
            <span id="pd-un-undo"></span><button class="pd-link2" onclick="PD._recent()">שיוכים אחרונים</button><button class="pd-link2" onclick="PD._openExt('nodb')">חברות שאינן במאגר (<span id="pd-un-extn">${extCount("nodb")}</span>)</button><button class="pd-link2" onclick="PD._openExt('gone')">חברות מחוקות (<span id="pd-un-gonen">${extCount("gone")}</span>)</button></div>
        </div>
        <div class="pd-view" id="pd-un-view"></div>
        <div class="pd-viewfoot" id="pd-un-foot"></div></div>
      <div class="pd-sidecol"><div class="pd-side" id="pd-un-side"></div></div></div>`, "full");
    closers["pd-un"] = () => { if (Q.blobUrl) URL.revokeObjectURL(Q.blobUrl); Q.blobUrl = ""; Q.curId = ""; if (typeof render === "function" && typeof view !== "undefined" && view === "home") render(); };
    if (!S.loaded) load().then(uqShow); else uqShow();
    undoRefresh();
  }
  function marks(b, d) {            // סימון איזה מסמכים כבר מסומנים לחברה: הת"ע פרטי / הת"ע כללי / מסמכים נוספים
    const need = needOf(b), ex = extrasOf(b.id);
    const one = t => {
      const doc = slotDoc(b.id, t), label = `הת"ע ${SLOT_HE[t]}`;
      if (!doc) return need[t] ? `<span class="pd-mk miss">${label}: חסר</span>` : `<span class="pd-mk off">${label}: לא נדרש</span>`;
      const me = d && doc.id === d.id;
      return `<span class="pd-mk ${t}${me ? " me" : ""}" title="${E(doc.original_name || "")}">${label}: ${me ? "המסמך הזה" : "קיים"}</span>`;
    };
    return `<div class="pd-marks">${one("private")}${one("general")}<span class="pd-mk ex" title="${E(ex.map(x => x.original_name).join(", "))}">נוספים: ${ex.length}${d && ex.some(x => x.id === d.id) ? " (כולל זה)" : ""}</span></div>`;
  }
  function uqMergeCands(d, live) {
    const m = new Map();
    const put = (id, score, why) => { const b = bizById(id); if (!b) return; const c = m.get(id) || { b, score: 0, why: [] }; c.score = Math.max(c.score, score) + (c.score ? 0.2 : 0); for (const w of [].concat(why || [])) if (!c.why.includes(w)) c.why.push(w); m.set(id, c); };
    for (const x of sugOf(d)) put(x.id, x.s || 1, x.w);
    for (const c of live || []) put(c.b.id, c.score, c.why);
    return [...m.values()].sort((a, b) => b.score - a.score);
  }
  async function uqShow(keepSel) {
    const list = unassignedList(), cnt = $("pd-un-count"); if (!$("pd-un")) return;
    const vc = viewCounts(), tabs = $("pd-un-tabs");
    if (tabs) tabs.innerHTML = VIEWS.map(([v, l]) => `<button class="pd-tab sub ${Q.view === v ? "sel" : ""}" onclick="PD._unView('${v}')">${l} <span class="pd-tabn">${vc[v]}</span></button>`).join("");
    const xn = $("pd-un-extn"); if (xn) xn.textContent = extCount("nodb");
    const gn = $("pd-un-gonen"); if (gn) gn.textContent = extCount("gone");
    if (cnt) cnt.innerHTML = `${list.length} מסמכים בתצוגה` + (Q.batch ? ` · <b>רק הקבצים שהועלו עכשיו</b> <button class="pd-link" style="color:#1a3a5c" onclick="PD._unBatchOff()">הצג את כל הלא משויכים</button>` : "");
    const pos = $("pd-un-pos"); if (pos) pos.textContent = list.length ? `${Math.min(Q.i, list.length - 1) + 1} / ${list.length}` : "0 / 0";
    const sk = $("pd-un-skipped"); if (sk) sk.innerHTML = Q.skipped.size ? ` · דולגו ${Q.skipped.size} <button class="pd-link" style="color:#1a3a5c" onclick="PD._unUnskip()">הצג אותם שוב</button>` : "";
    if (Q.resume) { const k = list.findIndex(x => x.id === Q.resume.id); Q.i = k >= 0 ? k : Math.min(Q.resume.i || 0, Math.max(0, list.length - 1)); Q.resume = null; }
    if (Q.i >= list.length) Q.i = Math.max(0, list.length - 1);
    const d = list[Q.i], side = $("pd-un-side"), view = $("pd-un-view");
    if (!d) {
      side.innerHTML = Q.skipped.size ? `<div class="pd-empty" style="color:#1e7e4a">אין עוד מסמכים בתור (דולגו ${Q.skipped.size}).<br><button class="pd-btn" style="margin-top:10px" onclick="PD._unUnskip()">הצג את מה שדולג</button></div>`
        : `<div class="pd-empty" style="color:#1e7e4a">${{ un: "אין מסמכים לא משויכים 🎉", review: "אין מסמכים לבדיקה ידנית 🎉", ext: "אין מסמכים ששויכו לחברות שאינן במאגר", gone: "אין מסמכים ששויכו לחברות מחוקות", other: "אין מסמכים אחרים" }[Q.view]}</div>`;
      view.innerHTML = ""; Q.curId = ""; const ft = $("pd-un-foot"); if (ft) ft.innerHTML = ""; return;
    }
    if (!Q.filter.trim()) savePos(Q.view, d.id, Q.i);
    if (Q.curId !== d.id) {
      Q.curId = d.id; Q.sel = new Set(); Q.typeTouched = false; Q.typeWhy = ""; Q.note = d.note || ""; Q.type = d.doc_type === "other" ? "unknown" : d.doc_type; Q.shared = false; Q.picker = isUnassigned(d) ? "add" : null; Q.replace = null; Q.bondPicker = false; Q.bondQ = "";
      Q.cands = uqMergeCands(d); Q.liveDone = false; Q.bondSug = [];
      const tok = ++Q.token;
      view.innerHTML = `<div class="pd-empty" style="color:#fff">טוען מסמך… <span id="pd-un-sec"></span></div>`;
      { const t0 = Date.now(), iv = setInterval(() => { const el = $("pd-un-sec"); if (!el || tok !== Q.token) return clearInterval(iv); el.textContent = Math.round((Date.now() - t0) / 1000) + " שנ'"; }, 500); }
      if (Q.blobUrl) { URL.revokeObjectURL(Q.blobUrl); Q.blobUrl = ""; }
      (async () => {
        try {
          const blob = await fetchPdfBlob(d.id); if (tok !== Q.token) return;
          Q.blobUrl = URL.createObjectURL(blob); view.innerHTML = `<iframe src="${Q.blobUrl}#toolbar=0&navpanes=0&view=FitH" title="המסמך"></iframe>`;
          if (!d.pages) blob.arrayBuffer().then(buf => pdfDoc(buf)).then(pdf => ensureMeta(d.id, pdf)).catch(() => {});
          unassignedList().slice(Q.i + 1, Q.i + 3).forEach(x => fetchPdfBlob(x.id).catch(() => {}));      // טעינה מראש של שני המסמכים הבאים
          try {           // הצעות נוספות מהטקסט של הקובץ עצמו (אם יש בו טקסט); קבצים סרוקים מסתמכים על ההצעות השמורות
            const r = await extractText(await blob.arrayBuffer(), 6); if (tok !== Q.token) return;
            const sug = suggest(r.text, d.original_name);
            CD.live[d.id] = { xo: sug.outside || [], cands: [] };
            Q.cands = uqMergeCands(d, sug.cands); Q.liveDone = true;
            try { Q.bondSug = await findBonds(r.text); if (tok !== Q.token) return; } catch { Q.bondSug = []; }
            if (!Q.typeTouched && (d.doc_type === "unknown") && sug.type !== "unknown") Q.type = sug.type === "personal" ? "unknown" : sug.type, Q.typeWhy = sug.typeWhy;
            uqShow(true);
          } catch { /* אין טקסט או שגיאת קריאה */ }
        } catch (e) { if (tok === Q.token) view.innerHTML = `<div class="pd-empty" style="color:#fff">${E(e.message)}</div>`; }
      })();
    }
    const keepIn = document.activeElement && document.activeElement.id === "pd-un-q" ? document.getElementById("pd-un-q").value : null;
    const reasons = inView(d, "review") ? reviewReasons(d) : (d.doc_type === "unknown" ? ["ללא סיווג"] : []);
    const curCos = (d.business_ids || []).map(id => bizById(id)).filter(Boolean);
    const nAsg = curCos.length + (d.ext_ids || []).length;
    const nb = (d.bonds || []).length;
    const statusBar = (nAsg ? `<div class="pd-asg ok">✓ משויך ל-${nAsg} ${nAsg > 1 ? "חברות" : "חברה"}${nb ? ` · ${nb} אג"ח` : ""}</div>` : `<div class="pd-asg no">✗ לא משויך לאף חברה${nb ? ` · ${nb} אג"ח` : ""}</div>`);
    const assigned = curCos.map(b => ucard(b, d, { assigned: true })).join("") + (d.ext_ids || []).map(id => xcard(id)).join("") + (d.bonds || []).map(x => bcard(x, d)).join("");
    const replName = Q.replace ? (Q.replace.kind === "biz" ? bizName(Q.replace.id) : extName(Q.replace.id)) : "";
    const sugg = Q.cands.filter(c => !(d.business_ids || []).includes(c.b.id)).slice(0, 8);
    const typeBtns = ["general", "both", "private"].map(t => `<button class="pd-btn ${d.doc_type === t ? "sel" : ""}" onclick="PD._unSetType('${t}')" title="${{ general: "היתר כללי בלבד", both: "היתר פרטי (מכסה גם את הרשימה הכללית)", private: "היתר פרטי בלבד" }[t]}">${TL[t]}</button>`).join("");
    side.innerHTML = `
      <div style="font-weight:600;font-size:14px;word-break:break-all">${E(d.source_title || d.original_name || d.id)}</div>
      <div class="pd-sub">${E(d.original_name || "")} · ${sizeHtml(d.size)} · ${metaHtml(d)}</div>
      ${!nAsg && ["g", "p", "gp"].includes(intelOf(d).o) ? `<div class="pd-warnbox">❓ <b>כותרת הפוסט אינה מזוהה במאגר</b>: לאיזו חברה שייך הפוסט "${E(postTitle(d))}" (${E(ORIG_HE[intelOf(d).o] || "")})?</div>` : ""}
      ${reasons.length ? `<div class="pd-warnbox">${reasons.map(E).join("<br>")}</div>` : ""}
      ${d.note ? `<div class="pd-warnbox">${E(d.note)}</div>` : ""}
      <div style="margin-top:8px"><span class="pd-sub">סיווג המסמך:</span><div class="pd-btns" style="margin-top:3px">${typeBtns}</div>
        ${d.doc_type === "unknown" && Q.type !== "unknown" ? `<div class="pd-sub" style="margin-top:3px">הצעה: ${TL[Q.type]}${Q.typeWhy ? " (" + E(Q.typeWhy) + ")" : ""} <button class="pd-link2" onclick="PD._unSetType('${Q.type}')">אימוץ ההצעה</button></div>` : ""}</div>
      ${Q.view === "un" && legacyDocs().length ? `<button class="pd-btn" style="margin-top:8px" onclick="PD._legacy()" title="ממיר את הסימון הישן בהערה לשיוך לחברה ברשימת החברות שאינן במאגר">המרת ${legacyDocs().length} סימוני "חסר במאגר" ישנים</button>` : ""}
      ${statusBar}
      ${assigned ? `<div class="pd-ucs">${assigned}</div>` : ""}
      ${(Q.pend[d.id] || []).length ? `<div class="pd-sub" style="margin-top:8px"><b>ממתינים לאישור (לא נשמרו עדיין):</b></div><div class="pd-ucs">${(Q.pend[d.id] || []).map((op, i) => `<div class="pd-uc" style="border-style:dashed;background:#fffbea"><div class="pd-uc-top" style="cursor:default"><b>${E(opLabel(op))}</b></div><div class="pd-uc-act"><button class="pd-link2" style="color:#c0392b" onclick="PD._unUnstage(${i})">ביטול</button></div></div>`).join("")}</div>` : ""}
      <h4 style="margin-top:14px">${Q.replace ? `שינוי שיוך: בחרו חברה במקום "${E(replName)}" <button class="pd-link2" onclick="PD._unPicker('')">ביטול</button>` : nAsg ? "הוספת שיוך נוסף" : "שיוך לחברה"}</h4>
      <input class="pd-in" id="pd-un-q" placeholder="חיפוש לפי ח.פ. או שם חברה" oninput="PD._unSearch(this.value)" autocomplete="off"><div id="pd-un-res"></div>
      ${sugg.length ? `<div class="pd-sub" style="margin-top:8px">הצעות לפי סריקת המסמך:</div><div class="pd-ucs">${sugg.map(c => ucard(c.b, d, { why: c.why })).join("")}</div>` : `<div class="pd-sub" style="margin-top:8px">לא נמצאו הצעות לפי תוכן המסמך: חפשו ידנית.</div>`}
      ${!nAsg && ["g", "p", "gp"].includes(intelOf(d).o) ? `<h4>חברות שאינן במאגר</h4>${postExtHtml(d)}` : ""}
      ${bondSugHtml(Q.bondSug || [], new Set((d.bonds || []).map(x => x.id)), id => `<button class="pd-mini link" onclick="PD._mgBondAdd('${d.id}','${E(id)}')">שיוך לאג&quot;ח</button>`)}
      <details style="margin-top:8px"><summary class="pd-sub" style="cursor:pointer">חברה שאינה במאגר: הוספה ידנית (בלי חיפוש ברשם)</summary>
        <div style="display:flex;gap:6px;margin-top:5px"><input class="pd-in" id="pd-ext-name" placeholder="שם החברה"><input class="pd-in" id="pd-ext-chp" placeholder="ח.פ." style="max-width:120px"></div>
        <div class="pd-btns" style="margin-top:5px"><button class="pd-btn primary" onclick="PD._unExtAdd('not_in_db')" title="הסטטוס (מחוקה / מוזגה / אינה במאגר) אפשר לשנות ברשימת החברות שאינן במאגר">שיוך</button></div></details>
      <details style="margin-top:6px" ${Q.note ? "open" : ""}><summary class="pd-sub" style="cursor:pointer">הערה</summary><textarea class="pd-in" rows="2" onchange="PD._unNote(this.value)">${E(Q.note)}</textarea></details>
      <div id="pd-un-err" style="color:#c0392b;margin-top:6px"></div>
      ${uqBar(d)}`;
    const foot = $("pd-un-foot");
    if (foot) foot.innerHTML = `<button class="pd-btn danger" onclick="PD._askDelete('${d.id}')">🗑 מחיקת המסמך</button>${isOther(d) ? `<button class="pd-btn" onclick="PD._unRestore()" title="המסמך חוזר ללשונית 'לא משויכים'">סימון מסמך כהיתר עסקה</button>` : `<button class="pd-btn" onclick="PD._unOtherDoc()" title="עובר ללשונית 'מסמכים אחרים'">סימון: מסמך שאינו היתר עסקה</button>`}`;
    if (keepIn !== null) { const q = $("pd-un-q"); q.value = keepIn; q.focus(); }
  }
  function cfeat(b, d) {          // פיצ'ר מסמכים ראשיים: כמה מהנדרשים קשורים (למשל 1/2), והאם המסמך הזה אחד מהם
    const need = needOf(b), req = ["private", "general"].filter(t => need[t]);
    const have = req.filter(t => slotDoc(b.id, t)), me = ["private", "general"].some(t => { const x = slotDoc(b.id, t); return x && d && x.id === d.id; });
    return { have: have.length, total: req.length, me, ex: extrasOf(b.id).length, names: ["private", "general"].map(t => { const x = slotDoc(b.id, t); return `הת"ע ${SLOT_HE[t]}: ${x ? x.original_name : "—"}`; }).join(" | ") };
  }
  function ucard(b, d, o) {          // כרטיסית חברה קטנה: שם, ח.פ., כללי/פרטי, ראשיים 1/2, נוספים; מתחת: כפתורי שיוך
    o = o || {};
    const f = cfeat(b, d), need = needOf(b), reg = b.visibility === "רק פרטי" ? "רק פרטי" : b.visibility === "פרטי" ? "פרטי" : "כללי";
    const act = o.assigned ? `<div class="pd-uc-act"><span class="pd-sub">שיוך:</span><button class="pd-link2" onclick="PD._unPicker('change','biz','${b.id}')">שינוי</button><button class="pd-link2" style="color:#c0392b" onclick="PD._unDetach('${b.id}')">ביטול</button></div>`
      : `<div class="pd-uc-act"><button class="pd-mini" onclick="PD._unAct('${b.id}','only')">שיוך בלבד</button>${need.private ? `<button class="pd-mini link" onclick="PD._unAct('${b.id}','private')">הת"ע פרטי</button>` : ""}${need.general ? `<button class="pd-mini link" onclick="PD._unAct('${b.id}','general')">הת"ע כללי</button>` : ""}</div>`;
    return `<div class="pd-uc ${f.me ? "is-main" : ""}"><div class="pd-uc-top" onclick="PD.openManage('${b.id}')" title="ניהול מסמכי החברה">
        <b>${displayName(b)}</b><div class="pd-sub">${b.chp_number ? chpLbl(b.chp_number, b.biz_type) + " " + E(b.chp_number) + " · " : ""}${reg}${stTag(b.registry_status)}</div>
        <div class="pd-ucf"><span class="pd-feat ${f.have === f.total ? "full" : "part"}${f.me ? " glow" : ""}" title="${E(f.names)}${f.me ? " | המסמך הזה הוא אחד מהמסמכים הראשיים של החברה" : ""}">ראשיים ${f.have}/${f.total}</span><span class="pd-feat ex" title="מסמכים נוספים של החברה">נוספים ${f.ex}</span></div>
        ${o.why && o.why.length ? `<div class="pd-sub" style="font-size:10.5px">${E(o.why.slice(0, 2).join(", "))}</div>` : ""}</div>${act}</div>`;
  }
  let bondRows = null;
  async function bondList() {
    if (bondRows) return bondRows;
    try { const j = await (await fetch("/data/bonds_list/bonds_all.json")).json(); bondRows = (j.rows || []).map(r => ({ id: String(r.security_id), name: r.security_name || "", symbol: r.symbol || "", company: r.company || r.issuer_name || "", chp: String(r.chp_number || "") })); }
    catch { bondRows = []; }
    return bondRows;
  }
  // תפקיד מסמך לאג"ח (כמו הת"ע של חברה): private / general / שניהם (משותף); ריק = טרם סווג. לכל אג"ח מסמך אחד לכל תפקיד
  const bRoles = v => String(v || "").split(",").filter(x => x === "private" || x === "general").sort();
  const bLink = (d, sid) => (d.bonds || []).find(x => x.id === sid);
  const bondOwners = (sid, except, role) => S.docs.filter(d => d.id !== except && bLink(d, sid) && (!role || bRoles(bLink(d, sid).slot).includes(role)));
  let bondScope = null;          // נייר -> { private, general }: באיזו רשימה האג"ח מאושרת (מקבצי רשימות האג"ח)
  async function bondScopes() {
    if (bondScope) return bondScope;
    const m = new Map();
    for (const t of ["private", "general"]) { try { for (const r of ((await (await fetch(`/data/bonds_list/bonds_${t}.json`)).json()).rows || [])) { const k = String(r.security_id); m.set(k, { ...(m.get(k) || {}), [t]: true }); } } catch { /* בלי רשימה */ } }
    return (bondScope = m);
  }
  function bcard(x, d) {
    const own = (d.business_ids || []).map(bizById).filter(Boolean).some(b => digitsOf(b.chp_number) && digitsOf(b.chp_number) === digitsOf(x.chp));
    return `<div class="pd-uc bond"><div class="pd-uc-top" style="cursor:default"><b>${E(x.name || x.id)}</b><div class="pd-sub">${E(bondLabel(x))} · נייר ${E(x.id)}</div><div class="pd-sub">${E(x.company)}${x.chp && !own ? ' <span class="pd-st bad">החברה לא משויכת למסמך</span>' : ""}</div></div>
      <div class="pd-uc-act"><span class="pd-sub">שיוך:</span><button class="pd-link2" style="color:#c0392b" onclick="PD._unBondDel('${E(x.id)}')">ביטול</button></div></div>`;
  }
  // ───────── שיוך מסמך לאג"ח, מתוך חלון ניהול מסמכי החברה ─────────
  function mgBond(docId) { M.bond = M.bond === docId ? "" : docId; M.bondQ = ""; M.menu = ""; paintMg(); }
  async function mgBondSearch(docId, q, keep) {
    if (!keep) M.bondQ = String(q || "");
    const out = $("pd-mgbr-" + docId); if (!out) return;
    const d = S.byId.get(docId), b = bizById(M.biz); if (!d || !b) return;
    const rows = await bondList(), have = new Set((d.bonds || []).map(x => x.id)), qq = String(q || "").trim().toLowerCase();
    const own = r => digitsOf(r.chp) && digitsOf(r.chp) === digitsOf(b.chp_number);
    let list = rows.filter(r => !have.has(r.id));
    list = qq ? list.filter(r => [r.name, r.symbol, r.id, r.company].some(v => String(v).toLowerCase().includes(qq))) : list.filter(own);
    list.sort((x, y) => (own(y) ? 1 : 0) - (own(x) ? 1 : 0) || String(x.name).localeCompare(String(y.name), "he"));
    out.innerHTML = list.slice(0, 40).map(r => { const tk = bondOwners(r.id, docId).length;
      return `<button class="pd-pick" onclick="PD._mgBondAdd('${docId}','${E(r.id)}')">${E(r.name)} <span class="pd-sub">${E(bondLabel(r))}${own(r) ? "" : " · " + E(r.company)}</span>${own(r) ? ' <span class="pd-tag">של החברה</span>' : ""}${tk ? ' <span class="pd-tag">יש לה כבר מסמך</span>' : ""}</button>`; }).join("")
      || `<div class="pd-sub" style="padding:5px">${qq ? "לא נמצאו אג\"ח" : "אין אג\"ח רשומות לחברה הזו. הקלידו לחיפוש בכל האג\"ח."}</div>`;
  }
  async function mgBondAdd(docId, id, role) {          // שיוך מסמך לאג"ח; role (private / general / both) = גם קביעת התפקיד
    const d = S.byId.get(docId); if (!d) return;
    const cur = bLink(d, id);
    if (cur && !role) return;
    const r = cur || (await bondList()).find(x => x.id === id); if (!r) return;
    const want = role === "both" ? ["general", "private"] : role ? [...new Set([...bRoles(cur && cur.slot), role])].sort() : bRoles(cur && cur.slot);
    return mgBondSet(docId, r, want.join(","));
  }
  async function mgBondSet(docId, r, slot) {          // קביעת תפקיד המסמך לאג"ח (בדיקה: תפקיד חדש שתפוס אצל מסמך אחר - נחסם)
    const d = S.byId.get(docId); if (!d) return;
    const cur = bLink(d, r.id), was = bRoles(cur && cur.slot);
    for (const t of bRoles(slot)) {
      if (was.includes(t)) continue;
      const tk = bondOwners(r.id, docId, t);
      if (tk.length) { alert(`ל${bondLabel(r)} (${r.name}) כבר משויך מסמך ${SLOT_HE[t]}: "${tk[0].original_name || tk[0].id}".\nלכל אג"ח מסמך אחד לכל רשימה - יש לבטל קודם את השיוך הקיים.`); return; }
    }
    const next = cur ? d.bonds.map(x => x.id === r.id ? { ...x, slot } : x) : [...(d.bonds || []), { id: r.id, name: r.name, symbol: r.symbol, company: r.company, chp: r.chp, slot }];
    try { const before = snapDoc(d); const nd = (await api("/permit-docs/" + docId, "PUT", { bonds: next })).doc; replaceDoc(nd); pushHist(before, (cur ? "עודכן שיוך לאג\"ח " : "שויך לאג\"ח ") + r.name);
      const got = nd && bLink(nd, r.id); if (got && bRoles(got.slot).join(",") !== bRoles(slot).join(",")) alert("השיוך נשמר, אבל הסימון פרטי / כללי לא נשמר בשרת (חסרה מיגרציה 0018 ב-D1?)"); }
    catch (e) { alert("שיוך האג\"ח נכשל: " + e.message + (/no such table/.test(e.message) ? " (חסרה מיגרציה 0009 ב-D1)" : "")); return; }
    paintMg();
  }
  async function mgBondDel(docId, id) {
    const d = S.byId.get(docId); if (!d) return;
    try { const before = snapDoc(d); replaceDoc((await api("/permit-docs/" + docId, "PUT", { bonds: (d.bonds || []).filter(x => x.id !== id) })).doc); pushHist(before, "בוטל שיוך לאג\"ח"); }
    catch (e) { alert("הפעולה נכשלה: " + e.message); return; }
    paintMg();
  }
  async function bondDel(id) {
    const d = unassignedList()[Q.i]; if (!d) return;
    try { const before = snapDoc(d); const res = await api("/permit-docs/" + d.id, "PUT", { bonds: (d.bonds || []).filter(x => x.id !== id) }); replaceDoc(res.doc); pushHist(before, "בוטל שיוך לאג\"ח"); }
    catch (e) { alert("הפעולה נכשלה: " + e.message); return; }
    uqShow();
  }
  function xcard(id) {
    const x = extById(id);
    return `<div class="pd-uc ext"><div class="pd-uc-top"><b>${E(extName(id))}</b><div class="pd-sub">${x && x.chp ? chpLbl(x.chp) + " " + E(x.chp) + " · " : ""}חברה שאינה במאגר <span class="pd-st bad">${x ? EXT_HE[x.status] : ""}</span></div></div>
      <div class="pd-uc-act"><span class="pd-sub">שיוך:</span><button class="pd-link2" onclick="PD._unPicker('change','ext','${id}')">שינוי</button><button class="pd-link2" style="color:#c0392b" onclick="PD._unExtDetach('${id}')">ביטול</button></div></div>`;
  }
  const C = { docId: "", bizId: "", t: "" };
  async function uqAct(bizId, act) { const d = unassignedList()[Q.i]; if (d) uqStage({ t: "act", docId: d.id, bid: bizId, act }); }
  // בחלון הלא משויכים: שיוכים מצטברים ונקלטים רק ב"אישור"; אפשר לשייך לכמה חברות.
  Q.pend = {};
  function uqStage(op) {
    const l = Q.pend[op.docId] || (Q.pend[op.docId] = []);
    if (!l.some(x => x.t === op.t && x.bid === op.bid && x.act === op.act && x.hp === op.hp && x.extId === op.extId && x.name === op.name)) l.push(op);
    const q = ($("pd-un-q") || {}).value || "";
    uqShow(true);
    if (q) setTimeout(() => { const el = $("pd-un-q"); if (el) { el.value = q; uqSearch(q); } }, 60);      // תוצאות החיפוש נשארות, כדי שאפשר לבחור עוד חברה
  }
  function uqBar(d) {
    const l = Q.pend[d.id] || [];
    return `<div class="pd-cdbar">${l.length ? `<div class="pd-sub" style="width:100%"><b>${l.length} שיוכים ממתינים לאישור</b> (מוצגים למעלה)</div>` : `<div class="pd-sub" style="width:100%">בחרו שיוך אחד או יותר (אפשר לכמה חברות), ואז אישור.</div>`}
      <button class="pd-btn primary" onclick="PD._unOk()" title="מבצע את השיוכים שנבחרו ועובר למסמך הבא">✔ אישור${l.length ? " (" + l.length + ")" : ""}</button></div>`;
  }
  async function uqOk() {          // האישור רץ ברקע: עוברים מיד למסמך הבא, והשיוכים נשלחים לאתר בתור
    const d = S.byId.get(Q.curId); if (!d) return;
    const ops = Q.pend[d.id] || [];
    if (!ops.length && isUnassigned(d)) { const el = $("pd-un-err"); if (el) el.textContent = "בחרו שיוך לפני אישור, או השתמשו ב'דילוג'."; return; }
    delete Q.pend[d.id]; Q.busy.add(d.id); Q.curId = ""; uqShow();
    Q.chain = (Q.chain || Promise.resolve()).then(async () => {
      try {
        for (const op of ops) {
          if (op.t === "act") await actFor(op.docId, op.bid, op.act);
          else if (op.t === "ext") await postExtApply(op.docId, op.hp, op.extId);
          else if (op.t === "extnew") { const c = await extEnsure({ chp: op.chp, name: op.name, status: op.status }); await extAssign(op.docId, c.id); }
        }
        await setReview("doc:" + d.id, "approved"); CD.lastRev.push({ key: "doc:" + d.id, status: "approved" });
        Q.busy.delete(d.id); refresh(); if ($("pd-un")) uqShow(true);
      } catch (e) {
        Q.busy.delete(d.id); Q.pend[d.id] = ops;
        alert("האישור של " + (d.original_name || d.id) + " נכשל: " + e.message + (/no such table/i.test(e.message) ? "\nיש להריץ את מיגרציה 0012 ב-D1." : "") + "\nהמסמך חזר לתור עם השיוכים שבחרתם.");
        if ($("pd-un")) uqShow(true);
      }
    });
  }
  async function actFor(docId, bizId, act) {
    const d = S.byId.get(docId); if (!d) return;
    const t = act === "only" ? "" : act, cur = t ? slotDoc(bizId, t) : null;
    if (cur && cur.id !== d.id) {          // כבר קיים מסמך לחברה: חלון קופץ
      Object.assign(C, { docId: d.id, bizId, t });
      overlay("pd-confirm", `<div class="pd-head" style="background:#8a5a00;color:#fff"><b>כבר קיים מסמך להת"ע ${SLOT_HE[t]} של החברה</b></div>
        <div class="pd-body"><p><b>${displayName(bizById(bizId))}</b>: המסמך הקיים הוא <a href="#" onclick="PD.openDoc('${cur.id}');return false"><b>${E(cur.original_name || cur.id)}</b></a>.</p>
          <p class="pd-sub">בהחלפה המסמך הקיים לא נמחק: הוא נשאר בחברה תחת "מסמכים נוספים".</p>
          <div class="pd-btns" style="margin-top:12px"><button class="pd-btn primary" onclick="PD._cf('replace')">החלפת המסמך הקיים</button><button class="pd-btn" onclick="PD._cf('manage')">ניהול מסמכי החברה</button><button class="pd-btn" onclick="PD._close('pd-confirm')">ביטול</button></div></div>`);
      return;
    }
    await doLink(d.id, bizId, t);
  }
  function cfChoose(what) {
    close("pd-confirm");
    if (what === "replace") doLink(C.docId, C.bizId, C.t); else if (what === "manage") openManage(C.bizId);
  }
  async function doLink(docId, bizId, t) {
    const d = S.byId.get(docId), b = bizById(bizId); if (!d || !b) return;
    const before = snapDoc(d), others = [], cur = t ? slotDoc(bizId, t) : null;
    if (cur && cur.id !== d.id) others.push({ id: cur.id, bid: bizId, slot: slotsOf(cur, bizId) });
    const ids = [...new Set([...(d.business_ids || []), bizId])], slots = t ? [...new Set([...slotsOf(d, bizId), t])] : slotsOf(d, bizId);
    let type = d.doc_type;
    if (t === "private" && type !== "both" && type !== "private") type = "both";
    if (t === "general" && type !== "both" && type !== "general") type = type === "private" ? "both" : "general";
    try {
      const r = await api("/permit-docs/" + docId, "PUT", { business_ids: ids, doc_type: type, slots: { [bizId]: slots } });
      replaceDoc(r.doc); await refetchDocs(others.map(o => o.id));
      pushHist(before, (t ? `הת"ע ${SLOT_HE[t]} של ` : "שויך ל") + displayName(b), others);
      say(t ? `המסמך הוא עכשיו הת"ע ${SLOT_HE[t]} של ${displayName(b)}${others.length ? ". המסמך הקודם נשאר בחברה תחת מסמכים נוספים. לביטול: ↩" : ""}` : "המסמך שויך ל" + displayName(b));
      await uqApplyReplace(docId);
    } catch (e) { const el = $("pd-un-err"); if (el) el.textContent = "השיוך נכשל: " + e.message; return; }
    refresh(); if ($("pd-un")) uqAfter(); if ($("pd-cd")) cdShow();
  }
  function uqSearch(q) {
    const out = $("pd-un-res"); if (!out) return;
    const d0 = unassignedList()[Q.i];
    runCompanySearch(q, out, { exclude: x => (((unassignedList()[Q.i] || {}).business_ids) || []).includes(x), card: b => ucard(b, d0, {}), pick: id => uqAct(id, "only"), mark: uqMark, ext: uqExt, extpick: id => uqExtPick(id),
      mkAdded: () => { const id0 = d0 && d0.id; return async bid => { if (id0) await doLink(id0, bid, ""); openUnassigned(Q.view); }; } });
  }
  function uqPick(id, on) {         // לא משותף: בחירת חברה אחת ופתיחת חלון השיוך שלה; משותף: הוספה / הסרה מהרשימה
    if (!Q.shared) { Q.sel = new Set(on ? [id] : []); uqShow(); if (on) uqAssign(); return; }
    on ? Q.sel.add(id) : Q.sel.delete(id); uqShow();
  }
  function uqShared(on) {
    Q.shared = on;
    if (!on && Q.sel.size > 1) Q.sel = new Set([[...Q.sel][0]]);
    uqShow();
  }
  function uqAssign() {
    const d = unassignedList()[Q.i]; if (!d || !Q.sel.size) return;
    openAssign(d.id, [...Q.sel], Q.type, Q.typeTouched || d.doc_type !== "unknown", Q.replace);
  }

  // ───────── היסטוריית שיוכים וביטול ─────────
  const HK = "pd_hist";
  const histGet = () => { try { return JSON.parse(localStorage.getItem(HK) || "[]"); } catch { return []; } };
  const histSet = v => { try { localStorage.setItem(HK, JSON.stringify(v.slice(-40))); } catch { /* בלי אחסון */ } };
  const snapDoc = d => ({ specials: { ...(d.specials || {}) }, id: d.id, name: d.original_name || d.id, ext_ids: [...(d.ext_ids || [])], bonds: (d.bonds || []).map(x => ({ ...x })), business_ids: [...(d.business_ids || [])], slots: { ...(d.slots || {}) }, doc_type: d.doc_type, note: d.note || "" });
  function pushHist(before, what, others, sid) { const h = histGet(); h.push({ ...before, what, others: others || [], sid: sid || "", at: Date.now() }); histSet(h); undoRefresh(); }
  function lastRevItem(docKeys) {          // האישור / שאלת המנהל האחרונים: גם אחרי רענון הדף (לפי הזמן ששמור בשרת)
    let best = null; for (const x of (S.rev || new Map()).values()) { if (x.key.startsWith("doc:") !== !!docKeys) continue; if (!best || String(x.updated_at || "") > String(best.updated_at || "")) best = x; }
    return best;
  }
  function undoRefresh() {
    const e = histGet().slice(-1)[0];
    const html = e ? `<button class="pd-link2" onclick="PD._undo()" title="${E(e.name)}: ${E(e.what)}. מחזיר את המסמך למצב שלפני">↩ ביטול אחרון</button>` : "";
    for (const id of ["pd-un-undo", "pd-mg-undo"]) { const el = $(id); if (el) el.innerHTML = html; }
    const rv = lastRevItem(false), cu = $("pd-cd-undo"), rvd = lastRevItem(true);
    const un = $("pd-un-undo"); if (un) un.innerHTML = (rvd ? `<button class="pd-link2" onclick="PD._cdUnrev(true)" title="מחזיר את המסמך שאושר חזרה לרשימה">↩ ביטול אישור אחרון</button>` : "") + html;
    if (cu) cu.innerHTML = (rv ? `<button class="pd-link2" onclick="PD._cdUnrev()" title="מחזיר את הפריט שאושר חזרה לרשימה (שינויים שבוצעו במסמכים מתבטלים בכפתור ביטול אחרון)">↩ ביטול אישור אחרון</button>` : "") + html;
  }
  async function refetchDocs(ids) {       // מסמכים אחרים שהקישור שלהם לרשימה הוחלף בצד השרת: טוענים מחדש כדי שהתצוגה לא תישאר ישנה
    await Promise.all([...new Set(ids)].map(id => api("/permit-docs/" + id).then(r => replaceDoc(r.doc)).catch(() => {})));
  }
  const slotArrs = (map, ids) => Object.fromEntries(ids.map(b => [b, String((map || {})[b] || "").split(",").filter(Boolean)]));
  async function undoLast() {
    const h = histGet(), last = h[h.length - 1]; if (!last) return;
    let from = h.length - 1; while (last.sid && from > 0 && h[from - 1].sid === last.sid) from--;       // כל השיוכים של אותו מסמך משותף בחלון השיוך מתבטלים יחד
    const grp = h.slice(from), e = grp[0];
    if (!confirm(`לבטל את השיוך האחרון?\n${e.name}: ${grp.map(x => x.what).join(" ; ")}\nהמסמך יחזור למצב שלפני השיוך.`)) return;
    try {
      const r = await api("/permit-docs/" + e.id, "PUT", { business_ids: e.business_ids, doc_type: e.doc_type, note: e.note, slots: slotArrs(e.slots, e.business_ids), ...(e.ext_ids ? { ext_ids: e.ext_ids } : {}), ...(e.bonds ? { bonds: e.bonds } : {}), ...(e.specials ? { specials: { ...Object.fromEntries(Object.keys((S.byId.get(e.id) || {}).specials || {}).map(b => [b, ""])), ...e.specials } } : {}) });
      replaceDoc(r.doc);
      for (const g of grp.slice().reverse()) for (const o of g.others || []) { try { const r2 = await api("/permit-docs/" + o.id, "PUT", { slots: { [o.bid]: o.slot } }); replaceDoc(r2.doc); } catch { /* המסמך כבר לא קיים */ } }
    } catch (err) { alert("הביטול נכשל: " + err.message); return; }
    histSet(h.slice(0, from)); say("השיוך בוטל"); refresh();
    if ($("pd-un")) { Q.curId = ""; uqShow(); }
    undoRefresh();
  }
  function openRecent() {          // מסמכים ששויכו / עודכנו ב-48 השעות האחרונות: אפשר להחזיר לא משויך
    const since = Date.now() - 48 * 3600e3;
    const ts = d => Date.parse(String(d.updated_at || "").replace(" ", "T") + "Z") || 0;
    const rows = S.docs.filter(d => (d.business_ids || []).length && ts(d) > since).sort((a, b) => ts(b) - ts(a)).slice(0, 60);
    overlay("pd-recent", `<div class="pd-head"><b>שיוכים אחרונים (48 שעות)</b><button class="pd-btn" onclick="PD._home()" title="סגירת החלונות וחזרה לדף הראשי של הניהול">🏠 ראשי</button><button class="pd-x" onclick="PD._close('pd-recent')">✕</button></div>
      <div class="pd-body">${rows.map(d => `<div class="pd-row" style="cursor:default"><div class="pd-grow"><div class="pd-name">${E(d.original_name || d.id)} <span class="pd-chip" style="background:${TCOL[d.doc_type] || TCOL.unknown}">${TL[d.doc_type] || ""}</span></div>
        <div class="pd-sub">${E((d.business_ids || []).map(bizName).join(" · ").slice(0, 160))} · ${E(String(d.updated_at || "").slice(0, 16))}</div></div>
        <button class="pd-btn" onclick="PD._unassignAll('${d.id}')">החזרה ללא שיוך</button></div>`).join("") || `<div class="pd-sub">אין שיוכים ב-48 השעות האחרונות.</div>`}</div>`);
  }
  async function unassignAll(id) {
    const d = S.byId.get(id); if (!d) return;
    if (!confirm(`להחזיר את "${d.original_name || id}" למסמכים הלא משויכים? השיוך לכל החברות יוסר (המסמך עצמו נשמר).`)) return;
    try { const before = snapDoc(d); const r = await api("/permit-docs/" + id, "PUT", { business_ids: [] }); replaceDoc(r.doc); pushHist(before, "הוחזר ללא שיוך"); } catch (e) { alert("הפעולה נכשלה: " + e.message); return; }
    refresh(); openRecent(); if ($("pd-un")) { Q.curId = ""; uqShow(); }
  }


  // ───────── דשבורד לפי חברות: שיוכים קיימים לבדיקה / הצעות לשיוכים חדשים ─────────
  const FLAG_HE = { hp_missing: "ח.פ. החברה לא מופיע במסמך", hp_typo: "ח.פ. שנראה כטעות הקלדה של ח.פ. החברה", hp_bad: "ח.פ. עם ספרת ביקורת שגויה", name_differs: "שם הפוסט שונה משם החברה במסמך", status: "זיהוי החברה לא חד-משמעי",
    no_private_phrase: "בהיתר פרטי חסר משפט מפתח של נוסח פרטי", private_phrase_in_general: "בהיתר כללי יש משפט מפתח של נוסח פרטי", no_text: "אין טקסט קריא במסמך" };
  const ORIG_HE = { g: "מהאתר הישן: רשימת הכללי", p: "מהאתר הישן: רשימת הפרטי", gp: "מהאתר הישן: שתי הרשימות", x: "מסמך נוסף (לא היה באף מאגר)" };
  const intelOf = d => { if (d._in !== undefined && d._inSrc === d.intel) return d._in; let v = {}; try { v = JSON.parse(d.intel || "{}") || {}; } catch { v = {}; } d._in = v; d._inSrc = d.intel; return v; };
  const CD = { lastRev: [], after: [], live: {}, mode: "review", i: 0, filter: "", skipped: new Set(), curBiz: "", selDoc: "", token: 0, blobUrl: "", shownDoc: "" };
  function sugFor(bid) {          // מסמכים שמוצעים לחברה (לפי הסריקה המקומית) ועוד לא משויכים אליה
    const out = [];
    for (const d of S.docs) {
      if (d.doc_type === "other" || (d.business_ids || []).includes(bid)) continue;
      const it = intelOf(d), s = (it.s || []).find(x => x.b === bid);
      if (s && (s.s >= 3.5 || isUnassigned(d) || (it.m || []).includes(bid))) out.push({ d, s: s.s, w: s.w || [] });
    }
    return out.sort((a, b) => b.s - a.s);
  }
  const REVIEW_CODES = ["hp_missing", "hp_typo", "hp_bad", "name_differs", "no_private_phrase"];      // אי התאמה: ח.פ., שם חברה, משפט מפתח פרטי חסר
  // הבסיס: רשימות הפוסטים באתר הישן (רשימת שטרות "פרטי" ורשימת "כללי"). כל מסמך שהיה בפוסט נבדק מול החברה שבכותרת הפוסט
  function flagFits(bid, f) {          // מסמך משותף לשני פוסטים: ממצא ששייך לחברה אחרת בפוסט (ח.פ. או שם אחר) לא מוצג אצל החברה הזו
    const b = bizById(bid); if (!b) return true;
    const d = String(f.d || "");
    const chp = String(b.chp_number || "").replace(/\D/g, "").padStart(9, "0");
    if (f.c === "hp_missing" || f.c === "hp_typo") { const ms = [...d.matchAll(/ח\.פ\. החברה (\d{9})/g)].map(m => m[1]); return !ms.length || (b.chp_number ? ms.includes(chp) : true); }
    if (f.c === "name_differs") {
      const ts = [...d.matchAll(/פוסט: (.*?) \| במסמך/g)].map(m => normText(m[1])).filter(x => x.length >= 3); if (!ts.length) return true;
      const names = [b.registrar_name, b.permit_name].flatMap(x => String(x || "").split(/[;|\n/]+/)).map(normText).filter(x => x.length >= 3);
      return ts.some(t => names.some(n => n.includes(t) || t.includes(n)));
    }
    return true;
  }
  const PK = new Map();          // בדיקה חוזרת באתר של משפט המפתח הפרטי (קורא עד 15 עמודים מהמסמך): yes / no
  function flagMap() {
    if (S._fm && S._fmFor === S.docs) return S._fm;
    const m = new Map(), add = (bid, d, f) => { if (!m.has(bid)) m.set(bid, []); m.get(bid).push({ d, label: FLAG_HE[f.c] || f.c, detail: f.d || "" }); };
    for (const d of S.docs) {
      const it = intelOf(d); if (!["g", "p", "gp"].includes(it.o)) continue;
      const fl = (it.f || []).filter(f => REVIEW_CODES.includes(f.c) && !(f.c === "no_private_phrase" && PK.get(d.id) === "yes")); if (!fl.length) continue;
      for (const bid of it.tb || []) for (const f of fl) if (flagFits(bid, f)) add(bid, d, f);
    }
    S._fm = m; S._fmFor = S.docs; return m;
  }
  const flagsOfCompany = bid => flagMap().get(bid) || [];
  const postDocs = () => S.docs.filter(d => { const it = intelOf(d); return ["g", "p", "gp"].includes(it.o) && !(it.tb || []).length && isUnassigned(d) && d.doc_type !== "other"; });      // פוסטים מהאתר הישן שכותרתם אינה מזוהה במאגר ועוד לא שויכו
  const postTitle = d => (intelOf(d).t || [])[0] || d.source_title || d.original_name || "";
  const cdKeyOf = b => b.post ? b.id : CD.mode + ":" + b.id;
  const entName = e => e.b.post ? postTitle(e.b.post) : displayName(e.b);
  function cdCompanies() {
    const f = CD.filter.trim().toLowerCase(), seen = new Map();
    const take = (bid, n) => { const b = bizById(bid); if (!b || INACTIVE_ST.test(b.registry_status || "")) return; const e = seen.get(bid) || { b, n: 0 }; e.n += n; seen.set(bid, e); };
    if (CD.mode === "review") { for (const b of bizList()) { const n = flagsOfCompany(b.id).length; if (n) take(b.id, n); } }
    else if (CD.mode === "intro") { for (const b of bizList()) if (introIssue(b)) take(b.id, 1); }
    else if (CD.mode === "manage") { for (const b of bizList()) { const f = cfeat(b, null); if (f.total && f.have < f.total) take(b.id, f.total - f.have); } }
    else { const cand = new Map(); for (const d of S.docs) { if (d.doc_type === "other") continue; for (const x of intelOf(d).s || []) if (!(d.business_ids || []).includes(x.b) && (x.s >= 3.5 || isUnassigned(d) || (intelOf(d).m || []).includes(x.b))) cand.set(x.b, (cand.get(x.b) || 0) + 1); } for (const [bid, n] of cand) take(bid, n); }
    const out = [...seen.values()].sort((a, b) => String(displayName(a.b)).localeCompare(String(displayName(b.b)), "he"));
    return out.filter(e => !CD.skipped.has(e.b.id) && !isApproved(cdKeyOf(e.b)) && (!f || `${entName(e)} ${e.b.chp_number || ""}`.toLowerCase().includes(f)));
  }
  const cdCount = m => { const old = CD.mode; CD.mode = m; const sk = CD.skipped, fl = CD.filter; CD.skipped = new Set(); CD.filter = ""; const n = cdCompanies().length; CD.mode = old; CD.skipped = sk; CD.filter = fl; return n; };
  const cdPosKey = () => "pd_cd_pos_" + CD.mode;
  function openCompanyDash(mode) {
    CD.mode = mode || "review"; CD.skipped = new Set(); CD.filter = ""; CD.i = 0; CD.curBiz = ""; CD.selDoc = "";
    let pos = null; try { pos = JSON.parse(localStorage.getItem(cdPosKey()) || "null"); } catch { /* בלי אחסון */ }
    CD.resume = pos;
    overlay("pd-cd", `<div class="pd-rv"><div class="pd-viewcol">
        <div class="pd-toolbar">
          <div class="pd-tbrow"><div class="pd-tabs" id="pd-cd-tabs"></div><span style="flex:1"></span><button class="pd-btn" onclick="PD._home()" title="חזרה לדף הראשי של הניהול">🏠 ראשי</button><button class="pd-x" onclick="PD._close('pd-cd')">✕</button></div>
          <div class="pd-tbrow"><div class="pd-nav"><button class="pd-btn" onclick="PD._cdGo(-1)">→ החברה הקודמת</button><span class="pd-navpos" id="pd-cd-pos"></span><button class="pd-btn" onclick="PD._cdGo(1)">החברה הבאה ←</button><button class="pd-btn" onclick="PD._cdSkip()" title="מסתיר את החברה עד לפתיחה הבאה">דילוג</button></div>
            <input class="pd-in" style="flex:1;min-width:180px" placeholder="חיפוש חברה: שם או ח.פ." oninput="PD._cdFilter(this.value)" autocomplete="off"><span id="pd-cd-undo"></span></div>
        </div>
        <div class="pd-viewhead" id="pd-cd-vhead"></div>
        <div class="pd-view" id="pd-cd-view"></div></div>
      <div class="pd-sidecol" style="width:470px"><div class="pd-side" id="pd-cd-side"></div></div></div>`, "full");
    closers["pd-cd"] = () => { if (CD.blobUrl) URL.revokeObjectURL(CD.blobUrl); CD.blobUrl = ""; CD.shownDoc = ""; };
    if (!S.loaded) load().then(cdShow); else cdShow();
  }
  function cdCard(d, bid, o) {          // כרטיס מסמך קטן בדשבורד החברות
    o = o || {};
    const sl = slotsOf(d, bid), it = intelOf(d), need = needOf(bizById(bid));
    const chips = (sl.length ? sl.map(t => `<span class="pd-chip" style="background:${TCOL[t]}">הת"ע ${SLOT_HE[t]}</span>`).join(" ") : (o.sug ? "" : `<span class="pd-chip" style="background:#8a8a8a">נוסף</span>`)) + ` <span class="pd-chip" style="background:${TCOL[d.doc_type] || TCOL.unknown}">${TL[d.doc_type] || ""}</span>`;
    const fl = (it.f || []).length ? `<span class="pd-feat part" title="${E((it.f || []).map(f => FLAG_HE[f.c] || f.c).join("\n"))}">⚠ ${(it.f || []).length}</span>` : "";
    const acts = o.sug ? `<button class="pd-mini" onclick="PD._cdAct('${d.id}','${bid}','only')">שיוך בלבד</button>${need.private ? `<button class="pd-mini link" onclick="PD._cdAct('${d.id}','${bid}','private')">הת"ע פרטי</button>` : ""}${need.general ? `<button class="pd-mini link" onclick="PD._cdAct('${d.id}','${bid}','general')">הת"ע כללי</button>` : ""}`
      : (sl.length ? `<button class="pd-link2" onclick="PD._cdExtras('${d.id}','${bid}')">הורדה לנוספים</button>` : ["private", "general"].filter(t => need[t]).map(t => `<button class="pd-mini link" onclick="PD._cdAct('${d.id}','${bid}','${t}')">קשר כהת"ע ${SLOT_HE[t]}</button>`).join("")) + `<button class="pd-mini" onclick="PD._cdSpecial('${d.id}','${bid}')" title="סיווג המסמך כ'אחר': מופיע באתר הסופי תחת כותרת שתבחרו. מסמך הוא פרטי / כללי או אחר, לא שניהם">אחר (עם כותרת)</button><button class="pd-link2" style="color:#c0392b" onclick="PD._cdDetach('${d.id}','${bid}')">הסרת שיוך</button>`;
    return `<div class="pd-cdc ${CD.selDoc === d.id ? "sel" : ""}"><div class="pd-cdc-top" onclick="PD._cdSel('${d.id}')" title="הצגה בצד"><div class="pd-cdc-th"><img data-thumb="${d.id}" alt="" ${thumbUrls.get(d.id) ? `src="${thumbUrls.get(d.id)}"` : ""}></div>
      <div class="pd-grow"><div class="pd-name" title="${E(d.original_name || "")}">${E(d.original_name || d.id)}</div><div class="pd-sub">${metaHtml(d)}</div><div class="pd-btns" style="gap:3px;margin-top:2px">${chips} ${fl}</div>
      <div class="pd-sub" style="font-size:10.5px">${E(it.o ? ORIG_HE[it.o] : "")}${(it.t || []).length ? " · " + E(it.t[0]) : ""}</div>
      ${o.sug ? `<div class="pd-sub" style="font-size:10.5px;color:#1e4570">${E(o.w.slice(0, 3).join(" · "))} (${o.s})</div>` : ""}</div></div><div class="pd-uc-act">${acts}</div></div>`;
  }
  async function cdShow() {
    if (!$("pd-cd")) return;
    const tabs = $("pd-cd-tabs");
    if (tabs) tabs.innerHTML = topTabs(CD.mode);
    undoRefresh();
    const list = cdCompanies(), pos = $("pd-cd-pos"), side = $("pd-cd-side");
    if (CD.resume) { const k = list.findIndex(e => e.b.id === CD.resume.id); CD.i = k >= 0 ? k : Math.min(CD.resume.i || 0, Math.max(0, list.length - 1)); CD.resume = null; }
    else if (CD.curBiz) { const k = list.findIndex(e => e.b.id === CD.curBiz); if (k >= 0) CD.i = k; }
    if (CD.i >= list.length) CD.i = Math.max(0, list.length - 1);
    if (pos) pos.textContent = list.length ? `${CD.i + 1} / ${list.length}` : "0 / 0";
    const e = list[CD.i];
    if (!e) { side.innerHTML = `<div class="pd-empty" style="color:#1e7e4a">${CD.mode === "review" ? "אין מסמכים לבדיקה 🎉" : CD.mode === "manage" ? "לכל החברות יש שיוך מסודר 🎉" : "אין הצעות לשיוכים חדשים"}</div>`; $("pd-cd-view").innerHTML = ""; $("pd-cd-vhead").innerHTML = ""; CD.curBiz = ""; return; }
    const b = e.b;
    if (b.post) return cdShowPost(b);
    if (!CD.filter.trim()) { try { localStorage.setItem(cdPosKey(), JSON.stringify({ id: b.id, i: CD.i })); } catch { /* בלי אחסון */ } }
    if (CD.curBiz !== b.id) { CD.curBiz = b.id; CD.selDoc = ""; }
    const f = cfeat(b, null), need = needOf(b), reg = b.visibility === "רק פרטי" ? "רק פרטי" : b.visibility === "פרטי" ? "פרטי" : "כללי";
    const docs = liveDocs(b.id), slotsFirst = ["private", "general"].map(t => slotDoc(b.id, t)).filter((x, i, a) => x && a.indexOf(x) === i), ex = docs.filter(d => !slotsOf(d, b.id).length);
    const flags = flagsOfCompany(b.id), sug = sugFor(b.id);
    if (!CD.selDoc || !S.byId.get(CD.selDoc)) CD.selDoc = (CD.mode === "suggest" && sug[0] ? sug[0].d.id : (flags[0] || {}).d ? flags[0].d.id : (slotsFirst[0] || docs[0] || (sug[0] || {}).d || {}).id) || "";
    if (CD.mode === "intro") { side.innerHTML = cdIntroPanel(b); cdViewer(); return; }
    if (CD.mode === "review") {
      if (!CD.selDoc || !S.byId.get(CD.selDoc) || !flags.some(x => x.d.id === CD.selDoc)) CD.selDoc = (flags[0] || {}).d ? flags[0].d.id : CD.selDoc;
      side.innerHTML = cdReviewPanel(b, flags) + cdBar(); cdViewer(); return;
    }
    side.innerHTML = `
      <div class="pd-uc is-main-none" style="border-width:2px"><div class="pd-uc-top" onclick="PD.openManage('${b.id}')" title="ניהול מסמכי החברה"><b style="font-size:15px">${displayName(b, true)}</b>
        <div class="pd-sub">${b.chp_number ? chpLbl(b.chp_number, b.biz_type) + " " + E(b.chp_number) + " · " : ""}רישום: ${reg}${stTag(b.registry_status)}</div>
        <div class="pd-ucf"><span class="pd-feat ${f.have === f.total ? "full" : "part"}">ראשיים ${f.have}/${f.total}</span><span class="pd-feat ex">נוספים ${f.ex}</span>${flags.length ? `<span class="pd-feat part">⚠ ${flags.length} ממצאים</span>` : ""}${sug.length ? `<span class="pd-feat ex">${sug.length} הצעות</span>` : ""}</div></div></div>
      ${flags.length ? `<h4>❓ שאלות על השיוך המקורי (לפי פוסטים מהאתר הישן)</h4>${flags.map(x => `<div class="pd-warnbox" style="cursor:pointer" onclick="PD._cdSel('${x.d.id}')">❓ <b>${E(x.d.original_name || "")}</b>: ${E(x.label)}${(intelOf(x.d).t || []).length ? " <span class='pd-sub'>(פוסט: " + E(intelOf(x.d).t[0]) + ")</span>" : ""}${x.detail ? " <span class='pd-sub'>" + E(x.detail) + "</span>" : ""}</div>`).join("")}` : ""}
      <h4>מסמכי החברה (${docs.length})</h4>
      ${docs.length ? `<div class="pd-cdgrid">${[...slotsFirst, ...ex].map(d => cdCard(d, b.id)).join("")}</div>` : `<div class="pd-mg-empty need">⚠ אין מסמכים לחברה</div>`}
      <h4>הצעות למסמכים נוספים (${sug.length})</h4>
      ${sug.length ? `<div class="pd-cdgrid">${sug.slice(0, 12).map(x => cdCard(x.d, b.id, { sug: true, s: x.s, w: x.w })).join("")}</div>` : `<div class="pd-sub">אין הצעות לחברה הזו.</div>`}${cdBar()}`;
    CD.after.push(() => side.querySelectorAll("img[data-thumb]").forEach(img => thumb(img.dataset.thumb).then(u => { if (img.isConnected && u) img.src = u; })));      // תמונות ממוזערות: רק אחרי שהמסמך הראשי נטען
    cdViewer();
  }
  // ───────── אישור: בחירות בדשבורד נקלטות רק אחרי "אישור" ─────────
  CD.pend = {};
  const cdKey = () => CD.curBiz.startsWith("post:") ? CD.curBiz : CD.mode + ":" + CD.curBiz;
  const docNm = id => { const d = S.byId.get(id); return d ? (d.original_name || d.id) : id; };
  function stage(op) {
    if (!CD.curBiz) return;
    const k = cdKey(), l = CD.pend[k] || (CD.pend[k] = []);
    if (op.t === "vis") for (let i = l.length - 1; i >= 0; i--) if (l[i].t === "vis" && l[i].bid === op.bid) l.splice(i, 1);
    if (!l.some(x => x.t === op.t && x.docId === op.docId && x.bid === op.bid && x.act === op.act && x.hp === op.hp && x.extId === op.extId && x.dtype === op.dtype)) l.push(op);
    cdShow();
  }
  const opLabel = op => op.t === "act" ? `שיוך ${docNm(op.docId)} ל${bizName(op.bid)} (${op.act === "only" ? "בלבד" : 'הת"ע ' + SLOT_HE[op.act]})`
    : op.t === "vis" ? `שינוי רישום ${bizName(op.bid)} ל${op.value === "רק פרטי" ? '"רק פרטי"' : op.value === "פרטי" ? '"יש גם פרטי"' : '"רק כללי"'}`
    : op.t === "special" ? `${docNm(op.docId)}: סיווג "אחר" של ${bizName(op.bid)} (${op.title}${op.detail ? ": " + op.detail : ""})`
    : op.t === "extnew" ? `שיוך ${docNm(op.docId)} לחברה שאינה במאגר: ${op.name || op.chp}`
    : op.t === "reject" ? `ביטול הרישום המקורי של ${docNm(op.docId)} ל${bizName(op.bid)} (לא ישויך)`
    : op.t === "type" ? `סיווג ${docNm(op.docId)}: ${TL[op.dtype] || op.dtype}` : op.t === "detach" ? `הסרת שיוך ${docNm(op.docId)} מ${bizName(op.bid)}` : op.t === "extras" ? `הורדת ${docNm(op.docId)} ל"מסמכים נוספים" של ${bizName(op.bid)}`
    : `שיוך ${docNm(op.docId)} לחברה שאינה במאגר${op.extId ? ": " + extName(op.extId) : op.hp ? " (" + chpLbl(op.hp) + " " + op.hp + ")" : " לפי שם הפוסט"}`;
  function cdBar() {
    const l = CD.pend[cdKey()] || [];
    return `<div class="pd-cdbar">${l.length ? `<div class="pd-sub" style="width:100%"><b>ממתין לאישור:</b></div>` + l.map((op, i) => `<div class="pd-sub" style="width:100%">• ${E(opLabel(op))} <a href="#" onclick="PD._cdUnstage(${i});return false" style="color:#c0392b" title="ביטול הבחירה">✕</a></div>`).join("") : ""}
      <button class="pd-btn primary" onclick="PD._cdOk()" title="מבצע רק את הבחירות שסומנו (אם יש) ועובר לפריט הבא. בלי בחירות: לא משנה כלום, רק מסמן שהרישום המקורי נבדק ונמצא תקין">✔ אישור${l.length ? " (" + l.length + ")" : ""}</button></div>`;
  }
  async function setReview(key, status, note) {
    await api("/permit-review", "PUT", { key, status, note: note || "" });
    if (!S.rev) S.rev = new Map();
    if (status) S.rev.set(key, { key, status, note: note || "", updated_at: new Date().toISOString().replace("T", " ").slice(0, 19) }); else S.rev.delete(key);
  }
  function originOps(bid) {          // השיוך המקורי: המסמך שבפוסט של החברה, ברשימה הכללית / הפרטית שבה הופיע
    const b = bizById(bid); if (!b) return [];
    const need = needOf(b), want = { g: ["general"], p: ["private"], gp: ["general", "private"] }, out = [], seen = new Set();
    for (const x of flagsOfCompany(bid)) {
      if (seen.has(x.d.id)) continue; seen.add(x.d.id);
      const ts = (want[intelOf(x.d).o] || []).filter(t => need[t]);
      let linkOnly = !ts.length;
      for (const t of ts) {
        if (slotsOf(x.d, bid).includes(t)) continue;
        const cur = slotDoc(bid, t);
        if (cur && cur.id !== x.d.id) linkOnly = true;      // ההת"ע של החברה כבר תפוס במסמך אחר: לא מחליפים ולא שואלים, רק משייכים (המסמך הקיים נשאר ההת"ע)
        else out.push({ t: "act", docId: x.d.id, bid, act: t });
      }
      if (linkOnly && !(x.d.business_ids || []).includes(bid) && !out.some(o => o.docId === x.d.id)) out.push({ t: "act", docId: x.d.id, bid, act: "only" });
    }
    return out;
  }
  async function cdOk() {
    if (!CD.curBiz) return;
    const k = cdKey(); let ops = CD.pend[k] || [];
    try {
      for (const op of ops) {
        if (op.t === "act") await actFor(op.docId, op.bid, op.act);
        else if (op.t === "detach") await cdDetach(op.docId, op.bid);
        else if (op.t === "extras") await toExtras(op.docId, op.bid);
        else if (op.t === "vis") { if (typeof inlineUpdate === "function" && await inlineUpdate(op.bid, "visibility", op.value) === false) throw new Error("עדכון הרישום נכשל"); }
        else if (op.t === "special") await updateDoc(op.docId, { specials: { [op.bid]: { title: op.title, detail: op.detail } } });
        else if (op.t === "reject") { /* הרישום המקורי לא מתקבל: אין מה לבצע */ }
        else if (op.t === "type") await updateDoc(op.docId, { doc_type: op.dtype });
        else if (op.t === "ext") await postExtApply(op.docId, op.hp, op.extId);
      }
      await setReview(k, "approved"); CD.lastRev.push({ key: k, status: "approved" });
    } catch (e) { alert("האישור נכשל: " + e.message + (/no such table/i.test(e.message) ? "\nיש להריץ את מיגרציה 0012 ב-D1." : "")); return; }
    delete CD.pend[k]; CD.curBiz = ""; cdShow();
  }
  async function cdUnrev(docMode) {
    const it = lastRevItem(docMode); if (!it) return;
    const r = { key: it.key, status: it.status };
    try { await setReview(r.key, ""); } catch (e) { alert("הביטול נכשל: " + e.message); return; }
    CD.lastRev = CD.lastRev.filter(x => x.key !== r.key);
    if (r.key.startsWith("doc:")) { Q.curId = ""; Q.resume = { id: r.key.slice(4), i: 0 }; uqShow(); return; }
    CD.curBiz = r.key.startsWith("post:") ? r.key : r.key.split(":").slice(1).join(":"); CD.mode = r.key.startsWith("post:") ? "review" : r.key.split(":")[0]; CD.i = 0; CD.resume = null;
    cdShow();
  }
  // הקדמה: טעות בסיווג פרטי / כללי של החברה מול רשימות האתר הישן (רשימת שטרות פרטי / רשימת כללי) - טעות כזו גורמת לשיוך מסמכים לא נכון
  function oldDocsOf(bid) { return S.docs.filter(d => ["g", "p", "gp"].includes(intelOf(d).o) && (intelOf(d).tb || []).includes(bid)); }
  function introIssue(b) {
    const docs = oldDocsOf(b.id); if (!docs.length) return "";
    const hasP = docs.some(d => /p/.test(intelOf(d).o)), hasG = docs.some(d => /g/.test(intelOf(d).o)), need = needOf(b);
    if (need.private && !hasP && hasG) return `החברה רשומה במאגר כ${b.visibility === "רק פרטי" ? "\"רק פרטי\"" : "\"יש גם פרטי\""}, אבל באתר הישן יש לה מסמך רק ברשימת הכללי.`;
    if (!need.private && hasP) return 'החברה רשומה במאגר כ"רק כללי", אבל באתר הישן יש לה מסמך ברשימת הפרטי.';
    return "";
  }
  function cdIntroPanel(b) {
    const docs = oldDocsOf(b.id), reg = b.visibility === "רק פרטי" ? "רק פרטי" : b.visibility === "פרטי" ? "יש גם פרטי" : "רק כללי";
    if (!CD.selDoc || !docs.some(d => d.id === CD.selDoc)) CD.selDoc = (docs[0] || {}).id || "";
    const opt = (v, l) => `<button class="pd-mini ${(b.visibility || "") === v ? "sel" : ""}" onclick="PD._cdVis('${b.id}','${v}')">${l}</button>`;
    return `<div style="font-weight:700;font-size:15px">${displayName(b, true)} <span class="pd-sub">${b.chp_number ? chpLbl(b.chp_number, b.biz_type) + " " + E(b.chp_number) : ""}</span></div>
      <h4>❓ בדיקת סיווג החברה</h4>
      <div class="pd-warnbox"><div>❓ <b>${E(introIssue(b))}</b></div><div class="pd-sub" style="margin-top:3px">רישום נוכחי במאגר: <b>${reg}</b></div>
        <div class="pd-btns" style="margin-top:6px"><span class="pd-sub">שינוי רישום:</span>${opt("", "רק כללי")}${opt("פרטי", "יש גם פרטי")}${opt("רק פרטי", "רק פרטי")}</div></div>
      <h4>מסמכים מהאתר הישן (${docs.length})</h4>
      ${docs.map(d => { const it = intelOf(d); return `<div class="pd-uc ${CD.selDoc === d.id ? "is-main" : ""}" style="cursor:pointer" onclick="PD._cdSel('${d.id}')"><div class="pd-uc-top" style="cursor:pointer"><b>${E(d.original_name || d.id)}</b><div class="pd-sub">${E(ORIG_HE[it.o] || "")} · פוסט: ${E((it.t || [])[0] || "")}</div></div></div>`; }).join("")}
      ${cdBar()}`;
  }
  function cdReviewPanel(b, flags) {          // תצוגה פשוטה: השאלה, אפשרויות שינוי מתאימות, ולמטה כפתורי האישור
    const by = new Map(); for (const x of flags) { if (!by.has(x.d.id)) by.set(x.d.id, { d: x.d, qs: [] }); by.get(x.d.id).qs.push(x); }
    const blocks = [...by.values()].map(({ d, qs }) => {
      const it = intelOf(d), linked = (d.business_ids || []).includes(b.id);
      return `<div class="pd-warnbox ${CD.selDoc === d.id ? "pd-qsel" : ""}" style="cursor:pointer" onclick="PD._cdSel('${d.id}')">
        <div class="pd-sub">${E(d.original_name || "")}${(it.t || []).length ? " · פוסט: " + E(it.t[0]) : ""} · ${E(ORIG_HE[it.o] || "")}</div>
        ${qs.map(q => `<div>❓ <b>${E(q.label)}</b>${q.detail ? ` <span class="pd-sub">${E(q.detail)}</span>` : ""}</div>`).join("")}
        <div class="pd-btns" style="margin-top:6px" onclick="event.stopPropagation()">
          <button class="pd-mini" style="color:#c0392b" onclick="PD._cdDetach('${d.id}','${b.id}')" title="${linked ? "מסיר את המסמך מהחברה" : "המסמך עדיין לא משויך לחברה: הרישום המקורי מהאתר הישן לא יתקבל"}">ביטול שיוך</button>
          <span class="pd-sub">סיווג:</span><button class="pd-mini ${d.doc_type === "general" ? "sel" : ""}" onclick="PD._cdType('${d.id}','general')">כללי</button><button class="pd-mini ${d.doc_type === "both" || d.doc_type === "private" ? "sel" : ""}" onclick="PD._cdType('${d.id}','both')">פרטי</button>
        </div></div>`;
    }).join("");
    return `<div style="font-weight:700;font-size:15px">${displayName(b, true)} <span class="pd-sub">${b.chp_number ? chpLbl(b.chp_number, b.biz_type) + " " + E(b.chp_number) : ""}</span></div>
      <h4>❓ שאלות על השיוך המקורי</h4>${blocks || `<div class="pd-sub">אין שאלות.</div>`}`;
  }
  const postExtHtml = d => {          // הצעות לשיוך לחברה שאינה במאגר: ח.פ. של תאגיד שנמצא במסמך, חברה קיימת ברשימה שהשם דומה, או לפי שם הפוסט
    const it = intelOf(d), title = postTitle(d), tn = normText(title), have = new Set((d.ext_ids || []));
    const cards = [], seen = new Set();
    const card = (name, sub, acts) => `<div class="pd-uc ext"><div class="pd-uc-top" style="cursor:default"><b>${E(name)}</b><div class="pd-sub">${E(sub)}</div></div><div class="pd-uc-act">${acts}</div></div>`;
    for (const hp of [...new Set([...(it.xo || []), ...((CD.live[d.id] || {}).xo || [])])]) {
      const x = S.ext.find(e => digitsOf(e.chp) === digitsOf(hp)); if (x) seen.add(x.id);
      cards.push(card(x ? x.name : (title || "חברה שאינה במאגר"), `${chpLbl(hp)} ${hp} · תאגיד שנמצא במסמך${x ? " · כבר ברשימת החברות שאינן במאגר" : ""}`,
        `<button class="pd-mini link" onclick="PD._postExt('${d.id}','${hp}','${x ? x.id : ""}')">שיוך כחברה שאינה במאגר</button>${x ? "" : `<button class="pd-link2" onclick="PD._postAdd('${d.id}','${hp}')">הוספה למאגר</button>`}`));
    }
    if (tn.length >= 4) for (const x of S.ext) { const xn = normText(x.name); if (!seen.has(x.id) && xn.length >= 4 && (xn.includes(tn) || tn.includes(xn))) { seen.add(x.id); cards.push(card(x.name, `${x.chp ? "ח.פ. " + x.chp + " · " : ""}${EXT_HE[x.status] || ""} · שם דומה לשם הפוסט`, `<button class="pd-mini link" onclick="PD._postExt('${d.id}','','${x.id}')">שיוך</button>`)); } }
    if (title && ["g", "p", "gp"].includes(it.o)) cards.push(card(title, "לפי שם הפוסט · חברה חדשה ברשימת החברות שאינן במאגר (בלי ח.פ.)", `<button class="pd-mini link" onclick="PD._postExt('${d.id}','','')">שיוך לפי שם הפוסט</button>`));
    return cards.join("");
  };
  async function postExtApply(docId, hp, extId) {
    const d = S.byId.get(docId); if (!d) return;
    try {
      let id = extId;
      if (!id) { const c = await extEnsure({ chp: hp || "", name: postTitle(d), status: "not_in_db" }); id = c.id; }
      await extAssign(docId, id);
    } catch (e) { alert("השיוך נכשל: " + e.message); throw e; }
  }
  function postAdd(docId, hp) { addReg(hp, false, async bid => { try { await doLink(docId, bid, ""); refresh(); } catch (e) { alert("החברה נוספה, אך שיוך המסמך נכשל: " + e.message); } }); }
  function cdShowPost(pb) {          // פוסט מהאתר הישן שכותרתו אינה מזוהה במאגר: שם הפוסט, השאלה על השיוך המקורי, והצעות שיוך
    const d = pb.post, it = intelOf(d), side = $("pd-cd-side");
    if (!CD.filter.trim()) { try { localStorage.setItem(cdPosKey(), JSON.stringify({ id: pb.id, i: CD.i })); } catch { /* בלי אחסון */ } }
    if (CD.curBiz !== pb.id) { CD.curBiz = pb.id; CD.selDoc = d.id; }
    const lv = CD.live[d.id];
    if (!lv) {          // קריאת הטקסט מהמסמך עצמו (בלי סריקה נוספת במחשב): תאגידים שאינם במאגר והצעות נוספות
      CD.live[d.id] = { wait: true };
      CD.after.push(async () => {
        try { const r = await extractText(await (await fetchPdfBlob(d.id)).arrayBuffer(), 6), sg = suggest(r.text, d.original_name); CD.live[d.id] = { xo: sg.outside || [], cands: sg.cands || [] }; }
        catch { CD.live[d.id] = { xo: [], cands: [] }; }
        if (CD.curBiz === pb.id && $("pd-cd")) cdShow();
      });
    }
    const sugs = (it.s || []).map(x => ({ x, b: bizById(x.b) })).filter(y => y.b);
    for (const c of (lv && lv.cands) || []) if (!sugs.some(y => y.b.id === c.b.id)) sugs.push({ x: { w: c.why || [] }, b: c.b });
    const fl = (it.f || []).filter(f => f.c !== "private_phrase_in_general");
    side.innerHTML = `
      <div class="pd-uc" style="border-width:2px"><div class="pd-uc-top" style="cursor:default"><div class="pd-sub">פוסט באתר הישן · ${E(ORIG_HE[it.o] || "")}</div><b style="font-size:15px">${E(postTitle(d))}</b>
        <div class="pd-ucf"><span class="pd-feat part">❓ כותרת הפוסט אינה מזוהה במאגר</span></div></div></div>
      <div class="pd-warnbox" style="margin-top:8px">❓ <b>שאלה על השיוך המקורי:</b> לאיזו חברה במאגר שייך הפוסט הזה? המסמך עדיין לא משויך לאף חברה.</div>
      ${fl.map(f => `<div class="pd-warnbox">⚠ ${E(FLAG_HE[f.c] || f.c)}${f.d ? " <span class='pd-sub'>" + E(f.d) + "</span>" : ""}</div>`).join("")}
      <h4>הצעות לשיוך (${sugs.length})</h4>
      ${sugs.length ? sugs.map(({ x, b }) => { const need = needOf(b), f = cfeat(b, d);
        return `<div class="pd-uc"><div class="pd-uc-top" onclick="PD.openManage('${b.id}')" title="ניהול מסמכי החברה"><b>${displayName(b)}</b><div class="pd-sub">${b.chp_number ? chpLbl(b.chp_number, b.biz_type) + " " + E(b.chp_number) + " · " : ""}${E((x.w || []).join(", "))}</div><div class="pd-ucf"><span class="pd-feat ${f.have === f.total ? "full" : "part"}">ראשיים ${f.have}/${f.total}</span></div></div>
          <div class="pd-uc-act"><button class="pd-mini" onclick="PD._cdAct('${d.id}','${b.id}','only')">שיוך בלבד</button>${need.private ? `<button class="pd-mini link" onclick="PD._cdAct('${d.id}','${b.id}','private')">הת"ע פרטי</button>` : ""}${need.general ? `<button class="pd-mini link" onclick="PD._cdAct('${d.id}','${b.id}','general')">הת"ע כללי</button>` : ""}</div></div>`; }).join("") : `<div class="pd-sub">לא נמצאה חברה במאגר לפי תוכן המסמך.</div>`}
      <h4>חברות שאינן במאגר</h4>${lv && lv.wait ? `<div class="pd-sub">קורא את הטקסט מהמסמך…</div>` : ''}${postExtHtml(d)}${cdBar()}`;
    cdViewer();
  }
  async function cdViewer() {
    const d = S.byId.get(CD.selDoc), view = $("pd-cd-view"), head = $("pd-cd-vhead");
    if (!d) { view.innerHTML = ""; head.innerHTML = ""; CD.shownDoc = ""; return; }
    const it = intelOf(d);
    head.innerHTML = `<b>${E(d.original_name || d.id)}</b> <span class="pd-sub">${metaHtml(d)} · ${E(it.o ? ORIG_HE[it.o] : "")}${(it.t || []).length ? " · שם הפוסט: " + E(it.t.join(" | ")) : ""}</span>`;
    if (CD.shownDoc === d.id) { cdAfterMain(); return; }
    CD.shownDoc = d.id; const tok = ++CD.token;
    view.innerHTML = `<div class="pd-empty" style="color:#fff">טוען מסמך…</div>`;
    if (CD.blobUrl) { URL.revokeObjectURL(CD.blobUrl); CD.blobUrl = ""; }
    try {
      const blob = await fetchPdfBlob(d.id); if (tok !== CD.token) return;
      CD.blobUrl = URL.createObjectURL(blob); view.innerHTML = `<iframe src="${CD.blobUrl}#toolbar=0&navpanes=0&view=FitH" title="המסמך"></iframe>`;
      if (!d.pages) blob.arrayBuffer().then(buf => pdfDoc(buf)).then(pdf => ensureMeta(d.id, pdf)).catch(() => {});
      if (tok === CD.token) {
        if ((intelOf(d).f || []).some(f => f.c === "no_private_phrase") && !PK.has(d.id)) CD.after.push(async () => {          // הסריקה המקומית קראה רק חלק מהעמודים: בודקים שוב את כל המסמך
          try { const r = await extractText(await blob.arrayBuffer(), 15); PK.set(d.id, phraseKind(r.text) ? "yes" : "no"); S._fm = null; if (PK.get(d.id) === "yes" && $("pd-cd")) cdShow(); } catch { /* בלי טקסט */ }
        });
        cdAfterMain();
      }
    } catch (e) { if (tok === CD.token) { view.innerHTML = `<div class="pd-empty" style="color:#fff">${E(e.message)}</div>`; cdAfterMain(); } }
  }
  function cdAfterMain() {          // קודם נטען רק המסמך הראשי; אחר כך, ברקע: תמונות ממוזערות, קריאת טקסט, והמסמכים הבאים
    const q = CD.after.splice(0);
    setTimeout(() => { for (const f of q) { try { f(); } catch { /* אינו קריטי */ } } setTimeout(cdPrefetch, 400); }, 150);
  }
  function cdPrefetch() {          // טעינה מראש של המסמך הראשי של שני הפריטים הבאים ברשימה
    try {
      for (const e of cdCompanies().slice(CD.i + 1, CD.i + 3)) {
        const id = e.b.post ? e.b.post.id : ((flagsOfCompany(e.b.id)[0] || {}).d || {}).id || ((slotDoc(e.b.id, "private") || slotDoc(e.b.id, "general") || liveDocs(e.b.id)[0]) || {}).id;
        if (id) fetchPdfBlob(id).catch(() => {});
      }
    } catch { /* טעינה מראש אינה קריטית */ }
  }
  function cdGo(n) { const len = cdCompanies().length; CD.i = Math.min(Math.max(0, CD.i + n), Math.max(0, len - 1)); CD.curBiz = ""; cdShow(); }
  async function cdDetach(docId, bid) {
    const d = S.byId.get(docId); if (!d) return;
    if ((d.business_ids || []).length === 1 && !(d.ext_ids || []).length && !confirm("זו החברה האחרונה של המסמך. הוא יחזור למסמכים הלא משויכים. להמשיך?")) return;
    try { const before = snapDoc(d); replaceDoc((await api("/permit-docs/" + docId, "PUT", { business_ids: (d.business_ids || []).filter(x => x !== bid) })).doc); pushHist(before, "הוסר שיוך ל" + bizName(bid)); }
    catch (e) { alert("הפעולה נכשלה: " + e.message); return; }
    refresh(); cdShow();
  }

  // ───────── חלון שיוך מסמך לחברה (נפתח מעל חלון המסמכים הלא משויכים, בלי לסגור אותו) ─────────
  const A = { docId: "", queue: [], i: 0, type: "unknown", slots: new Set(), typeKnown: false };
  function openAssign(docId, queue, type, typeKnown, replace) {
    Object.assign(A, { docId, queue, i: 0, type: type || "unknown", typeKnown: !!typeKnown, sid: "s" + Date.now(), replace: replace || null });
    overlay("pd-assign", `<div id="pd-as" style="display:flex;flex-direction:column;height:100%;min-height:0"></div>`, true);
    asInit(); paintAssign();
  }
  function asInit() {         // ברירת מחדל לכל חברה: קישור לרשימות שהחברה צריכה ושעוד אין לה מסמך, ולפי הסיווג
    const b = bizById(A.queue[A.i]), d = S.byId.get(A.docId); if (!b || !d) return;
    const need = needOf(b), others = liveDocs(b.id).filter(x => x.id !== d.id);
    if (!others.length && !A.typeKnown) A.type = need.private && need.general ? "both" : need.private ? "private" : "general";      // המסמך היחיד של החברה
    const cover = A.type === "both" ? ["general", "private"] : A.type === "unknown" ? [] : [A.type];
    A.slots = new Set(cover.filter(t => need[t] && !others.some(x => slotsOf(x, b.id).includes(t))));
  }
  function asCaption(b, d) {
    const need = needOf(b), others = liveDocs(b.id).filter(x => x.id !== d.id), out = [];
    if (!others.length) out.push(`<span class="pd-tag" style="background:#e1f3e8;color:#1e7e4a">מסמך יחיד של החברה</span> אין לחברה עוד מסמכים${need.private && need.general ? ": מומלץ לסמן אותו כמשולב (כללי + פרטי)" : ""}.`);
    for (const t of ["private", "general"]) {
      if (!need[t]) continue;
      const cur = slotDoc(b.id, t);
      out.push(cur && cur.id !== d.id ? `<span class="pd-tag warn">יש כבר הת"ע ${SLOT_HE[t]}</span> ${E(cur.original_name || cur.id)}: קישור המסמך הזה יחליף אותו (הוא יעבור למסמכים נוספים).` : `<span class="pd-tag">אין הת"ע ${SLOT_HE[t]} מקושר</span>`);
    }
    return out.map(x => `<div class="pd-as-cap">${x}</div>`).join("");
  }
  function paintAssign() {
    const root = $("pd-as"); if (!root) return;
    const b = bizById(A.queue[A.i]), d = S.byId.get(A.docId); if (!b || !d) { close("pd-assign"); return; }
    const others = liveDocs(b.id).filter(x => x.id !== d.id), cur = (d.business_ids || []).includes(b.id);
    const tb = t => `<button class="pd-btn ${A.type === t ? "sel" : ""}" onclick="PD._asType('${t}')">${TL[t]}</button>`;
    const sb = t => `<button class="pd-btn ${A.slots.has(t) ? "sel" : ""}" style="${A.slots.has(t) ? "background:" + TCOL[t] + ";border-color:" + TCOL[t] : ""}" onclick="PD._asSlot('${t}')">${A.slots.has(t) ? "✓ " : ""}הת"ע ${SLOT_HE[t]}</button>`;
    const mini = x => `<div class="pd-as-mini" onclick="PD.openDoc('${x.id}')" title="פתיחה בגדול"><div class="pd-mg-th" style="height:120px"><img data-thumb="${x.id}" alt="" ${thumbUrls.get(x.id) ? `src="${thumbUrls.get(x.id)}"` : ""}><span class="pd-mg-ld" ${thumbUrls.get(x.id) ? 'style="display:none"' : ""}>…</span></div>
      <div class="pd-name" title="${E(x.original_name || "")}">${E(x.original_name || x.id)}</div><div class="pd-sub">${metaHtml(x)}</div>
      <div class="pd-btns"><span class="pd-chip" style="background:${TCOL[x.doc_type] || TCOL.unknown}">${TL[x.doc_type] || TL.unknown}</span>${slotsOf(x, b.id).map(t => `<span class="pd-chip" style="background:#555">הת"ע ${SLOT_HE[t]}</span>`).join("")}</div></div>`;
    const pr = slotDoc(b.id, "private"), ge = slotDoc(b.id, "general"), ex = others.filter(x => !slotsOf(x, b.id).length);
    const chips = A.queue.map((id, k) => `<span class="pd-chip" style="background:${k < A.i ? "#1e7e4a" : k === A.i ? "#1a3a5c" : "#8a8a8a"}">${k < A.i ? "✓ " : ""}${E(bizName(id))}${k > A.i ? ` <a href="#" style="color:#fff" onclick="PD._asDrop(${k});return false" title="הסרה מהרשימה">✕</a>` : ""}</span>`).join(" ");
    root.innerHTML = `<div class="pd-head"><b>שיוך מסמך · ${displayName(b, true)}</b>${A.queue.length > 1 ? `<span class="pd-sub">חברה ${A.i + 1} מתוך ${A.queue.length}</span>` : ""}<button class="pd-btn" onclick="PD._home()" title="סגירת החלונות וחזרה לדף הראשי של הניהול">🏠 ראשי</button><button class="pd-x" onclick="PD._close('pd-assign')">✕</button></div>
      <div class="pd-body"><div style="margin-bottom:10px"><div class="pd-sub">חברות לשיוך (מסמך משותף): ${chips}</div>
        <input class="pd-in" id="pd-as-q" placeholder="הוספת חברה נוספת למסמך (מסמך משותף): שם או ח.פ." oninput="PD._asAdd(this.value)" autocomplete="off" style="margin-top:6px"><div id="pd-as-res"></div></div><div class="pd-as-top">
        <div class="pd-as-new"><h4>המסמך שמשייכים</h4>
          <div class="pd-mg-card"><div class="pd-mg-l"><div class="pd-mg-th" onclick="PD.openDoc('${d.id}')"><img data-thumb="${d.id}" alt="" ${thumbUrls.get(d.id) ? `src="${thumbUrls.get(d.id)}"` : ""}><span class="pd-mg-ld" ${thumbUrls.get(d.id) ? 'style="display:none"' : ""}>טוען…</span></div></div>
            <div class="pd-mg-r"><div class="pd-name">${E(d.original_name || d.id)}</div>${asCaption(b, d)}
              <div class="pd-sub">סיווג</div><div class="pd-btns">${["general", "private", "both", "unknown"].map(tb).join("")}</div>
              <div class="pd-sub">קישור לרשימה של החברה</div><div class="pd-btns">${sb("private")}${sb("general")}</div></div></div></div>
        <div class="pd-as-have"><h4>המסמכים הקיימים של החברה (${others.length})</h4>
          ${others.length ? `<div class="pd-as-grid">${[pr, ge].filter((x, i, a) => x && a.indexOf(x) === i).map(mini).join("")}${ex.map(mini).join("")}</div>` : `<div class="pd-mg-empty">אין לחברה מסמכים אחרים</div>`}</div></div>
        <div class="pd-btns" style="margin-top:14px"><button class="pd-btn primary" onclick="PD._asDo()">${cur ? "עדכון" : "שיוך המסמך לחברה"} ←</button>
          ${A.queue.length > 1 && A.i < A.queue.length - 1 ? `<button class="pd-btn" onclick="PD._asNext()">דילוג על החברה הזו</button>` : ""}
          <button class="pd-btn" onclick="PD._close('pd-assign')">ביטול</button></div>
        <div id="pd-as-err" style="color:#c0392b;margin-top:6px"></div></div>`;
    root.querySelectorAll("img[data-thumb]").forEach(img => thumb(img.dataset.thumb).then(u => { if (img.isConnected && u) { img.src = u; if (img.nextElementSibling) img.nextElementSibling.style.display = "none"; } }));
  }
  function asAdd(q) {
    const out = $("pd-as-res"); if (!out) return;
    const d = S.byId.get(A.docId);
    runCompanySearch(q, out, { exclude: x => A.queue.includes(x) || ((d && d.business_ids) || []).includes(x), pick: id => { A.queue.push(id); paintAssign(); },
      mark: () => alert("סימון 'חסר במאגר' אפשרי בחלון המסמכים הלא משויכים.") });
  }
  function asDrop(k) { if (k > A.i) { A.queue.splice(k, 1); paintAssign(); } }
  function asNext() {
    if (A.i + 1 < A.queue.length) { A.i++; asInit(); paintAssign(); }
    else { close("pd-assign"); if ($("pd-un")) uqAfter(); }
  }
  async function asDo() {
    const b = bizById(A.queue[A.i]), d = S.byId.get(A.docId); if (!b || !d) return;
    const rp = A.replace && A.i === 0 ? A.replace : null;          // שינוי שיוך: הישנה מוסרת יחד עם הוספת החדשה
    let ids = [...new Set([...(d.business_ids || []), b.id])];
    if (rp && rp.kind === "biz") ids = ids.filter(x => x !== rp.id);
    try {
      const before = snapDoc(d), others = [];
      for (const t of A.slots) { const o = slotDoc(b.id, t); if (o && o.id !== d.id && !others.some(x => x.id === o.id)) others.push({ id: o.id, bid: b.id, slot: slotsOf(o, b.id) }); }
      const r = await api("/permit-docs/" + d.id, "PUT", { business_ids: ids, doc_type: A.type, slots: { [b.id]: [...A.slots] }, ...(rp && rp.kind === "ext" ? { ext_ids: (d.ext_ids || []).filter(x => x !== rp.id) } : {}) });
      replaceDoc(r.doc); await refetchDocs(others.map(o => o.id)); pushHist(before, "שויך ל" + displayName(b), others, A.sid);
      say("המסמך שויך ל" + displayName(b) + (others.length ? `. המסמך הקודם בהת"ע (${others.map(o => (S.byId.get(o.id) || {}).original_name || o.id).join(", ")}) לא נמחק: הוא נשאר בחברה תחת "מסמכים נוספים". לביטול: ↩` : "")); refresh();
    } catch (e) { const el = $("pd-as-err"); if (el) el.textContent = "השיוך נכשל: " + e.message; return; }
    asNext();
  }
  function asSlot(t) {
    A.slots.has(t) ? A.slots.delete(t) : A.slots.add(t);
    if (A.slots.has(t) && A.type !== "both" && A.type !== t) A.type = A.type === "unknown" ? t : "both";
    A.typeKnown = true; paintAssign();
  }
  function asType(t) { A.type = t; A.typeKnown = true; paintAssign(); }

  async function extEnsure(o) {      // יוצר חברה ברשימת החברות שאינן במאגר (או מחזיר את הקיימת לפי ח.פ.) ומעדכן את הסטטוס
    const r = await api("/permit-ext", "POST", o), c = r.company;
    const i = S.ext.findIndex(x => x.id === c.id);
    if (i >= 0) S.ext[i] = { ...S.ext[i], ...c, doc_ids: S.ext[i].doc_ids }; else S.ext.push({ ...c, doc_ids: [] });
    return c;
  }
  async function extAssign(docId, extId, what) {
    const d = S.byId.get(docId); if (!d) return;
    const before = snapDoc(d), ids = [...new Set([...(d.ext_ids || []), extId])];
    const r = await api("/permit-docs/" + docId, "PUT", { ext_ids: ids });
    replaceDoc(r.doc); const x = extById(extId); if (x) x.doc_ids = [...new Set([...(x.doc_ids || []), docId])];
    pushHist(before, what || "שויך לחברה שאינה במאגר: " + extName(extId)); say(`שויך ל"${extName(extId)}" (${EXT_HE[(x || {}).status] || ""}) וברשימת החברות שאינן במאגר`); refresh();
  }
  function uqAfter() { Q.sel = new Set(); Q.replace = null; const d = S.byId.get(Q.curId); Q.picker = d && isUnassigned(d) ? "add" : null; uqShow(); }
  async function uqSetType(t) {
    const d = unassignedList()[Q.i]; if (!d) return;
    const before = snapDoc(d);
    if (await updateDoc(d.id, { doc_type: t })) { pushHist(before, "סיווג: " + TL[t]); uqAfter(); }
  }
  function uqPicker(mode, kind, id) { Q.picker = mode || null; Q.replace = mode === "change" ? { kind, id } : null; uqShow(); }
  async function uqApplyReplace(docId) {          // שינוי שיוך: אחרי ששויך לחברה החדשה, הישנה מוסרת מהמסמך
    const r0 = Q.replace; if (!r0) return; Q.replace = null;
    const d = S.byId.get(docId); if (!d) return;
    const body = r0.kind === "biz" ? { business_ids: (d.business_ids || []).filter(x => x !== r0.id) } : { ext_ids: (d.ext_ids || []).filter(x => x !== r0.id) };
    replaceDoc((await api("/permit-docs/" + docId, "PUT", body)).doc);
  }
  async function uqExt(reg, st) {
    const d = unassignedList()[Q.i]; if (!d) return;
    uqStage({ t: "extnew", docId: d.id, chp: reg.id, name: reg.name, status: st });          // גם שיוך לחברה שאינה במאגר מצטבר ונקלט רק באישור
  }
  async function uqExtPick(id) {
    const d = unassignedList()[Q.i]; if (!d) return;
    uqStage({ t: "ext", docId: d.id, hp: "", extId: id });
  }
  async function uqExtAdd(st) {
    const d = unassignedList()[Q.i], name = ($("pd-ext-name") || {}).value || "", chp = ($("pd-ext-chp") || {}).value || "";
    if (!d || !(name.trim() || chp.trim())) { const el = $("pd-un-err"); if (el) el.textContent = "יש להקליד שם או ח.פ."; return; }
    uqStage({ t: "extnew", docId: d.id, chp, name, status: st });
  }
  async function uqExtDetach(extId) {
    const d = unassignedList()[Q.i]; if (!d) return;
    try { const before = snapDoc(d); const r = await api("/permit-docs/" + d.id, "PUT", { ext_ids: (d.ext_ids || []).filter(x => x !== extId) }); replaceDoc(r.doc); const x = extById(extId); if (x) x.doc_ids = (x.doc_ids || []).filter(i => i !== d.id); pushHist(before, "הוסר שיוך לחברה שאינה במאגר"); }
    catch (e) { alert("הפעולה נכשלה: " + e.message); return; }
    uqAfter(); refresh();
  }
  function uqDetach(bizId) {
    const d = unassignedList()[Q.i]; if (!d) return;
    if ((d.business_ids || []).length === 1 && !(d.ext_ids || []).length && !confirm("זו החברה האחרונה של המסמך. הוא יחזור למסמכים הלא משויכים. להמשיך?")) return;
    const before = snapDoc(d);
    api("/permit-docs/" + d.id, "PUT", { business_ids: (d.business_ids || []).filter(x => x !== bizId) }).then(r => { replaceDoc(r.doc); pushHist(before, "הוסר שיוך ל" + bizName(bizId)); uqAfter(); refresh(); }).catch(e => alert("הפעולה נכשלה: " + e.message));
  }
  async function uqRestore() {
    const d = unassignedList()[Q.i]; if (!d) return;
    try { const before = snapDoc(d); const r = await api("/permit-docs/" + d.id, "PUT", { doc_type: "unknown", note: String(d.note || "").replace(/\s*\|?\s*חסר במאגר:[^|]*/g, "").trim() }); replaceDoc(r.doc); pushHist(before, "הוחזר לתור"); Q.curId = ""; uqShow(); refresh(); }
    catch (e) { alert("הפעולה נכשלה: " + e.message); }
  }
  // ───────── חלון: חברות שאינן במאגר (מחוקות / מוזגו / לא במאגר) ─────────
  function goHome() {          // סוגר את כל החלונות וחוזר לדף הראשי של הניהול
    S._nav = true;
    for (const id of ["pd-confirm", "pd-ext", "pd-recent", "pd-assign", "pd-doc", "pd-upload", "pd-manage", "pd-company", "pd-un", "pd-cd", "pd-nd"]) close(id);
    S._nav = false;
    if (typeof setView === "function") setView("home");
  }
  let extGrp = "nodb";
  function openExt(g) {
    if (g === "gone" || g === "nodb") extGrp = g;
    const rows = S.ext.filter(x => extGroup(x) === extGrp).sort((a, b) => String(a.name).localeCompare(String(b.name), "he"));
    overlay("pd-ext", `<div class="pd-head"><b>${extGrp === "gone" ? "חברות מחוקות" : "חברות שאינן במאגר"} (${rows.length})</b><button class="pd-btn" onclick="PD._home()" title="סגירת החלונות וחזרה לדף הראשי של הניהול">🏠 ראשי</button><button class="pd-x" onclick="PD._close('pd-ext')">✕</button></div>
      <div class="pd-body"><div class="pd-sub" style="margin-bottom:8px">חברות שמסמכי היתר משויכים אליהן אבל אינן במאגר העסקים. כל שיוך כזה מוסיף את החברה לכאן. ${S.extErr ? `<span style="color:#c0392b">(${E(S.extErr)}: אם חסרה מיגרציה 0008 - להריץ ב-D1)</span>` : ""}</div>
        <table class="pd-ext-tbl"><thead><tr><th>שם</th><th>ח.פ. / ח.צ.</th><th>סטטוס</th><th>מסמכים</th><th></th></tr></thead><tbody>
        ${rows.map(x => `<tr><td>${E(x.name)}</td><td dir="ltr" style="text-align:right">${E(x.chp || "")}</td>
          <td><select class="pd-in" style="padding:3px" onchange="PD._extStatus('${x.id}',this.value)">${["deleted", "merged", "not_in_db"].map(st => `<option value="${st}" ${x.status === st ? "selected" : ""}>${EXT_HE[st]}</option>`).join("")}</select></td>
          <td>${(x.doc_ids || []).map(id => { const d = S.byId.get(id); return d ? `<a href="#" onclick="PD.openDoc('${id}');return false">${E(d.original_name || id)}</a>` : ""; }).filter(Boolean).join(" · ") || '<span class="pd-sub">אין</span>'}</td>
          <td><button class="pd-link" onclick="PD._extDel('${x.id}')">מחיקה מהרשימה</button></td></tr>`).join("") || `<tr><td colspan="5" class="pd-sub">הרשימה ריקה.</td></tr>`}
        </tbody></table></div>`);
  }
  async function extStatus(id, st) {
    try { await api("/permit-ext/" + id, "PUT", { status: st }); const x = extById(id); if (x) x.status = st; refresh(); openExt(); if ($("pd-un")) uqShow(); }
    catch (e) { alert("העדכון נכשל: " + e.message); }
  }
  async function extDel(id) {
    const x = extById(id); if (!x) return;
    if (!confirm(`למחוק את "${x.name}" מהרשימה? המסמכים שמשויכים רק אליה יחזרו להיות לא משויכים.`)) return;
    try { await api("/permit-ext/" + id, "DELETE"); S.ext = S.ext.filter(y => y.id !== id); await load(); openExt(); }
    catch (e) { alert("המחיקה נכשלה: " + e.message); }
  }

  const legacyDocs = () => S.docs.filter(d => missingMarked(d) && isUnassigned(d) && d.doc_type !== "other");
  async function legacyConvert() {          // המרת הסימון הישן "חסר במאגר: שם (ח.פ. N, סטטוס)" בהערה לחברה ברשימת החברות שאינן במאגר
    const list = legacyDocs();
    if (!list.length || !confirm(`להמיר ${list.length} מסמכים שסומנו "חסר במאגר" לשיוך לחברות שאינן במאגר? (ההערה נשמרת)`)) return;
    let ok = 0, bad = 0;
    for (const d of list) {
      const m = /חסר במאגר:\s*(.+?)\s*\(ח\.פ\.\s*(\d+)(?:,\s*([^)]*))?\)/.exec(d.note || "");
      if (!m) { bad++; continue; }
      try { const c = await extEnsure({ chp: m[2], name: m[1], status: extGuess(m[3]) }); await extAssign(d.id, c.id); ok++; } catch { bad++; }
    }
    alert(`הומרו ${ok} מסמכים${bad ? `, ${bad} לא הומרו (אין ח.פ. או שם בהערה)` : ""}.`);
    Q.curId = ""; uqShow();
  }
  async function uqMark(reg) {        // סימון "חסר במאגר" בהערת המסמך (המסמך נשאר לא משויך)
    const d = unassignedList()[Q.i]; if (!d) return;
    const note = (Q.note ? Q.note + " | " : "") + markText(reg); Q.note = note;
    try { const r = await api("/permit-docs/" + d.id, "PUT", { note, doc_type: Q.type }); replaceDoc(r.doc); say("נשמר: החברה אינה במאגר. המסמך יצא מהתור"); Q.curId = ""; }
    catch (e) { const el = $("pd-un-err"); if (el) el.textContent = "הסימון נכשל: " + e.message; }
    uqShow();
  }
  async function uqSave() {
    const d = unassignedList()[Q.i]; if (!d || !Q.sel.size) return;
    try {
      const before = snapDoc(d);
      const r = await api("/permit-docs/" + d.id, "PUT", { doc_type: Q.type, business_ids: [...Q.sel], note: Q.note });
      replaceDoc(r.doc); pushHist(before, "שמירה מהירה ל-" + Q.sel.size + " חברות"); say("נשמר"); Q.curId = ""; uqShow();
    } catch (e) { const el = $("pd-un-err"); if (el) el.textContent = "השמירה נכשלה: " + e.message; }
  }
  async function uqOther() {
    const d = unassignedList()[Q.i]; if (!d) return;
    try { const before = snapDoc(d); const r = await api("/permit-docs/" + d.id, "PUT", { doc_type: "other", note: Q.note }); replaceDoc(r.doc); pushHist(before, "סומן לא קשור"); Q.curId = ""; uqShow(); }
    catch (e) { const el = $("pd-un-err"); if (el) el.textContent = "הפעולה נכשלה: " + e.message; }
  }

  // ───────── עמודות הרשימה: הת"ע פרטי / הת"ע כללי / מסמכים נוספים לבדיקה ─────────
  function ready() {
    if (!S.loaded) { if (!S.loading && typeof isAdmin !== "undefined" && isAdmin) load(); return `<span class="pd-na">…</span>`; }
    if (S.err) return `<span class="pd-na" title="${E(S.err)}">—</span>`;
    return "";
  }
  function slotCell(b, t) {
    const w = ready(); if (w) return w;
    const d = slotDoc(b.id, t);
    if (d) return `<button type="button" class="pd-ok pd-c-${t}" onclick="PD.openDoc('${d.id}','${b.id}',true)" title="${E(d.original_name || "")}">📄 פתיחה${otherCos(d, b.id).length ? ' <span class="pd-chip" style="background:#1e7e4a">הת"ע משותף לכמה חברות</span>' : ""}</button>`;
    if (!needOf(b)[t]) return `<span class="pd-na">—</span>`;
    return liveDocs(b.id).length
      ? `<button type="button" class="pd-warn" onclick="PD.openManage('${b.id}')" title="יש מסמכים לחברה, אבל אף אחד לא קושר לרשימה הזו">לא קושר מסמך</button>`
      : `<button type="button" class="pd-missing" onclick="PD.openManage('${b.id}')" title="אין אף מסמך לחברה">⚠ חסר</button>`;
  }
  // שני התאים של הת"ע פרטי / כללי. אם אותו מסמך (משולב) מקושר לשתי הרשימות: כפתור ארוך אחד לרוחב שתי העמודות
  function slotCells(b) {
    const w = ready(), pr = slotDoc(b.id, "private"), ge = slotDoc(b.id, "general");
    if (!w && pr && ge && pr.id === ge.id)
      return `<td class="pd-cell" colspan="2" style="text-align:center;"><button type="button" class="pd-ok pd-long" onclick="PD.openDoc('${pr.id}','${b.id}',true)" title="${E(pr.original_name || "")}">📄 פתיחה${otherCos(pr, b.id).length ? ' <span class="pd-chip" style="background:#1e7e4a">הת"ע משותף לכמה חברות</span>' : ""}</button></td>`;
    return `<td class="pd-cell" style="text-align:center;">${slotCell(b, "private")}</td><td class="pd-cell" style="text-align:center;">${slotCell(b, "general")}</td>`;
  }
  function extraCell(b) {
    const w = ready(); if (w) return w;
    { const m = mainOf(b); if (m) return `<span class="pd-na" title="המסמכים של תת-השורה מנוהלים בחלון ניהול המסמכים של ${E(displayName(m))}">—</span>`; }
    const n = extrasOf(b.id).length;
    return `<button type="button" class="pd-ok" onclick="PD.openManage('${b.id}')">🗂 ניהול מסמכים${n ? ` <span class="pd-chip" style="background:#b85c00">${n} לבדיקה</span>` : ""}</button>
      <div style="margin-top:3px"><button type="button" class="pd-link" style="font-size:12px" onclick="PD._upNew('${b.id}')" title="בחירת קובץ; אחרי הבחירה נפתח חלון ההוספה עם החברה הזו כבר נבחרת, ונשאר לבחור פרטי / כללי / משותף">⬆ העלאת מסמך חדש</button></div>`;
  }
  function upNewFor(bizId) {          // העלאת מסמך חדש מהשורה בטבלת העדכון: אחרי בחירת הקובץ נפתח חלון ההוספה, והחברה כבר נבחרה (כרטיסייה בראש החלון)
    const inp = document.createElement("input"); inp.type = "file"; inp.accept = "application/pdf,.pdf"; inp.multiple = true;
    inp.onchange = () => { if (inp.files && inp.files.length) { openUpload({ addCompany: true, bizId }); upFiles(inp.files); } };
    inp.click();
  }

  // מצב מסמכי ההיתר של חברה, לסינון בטבלת הניהול: review = צריכה החלטה ידנית (כמה מועמדים לרשימה בלי קישור, או מסמך בלי סיווג);
  // missing = חסר מסמך מהסוג הנדרש ואין מועמד; ok = תקין; inactive = לא פעילה ברשם; "" = הנתונים עוד לא נטענו
  const INACTIVE_ST = /מחוקה|נגרעה|מחוסלת|בפרוק/;
  function docStatus(b) {
    if (!S.loaded || S.err) return "";
    if (INACTIVE_ST.test(b.registry_status || "")) return "inactive";
    const ds = liveDocs(b.id), need = needOf(b);
    let review = ds.some(d => d.doc_type === "unknown"), missing = false;
    for (const t of ["general", "private"]) {
      if (!need[t] || slotDoc(b.id, t)) continue;
      const cov = ds.filter(d => d.doc_type === t || d.doc_type === "both").length;
      if (cov >= 2) review = true; else if (!cov) missing = true;
    }
    return review ? "review" : missing ? "missing" : "ok";
  }
  function docCounts(list) {
    const c = { review: 0, missing: 0, ok: 0 };
    for (const b of list) { const s = docStatus(b); if (s === "review" || s === "missing" || s === "ok") c[s]++; }
    return c;
  }

  // ───────── תמונה קטנה של העמוד הראשון (pdf.js, עד 3 במקביל) ─────────
  const thumbs = new Map(), thumbUrls = new Map(), thumbWait = []; let thumbActive = 0;
  function thumb(id) {
    if (thumbs.has(id)) return thumbs.get(id);
    const run = async () => {
      try {
        const pdf = await pdfDoc(await (await fetchPdfBlob(id)).arrayBuffer());
        ensureMeta(id, pdf);
        const pg = await pdf.getPage(1), v1 = pg.getViewport({ scale: 1 }), vp = pg.getViewport({ scale: 240 / v1.width });
        const cv = document.createElement("canvas"); cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
        await pg.render({ canvasContext: cv.getContext("2d"), viewport: vp }).promise;
        return cv.toDataURL("image/jpeg", 0.72);
      } catch { return ""; }
    };
    const p = new Promise(res => {
      const go = () => { thumbActive++; run().then(res).finally(() => { thumbActive--; const n = thumbWait.shift(); if (n) n(); }); };
      thumbActive < 3 ? go() : thumbWait.push(go);
    }).then(u => { if (u) thumbUrls.set(id, u); else thumbs.delete(id); return u; });
    thumbs.set(id, p);
    return p;
  }

  // ───────── חלון "ניהול מסמכים" לחברה ─────────
  const M = { biz: "", share: new Set(), move: "", menu: "", bond: "", bondQ: "", subNew: false };
  // רישום החברה ברשימות (כללי / פרטי / רק פרטי): תווית, שינוי ומחיקה מהרשימה
  const regLabel = b => b.visibility === "רק פרטי" ? "רק פרטי" : b.visibility === "פרטי" ? "פרטי" : "כללי";
  function regChange() {
    const b = bizById(M.biz); if (!b) return;
    const cur = regLabel(b), btn = (l) => `<button class="pd-btn ${cur === l ? "sel" : ""}" onclick="PD._regSet('${l}')">${l}</button>`;
    overlay("pd-reg", `<div class="pd-head"><b>רישום החברה · ${displayName(b, true)}</b><button class="pd-x" onclick="PD._close('pd-reg')">✕</button></div>
      <div class="pd-body"><div class="pd-sub" style="margin-bottom:8px">הרישום הנוכחי: <b>${cur}</b></div>
        <div class="pd-btns">${btn("פרטי")}${btn("כללי")}${btn("רק פרטי")}</div>
        <div style="margin-top:14px"><button class="pd-btn" onclick="PD._regEdit()" title="פתיחת הרישום בטופס העדכון: שם, ח.פ., קטגוריה ועוד">✏️ עריכת רישום</button></div>
        <div style="margin-top:18px"><button class="pd-btn danger" onclick="PD._regDel()">מחיקת הרישום</button></div></div>`);
  }
  function regEdit() {          // קפיצה לטופס העדכון של הרישום (שם, ח.פ. וכו')
    const b = bizById(M.biz); if (!b) return;
    S._nav = true; for (const id of ["pd-reg", "pd-manage", "pd-doc", "pd-nd", "pd-un", "pd-company"]) close(id); S._nav = false;
    if (typeof openForm === "function") openForm(b.id);
  }
  async function regSet(label) {
    const b = bizById(M.biz); if (!b || regLabel(b) === label) { close("pd-reg"); return; }
    const vis = label === "כללי" ? "" : label;
    try {
      await api("/businesses/" + b.id, "PUT", { ...b, visibility: vis });
      b.visibility = vis; S._fm = null; close("pd-reg"); refresh(); if ($("pd-manage") && S._paintMg) S._paintMg();
    } catch (e) { alert("שינוי הרישום נכשל: " + e.message); }
  }
  async function regDel() {
    const b = bizById(M.biz); if (!b) return;
    if (!confirm("האם אתה בטוח שאתה רוצה למחוק החברה מהרשימה?\n" + (b.permit_name || b.registrar_name || "") + "\n(השטרות שלה יישארו במאגר, ללא שיוך לחברה הזו.)")) return;
    try {
      await api("/businesses/" + b.id, "DELETE");
      businesses = businesses.filter(x => x.id !== b.id);
      if (typeof logChange === "function") logChange("delete", b, null);
      close("pd-reg"); close("pd-manage"); S.loaded = false; S.loading = false; await load(); refresh();
    } catch (e) { alert("המחיקה נכשלה: " + e.message); }
  }
  function openManage(bizId) {
    if (!bizById(bizId)) return;
    { const m = mainOf(bizById(bizId)); if (m) bizId = m.id; }          // תת-שורה: הכל מנוהל בחלון הראשי של החברה
    M.biz = bizId; M.share = new Set(); M.move = ""; M.subNew = false;
    ["pd-company"].forEach(close);
    overlay("pd-manage", `<div id="pd-mg" style="display:flex;flex-direction:column;height:100%;min-height:0"></div>`, true);
    S._paintMg = paintMg;
    closers["pd-manage"] = () => { if (S._paintMg === paintMg) S._paintMg = null; if ($("pd-un") && !S._nav) { Q.replace = null; uqShow(); } };
    paintMg();
    if (!S.loaded && !S.loading) load();
  }

  // ───────── דשבורד חדש (בבנייה, רק בעמוד הבדיקה): שלוש כרטיסיות. א: חברות שחסרים להן שטרות; ב: שטרות שמחכים לשיוך; ג: חברות לא רשומות ─────────
  const ND = { tab: "a", miss: "all", sug: false, gone: false, q: "", sq: "", tq: "", fq: "" };
  function later(o, key, fn, delay) {          // הרצה אחרי הפסקת הקלדה, ולא באמצע הקלדה (אם יש קלט ממתין - דוחים עוד): ההקלדה לא נעצרת בגלל החיפוש ברקע
    clearTimeout(o[key]);
    const go = () => { if (navigator.scheduling && navigator.scheduling.isInputPending && navigator.scheduling.isInputPending()) { o[key] = setTimeout(go, 120); return; } fn(); };
    o[key] = setTimeout(go, delay || 450);
  }
  const _nm = new Map();
  const NORMN = x => { const k = String(x || ""); let v = _nm.get(k); if (v === undefined) { v = NORMN0(k); if (_nm.size > 40000) _nm.clear(); _nm.set(k, v); } return v; };
  const NORMN0 = x => String(x || "").toLowerCase().replace(/["'`״׳.\-,()]/g, " ").replace(/(^|\s)(בע\s*מ|בעמ|ltd|inc)(?=\s|$)/g, " ").replace(/\s+/g, " ").trim();          // (\b אינו עובד בעברית)
  const _tr = new Map();
  const tri = x => { const n = NORMN(x); let o = _tr.get(n); if (!o) { const t = " " + n + " "; o = new Set(); for (let i = 0; i + 3 <= t.length; i++) o.add(t.slice(i, i + 3)); if (_tr.size > 40000) _tr.clear(); _tr.set(n, o); } return o; };
  function fuzzy(q, name) {          // התאמה מקורבת: הכלה מלאה, או דמיון משולשות אותיות (שינוי קטן בשם)
    const a = NORMN(q), b = NORMN(name); if (!a || !b) return 0;
    if (b.includes(a) || a.includes(b)) return 1;
    const ta = tri(a), tb = tri(b); let c = 0; for (const x of ta) if (tb.has(x)) c++;
    return c / Math.max(1, Math.min(ta.size, tb.size) * 0.5 + Math.max(ta.size, tb.size) * 0.5);
  }
  const hp9 = x => String(x || "").replace(/\D/g, "").padStart(9, "0");
  function hpMaps() {          // ח.פ. -> מסמכים שנמצא בהם; מסמך -> ח.פ. שנמצאו בו (עם מקור: text / stamp / hand)
    if (S.hpDocs || !S.hp) return;
    S.hpDocs = new Map(); S.hpBy = new Map();
    for (const r of S.hp) {
      if (!S.hpDocs.has(r.hp)) S.hpDocs.set(r.hp, new Set()); S.hpDocs.get(r.hp).add(r.id);
      if (!S.hpBy.has(r.id)) S.hpBy.set(r.id, []); S.hpBy.get(r.id).push(r);
    }
  }
  const FITS = { private: ["private", "both", "unknown"], general: ["general", "both", "unknown"] };
  // ───────── הצעות לפי שם החברה שנמצא במסמך ─────────
  const NSTOP = new Set(["מהדרין", "מכון", "היתר", "עיסקא", "עסקא", "עסקה", "חברה", "חברת", "הנפקות", "בנק", "ביטוח", "השקעות", "גיוס", "הון", "ישראל", "החברה"]);          // שם שכולו מילים כאלה אינו מזהה חברה
  const NGENERIC_DF = 25;          // שם שמופיע ביותר ממספר הזה של מסמכים הוא כנראה שם כללי (למשל "מכון היתר עסקא למהדרין בע"מ" בכל מסמך), ולא מזהה חברה
  function loadNames() { return S._namesP || (S._namesP = loadNames0()); }          // הבטחה אחת משותפת: מי שמבקש בזמן הטעינה ממתין לסיומה (ולא מקבל "אין הצעות")
  async function loadNames0() {
    S.nameDf = null;
    try {
      const rows = (await api("/permit-text?names=1")).names || [];
      S.nameDf = new Map(); S.docNames = new Map();
      for (const r of rows) {
        const n = NORMN(r.name); if (n.length < 3) continue;
        if (!S.nameDf.has(n)) S.nameDf.set(n, new Set()); S.nameDf.get(n).add(r.id);
        if (!S.docNames.has(r.id)) S.docNames.set(r.id, new Set()); S.docNames.get(r.id).add(n);
      }
    } catch { S.nameDf = null; S.docNames = null; }
  }
  const nameGeneric = n => !S.nameDf || S.nameDf.get(n).size > NGENERIC_DF;
  function coKeys(b) {          // שמות החברה לצורך התאמה: בלי בע"מ וגרשיים; לא שם שכולו מילים כלליות
    return [...new Set([b.permit_name, b.registrar_name].map(NORMN).filter(k => k.length >= 3 && !k.split(" ").every(w => NSTOP.has(w))))];
  }
  const nameHit = (docName, key) => docName === key || (key.length >= 6 && (" " + docName + " ").includes(" " + key + " "));          // שם קצר: רק התאמה מלאה; שם ארוך: גם כחלק משורה
  function nameDocs(b) {          // מסמכים ששם החברה מופיע בהם (שם שאינו כללי)
    const keys = coKeys(b), out = new Set();
    if (!S.nameDf || !keys.length) return out;
    const ck = b.id + "|" + keys.join("|"), cache = S._ndc && S._ndc.df === S.nameDf ? S._ndc : (S._ndc = { df: S.nameDf, m: new Map() });
    if (cache.m.has(ck)) return cache.m.get(ck);
    cache.m.set(ck, out);
    for (const [n, ids] of S.nameDf) if (ids.size <= NGENERIC_DF && keys.some(k => nameHit(n, k))) for (const id of ids) out.add(id);
    return out;
  }
  function coIndex() {
    if (S._coIdx && S._coIdxN === bizList().length) return S._coIdx;
    S._coIdxN = bizList().length;
    return (S._coIdx = bizList().filter(b => !INACTIVE_ST.test(b.registry_status || "")).map(b => ({ b, keys: coKeys(b) })).filter(x => x.keys.length));
  }
  function companiesByName(d) {          // חברות ששמן מופיע במסמך
    const ns = S.docNames && S.docNames.get(d.id); if (!ns) return [];
    const out = new Map();
    for (const n of ns) { if (nameGeneric(n)) continue; for (const x of coIndex()) if (x.keys.some(k => nameHit(n, k))) out.set(x.b.id, x.b); }
    return [...out.values()];
  }
  function hintDocs(b, miss) {          // מסמכים שנמצא בהם ח.פ. או שם של החברה ואינם משויכים אליה כלל (מסמך שכבר משויך לחברה, גם כנוסף או לאג"ח, אינו הצעה), וסוגם מתאים לשטר החסר: [{ d, why }]
    hpMaps(); const rej = rejSet();
    const hp = S.hpDocs && (b.chp_number || "").trim() ? S.hpDocs.get(hp9(b.chp_number)) : null, nm = nameDocs(b), out = [];
    for (const id of new Set([...(hp || []), ...nm])) {
      const d = S.byId.get(id);
      if (d && !rej.has(id + "|" + b.id) && d.doc_type !== "other" && !(d.business_ids || []).includes(b.id) && miss.some(t => FITS[t].includes(d.doc_type))) out.push({ d, why: hp && hp.has(id) ? "ח.פ." : "שם החברה" });
    }
    return out;
  }
  const SUG_TYPES = ["private", "general"];          // הצעות: כל מסמך לא משויך שנמצא בו ח.פ. או שם החברה, בלי קשר לסוג השטר שחסר
  function ndMissing() {
    const out = [];
    for (const b of bizList()) {
      if (INACTIVE_ST.test(b.registry_status || "")) continue;
      const need = needOf(b), miss = ["private", "general"].filter(t => need[t] && !slotDoc(b.id, t));
      if (!miss.length) continue;
      if (ND.miss === "private" && !miss.includes("private")) continue;
      if (ND.miss === "general" && !miss.includes("general")) continue;
      if (ND.miss === "both" && miss.length < 2) continue;
      const ex = extrasOf(b.id).filter(d => !(d.bonds || []).length), sug = hintDocs(b, SUG_TYPES);
      if (ND.sug && !ex.length && !sug.length) continue;
      out.push({ b, miss, ex, sug });          // מסמכים ששויכו לאג"ח אינם נחשבים "שטרות נוספים"
    }
    const f = ND.q.trim().toLowerCase();
    return out.filter(e => !f || `${displayName(e.b)} ${e.b.chp_number || ""}`.toLowerCase().includes(f) || fuzzy(f, displayName(e.b)) >= 0.5)
      .sort((x, y) => String(displayName(x.b)).localeCompare(String(displayName(y.b)), "he"));
  }
  const ndDocsB = () => S.docs.filter(d => isUnassigned(d) && d.doc_type !== "other");
  const ndExt = () => S.ext.filter(x => ND.gone || extGroup(x) === "nodb");
  const ndCount = t => t === "e" ? J.total : !S.loaded ? "…" : t === "a" ? ndMissing().length : t === "b" ? ndDocsB().length : ndExt().length;
  function ndCss() {
    if ($("pd-nd-css")) return;
    const st = document.createElement("style"); st.id = "pd-nd-css";
    st.textContent = `.pd-nd-tbl{width:100%;border-collapse:collapse;font-size:13px}.pd-nd-tbl th{position:sticky;top:0;background:#f6f4ee;text-align:right;padding:6px 8px;border-bottom:2px solid #cfcac0}.pd-nd-tbl td{padding:6px 8px;border-bottom:1px solid #eee;vertical-align:top}.pd-nd-tbl .pd-jtbl th,.pd-jtbl td{padding:4px 5px !important}.pd-jsel{width:100%;min-width:0;padding:1px 0;font-size:11.5px}.pd-jtbl th.pd-jnar{width:58px;max-width:58px}.pd-jbtns{display:flex;gap:2px;flex-wrap:nowrap}.pd-ib{display:flex;flex-direction:column;align-items:center;gap:0;line-height:1.15;padding:2px 2px;font-size:10.5px;min-width:34px}.pd-ib span{font-size:15px}.pd-j-act{position:sticky;left:0;background:#fff;box-shadow:3px 0 5px -2px rgba(0,0,0,.18)}.pd-nd-tbl th.pd-j-act{background:#f6f4ee}.pd-jtbl td{overflow:visible;text-overflow:clip;white-space:normal}.pd-nd-tbl tr.go{cursor:pointer}.pd-nd-tbl tr.go:hover{background:#f3f8ff}
      .pd-nd-miss{display:inline-block;background:#fdecea;color:#b3261e;border-radius:9px;padding:1px 8px;font-size:11.5px;margin-inline-end:4px}.pd-nd-ok{display:inline-block;background:#e6f4ea;color:#1e7e4a;border-radius:9px;padding:1px 8px;font-size:11.5px;margin-inline-end:4px}.pd-nd-sug{display:inline-block;background:#fff4d6;color:#7a5a00;border-radius:9px;padding:1px 8px;font-size:12px;cursor:help}.pd-nd-hl mark{background:#ffe58a}.pd-nd-n{font-size:20px;font-weight:700;color:#b85c00}.pd-nd-bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:8px 0}`;
    document.head.appendChild(st);
  }
  function openDash(tab) {          // הדשבורד הוא דף (תצוגה) של הניהול, לא חלון קופץ
    ND.tab = tab || ND.tab || "a"; ndCss();
    if (typeof view !== "undefined" && view === "dash") { dashPage(document.getElementById("app")); return; }
    setView("dash");
  }
  function dashPage(app) {          // נקרא מ-render() של דף הניהול; אם הדף כבר מוצג, רק מרעננים את התוכן (כדי לא לאבד העלאה באמצע)
    if (!app) return;
    if (!($("pd-nd-body") && $("pd-nd-tabs") && app.contains($("pd-nd-body")))) {
      app.innerHTML = `<div class="admin-tabs" id="pd-nd-tabs"></div><div id="pd-nd-body"></div>`;
    }
    (S.loaded ? Promise.resolve() : load()).then(() => loadNames()).then(ndShow);
    if (S.loaded) ndShow();
  }
  function ndShow() {
    if (!$("pd-nd-body") || !$("pd-nd-tabs")) return;
    $("pd-nd-tabs").innerHTML = [["a", "חברות שחסרים להן שטרות"], ["b", "שטרות שמחכים לשיוך"], ["c", "חברות לא רשומות"]]
      .map(([t, l]) => `<button class="${ND.tab === t ? "active" : ""}" onclick="PD._ndTab('${t}')"><span>${l}</span><span class="pd-tabn" ${t === "d" || t === "f" ? 'style="visibility:hidden"' : ""}>${t === "d" || t === "f" ? 0 : ndCount(t)}</span></button>`).join("");
    if (ND.tab === "e") $("pd-nd-tabs").innerHTML = `<button class="active"><span>👥 מצטרפים</span>${J.total ? ` <span class="pd-tabn">${ndCount("e")}</span>` : ""}</button>`;          // מצטרפים: מסך נפרד, לא לשונית של ניהול השטרות
    const body = $("pd-nd-body"), keepEl = document.activeElement && (["pd-nd-q", "pd-nd-jq", "pd-f-q", "pd-nd-tq"].includes(document.activeElement.id) || /^pd-cf-/.test(document.activeElement.id)) && body.contains(document.activeElement) ? document.activeElement : null, ks = keepEl ? [keepEl.selectionStart, keepEl.selectionEnd] : null;
    if (ND.tab === "d") {          // העלאה בתוך הלשונית (אותו מנגנון של חלון ההעלאה); לא מציירים מחדש באמצע העלאה
      if (!$("pd-up-body")) { body.innerHTML = '<div id="pd-up-body"></div>'; U.queue = []; U.cur = null; U.preset = null; U.addCompany = false; upPick(); }
      return;
    }
    body.innerHTML = ND.tab === "a" ? ndTabA() : ND.tab === "b" ? ndTabB() : ND.tab === "e" ? ndTabE() : ndTabC();
    if (keepEl) { const n = $(keepEl.id); if (n) { n.replaceWith(keepEl); keepEl.focus(); try { keepEl.setSelectionRange(ks[0], ks[1]); } catch { /* בלי בחירה */ } } }          // שדה החיפוש נשאר אותו אלמנט: ההקלדה לא נקטעת ולא נאבדים תווים
  }
  const ndSearchBox = ph => `<input class="pd-in" id="pd-nd-q" style="flex:1;min-width:220px" placeholder="${ph}" value="${E(ND.tab === "c" ? ND.sq : ND.q)}" oninput="PD._ndQ(this.value)" autocomplete="off">`;
  function ndTabA() {
    const rows = ndMissing(), M_ = [["all", "הכל"], ["private", "חסר פרטי"], ["general", "חסר כללי"], ["both", "חסרים שניהם"]];
    return `<div class="pd-nd-bar">${ndSearchBox("חיפוש חברה: שם או ח.פ.")}<span class="pd-btns">${M_.map(([k, l]) => `<button class="pd-mini ${ND.miss === k ? "sel" : ""}" onclick="PD._ndMiss('${k}')">${l}</button>`).join("")}</span></div>
      <div class="pd-nd-bar" style="margin-top:6px"><button class="pd-mini ${ND.sug ? "sel" : ""}" onclick="PD._ndSug()" title="רק חברות שיש להן שטרות נוספים או הצעות נוספות">חברות עם שטרות/הצעות נוספות</button></div>
      <div class="pd-sub" style="margin-bottom:6px">כל חברה שרשומה ברשימת הפרטי או הכללי צריכה הת"ע משויך מאותו סוג. לחיצה על שורה פותחת את ניהול המסמכים של החברה.</div>
      <table class="pd-nd-tbl"><thead><tr><th>חברה</th><th>ח.פ. / ח.צ.</th><th>הת"ע פרטי</th><th>הת"ע כללי</th><th>שטרות נוספים</th><th>הצעות נוספות</th><th>הערה (מרשימת החברות)</th><th>העלאה</th></tr></thead><tbody>${rows.map(e => {
        const b = e.b, one = t => { const d = slotDoc(b.id, t); return d ? `<span class="pd-nd-ok" title="${E(d.original_name || "")}">קיים</span>` : needOf(b)[t] ? `<span class="pd-nd-miss">חסר</span>` : `<span class="pd-sub">-</span>`; };
        return `<tr class="go" onclick="PD.openManage('${b.id}')"><td><b>${displayName(b)}</b>${stTag(b.registry_status)}</td><td dir="ltr" style="text-align:right">${E(b.chp_number || "")}</td>
          <td>${one("private")}</td><td>${one("general")}</td><td class="pd-nd-n">${e.ex.length || ""}</td><td>${e.sug.length ? `<span class="pd-nd-sug" title="${E(e.sug.map(x => (x.d.original_name || x.d.id) + " (" + x.why + ")").join("\n"))}">💡 ${e.sug.length} ${e.sug.length === 1 ? "הצעה" : "הצעות"}</span>` : ""}</td><td style="font-size:12px;max-width:260px" title="${E(b.notes || "")}">${E((b.notes || "").trim())}</td><td><button class="pd-mini" onclick="event.stopPropagation();PD._rowUp('${b.id}')" title="העלאת מסמך עבור החברה, ובחירת הת&quot;ע שאליו לקשר">⬆ העלאת מסמך</button></td></tr>`; }).join("") || `<tr><td colspan="8" class="pd-sub">אין חברות שחסרים להן שטרות בסינון הזה.</td></tr>`}</tbody></table>`;
  }
  function ndTabB() {
    const f = ND.q.trim().toLowerCase(), rows = ndDocsB().filter(d => !f || docHay(d).includes(f))
      .sort((a, b) => sugOf(b).length - sugOf(a).length || String(a.source_title || a.original_name).localeCompare(String(b.source_title || b.original_name), "he"));
    return `
      <div class="pd-sub" style="margin-bottom:6px">שטרות שאינם משויכים לאף חברה. הצעות השיוך לפי ח.פ. או שם החברה שנמצאו בתוך המסמך (טקסט, חותמת או כתב יד), ולפי הפוסט והכותרת. שמות כלליים שמופיעים במסמכים רבים (כמו שם המכון) מדולגים. לחיצה פותחת את החלון הרגיל לשיוך.</div>
      <table class="pd-nd-tbl"><thead><tr><th>שטר</th><th>כותרת / פוסט</th><th>הצעות שיוך (לפי ח.פ. שנמצא במסמך, ולפי הפוסט)</th><th>הערה</th></tr></thead><tbody>${rows.map(d => {
        const byChp = ndChpMap(), fromHp = hpFound(d).map(h => ({ b: byChp.get(hp9(h.hp)), src: h.src })).filter(x => x.b);
        const seen = new Set(), sg = [...fromHp.map(x => ({ b: x.b, why: ({ text: "ח.פ. בטקסט", stamp: "ח.פ. בחותמת", hand: "ח.פ. בכתב יד" })[x.src] || "ח.פ." })), ...companiesByName(d).map(b => ({ b, why: "שם החברה במסמך" })), ...sugOf(d).map(x => ({ b: bizById(x.id), why: "פוסט / כותרת" }))]
          .filter(x => x.b && !seen.has(x.b.id) && seen.add(x.b.id));
        return `<tr class="go" onclick="PD._ndOpenDoc('${d.id}')"><td>${E(d.original_name || d.id)}</td><td>${E(postTitle(d))}</td><td>${sg.slice(0, 4).map(x => `<span class="pd-nd-ok" title="${E(x.why)}">${displayName(x.b)}</span>`).join("") || '<span class="pd-sub">אין</span>'}${sg.length > 4 ? ` <span class="pd-sub">+${sg.length - 4}</span>` : ""}</td><td class="pd-sub">${E(d.note || "")}</td></tr>`; }).join("") || `<tr><td colspan="4" class="pd-sub">אין שטרות שמחכים לשיוך.</td></tr>`}</tbody></table>`;
  }
  function hpFound(d) { hpMaps(); return (S.hpBy && S.hpBy.get(d.id)) || []; }
  function ndChpMap() { if (!S._chpMap || S._chpN !== bizList().length) { S._chpN = bizList().length; S._chpMap = new Map(bizList().filter(b => (b.chp_number || "").trim()).map(b => [hp9(b.chp_number), b])); } return S._chpMap; }
  let ndTextSeq = 0;
  async function ndTextSearch(q) {          // חיפוש בתוך טקסט המסמכים (אינדקס FTS ב-D1)
    const box = $("pd-nd-tres"), seq = ++ndTextSeq; if (!box) return;
    q = String(q || "").trim();
    if (q.length < 2) { box.innerHTML = ""; return; }
    box.innerHTML = '<div class="pd-sub">מחפש…</div>';
    let r; try { r = (await api("/permit-text?q=" + encodeURIComponent(q))).results || []; } catch (e) { if (seq === ndTextSeq) box.innerHTML = `<div class="pd-sub">החיפוש בטקסט לא זמין (${E(e.message)})</div>`; return; }
    if (seq !== ndTextSeq) return;
    box.innerHTML = r.length ? `<table class="pd-nd-tbl"><thead><tr><th>מסמך</th><th>עמוד</th><th>קטע</th><th>שיוך</th></tr></thead><tbody>` + r.map(x => {
      const d = S.byId.get(x.id), cos = d ? (d.business_ids || []).map(b => displayName(bizById(b) || { permit_name: "?" })).join(", ") : "";
      return `<tr class="go" onclick="PD.openDoc('${x.id}')"><td>${E(x.name || x.id)}</td><td>${x.page}</td><td class="pd-nd-hl">${E(x.snippet || "").replace(/\[/g, "<mark>").replace(/\]/g, "</mark>")}</td><td class="pd-sub">${cos ? E(cos) : "לא משויך"}</td></tr>`; }).join("") + "</tbody></table>" : '<div class="pd-sub">לא נמצא בטקסט המסמכים</div>';
  }
  // ───────── לשונית חיפוש: בצד אחד חברות (מאגר + רשם, התאמה מקורבת), בצד השני חיפוש בתוך טקסט השטרות ─────────
  function ndTabF() {
    return `<div class="pd-f-cols"><div class="pd-f-col"><h4>חיפוש חברות (מהמאגר ומהרשם)</h4>
        <input class="pd-in" id="pd-f-q" value="${E(ND.fq)}" placeholder="שם חברה / שותפות / עמותה, או ח.פ." oninput="PD._fQ(this.value)" autocomplete="off"><div id="pd-f-res" style="margin-top:8px"></div></div>
      <div class="pd-f-col"><h4>חיפוש בתוך השטרות</h4>
        <input class="pd-in" id="pd-nd-tq" value="${E(ND.tq)}" placeholder="חיפוש בטקסט של כל המסמכים (למשל: מסלול הלכה)" oninput="PD._ndTq(this.value)" autocomplete="off"><div id="pd-nd-tres" style="margin-top:8px"></div></div></div>`;
  }
  const levelColor = { "פרטי": "#7a3b8f", "כללי": "#1e4570", "רק פרטי": "#b8860b" };
  function fCard(b, sc) {
    const need = needOf(b), one = t => { const d = slotDoc(b.id, t); return d ? `<span class="pd-nd-ok">${SLOT_HE[t]}: קיים</span>` : need[t] ? `<span class="pd-nd-miss">${SLOT_HE[t]}: חסר</span>` : ""; };
    const lv = regLabel(b), ex = extrasOf(b.id).length, type = b.entity_type || b.biz_type || "";
    return `<div class="pd-reg" style="cursor:pointer" onclick="PD.openManage('${b.id}')"><div><b>${displayName(b, true)}</b>${stTag(b.registry_status)} <span class="pd-chip" style="background:${levelColor[lv] || "#555"}" title="הרישום ברשימות האתר">${lv}</span>${sc < 1 ? ' <span class="pd-sub">(שם דומה)</span>' : ""}</div>
      <div class="pd-sub">${E(b.chp_number || "ללא ח.פ.")}${type ? " · " + E(type) : ""}</div>
      <div class="pd-btns" style="margin-top:4px;align-items:center">${one("private")}${one("general")}${ex ? `<span class="pd-sub">שטרות נוספים: ${ex}</span>` : ""}${!slotDoc(b.id, "private") && !slotDoc(b.id, "general") && !ex ? '<span class="pd-sub">אין שטר</span>' : ""}</div></div>`;
  }
  async function fSearch() {
    const box = $("pd-f-res"), q = ND.fq.trim(); if (!box) return;
    if (q.length < 2) { box.innerHTML = ""; return; }
    const seq = ND._fseq = (ND._fseq || 0) + 1, dg = q.replace(/\D/g, "");
    const local = bizList().map(b => ({ b, sc: (dg.length >= 4 && (b.chp_number || "").includes(dg)) ? 2 : Math.max(fuzzy(q, b.registrar_name), fuzzy(q, b.permit_name), fuzzy(q, displayName(b))) })).filter(x => x.sc >= 0.5).sort((a, b) => b.sc - a.sc).slice(0, 15);
    const exts = S.ext.map(x => ({ x, sc: (dg.length >= 4 && (x.chp || "").includes(dg)) ? 2 : fuzzy(q, x.name) })).filter(r => r.sc >= 0.5).sort((a, b) => b.sc - a.sc).slice(0, 6);
    box.innerHTML = `<div class="pd-grp">במאגר שלנו${local.length ? "" : ": לא נמצא"}</div>` + local.map(r => fCard(r.b, r.sc)).join("") +
      (exts.length ? `<div class="pd-grp weak">חברות לא רשומות (יש להן שטר)</div>` + exts.map(r => `<div class="pd-reg"><b>${E(r.x.name)}</b> <span class="pd-st bad">${EXT_HE[r.x.status] || r.x.status}</span><div class="pd-sub">${E(r.x.chp || "")} · ${(r.x.doc_ids || []).length} שטרות</div></div>`).join("") : "") +
      `<div id="pd-f-reg" class="pd-sub" style="margin-top:8px">${q.length >= 3 ? "בודק גם ברשם החברות…" : "הקלד 3 תווים לפחות כדי לחפש גם ברשם"}</div>`;
    if (q.length < 3) return;
    let d; try { d = await api("/registry-name-search?q=" + encodeURIComponent(q)); } catch (e) { if (seq === ND._fseq && $("pd-f-reg")) $("pd-f-reg").textContent = "הבדיקה ברשם לא זמינה (" + e.message + ")"; return; }
    if (seq !== ND._fseq || !$("pd-f-reg")) return;
    const byChp = new Map(bizList().filter(b => digitsOf(b.chp_number)).map(b => [digitsOf(b.chp_number), b])), shown = new Set(local.map(x => x.b.id)), inExt = new Set(S.ext.map(x => digitsOf(x.chp)).filter(Boolean)), seen = new Set();
    const rs = (d.results || []).filter(r => !seen.has(digitsOf(r.id)) && seen.add(digitsOf(r.id)));
    $("pd-f-reg").innerHTML = `<div class="pd-grp" style="color:#c0392b">ברשם החברות / העמותות</div>` + (rs.slice(0, 15).map(r => {
      const b = byChp.get(digitsOf(r.id)); if (b && shown.has(b.id)) return "";
      if (b) return fCard(b, 1);
      const tag = inExt.has(digitsOf(r.id)) ? '<span class="pd-nd-ok">ברשימת הלא רשומות</span>' : '<span class="pd-nd-miss">לא במאגר</span>';
      return `<div class="pd-reg"><div><b>${E(r.name)}</b> ${tag}${r.defunct ? ' <span class="pd-tag red">⚠ מחוסלת / נמחקה</span>' : ""}</div><div class="pd-sub">${E(r.type || "")} · ${chpLbl(r.id, r.type)} ${E(r.id)}${r.status ? " · " + E(r.status) : ""}</div></div>`; }).join("") || `<div class="pd-sub">לא נמצא ברשם</div>`) + (d.more ? `<div class="pd-sub">יש עוד תוצאות: חדדו את החיפוש</div>` : "");
  }
  function searchPage(el) {          // דף "חיפוש" בראשי הניהול (במקום לשונית בדשבורד)
    if (!el) return;
    el.innerHTML = ndTabF();
    const go = () => { if ($("pd-f-q")) { if (ND.fq.trim().length >= 2) fSearch(); if (ND.tq.trim().length >= 2) ndTextSearch(ND.tq); } };
    go(); (S.loaded ? Promise.resolve() : load()).then(() => loadNames()).then(go);
  }
  function ndTabC() {
    const q = ND.sq.trim();
    return `<div class="pd-nd-bar">${ndSearchBox("חיפוש בכל החברות והעמותות: שם או ח.פ.")}<label class="pd-sub"><input type="checkbox" ${ND.gone ? "checked" : ""} onchange="PD._ndGone(this.checked)"> הצג גם מחוקות / מוזגו</label></div>
      ${q.length >= 2 ? `<div id="pd-nd-res" class="pd-sub">מחפש…</div>` : ndExtTable()}`;
  }
  function extGroups() {          // חברה אחת = שורה אחת (לפי ח.פ., ובלעדיו לפי שם), גם אם נרשמה כמה פעמים ברשימת החברות שאינן במאגר
    const m = new Map();
    for (const x of ndExt()) {
      const k = digitsOf(x.chp) || NORMN(x.name), g = m.get(k) || { name: x.name, chp: x.chp || "", status: x.status, ids: [], docs: new Set() };
      g.ids.push(x.id); for (const id of x.doc_ids || []) g.docs.add(id);
      if (!g.chp && x.chp) g.chp = x.chp;
      m.set(k, g);
    }
    return [...m.values()].sort((a, b) => String(a.name).localeCompare(String(b.name), "he"));
  }
  function ndExtTable() {
    const rows = extGroups();
    return `<div class="pd-sub" style="margin-bottom:6px">חברות שיש להן שטר במאגר, אבל אינן ברשימת העסקים. ברירת מחדל בלי מחוקות ומוזגו. "הוספת חברה לרשימה" פותחת את טופס הוספת העסק עם הח.פ., ואחרי השמירה השטרות של החברה משויכים אליה אוטומטית.</div>
      <table class="pd-nd-tbl"><thead><tr><th>חברה</th><th>ח.פ. / ח.צ.</th><th>סטטוס</th><th>שטרות</th><th></th></tr></thead><tbody>${rows.map((g, i) => `<tr><td><b>${E(g.name)}</b></td><td dir="ltr" style="text-align:right">${E(g.chp)}</td><td>${EXT_HE[g.status] || g.status}</td>
        <td class="pd-nd-n">${g.docs.size} <button class="pd-mini" onclick="PD._evOpen(${i})" title="הצגת כל השטרות של החברה">הצגה</button></td>
        <td><button class="pd-mini primary" onclick="PD._ndAddCo(${i})" ${digitsOf(g.chp) ? "" : 'title="אין ח.פ.: נפתח טופס עסק בלי ח.פ. עם השם"'}>הוספת חברה לרשימה</button></td></tr>`).join("") || `<tr><td colspan="5" class="pd-sub">הרשימה ריקה.</td></tr>`}</tbody></table>`;
  }
  function extDone(g) {          // אחרי שהחברה נוספה / נבחרה: שיוך כל השטרות שלה אליה והסרתה מרשימת "לא רשומות"
    return async bid => {
      try {
        for (const id of g.docs) { const d = S.byId.get(id); if (d && !(d.business_ids || []).includes(bid)) await api("/permit-docs/" + id, "PUT", { business_ids: [...(d.business_ids || []), bid] }); }
        for (const id of g.ids) await api("/permit-ext/" + id, "DELETE").catch(() => {});
      } catch (e) { alert("החברה נוספה, אבל שיוך השטרות נכשל: " + e.message); }
      close("pd-extv"); S.loaded = false; S.loading = false; await load(); openDash("c");
    };
  }
  function extAdd(g, name) {          // הוספה לרשימת העסקים: עם ח.פ. - מהרשם; בלי ח.פ. - טופס "עסק בלי ח.פ." עם השם ממולא (name ריק = טופס חדש)
    const done = extDone(g);
    if (digitsOf(g.chp)) { addReg(digitsOf(g.chp).padStart(9, "0"), GONE.includes(g.status), done); return; }
    pendingAdd = { chp: "", added: done };
    ["pd-confirm", "pd-un", "pd-upload", "pd-doc", "pd-manage", "pd-company", "pd-extv"].forEach(close);
    if (typeof openForm === "function") { openForm(null); setTimeout(() => {
      if (typeof toggleNoChp === "function") toggleNoChp();
      if (name) setTimeout(() => { const r = document.getElementById("f-reg"); if (r) { r.value = name; r.dispatchEvent(new Event("input", { bubbles: true })); } if (typeof editBiz !== "undefined") editBiz = { ...(editBiz || {}), registrar_name: name }; }, 100);
    }, 150); }
  }
  function ndAddCo(i) { const g = extGroups()[i]; if (g) extAdd(g, g.name); }
  // ───────── הצגת שטרות של חברה לא רשומה: כרטיס החברה (מהרשם / השם המוצע) להוספה לרשימה, חיפוש חברה אחרת, או חברה חדשה ─────────
  const EV = { i: -1, reg: null };
  function evGroup() { return extGroups()[EV.i]; }
  function evOpen(i) {
    const g = extGroups()[i]; if (!g) return;
    EV.i = i; EV.reg = null;
    overlay("pd-extv", `<div class="pd-head"><b>שטרות של ${E(g.name)} (${g.docs.size})</b><button class="pd-x" onclick="PD._close('pd-extv')">✕</button></div><div class="pd-body" id="pd-ev-body"></div>`, true);
    evPaint();
    if (digitsOf(g.chp)) api("/lookup?number=" + encodeURIComponent(digitsOf(g.chp).padStart(9, "0"))).then(r => { if (EV.i === i && r && r.found) { EV.reg = r; evPaint(); } }).catch(() => {});
  }
  function evPaint() {
    const body = $("pd-ev-body"), g = evGroup(); if (!body || !g) return;
    const q = ($("pd-ev-q") || {}).value || "", r = EV.reg;
    const card = `<div class="pd-dup" style="cursor:pointer;max-width:520px" onclick="PD._evAdd()" title="הוספת החברה לרשימה ושיוך כל השטרות שלה">
        <div class="pd-sub">${r ? "נתוני החברה מהרשם" : "שם החברה המוצעת"}</div><b style="font-size:16px">${E(r ? r.name : g.name)}</b>
        <div style="margin-top:4px">${g.chp ? `${chpLbl(g.chp, r && r.type)}: <b><bdi>${E(g.chp)}</bdi></b>` : "אין ח.פ."}${r && r.type ? " · " + E(r.type) : ""}${r && r.status ? " · " + E(r.status) : ""}${!r && g.status ? " · " + (EXT_HE[g.status] || E(g.status)) : ""}</div>
        <div style="margin-top:8px;color:#1e7e4a;font-weight:700">➕ להוספה לרשימה</div></div>`;
    const docs = [...g.docs].map(id => S.byId.get(id)).filter(Boolean);
    body.innerHTML = card + `<div style="margin:12px 0 4px"><input class="pd-in" id="pd-ev-q" value="${E(q)}" placeholder="חיפוש חברה אחרת (ח.פ. / שם) לשיוך השטרות אליה" oninput="PD._evSearch(this.value)" autocomplete="off" style="max-width:520px"><div id="pd-ev-res" style="max-width:520px"></div>
      <button class="pd-btn" style="margin-top:8px" onclick="PD._evNew()">➕ הוספת חברה חדשה</button></div>
      <h4 style="margin:16px 0 8px">שטרות (${docs.length})</h4><div class="pd-mg-grid">${docs.map(d => { const th = thumbUrls.get(d.id), open = `PD.openDoc('${d.id}','',true)`;
        return `<div class="pd-mg-card"><div class="pd-mg-l"><div class="pd-mg-th" onclick="${open}"><img data-thumb="${d.id}" alt="" ${th ? `src="${th}"` : ""}><span class="pd-mg-ld" ${th ? 'style="display:none"' : ""}>טוען…</span></div>${pgHtml(d)}</div>
          <div class="pd-mg-r"><div class="pd-name" style="cursor:pointer;text-decoration:underline" onclick="${open}">${E(d.original_name || d.id)}</div><div class="pd-sub">${sizeHtml(d.size)} ${dateHtml(d)}</div><div class="pd-btns"><button class="pd-mini" onclick="${open}">צפייה</button></div></div></div>`; }).join("")}</div>`;
    body.querySelectorAll("img[data-thumb]").forEach(img => thumb(img.dataset.thumb).then(u => { if (img.isConnected && u) { img.src = u; if (img.nextElementSibling) img.nextElementSibling.style.display = "none"; } }));
    if (q) evSearch(q);
  }
  function evSearch(q) {
    const g = evGroup(), out = $("pd-ev-res"); if (!g || !out) return;
    runCompanySearch(q, out, { exclude: () => false, pick: id => evPick(id), mkAdded: () => extDone(g) });
  }
  async function evPick(bid) {
    const g = evGroup(), b = bizById(bid); if (!g || !b) return;
    if (!confirm(`לשייך את ${g.docs.size} השטרות ל"${displayName(b)}" ולהסיר את "${g.name}" מרשימת החברות הלא רשומות?`)) return;
    await extDone(g)(bid);
  }
  const evAddNew = () => { const g = evGroup(); if (g) extAdd({ ...g, chp: "" }, ""); };
  async function ndSearchC() {          // חיפוש בחברות שלנו (עם התאמה מקורבת) + ברשם החברות
    const box = $("pd-nd-res"), q = ND.sq.trim(); if (!box) return;
    const seq = ND._seq = (ND._seq || 0) + 1, dg = q.replace(/\D/g, "");
    const local = bizList().map(b => ({ b, sc: (dg.length >= 4 && (b.chp_number || "").includes(dg)) ? 2 : Math.max(fuzzy(q, b.registrar_name), fuzzy(q, b.permit_name), fuzzy(q, displayName(b))) })).filter(x => x.sc >= 0.5).sort((a, b) => b.sc - a.sc).slice(0, 12);
    const exts = S.ext.map(x => ({ x, sc: (dg.length >= 4 && (x.chp || "").includes(dg)) ? 2 : fuzzy(q, x.name) })).filter(r => r.sc >= 0.5).sort((a, b) => b.sc - a.sc).slice(0, 8);
    const loc = `<div class="pd-grp">במאגר שלנו${local.length ? "" : ": לא נמצא"}</div>` + local.map(r => `<button class="pd-pick" onclick="PD.openManage('${r.b.id}')">${displayName(r.b, true)} <span class="pd-sub">${E(r.b.chp_number || "")}</span>${stTag(r.b.registry_status)}${r.sc < 1 ? ' <span class="pd-sub">(שם דומה)</span>' : ""}</button>`).join("") +
      (exts.length ? `<div class="pd-grp weak">ברשימת החברות שאינן במאגר</div>` + exts.map(r => `<div class="pd-pick" style="cursor:default;border-color:#c9b46a;background:#fffaf0">${E(r.x.name)} <span class="pd-sub">${E(r.x.chp || "")}</span> <span class="pd-st bad">${EXT_HE[r.x.status] || r.x.status}</span> ${(r.x.doc_ids || []).length} שטרות</div>`).join("") : "");
    box.innerHTML = loc + `<div id="pd-nd-reg" class="pd-sub" style="margin-top:8px">${q.length >= 3 ? "בודק גם ברשם החברות…" : "הקלד 3 תווים לפחות כדי לחפש גם ברשם"}</div>`;
    if (q.length < 3) return;
    let d; try { d = await api("/registry-name-search?q=" + encodeURIComponent(q)); } catch (e) { if (seq === ND._seq && $("pd-nd-reg")) $("pd-nd-reg").textContent = "הבדיקה ברשם לא זמינה (" + e.message + ")"; return; }
    if (seq !== ND._seq || !$("pd-nd-reg")) return;
    const inDb = new Set(bizList().map(b => digitsOf(b.chp_number)).filter(Boolean)), inExt = new Set(S.ext.map(x => digitsOf(x.chp)).filter(Boolean)), seen = new Set();
    const rs = (d.results || []).filter(r => !seen.has(digitsOf(r.id)) && seen.add(digitsOf(r.id)));
    $("pd-nd-reg").innerHTML = `<div class="pd-grp" style="color:#c0392b">ברשם החברות / העמותות</div>` + (rs.slice(0, 15).map(r => { const k = digitsOf(r.id), tag = inDb.has(k) ? '<span class="pd-nd-ok">במאגר שלנו</span>' : inExt.has(k) ? '<span class="pd-nd-ok">ברשימת השאינן במאגר</span>' : '<span class="pd-nd-miss">לא במאגר</span>';
      return `<div class="pd-reg"><div><b>${E(r.name)}</b> ${tag}${r.defunct ? ' <span class="pd-tag red">⚠ מחוסלת / נמחקה</span>' : ""}</div><div class="pd-sub">${E(r.type || "")} · ${chpLbl(r.id, r.type)} ${E(r.id)}${r.status ? " · " + E(r.status) : ""}</div></div>`; }).join("") || `<div class="pd-sub">לא נמצא ברשם</div>`) + (d.more ? `<div class="pd-sub">יש עוד תוצאות: חדדו את החיפוש</div>` : "");
  }

  // ───────── מצטרפים להיתר עיסקא (נתונים אישיים: מנהל בלבד; מפוענחים בשרת ונשארים רק בזיכרון הדף) ─────────
  const J = { rows: null, total: 0, cancels: 0, loading: false, err: "", q: "", f: "all", fa: "all", cf: {}, shown: 200, open: "", view: "list", cl: null, clErr: "" };
  const jUserBusy = () => { const a = document.activeElement, b = $("pd-nd-body"); return !!(J.q || J.f !== "all" || J.fa !== "all" || Object.values(J.cf).some(v => String(v || "").trim()) || (a && b && b.contains(a) && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName))); };
  const jProg = () => { const el = $("pd-j-prog"); if (el) el.textContent = J.loading ? `נטען ${J.rows.length} מתוך ${J.total}… ` : ""; };
  async function jLoad() {
    if (J.loading || J.rows) return;
    J.loading = true; J.err = ""; J.rows = [];
    try {
      for (let off = 0; ; off += 400) {
        const r = await api(`/joiners?offset=${off}&limit=400`);
        J.total = r.total; J.cancels = r.cancels; J.rows.push(...r.rows);
        if (ND.tab === "e") { if (off === 0 || !jUserBusy()) ndShow(); else jProg(); }          // כל עוד המשתמש מסנן / מקליד: לא מציירים מחדש בכל קבוצה (זה קוטע את הסינון), רק מעדכנים את המונה
        if (off + 400 >= r.total) break;
      }
    } catch (e) { J.err = e.message || "שגיאה"; J.rows = null; }
    J.loading = false;
    if (ND.tab === "e") ndShow();
  }
  const jName = r => `${r.first} ${r.last}`.trim() || "(בלי שם)";
  const jDate = v => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v || ""); return m ? `${m[3]}/${m[2]}/${m[1]}` : ""; };          // יום/חודש/שנה
  // הקלטות של מצטרף טלפוני (שדות "הקלטת ..." ב-extra): סמל קטן להשמעה לכל הקלטה
  const J_REC = { "הקלטת שם פרטי": "פרטי", "הקלטת שם משפחה": "משפחה", "הקלטת כתובת": "כתובת", "הקלטת אימייל": "מייל", "הקלטת חברות": "חברות" };
  function jRecs(r) { if (!r.extra || r.extra.indexOf("הקלטת") < 0) return []; try { const x = JSON.parse(r.extra); return Object.keys(J_REC).filter(k => typeof x[k] === "string" && x[k]); } catch { return []; } }
  const J_RECCOL = { "הקלטת שם פרטי": "first", "הקלטת שם משפחה": "last", "הקלטת כתובת": "addr", "הקלטת אימייל": "email", "הקלטת חברות": "co" };   // הסמל מופיע בעמודה של השדה שהוקלט
  // ניגון נכשל: בודקים מה השרת החזיר בפועל (הודעת שגיאה / עמוד חסימה / פורמט שמע לא נתמך) ומציגים סיבה מפורשת
  async function jWhy(url, e) {
    try {
      const res = await fetch(url), buf = new Uint8Array(await res.arrayBuffer()), tx = n => String.fromCharCode(...buf.slice(0, n));
      if (res.status === 418) return "נטפרי חוסם את קובץ השמע (שגיאה 418). יש לבקש מנטפרי לפתוח את הכתובת harav-levin.pages.dev/api/joiner-audio. " + new TextDecoder().decode(buf.slice(0, 200)).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
      if (!res.ok) { try { return JSON.parse(new TextDecoder().decode(buf)).error || "שגיאת שרת " + res.status; } catch { return "שגיאת שרת " + res.status; } }
      if (tx(4) === "RIFF") { const dv = new DataView(buf.buffer); return `הדפדפן לא מנגן את הקובץ (פורמט ${dv.getUint16(20, true)}, ${dv.getUint32(24, true)}Hz, ${dv.getUint16(34, true)} ביט, ${buf.length} בתים)`; }
      return `התקבל תוכן שאינו קובץ שמע (${res.headers.get("content-type") || "?"}): ${new TextDecoder().decode(buf.slice(0, 80)).replace(/\s+/g, " ")}`;
    } catch (x) { return (e && e.message || "") + " (בקשת האבחון נכשלה: " + x.message + ")"; }
  }
  let jAud = null;
  async function jPlay(id, i, btn) {
    const r = J.rows.find(x => x.id === id), k = r && jRecs(r)[i];
    if (!k) return;
    if (jAud) { jAud.pause(); jAud = null; }
    const old = btn.textContent; btn.textContent = "⏳"; btn.disabled = true;
    try {
      // קישור חתום קצר-תוקף (בקשת JSON רגילה), ואז ניגון כרכיב שמע רגיל מהכתובת הזו
      const res = await fetch("/api/joiner-audio?sign=1&id=" + encodeURIComponent(id) + "&k=" + encodeURIComponent(k), { headers: authH() });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.url) throw new Error(j.error || res.statusText);
      jAud = new Audio(j.url);
      try { await jAud.play(); } catch (e) { throw new Error(await jWhy(j.url, e)); }
    } catch (e) { alert("השמעת ההקלטה נכשלה: " + e.message); }
    btn.textContent = old; btn.disabled = false;
  }
  // שדות מתוך extra (JSON שנכתב ע"י הטופס/הטלפון); רשומות ישנות עם טקסט חופשי נשארות בלי שדות מפורקים
  // מקור ההרשמה: טלפון (ימות) / נדרים פלוס / קהילות / אתר (הטופס המוטמע בוורדפרס) / אתר ישן / ידני
  function jSrc(r, o) {
    const s = String(r.src || "");
    if (/טלפון/.test(o["ערוץ"] || "")) return "טלפון";
    if (/^nedarim/.test(s)) return "נדרים פלוס";
    if (s === "site:embed") return "אתר";
    if (s === "site:kehilot") return "קהילות";
    if (/^cfdb7/.test(s)) return "אתר ישן";
    if (s === "admin") return "ידני";
    return "";
  }
  function jX(r) {
    if (r._x) return r._x;
    let o = {}; try { const j = JSON.parse(r.extra || ""); if (j && typeof j === "object" && !Array.isArray(j)) o = j; } catch { /* טקסט חופשי */ }
    const shown = new Set(["כתובת", "טלפון נוסף", "פקס", "ערוץ", ...Object.keys(J_REC)]);
    return (r._x = { addr: String(o["כתובת"] || ""), phone2: String(o["טלפון נוסף"] || ""), fax: String(o["פקס"] || ""), src: jSrc(r, o),
      rest: Object.keys(o).filter(k => !shown.has(k) && o[k]).map(k => `${k}: ${o[k]}`).join(" · "), raw: Object.keys(o).length ? "" : String(r.extra || "") });
  }
  // עמודות הטבלה: nar = צרה (בלי שבירת שורה), ltr = מספרים/אימייל
  const J_COLS = [
    { k: "date", h: "תאריך", nar: 1, ltr: 1, v: r => jDate(r.submitted_at) },
    { k: "first", h: "שם פרטי", v: r => r.first },
    { k: "last", h: "שם משפחה", v: r => r.last },
    { k: "id", h: "ת.ז.", nar: 1, ltr: 1, v: r => r.id_number },
    { k: "phone", h: "טלפון", nar: 1, ltr: 1, v: r => `${r.phone} ${jX(r).phone2}`.trim() },          // הטלפון הנוסף מוצג מתחת לעיקרי (ומסונן יחד איתו)
    { k: "fax", h: "פקס", nar: 1, ltr: 1, v: r => jX(r).fax },
    { k: "email", h: 'דוא"ל', ltr: 1, v: r => r.email },
    { k: "addr", h: "כתובת", v: r => jX(r).addr },
    { k: "co", h: "חברות", wide: 1, v: r => (r.all ? "לבחירת כל החברות שנרשמו וירשמו בהמשך" + (r.companies ? ": " : "") : "") + (r.companies || "") },
    { k: "src", h: "מקור", nar: 1, v: r => jX(r).src },
  ];
  function jFiltered() {
    const f = J.q.trim().toLowerCase(), d = f.replace(/\D/g, "");
    const dup = new Map(); for (const r of J.rows) if (r.ident_hash) dup.set(r.ident_hash, (dup.get(r.ident_hash) || 0) + 1);
    const cfs = J_COLS.map(c => [c, (J.cf[c.k] || "").trim().toLowerCase()]).filter(x => x[1]);
    const rows = J.rows.filter(r => (J.f === "all" || (J.f === "cancelled" ? r.cancelled_at : !r.cancelled_at)) && (J.fa === "all" || (J.fa === "file" ? r.file_sha256 : !r.file_sha256))
      && cfs.every(([c, q]) => { const v = String(c.v(r) || "").toLowerCase(), dq = q.replace(/\D/g, ""); if (c.k === "src") return v === q; return v.includes(q) || (c.ltr && dq.length >= 3 && v.replace(/\D/g, "").includes(dq)); })
      && (!f || (() => { const h = `${jName(r)} ${r.phone} ${r.email} ${r.companies} ${r.id_number} ${jX(r).addr} ${jX(r).phone2}`.toLowerCase(); return h.includes(f) || (d.length >= 4 && h.replace(/\D/g, "").includes(d)); })()));
    return { rows, dup };
  }
  async function jLoadCancels() {
    J.clErr = ""; J.cl = null;
    try { J.cl = (await api("/joiner-cancels")).rows; J.cancels = J.cl.length; } catch (e) { J.clErr = e.message || "שגיאה"; J.cl = []; }
    if (ND.tab === "e") ndShow();
  }
  function ndCancels() {
    const back = `<button class="pd-mini" onclick="PD._jView('list')">← חזרה לרשימת המצטרפים</button>`;
    if (!J.cl) { return `<div class="pd-nd-bar">${back}</div><div class="pd-sub" style="margin:12px 0">טוען בקשות ביטול…</div>`; }
    return `<div class="pd-nd-bar">${back}</div>${J.clErr ? `<div class="pd-sub" style="color:#c0392b;margin:8px 0">${E(J.clErr)}</div>` : ""}
      <div class="pd-sub" style="margin-bottom:6px">${J.cl.length} בקשות ביטול. "הותאם" = נמצא מצטרף עם אותה ת.ז. והוא סומן כמבוטל אוטומטית. אחרת יש לחפש את המצטרף ולסמן ידנית (עריכה ← תאריך ביטול).</div>
      <div style="overflow-x:auto;max-width:100%"><table class="pd-nd-tbl"><thead><tr><th>תאריך</th><th>שם</th><th>טלפון</th><th>דוא"ל</th><th>ת.ז.</th><th>סטטוס</th><th>פעולות</th></tr></thead><tbody>${J.cl.map(c => `<tr><td dir="ltr" style="text-align:right">${E((c.requested_at || "").slice(0, 16))}</td><td><b>${E(c.name || "-")}</b></td><td dir="ltr" style="text-align:right">${E(c.phone)}</td><td dir="ltr" style="text-align:right">${E(c.email)}</td><td dir="ltr" style="text-align:right">${E(c.id_number || "-")}</td>
        <td>${c.matched ? '<span class="pd-nd-sug">הותאם וסומן כמבוטל</span>' : '<span class="pd-nd-miss">לא הותאם</span>'}${c.undecryptable ? '<span class="pd-nd-miss">לא פוענח</span>' : ""}</td>
        <td style="white-space:nowrap"><button class="pd-mini" onclick="PD._jFind('${c.id}')">🔍 חיפוש מצטרף</button> <button class="pd-mini" style="color:#c0392b" onclick="PD._jCDel('${c.id}')">🗑 מחיקה</button></td></tr>`).join("") || `<tr><td colspan="7" class="pd-sub">אין בקשות ביטול.</td></tr>`}</tbody></table></div>`;
  }
  function ndTabE() {
    if (J.view === "cancels") return ndCancels();
    if (J.err) return `<div class="pd-sub" style="color:#c0392b;margin:12px 0">${E(J.err)} <button class="pd-link" onclick="PD._jRetry()">נסה שוב</button></div>`;
    if (!J.rows) { jLoad(); return `<div class="pd-sub" style="margin:12px 0">טוען את הרשימה…</div>`; }
    const { rows, dup } = jFiltered(), N = J_COLS.length + 4;
    const cell = (c, r) => `<td${c.ltr ? ' dir="ltr"' : ""} style="${c.ltr ? "text-align:right;" : ""}${c.nar ? "white-space:nowrap;" : ""}${c.wide ? "min-width:150px;max-width:240px;" : ""}${c.k === "email" ? "overflow-wrap:anywhere;min-width:90px;max-width:130px;" : ""}${c.k === "first" || c.k === "last" ? "font-weight:700;" : ""}">${c.k === "phone" ? `${E(r.phone)}${jX(r).phone2 ? `<br><span class="pd-sub" title="טלפון נוסף">${E(jX(r).phone2)}</span>` : ""}` : E(c.v(r) || "")}${jRecs(r).map((k, i) => J_RECCOL[k] === c.k ? `<button class="pd-mini" style="padding:0 3px;margin-inline-start:4px;font-size:11px;line-height:1.3" title="השמעת ${E(k)}" aria-label="השמעת ${E(k)}" onclick="event.stopPropagation();PD._jPlay('${r.id}',${i},this)">🔊</button>` : "").join("")}</td>`;
    const sel = (fn, cur, opts) => `<select class="pd-in pd-jsel" onchange="${fn}(this.value)">${opts.map(([k, l]) => `<option value="${k}"${cur === k ? " selected" : ""}>${l}</option>`).join("")}</select>`;
    return `<div class="pd-nd-bar"><input class="pd-in" id="pd-nd-jq" style="flex:1;min-width:220px" placeholder="חיפוש בכל העמודות" value="${E(J.q)}" oninput="PD._jQ(this.value)" autocomplete="off">
        <button class="pd-btn" onclick="PD._jEdit('')">➕ הוספת מצטרף</button>
        <button class="pd-mini" onclick="PD._jView('cancels')">📋 בקשות ביטול (${J.cancels})</button>
        <button class="pd-btn" onclick="PD._jSync()">🔄 סנכרון מהאתר הישן</button> <button class="pd-btn" onclick="PD._jMail()">📧 שליחת אישורים</button> <button class="pd-btn" onclick="PD._jNed()">🔄 משיכה מנדרים פלוס</button></div>
      <div class="pd-sub" style="margin-bottom:6px"><span id="pd-j-prog">${J.loading ? `נטען ${J.rows.length} מתוך ${J.total}… ` : ""}</span>${rows.length} מצטרפים בסינון מתוך ${J.total} (בקשות ביטול: ${J.cancels}). לכל עמודה יש שדה חיפוש משלה (שורה מתחת לכותרות). הפרטים האישיים מפוענחים בשרת, רק למנהל, ולא נשמרים בדפדפן. לחיצה על שורה פותחת פרטים.</div>
      <div style="overflow-x:auto;max-width:100%"><table class="pd-nd-tbl pd-jtbl" style="font-size:12px"><thead><tr>${J_COLS.map(c => `<th${c.nar ? ' style="white-space:nowrap"' : ""}>${c.h}</th>`).join("")}<th class="pd-jnar" style="white-space:nowrap">סטטוס</th><th class="pd-jnar" style="white-space:nowrap">אישור</th><th class="pd-j-act">פעולות</th></tr>
        <tr class="pd-cfrow">${J_COLS.map(c => c.k === "src" ? `<th style="padding:2px 4px;top:30px"><select class="pd-in pd-jsel" aria-label="סינון ${c.h}" onchange="PD._jCF('src',this.value)">${[["", "הכל"], ...[...new Set(J.rows.map(r => String(jX(r).src || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "he")).map(v => [v, v])].map(([k, l]) => `<option value="${E(k)}"${(J.cf.src || "") === k ? " selected" : ""}>${E(l)}</option>`).join("")}</select></th>` : `<th style="padding:2px 4px;top:30px"><input class="pd-in" id="pd-cf-${c.k}" value="${E(J.cf[c.k] || "")}" oninput="PD._jCF('${c.k}',this.value)" autocomplete="off" aria-label="סינון ${c.h}" placeholder="🔎" style="width:100%;min-width:${c.nar ? 56 : 80}px;padding:2px 4px;font-size:12px"></th>`).join("")}
          <th class="pd-jnar" style="padding:2px 4px;top:30px">${sel("PD._jF", J.f, [["all", "הכל"], ["cancelled", "ביטלו"], ["active", "פעילים"]])}</th><th class="pd-jnar" style="padding:2px 4px;top:30px">${sel("PD._jFA", J.fa, [["all", "הכל"], ["file", "יש"], ["nofile", "אין"]])}</th><th class="pd-j-act"></th></tr></thead>
      <tbody>${rows.slice(0, J.shown).map(r => {
        const n = dup.get(r.ident_hash) || 1, open = J.open === r.id, x = jX(r);
        return `<tr class="go" onclick="PD._jOpen('${r.id}')">${J_COLS.map(c => cell(c, r)).join("")}
          <td style="white-space:nowrap">${r.cancelled_at ? `<span class="pd-nd-miss" title="תאריך ביטול: ${E(r.cancelled_at)}">ביטל</span>` : ""}${n > 1 ? `<span class="pd-nd-sug">${n} הגשות</span>` : ""}${r.undecryptable ? '<span class="pd-nd-miss">לא פוענח</span>' : ""}</td>
          <td style="white-space:nowrap">${r.file_sha256 ? `<button class="pd-mini" onclick="event.stopPropagation();PD._jFile('${r.file_sha256}')">📄</button>` : '<span class="pd-sub">-</span>'}</td><td class="pd-j-act"><div class="pd-jbtns"><button class="pd-mini pd-ib" onclick="event.stopPropagation();PD._jEdit('${r.id}')"><span>✏️</span>עריכה</button>${r.cancelled_at ? `<button class="pd-mini pd-ib" onclick="event.stopPropagation();PD._jCancel('${r.id}',0)"><span>↩</span>שחזור</button>` : `<button class="pd-mini pd-ib" onclick="event.stopPropagation();PD._jCancel('${r.id}',1)"><span>⛔</span>ביטול</button>`}<button class="pd-mini pd-ib" style="color:#c0392b" onclick="event.stopPropagation();PD._jDel('${r.id}')"><span>🗑</span>מחיקה</button></div></td></tr>`
          + (open ? `<tr><td colspan="${N}" style="background:#f7fafa"><div class="pd-sub" style="line-height:1.9">כתובת IP: <span dir="ltr">${E(r.ip || "-")}</span>${r.all ? " · סימן: לבחירת כל החברות שנרשמו וירשמו בהמשך" : ""}${x.rest ? `<br>שדות נוספים: ${E(x.rest)}` : ""}${x.raw ? `<br>שדות נוספים: ${E(x.raw)}` : ""}</div></td></tr>` : ""); }).join("") || `<tr><td colspan="${N}" class="pd-sub">אין תוצאות.</td></tr>`}</tbody></table></div>
      ${rows.length > J.shown ? `<div style="text-align:center;margin:10px"><button class="pd-btn" onclick="PD._jMore()">הצג עוד (${rows.length - J.shown})</button></div>` : ""}`;
  }
  async function jFile(sha) {
    const w = window.open("", "_blank");
    try {
      const res = await fetch("/api/joiners?file=" + sha, { headers: authH() });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || res.statusText); }
      const url = URL.createObjectURL(await res.blob());
      if (w) w.location = url; else window.open(url);
    } catch (e) { if (w) w.close(); alert("פתיחת הקובץ נכשלה: " + e.message); }
  }
  // עריכה / הוספה / מחיקה ידנית של מצטרף (מנהל בלבד; השרת מצפין מחדש את הפרטים)
  const JF = [["first", "שם פרטי"], ["last", "שם משפחה"], ["id_number", "ת.ז."], ["phone", "טלפון"], ["email", "דוא\"ל (אנגלית)"]];
  function jEdit(id) {
    const r = id ? J.rows.find(x => x.id === id) : { first: "", last: "", id_number: "", phone: "", email: "", companies: "", all: "", extra: "", cancelled_at: "", submitted_at: "" };
    if (!r) return;
    if (r.undecryptable) { alert("לא ניתן לערוך רשומה שלא פוענחה."); return; }
    overlay("pd-jedit", `<div class="pd-head"><b>${id ? "עריכת מצטרף: " + E(jName(r)) : "הוספת מצטרף ידנית"}</b></div>
      <div style="padding:14px;display:grid;gap:8px" id="pd-jf" data-id="${E(id)}">
        ${JF.map(([k, l]) => `<label class="pd-sub">${l}<input class="pd-in" data-k="${k}" value="${E(r[k] || "")}" style="width:100%" ${k === "email" || k === "id_number" || k === "phone" ? 'dir="ltr"' : ""} autocomplete="off"></label><div class="pd-sub" data-e="${k}" style="color:#c0392b"></div>`).join("")}
        <label class="pd-sub">חברות שנבחרו<textarea class="pd-in" data-k="companies" rows="3" style="width:100%">${E(r.companies || "")}</textarea></label>
        <label class="pd-sub"><input type="checkbox" data-k="all" ${r.all ? "checked" : ""}> לבחירת כל החברות שנרשמו וירשמו בהמשך</label>
        <label class="pd-sub">שדות נוספים / הערות<textarea class="pd-in" data-k="extra" rows="2" style="width:100%">${E(r.extra || "")}</textarea></label>
        <label class="pd-sub">${id ? "תאריך ביטול (ריק = לא ביטל)" : "תאריך הרשמה (ריק = היום)"}<input class="pd-in" type="date" data-k="${id ? "cancelled_at" : "submitted_at"}" value="${E(((id ? r.cancelled_at : r.submitted_at) || "").slice(0, 10))}"></label>
        <div class="pd-sub" data-e="cancelled_at submitted_at" id="pd-jerr" style="color:#c0392b"></div>
        <div style="display:flex;gap:8px;justify-content:flex-end"><button class="pd-btn" id="pd-jsave" onclick="PD._jSave()">שמירה</button><button class="pd-mini" onclick="PD._close('pd-jedit')">ביטול</button></div>
      </div>`);
  }
  async function jSave() {
    const box = $("pd-jf"); if (!box) return;
    const id = box.dataset.id, b = {};
    box.querySelectorAll("[data-k]").forEach(el => { b[el.dataset.k] = el.type === "checkbox" ? el.checked : el.value; });
    box.querySelectorAll("[data-e]").forEach(el => { el.textContent = ""; });
    const btn = $("pd-jsave"); btn.disabled = true;
    try {
      const r = id ? await api("/joiners?id=" + encodeURIComponent(id), "PUT", b) : await api("/joiners", "POST", b);
      if (id) { const i = J.rows.findIndex(x => x.id === id); if (i >= 0) J.rows[i] = r.row; } else { J.rows.unshift(r.row); J.total++; }
      close("pd-jedit"); ndShow();
    } catch (e) {
      btn.disabled = false;
      const errs = (e.data && e.data.errors) || null;
      if (errs) for (const [k, m] of Object.entries(errs)) { const t = box.querySelector(`[data-e~="${k}"]`) || $("pd-jerr"); if (t) t.textContent = m; }
      else { $("pd-jerr").textContent = e.message || "שגיאה"; }
    }
  }
  function jDel(id) {
    const r = J.rows.find(x => x.id === id); if (!r) return;
    overlay("pd-jdel", `<div class="pd-head" style="background:#c0392b;color:#fff"><b>מחיקת מצטרף</b></div>
      <div style="padding:14px;line-height:1.7">למחוק לצמיתות את <b>${E(jName(r))}</b>${r.submitted_at ? " (נרשם " + E(jDate(r.submitted_at)) + ")" : ""}?<br><span class="pd-sub">הפעולה אינה הפיכה${r.file_sha256 ? ", וקובץ האישור שלו יימחק אם אף מצטרף אחר לא משתמש בו" : ""}.</span>
      <div class="pd-sub" id="pd-jderr" style="color:#c0392b"></div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px"><button class="pd-btn" style="background:#c0392b" id="pd-jdgo" onclick="PD._jDelGo('${E(id)}')">מחיקה</button><button class="pd-mini" onclick="PD._close('pd-jdel')">ביטול</button></div></div>`);
  }
  // "ביטול" = מחיקה רכה: הרישום נשאר עם תאריך ההרשמה ותאריך הביטול (מוצג "ביטל <תאריך>", וניתן לשחזר)
  async function jCancel(id, on) {
    const r = J.rows.find(x => x.id === id); if (!r) return;
    if (on && !confirm(`לסמן את ${jName(r)} כמבוטל? הרישום יישאר ברשימה עם תאריך הביטול, ואפשר לשחזר אותו.`)) return;
    try {
      const d = new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);   // תאריך בישראל (בקירוב, מספיק ליום)
      const res = await api("/joiners?id=" + encodeURIComponent(id), "PUT", { cancelled_at: on ? d : "" });
      const i = J.rows.findIndex(x => x.id === id); if (i >= 0) J.rows[i] = res.row; ndShow();
    } catch (e) { alert(e.message || "שגיאה"); }
  }
  async function jDelGo(id) {
    const b = $("pd-jdgo"); if (b) b.disabled = true;
    try { await api("/joiners?id=" + encodeURIComponent(id), "DELETE"); J.rows = J.rows.filter(x => x.id !== id); J.total--; if (J.open === id) J.open = ""; close("pd-jdel"); ndShow(); }
    catch (e) {
      if (e.status === 404) { J.rows = J.rows.filter(x => x.id !== id); close("pd-jdel"); ndShow(); return; }
      if (b) b.disabled = false; const t = $("pd-jderr"); if (t) t.textContent = e.message || "שגיאה";
    }
  }
  // ייבוא הגשות חדשות מייצוא CSV של CFDB7 (האתר הישן): בדיקה מקדימה, ואז הוספת החדשות בלבד
  function parseCsv(text) {
    text = text.replace(/^\uFEFF/, "");
    const first = text.split(/\r?\n/, 1)[0], cnt = c => first.split(c).length;
    const d = cnt("\t") >= cnt(",") && cnt("\t") >= cnt(";") ? "\t" : cnt(";") > cnt(",") ? ";" : ",";
    const rows = []; let row = [], f = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
      else if (c === '"') q = true;
      else if (c === d) { row.push(f); f = ""; }
      else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(f); f = ""; if (row.some(x => x !== "")) rows.push(row); row = []; }
      else f += c;
    }
    row.push(f); if (row.some(x => x !== "")) rows.push(row);
    if (rows.length < 2) return [];
    const head = rows[0].map(h => h.trim().toLowerCase().replace(/[_\-\s]+/g, " "));
    return rows.slice(1).map(r => Object.fromEntries(head.map((h, i) => [h, (r[i] || "").trim()])));
  }
  function jImp() {
    const inp = document.createElement("input"); inp.type = "file"; inp.accept = ".csv,.tsv,.txt,text/csv";
    inp.onchange = async () => {
      const file = inp.files[0]; if (!file) return;
      let rows; try { rows = parseCsv(await file.text()); } catch { rows = []; }
      if (!rows.length || !("id" in rows[0]) || !("private" in rows[0])) { alert("הקובץ לא נראה כמו ייצוא של טופס ההצטרפות מ-CFDB7 (חסרות העמודות Id ו-Private)."); return; }
      overlay("pd-jimp", `<div class="pd-head"><b>ייבוא מ-CSV</b></div><div style="padding:14px;line-height:1.8" id="pd-jimp-b">בודק ${rows.length} שורות…</div>`);
      const run = async dry => { const t = { added: 0, existing: 0, skipped: 0 }; for (let i = 0; i < rows.length; i += 400) { const r = await api("/joiners-import", "POST", { dry, rows: rows.slice(i, i + 400) }); for (const k in t) t[k] += r[k]; } return t; };
      try {
        const t = await run(true), b = $("pd-jimp-b"); if (!b) return;
        b.innerHTML = `נמצאו <b>${rows.length}</b> שורות בקובץ:<br>חדשות (יתווספו): <b>${t.added}</b><br>כבר קיימות ברשימה (לא ישונו): ${t.existing}<br>דולגו (חסר מזהה, תאריך או פרטים): ${t.skipped}
          <div class="pd-sub" id="pd-jimp-e" style="color:#c0392b"></div>
          <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px">${t.added ? `<button class="pd-btn" id="pd-jimp-go">ייבוא ${t.added} חדשים</button>` : ""}<button class="pd-mini" onclick="PD._close('pd-jimp')">${t.added ? "ביטול" : "סגירה"}</button></div>`;
        const go = $("pd-jimp-go"); if (go) go.onclick = async () => {
          go.disabled = true; go.textContent = "מייבא…";
          try { const r = await run(false); close("pd-jimp"); J.rows = null; J.cl = null; ndShow(); alert(`יובאו ${r.added} מצטרפים חדשים.`); }
          catch (e) { go.disabled = false; go.textContent = "נסה שוב"; $("pd-jimp-e").textContent = e.message || "שגיאה"; }
        };
      } catch (e) { const b = $("pd-jimp-b"); if (b) b.innerHTML = `<span style="color:#c0392b">${E(e.message || "שגיאה")}</span><div style="margin-top:10px"><button class="pd-mini" onclick="PD._close('pd-jimp')">סגירה</button></div>`; }
    };
    inp.click();
  }
  // סנכרון חי מהאתר הישן: הגשות חדשות + קובצי אישור (בקריאות קצרות חוזרות, עד שאין עוד)
  async function jSync() {
    overlay("pd-jsync", `<div class="pd-head"><b>סנכרון מהאתר הישן</b></div><div style="padding:14px;line-height:1.8" id="pd-jsync-b">מתחבר…</div>`);
    const set = h => { const b = $("pd-jsync-b"); if (b) b.innerHTML = h; };
    const t = { added: 0, existing: 0, pdfs: 0, back: 0, canc: 0 };
    try {
      for (let i = 0; i < 80; i++) {
        const r = await api("/joiners-sync", "POST", { phase: "new" });
        t.added += r.added; t.existing += r.existing; t.pdfs += r.pdfs;
        set(`מושך הגשות חדשות… נבדק עד מספר ${r.last_id} מתוך ${r.wp_max_id || "?"}<br>נוספו ${t.added}, כבר קיימים ${t.existing}, קובצי אישור ${t.pdfs}`);
        if (!r.more) break;
      }
      for (let i = 0; i < 40; i++) {
        const r = await api("/joiners-sync", "POST", { phase: "cancels" });
        t.canc += r.added; set(`מושך בקשות ביטול… נוספו ${t.canc}`);
        if (!r.more) break;
      }
      for (let off = 0; off < 400; off += 8) {
        const r = await api("/joiners-sync", "POST", { phase: "backfill", offset: off });
        t.back += r.pdfs; set(`משלים קובצי אישור למצטרפים אחרונים… נוספו ${t.back}`);
        if (!r.more) break;
      }
      J.rows = null; ndShow();
      set(`הסתיים.<br>מצטרפים חדשים: <b>${t.added}</b><br>קובצי אישור שנוספו: <b>${t.pdfs + t.back}</b><br>בקשות ביטול חדשות: <b>${t.canc}</b>${t.canc ? '<div class="pd-sub">בקשות הביטול מופיעות ב-"בקשות ביטול". מצטרף שביקש ביטול אינו מסומן אוטומטית: השתמש ב-"חיפוש מצטרף" ואז "ביטול".</div>' : ""}<div style="margin-top:10px"><button class="pd-btn" onclick="PD._close('pd-jsync')">סגירה</button></div>`);
    } catch (e) {
      J.rows = null; ndShow();
      set(`<span style="color:#c0392b">${E(e.message || "שגיאה")}</span><div class="pd-sub" style="margin-top:6px">עד כה נוספו ${t.added} מצטרפים ו-${t.pdfs + t.back} קובצי אישור.</div><div style="margin-top:10px"><button class="pd-mini" onclick="PD._close('pd-jsync')">סגירה</button></div>`);
    }
  }
  // קליטת הרשמות מהטופס בנדרים פלוס (קבלה בלבד), בקריאות קצרות חוזרות עד שאין עוד
  // שליחה חוזרת של מייל אישור הצטרפות: טווח תאריכים + מקורות, בדיקה לפני שליחה, ושליחה במנות (פעם אחת לכל מצטרף)
  const JM = { from: "", to: "", src: null, sent: {}, busy: false, stop: false };
  const jmEmail = v => /^[\x21-\x7e]+@[\x21-\x7e]+\.[\x21-\x7e]{2,}$/.test(v || "");
  function jmList() {
    const from = JM.from, to = JM.to;
    const base = (J.rows || []).filter(r => !r.cancelled_at && (r.submitted_at || "").slice(0, 10) >= from && (r.submitted_at || "").slice(0, 10) <= to && JM.src.has(jX(r).src || "אחר"));
    const noMail = base.filter(r => !jmEmail(r.email)), already = base.filter(r => jmEmail(r.email) && JM.sent[r.id]);
    return { base, noMail, already, go: base.filter(r => jmEmail(r.email) && !JM.sent[r.id]) };
  }
  async function jMail() {
    const iso = d => d.toISOString().slice(0, 10), now = new Date();
    JM.to = iso(now); JM.from = iso(new Date(now.getTime() - 30 * 864e5)); JM.stop = false;
    const all = [...new Set((J.rows || []).map(r => jX(r).src || "אחר"))].sort((a, b) => a.localeCompare(b, "he"));
    JM.src = new Set(all.filter(x => x === "נדרים פלוס"));
    if (!JM.src.size) JM.src = new Set(all);
    try { JM.sent = (await api("/joiners-confirm")).sent || {}; } catch { JM.sent = {}; }
    overlay("pd-jmail", `<div class="pd-head"><b>שליחת אישורי הצטרפות</b></div><div style="padding:14px;line-height:1.8" id="pd-jmail-b"></div>`);
    jmPaint(all);
  }
  function jmPaint(all) {
    const b = $("pd-jmail-b"); if (!b) return;
    all = all || [...new Set((J.rows || []).map(r => jX(r).src || "אחר"))].sort((a, b) => a.localeCompare(b, "he"));
    const L = jmList();
    b.innerHTML = `<div>נרשמו בין <input class="pd-in" type="date" value="${JM.from}" style="width:auto" onchange="PD._jmSet('from',this.value)"> ל-<input class="pd-in" type="date" value="${JM.to}" style="width:auto" onchange="PD._jmSet('to',this.value)"></div>
      <div style="margin-top:6px">מקור: ${all.map(x => `<label style="margin-inline-end:12px"><input type="checkbox" ${JM.src.has(x) ? "checked" : ""} onchange="PD._jmSrc('${E(x)}',this.checked)"> ${E(x)}</label>`).join("")}</div>
      <div class="pd-sub" style="margin-top:6px">במייל: משפט פתיחה "מצורף אישור על הצטרפותך מתאריך …", ואחריו אותו אישור כמו בהצטרפות. מבוטלים לא נכללים.</div>
      <div style="margin-top:10px;padding:8px 10px;background:#f4f8fd;border-radius:8px">יישלח ל-<b>${L.go.length}</b> מצטרפים<br><span class="pd-sub">בלי מייל תקין: ${L.noMail.length} · כבר קיבלו אישור כזה: ${L.already.length}</span></div>
      <div style="margin-top:12px;display:flex;gap:8px"><button class="pd-btn primary" ${L.go.length ? "" : "disabled"} onclick="PD._jmGo()">שליחה ל-${L.go.length}</button><button class="pd-btn" onclick="PD._close('pd-jmail')">סגירה</button></div>`;
  }
  async function jmGo() {
    const L = jmList(); if (!L.go.length || JM.busy) return;
    if (!confirm(`לשלוח מייל אישור ל-${L.go.length} מצטרפים?`)) return;
    JM.busy = true; JM.stop = false;
    const b = $("pd-jmail-b"), set = h => { if (b) b.innerHTML = h; };
    let sent = 0, failed = 0, skipped = 0, err = "";
    const ids = L.go.map(r => r.id);
    for (let i = 0; i < ids.length && !JM.stop; i += 8) {
      set(`שולח… ${Math.min(i, ids.length)} מתוך ${ids.length}<br>נשלחו ${sent}${failed ? `, נכשלו ${failed}` : ""}<div style="margin-top:10px"><button class="pd-btn" onclick="PD._jmStop()">עצירה</button></div>`);
      try { const r = await api("/joiners-confirm", "POST", { ids: ids.slice(i, i + 8) }); sent += r.sent; failed += r.failed; skipped += r.skipped; for (const x of r.results || []) if (x.status === "sent") JM.sent[x.id] = new Date().toISOString(); }
      catch (e) { err = e.message || "שגיאה"; break; }
    }
    JM.busy = false;
    set(`${err ? `<span style="color:#c0392b">${E(err)}</span><br>` : JM.stop ? "נעצר.<br>" : "הסתיים.<br>"}נשלחו: <b>${sent}</b>${failed ? `<br>נכשלו: <b>${failed}</b> (אפשר לנסות שוב - יישלח רק למי שלא קיבל)` : ""}${skipped ? `<br>דולגו: ${skipped}` : ""}<div style="margin-top:10px"><button class="pd-btn" onclick="PD._close('pd-jmail')">סגירה</button></div>`);
  }
  async function jNed() {
    overlay("pd-jned", `<div class="pd-head"><b>משיכה מנדרים פלוס</b></div><div style="padding:14px;line-height:1.8" id="pd-jned-b">מתחבר…</div>`);
    const set = h => { const b = $("pd-jned-b"); if (b) b.innerHTML = h; };
    const t = { added: 0, existing: 0 };
    try {
      let more = true;
      for (let i = 0; i < 2000 && more; i++) {          // עד שאין עוד (שומר-בטיחות: 2000 קריאות = 30,000 הרשמות)
        const r = await api("/joiners-nedarim-sync", "POST", {});
        t.added += r.added; t.existing += r.existing; more = !!r.more;
        set(`מושך הרשמות… נוספו ${t.added}, כבר קיימים ${t.existing}`);
      }
      J.rows = null; ndShow();
      set(more ? `נעצר באמצע (יש עוד הרשמות).<br>נוספו עד כה: <b>${t.added}</b>. לחצו שוב להמשך.` : `הסתיים - נמשכו כל ההרשמות.<br>מצטרפים חדשים מנדרים: <b>${t.added}</b>`);
    } catch (e) {
      J.rows = null; ndShow();
      set(`<span style="color:#c0392b">${E(e.message || "שגיאה")}</span><div class="pd-sub" style="margin-top:6px">עד כה נוספו ${t.added}.</div><div style="margin-top:10px"><button class="pd-mini" onclick="PD._close('pd-jned')">סגירה</button></div>`);
    }
  }
  async function jCDel(id) {
    const c = (J.cl || []).find(x => x.id === id); if (!c) return;
    if (!confirm(`למחוק את בקשת הביטול של ${c.name || "(בלי שם)"}? הפעולה אינה הפיכה.`)) return;
    try { await api("/joiner-cancels?id=" + encodeURIComponent(id), "DELETE"); } catch (e) { if (e.status !== 404) { alert(e.message || "שגיאה"); return; } }
    J.cl = J.cl.filter(x => x.id !== id); J.cancels = J.cl.length; ndShow();
  }
  function jFind(id) {      // עובר לרשימת המצטרפים, מסונן לפי ת.ז. / טלפון / דוא"ל / שם של המבקש
    const c = (J.cl || []).find(x => x.id === id); if (!c) return;
    J.q = c.id_number || c.phone || c.email || c.name || ""; J.f = "all"; J.fa = "all"; J.cf = {}; J.shown = 200; J.view = "list"; ndShow();
  }
  const jAct = {
    view: v => { J.view = v; if (v === "cancels") jLoadCancels(); ndShow(); },
    q: v => { J.q = v; J.shown = 200; later(J, "_t", ndShow); },
    f: k => { J.f = k; J.shown = 200; ndShow(); }, fa: k => { J.fa = k; J.shown = 200; ndShow(); }, cf: (k, v) => { J.cf[k] = v; J.shown = 200; later(J, "_t", ndShow); }, open: id => { J.open = J.open === id ? "" : id; ndShow(); },
    more: () => { J.shown += 300; ndShow(); }, retry: () => { J.err = ""; J.rows = null; ndShow(); },
  };
  const ndAct = {
    tab: t => { if (t !== ND.tab) Object.assign(ND, { miss: "all", sug: false, gone: false, q: "", sq: "", tq: "", fq: "" }); ND.tab = t; ndShow(); if (t === "c" && ND.sq.trim().length >= 2) ndSearchC(); },
    q: v => { if (ND.tab === "c") ND.sq = v; else ND.q = v; later(ND, "_t", () => { ndShow(); if (ND.tab === "c" && ND.sq.trim().length >= 2) ndSearchC(); }); },
    miss: k => { ND.miss = k; ndShow(); }, sug: () => { ND.sug = !ND.sug; ndShow(); },
    tq: v => { ND.tq = v; later(ND, "_tt", () => ndTextSearch(v)); }, gone: on => { ND.gone = on; ndShow(); if (ND.sq.trim().length >= 2) ndSearchC(); },
    openDoc: id => { savePos("un", id, 0); openUnassigned("un"); },
  };

  const specialTitle = d => (intelOf(d).t || [])[0] || d.source_title || String(d.original_name || "").replace(/\.pdf$/i, "");
  const SP = { docId: "", bid: "", staged: false };
  function spEdit(docId, bid, staged) {          // סיווג "אחר": כותרת (מוצגת באתר) + פירוט שמסביר את מהות המסמך; שניהם חובה
    const d = S.byId.get(docId); if (!d) return;
    Object.assign(SP, { docId, bid, staged: !!staged });
    const cur = (d.specials || {})[bid] || {};
    overlay("pd-confirm", `<div class="pd-head"><b>סיווג "אחר": ${E(d.original_name || "")}</b></div>
      <div class="pd-body"><div class="pd-sub">החברה: ${E(bizName(bid))}. מסמך "אחר" אינו פרטי / כללי, ומוצג באתר הסופי תחת הכותרת.</div>
        <label class="pd-sub" style="display:block;margin-top:8px">כותרת (מוצגת באתר)</label><input class="pd-in" id="pd-sp-t" value="${E(cur.title || specialTitle(d))}" maxlength="200">
        <label class="pd-sub" style="display:block;margin-top:8px">פירוט: מהות המסמך (חובה)</label><textarea class="pd-in" id="pd-sp-d" rows="3" maxlength="1000" placeholder="למשל: רישום היתר עיסקא פרטי של קרנות הראל, שהפניקס התקשרה בהן">${E(cur.detail || "")}</textarea>
        <div id="pd-sp-err" style="color:#c0392b;margin-top:4px"></div>
        <div class="pd-btns" style="margin-top:10px"><button class="pd-btn primary" onclick="PD._spSave()">שמירה</button><button class="pd-btn" onclick="PD._close('pd-confirm')">ביטול</button></div></div>`);
    setTimeout(() => { const el = $("pd-sp-d"); if (el) el.focus(); }, 50);
  }
  async function spSave() {
    const title = ($("pd-sp-t") || {}).value, detail = ($("pd-sp-d") || {}).value;
    if (!String(title || "").trim() || !String(detail || "").trim()) { const e = $("pd-sp-err"); if (e) e.textContent = "יש למלא כותרת ופירוט."; return; }
    const { docId, bid, staged } = SP, d = S.byId.get(docId); if (!d) return;
    close("pd-confirm");
    if (staged) { stage({ t: "special", docId, bid, title: title.trim(), detail: detail.trim() }); return; }
    const before = snapDoc(d);
    if (await updateDoc(docId, { specials: { [bid]: { title: title.trim(), detail: detail.trim() } } })) { pushHist(before, "סיווג \"אחר\": " + title.trim()); if ($("pd-manage")) paintMg(); if ($("pd-cd")) cdShow(); }
  }
  async function spDel(docId, bid) {
    const d = S.byId.get(docId); if (!d) return;
    const before = snapDoc(d);
    if (await updateDoc(docId, { specials: { [bid]: "" } })) { pushHist(before, "בוטל סיווג \"אחר\""); if ($("pd-manage")) paintMg(); if ($("pd-cd")) cdShow(); }
  }
  // ───────── תת-שורה "אחר" (מסלול הלכה וכו'): רישום נוסף לאותו ח.פ. עם שם בהיתר = הפירוט; המסמך מקושר אליו כהת"ע פרטי / כללי ─────────
  const subLabel = x => String(x.permit_name || x.registrar_name || "").trim() || "—";
  const subNorm = s => String(s || "").replace(/["'׳״`\-–(),.]/g, " ").replace(/\s+/g, " ").trim();
  async function subCreate() {          // "+ הוספת תת-שורה" בחלון הניהול: פירוט + רישום; אחרי ההוספה מוצגת כרטיסייה קבועה
    const b = bizById(M.biz), name = String(($("pd-sub-new") || {}).value || "").replace(/\s+/g, " ").trim(), vis = ($("pd-sub-vis") || {}).value || "";
    if (!b) return;
    if (!name) { const i = $("pd-sub-new"); if (i) i.focus(); return; }
    if (!digitsOf(b.chp_number)) { alert("תת-שורה אפשרית רק לחברה עם ח.פ."); return; }
    if (sameChpRows(b).some(r => subNorm(r.permit_name) === subNorm(name))) { alert("כבר יש תת-שורה בשם הזה"); return; }
    try {
      const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      await api("/businesses", "POST", { id, chp_number: b.chp_number, entity_type: b.entity_type || "company", registrar_name: b.registrar_name || "", permit_name: name, category: b.category || "", region: b.region || "", visibility: vis, agch_approved: "לא", biz_type: b.biz_type || "" });
      if (typeof loadBusinesses === "function") await loadBusinesses();
      M.subNew = false; S._fm = null; refresh(); paintMg();
    } catch (e) { alert("השמירה נכשלה: " + e.message); }
  }
  function tagsOf(d) {          // תיוגי תתי-השורות של המסמך, כולל שיוך ישיר ישן לעסק של תת-שורה (לפני העברת 0021), כדי שיישמר כתיוג
    const fam = sameChpRows(bizById(M.biz)), out = [...(d.subs || [])];
    for (const x of fam) if ((d.business_ids || []).includes(x.id) && !out.some(t => t.id === x.id)) out.push({ id: x.id, slot: String((d.slots || {})[x.id] || "") });
    return out;
  }
  async function subSave(d, subs, extra, what, others) {          // שמירת תיוג תתי-השורות של מסמך; המסמך משויך לחברה הראשית ולא לעסק של תת-השורה
    const b = bizById(M.biz); if (!b) return false;
    const fam = new Set(sameChpRows(b).map(x => x.id));
    const ids = [...new Set([...(d.business_ids || []).filter(i => !fam.has(i)), b.id])];
    try {
      const before = snapDoc(d);
      const nd = (await api("/permit-docs/" + d.id, "PUT", { business_ids: ids, subs, ...(extra || {}) })).doc;
      replaceDoc(nd); await refetchDocs(others || []); pushHist(before, what);
      S._fm = null; refresh(); paintMg(); return true;
    } catch (e) { alert("השמירה נכשלה: " + e.message); paintMg(); return false; }
  }
  async function subLink(docId, bid, t) {          // תיוג מסמך של החברה לתת-שורה כהת"ע פרטי / כללי (t ריק: מסמך נוסף של תת-השורה)
    const d = S.byId.get(docId), x = bizById(bid); if (!d || !x) { paintMg(); return; }
    const prev = t ? slotDoc(x.id, t) : null;
    if (prev && prev.id !== docId && !confirm(`לתת-השורה "${subLabel(x)}" כבר מקושר הת"ע ${SLOT_HE[t]} (${prev.original_name || prev.id}). להחליף? הקודם יעבור למסמכים נוספים של תת-השורה.`)) { paintMg(); return; }
    const role = t ? [...new Set([...slotsOf(d, x.id), t])].sort().join(",") : "";
    const subs = [...tagsOf(d).filter(s => s.id !== x.id), { id: x.id, slot: role }];
    const extra = {};          // מסמך של תת-שורה אינו גם מסמך של החברה: מוריד את הת"ע / "אחר" של החברה
    if (String((d.slots || {})[M.biz] || "")) extra.slots = { [M.biz]: [] };
    if ((d.specials || {})[M.biz] !== undefined) extra.specials = { [M.biz]: "" };
    await subSave(d, subs, extra, (t ? "קושר לתת-שורה " + subLabel(x) + " (" + SLOT_HE[t] + ")" : "הורד למסמכים נוספים של " + subLabel(x)), prev && prev.id !== docId ? [prev.id] : []);
  }
  async function subVis(bid, vis) {          // רישום תת-השורה: כללי / פרטי + כללי / רק פרטי
    const x = bizById(bid); if (!x) return;
    try { await api("/businesses/" + bid, "PUT", { ...x, visibility: vis }); if (typeof loadBusinesses === "function") await loadBusinesses(); S._fm = null; refresh(); paintMg(); }
    catch (e) { alert("השמירה נכשלה: " + e.message); paintMg(); }
  }
  async function subToMain(docId, bid, how) {          // המסמך שייך לחברה עצמה, לא לתת-השורה: הסרת התיוג, וקישור כהת"ע של החברה / מסמך נוסף
    const d = S.byId.get(docId), b = bizById(M.biz); if (!d || !b) { paintMg(); return; }
    const want = how === "both" ? ["general", "private"] : how === "extra" ? [] : [how];
    const prev = want.map(t => slotDoc(b.id, t)).filter(p => p && p.id !== docId);
    if (prev.length && !confirm(`לחברה כבר מקושר: ${[...new Set(prev.map(p => p.original_name || p.id))].join(", ")}. להחליף? הקודם יעבור למסמכים נוספים של החברה.`)) { paintMg(); return; }
    const mainSl = String((d.slots || {})[b.id] || "").split(",").filter(Boolean);
    await subSave(d, tagsOf(d).filter(s => s.id !== bid), { slots: { [b.id]: [...new Set([...mainSl, ...want])] } }, "הועבר מתת-השורה " + bizName(bid) + " לחברה", prev.map(p => p.id));
  }
  async function subDel(docId, bid) {          // ביטול התיוג לתת-השורה: המסמך נשאר מסמך נוסף של החברה (תת-השורה עצמה נשארת ברשימה)
    const d = S.byId.get(docId); if (!d) return;
    await subSave(d, tagsOf(d).filter(s => s.id !== bid), {}, "בוטל שיוך לתת-שורה " + bizName(bid));
  }
  function mgCard(d, b) {
    const others = otherCos(d, b.id), sl = slotsOf(d, b.id), fam = sameChpRows(b), subOn = fam.filter(x => subTag(d, x.id) || (d.business_ids || []).includes(x.id));
    const shared = others.length > 0 || M.share.has(d.id), menuOpen = M.menu === d.id || M.move === d.id;
    const typeSel = `<select class="pd-sel" onchange="PD._setType('${d.id}',this.value)" title="סיווג המסמך">${["general", "private", "both", "unknown", "other"].map(t => `<option value="${t}" ${d.doc_type === t ? "selected" : ""}>${TL[t]}</option>`).join("")}</select>`;
    const othr = t => t === "private" ? "general" : "private";
    const alsoBtns = sl.length === 1 ? `<button class="pd-mini link" onclick="PD._slot('${d.id}','${b.id}','${othr(sl[0])}')" title="אותו מסמך ישמש גם כהת&quot;ע ${SLOT_HE[othr(sl[0])]} של החברה">לסמן גם כהת"ע ${SLOT_HE[othr(sl[0])]}</button>`
      : sl.length === 2 ? ["private", "general"].map(t => `<button class="pd-mini link" onclick="PD._slot('${d.id}','${b.id}','${othr(t)}')" title="המסמך יישאר רק כהת&quot;ע ${SLOT_HE[t]}">לסמן רק כהת"ע ${SLOT_HE[t]}</button>`).join("") : "";
    const linkBtns = sl.length ? alsoBtns + `<button class="pd-link2" onclick="PD._toExtras('${d.id}')" title="המסמך יעבור ל'מסמכים נוספים' ויישאר משויך לחברה">הורדה למסמכים נוספים</button>`
      : ["private", "general"].map(t => `<button class="pd-mini link" onclick="PD._slot('${d.id}','${b.id}','${t}')">קשר כהת"ע ${SLOT_HE[t]}</button>`).join("");
    const sp = (d.specials || {})[b.id];
    const spBtn = sp !== undefined ? `<span class="pd-chip" style="background:#b8860b" title="${E(sp.detail || "")}">אחר: ${E(sp.title)}</span><button class="pd-link2" onclick="PD._spEdit('${d.id}','${b.id}')">שינוי כותרת</button><button class="pd-link2" style="color:#c0392b" onclick="PD._spDel('${d.id}','${b.id}')">ביטול</button>`
      : `<button class="pd-mini" onclick="PD._spEdit('${d.id}','${b.id}')" title="סיווג המסמך כ'אחר': מופיע באתר הסופי של החברה תחת כותרת שתבחרו (כמה שרוצים). מסמך הוא פרטי / כללי או אחר, לא שניהם">אחר (עם כותרת)</button>`;
    const shareBox = shared ? `<div class="pd-mg-sh">${others.map(o => `<div class="pd-co"><span>${E(bizName(o))}</span><button class="pd-link" onclick="PD._mgRemove('${d.id}','${o}')">הסר</button></div>`).join("")}
        ${M.move === d.id ? "" : `<input class="pd-in" placeholder="הוספת חברה: שם או ח.פ." oninput="PD._mgSearch('${d.id}','add',this.value)" autocomplete="off">`}</div>` : "";
    const moveBox = M.move === d.id ? `<div class="pd-mg-sh"><input class="pd-in" placeholder="העברה לחברה: שם או ח.פ." oninput="PD._mgSearch('${d.id}','move',this.value)" autocomplete="off"></div>` : "";
    return `<div class="pd-mg-card" draggable="true" ondragstart="PD._dragStart(event,'${d.id}')" ondragend="PD._dragEnd()" title="אפשר לגרור לתיבת הת&quot;ע פרטי / כללי או למסמכים נוספים">
      <div class="pd-mg-l"><div class="pd-mg-th" onclick="PD.openDoc('${d.id}','${b.id}')" title="פתיחה בגדול"><img data-thumb="${d.id}" alt="" ${thumbUrls.get(d.id) ? `src="${thumbUrls.get(d.id)}"` : ""}><span class="pd-mg-ld" ${thumbUrls.get(d.id) ? 'style="display:none"' : ""}>טוען…</span></div>${pgHtml(d)}</div>
      <div class="pd-mg-r">
        <div class="pd-name" style="cursor:pointer;text-decoration:underline" onclick="PD.openDoc('${d.id}','${b.id}')" title="פתיחה בגדול">${E(d.original_name || d.id)}</div>
        <div class="pd-sub">${sizeHtml(d.size)} ${dateHtml(d)}${others.length ? ` · משותף עם ${others.length} חברות` : ""}${d.note ? " · " + E(d.note.slice(0, 60)) : ""}</div>
        <div class="pd-btns">${linkBtns}${spBtn}</div>${sp !== undefined && sp.detail ? `<div class="pd-sub">פירוט: ${E(sp.detail)}</div>` : ""}
        <div class="pd-btns" style="align-items:center">${(d.bonds || []).map(x => `<span class="pd-chip" style="background:#3f6ea8" title="${E(x.company)}">${E(bondLabel(x))}${bRoles(x.slot).length ? " · " + bRoles(x.slot).map(t => SLOT_HE[t]).join(" + ") : " · טרם סווג"} <a href="#" style="color:#fff;text-decoration:none" onclick="PD._mgBondDel('${d.id}','${E(x.id)}');return false" title="ביטול השיוך לאג&quot;ח">✕</a></span>`).join("")}${subOn.map(x => `<span class="pd-chip" style="background:#6b4fa0" title="תת-שורה של החברה">${E(subLabel(x))}${slotsOf(d, x.id).length ? " · " + slotsOf(d, x.id).map(t => SLOT_HE[t]).join(" + ") : ""} <a href="#" style="color:#fff;text-decoration:none" onclick="PD._subDel('${d.id}','${x.id}');return false" title="ביטול השיוך לתת-השורה">✕</a></span>`).join("")}<button class="pd-mini ${M.bond === d.id ? "sel" : ""}" onclick="PD._mgBond('${d.id}')" title="שיוך המסמך לאג&quot;ח של החברה">+ שיוך לאג"ח</button></div>
        ${M.bond === d.id ? `<div class="pd-mg-sh"><input class="pd-in" id="pd-mgb-${d.id}" value="${E(M.bondQ)}" placeholder="אג&quot;ח של החברה (או הקלידו לחיפוש בכל האג&quot;ח)" oninput="PD._mgBondSearch('${d.id}',this.value)" autocomplete="off"><div id="pd-mgbr-${d.id}" style="max-height:200px;overflow:auto"></div></div>` : ""}
        <details class="pd-menu" ${menuOpen ? "open" : ""} ontoggle="PD._menu('${d.id}',this.open)"><summary>⋯ עוד</summary>
          <label class="pd-mg-share"><input type="checkbox" ${shared ? "checked" : ""} onchange="PD._mgShare('${d.id}',this.checked)"> מסמך משותף (כמה חברות)</label>${shareBox}
          <div class="pd-btns" style="margin-top:6px"><button class="pd-link2" onclick="PD._mgMove('${d.id}')">העברה לחברה אחרת</button><button class="pd-link2" style="color:#c0392b" onclick="PD._askDelete('${d.id}')">מחיקה</button></div>${moveBox}</details>
        <div id="pd-mgs-${d.id}"></div>
      </div></div>`;
  }
  const bondKey = d => (d.bonds || []).map(x => bondLabel(x)).sort().join(" ו-");
  function paintMg() {
    const root = $("pd-mg"); if (!root) return;
    const b = bizById(M.biz); if (!b) { close("pd-manage"); return; }
    const need = needOf(b), keep = (root.querySelector(".pd-body") || {}).scrollTop || 0;
    const slotBox = t => { const d = slotDoc(b.id, t);
      return `<div class="pd-mg-slot ${need[t] ? "" : "off"}" ondragover="PD._dragOver(event)" ondragleave="PD._dragLeave(event)" ondrop="PD._drop(event,'${t}')"><h4>הת"ע ${SLOT_HE[t]}${need[t] ? "" : ' <span class="pd-sub">(לא נדרש לפי הרישום)</span>'}</h4>${d ? mgCard(d, b)
        : `<div class="pd-mg-empty ${need[t] ? "need" : ""}">${need[t] ? "⚠ אין מסמך מקושר" : "אין מסמך מקושר"}<div class="pd-sub">לקישור: בחרו מסמך מלמטה ולחצו "הת"ע ${SLOT_HE[t]}"</div></div>`}</div>`; };
    const allEx = extrasOf(b.id), bd = allEx.filter(d => (d.bonds || []).length).sort((x, y) => bondKey(x).localeCompare(bondKey(y), "he")), ex = allEx.filter(d => !(d.bonds || []).length);
    // תיבות אג"ח (קטנות, בצד שמאל): אג"ח של החברה לפי ח.פ. + אג"ח שמשויכות למסמכי החברה. בכל תיבה מסמך אחד
    if (!bondRows) bondList().then(() => { if (M.biz === b.id) paintMg(); });
    const bmap = new Map((bondRows || []).filter(r => digitsOf(r.chp) && digitsOf(r.chp) === digitsOf(b.chp_number)).map(r => [r.id, r]));
    for (const d of bd) for (const x of d.bonds) if (!bmap.has(x.id)) bmap.set(x.id, x);
    const bonds = [...bmap.values()].sort((x, y) => bondLabel(x).localeCompare(bondLabel(y), "he"));
    if (!bondScope) bondScopes().then(() => { if (M.biz === b.id) paintMg(); });
    const bmini = (d, x, acts) => `<div class="pd-mg-bdoc"><div class="pd-mg-bth" onclick="PD.openDoc('${d.id}','${b.id}')" title="פתיחה בגדול"><img data-thumb="${d.id}" alt="" ${thumbUrls.get(d.id) ? `src="${thumbUrls.get(d.id)}"` : ""}><span class="pd-mg-ld" ${thumbUrls.get(d.id) ? 'style="display:none"' : ""}>…</span></div>
      <div style="min-width:0"><div class="pd-name" style="cursor:pointer;text-decoration:underline;font-size:12px;overflow-wrap:anywhere" onclick="PD.openDoc('${d.id}','${b.id}')">${E(d.original_name || d.id)}</div><div class="pd-btns" style="gap:2px 8px">${acts}<button class="pd-link2" style="color:#c0392b" onclick="PD._mgBondDel('${d.id}','${E(x.id)}')">ביטול שיוך</button></div></div></div>`;
    const sb = (d, x, slot, l) => `<button class="pd-link2" onclick="PD._mgBondSet('${d.id}','${E(x.id)}','${slot}')">${l}</button>`;
    const bslot = x => {
      const ds = bondOwners(x.id), rl = d => bRoles(bLink(d, x.id).slot), sc = bondScope ? bondScope.get(x.id) || {} : { private: true, general: true };
      const hold = t => ds.filter(d => rl(d).includes(t)), hp = hold("private"), hg = hold("general"), unc = ds.filter(d => !rl(d).length);
      const dup = n => n > 1 ? `<div class="pd-sub" style="color:#c0392b;font-weight:600">⚠ ${n} מסמכים - יש להשאיר אחד</div>` : "";
      const row = (t, label, hs, acts) => `<div class="pd-mg-brow ${hs.length > 1 ? "dup" : ""} ${!hs.length && t !== "both" && !sc[t] ? "off" : ""}" ondragover="PD._dragOver(event)" ondragleave="PD._dragLeave(event)" ondrop="PD._drop(event,'bond:${E(x.id)}:${t}')"><span class="pd-mg-brl">${label}</span>
        ${hs.length ? hs.map(d => bmini(d, x, acts(d))).join("") + dup(hs.length) : `<div class="pd-mg-bempty">${t !== "both" && !sc[t] ? "לא נדרש · " : ""}אין מסמך · גררו לכאן</div>`}</div>`;
      const shared = hp.length === 1 && hg.length === 1 && hp[0] === hg[0];
      const rows = shared ? row("both", "פרטי + כללי (משותף)", hp, d => sb(d, x, "private", "רק פרטי") + sb(d, x, "general", "רק כללי"))
        : row("private", "פרטי", hp, d => rl(d).length === 2 ? "" : sb(d, x, "general,private", "גם כללי (משותף)")) + row("general", "כללי", hg, d => rl(d).length === 2 ? "" : sb(d, x, "general,private", "גם פרטי (משותף)"));
      const uncRow = unc.length ? `<div class="pd-mg-brow need"><span class="pd-mg-brl">⚠ טרם סווג (פרטי / כללי)</span>${unc.map(d => bmini(d, x, sb(d, x, "private", "פרטי") + sb(d, x, "general", "כללי") + sb(d, x, "general,private", "משותף"))).join("")}</div>` : "";
      const gone = bondRows && bondRows.length && !bondRows.some(r => r.id === x.id), noAppr = !gone && bondScope && !sc.private && !sc.general;          // לפי רשימת האג"ח העדכנית
      return `<div class="pd-mg-bslot ${hp.length > 1 || hg.length > 1 ? "dup" : ""} ${gone || noAppr ? "gone" : ""}"><h5>${E(bondLabel(x))} <span class="pd-sub">${E(x.symbol || x.id)}</span>${gone ? '<div class="pd-sub" style="color:#8a5a00;font-weight:600">לא קיימת עוד ברשימת האג&quot;ח (נפדתה / נמחקה)</div>' : noAppr ? '<div class="pd-sub" style="color:#8a5a00;font-weight:600">לא מאושרת ברשימות</div>' : ""}</h5>${rows}${uncRow}</div>`; };
    const bcol = bonds.length ? `<h4 style="margin:16px 0 8px">שטרות אג"ח (${bonds.filter(x => bondOwners(x.id).length).length}/${bonds.length})</h4><div class="pd-mg-bgrid">${bonds.map(bslot).join("")}</div>` : "";
    const fam = sameChpRows(b), pool = liveDocs(b.id).filter(d => !(d.subs || []).length && !slotsOf(d, b.id).length);          // לבחירה בתת-שורה: מסמכים נוספים של החברה
    const subBox = x => { const need2 = needOf(x);
      const cell = t => { const d = slotDoc(x.id, t);
        return `<div class="pd-mg-brow ${need2[t] || d ? "" : "off"}" ondragover="PD._dragOver(event)" ondragleave="PD._dragLeave(event)" ondrop="PD._drop(event,'sub:${x.id}:${t}')"><span class="pd-mg-brl">${SLOT_HE[t]}</span>${d ? bmini2(d, x) : `<div class="pd-mg-bempty">${need2[t] ? "" : "לא נדרש · "}אין מסמך · גררו לכאן${pool.length ? `<select class="pd-sel" style="font-size:12px;margin-top:4px;max-width:100%" onchange="if(this.value)PD._subLink(this.value,'${x.id}','${t}')"><option value="">בחירת מסמך של החברה…</option>${pool.map(p => `<option value="${p.id}">${E(p.original_name || p.id)}</option>`).join("")}</select>` : ""}</div>`}</div>`; };
      return `<div class="pd-mg-bslot sub"><h5>${E(subLabel(x))} <select class="pd-sel" style="font-size:12px;padding:1px 4px" onchange="PD._subVis('${x.id}',this.value)" title="רישום תת-השורה ברשימות האתר">${[["", "כללי"], ["פרטי", "פרטי + כללי"], ["רק פרטי", "רק פרטי"]].map(([v, l]) => `<option value="${v}" ${(x.visibility || "") === v || (!["פרטי", "רק פרטי"].includes(x.visibility || "") && v === "") ? "selected" : ""}>${l}</option>`).join("")}</select> </h5>${["private", "general"].filter(t => need2[t] || slotDoc(x.id, t)).map(cell).join("")}${(ex2 => ex2.length ? `<div class="pd-mg-brow need"><span class="pd-mg-brl">⚠ מסמכים נוספים של תת-השורה (בלי הת"ע)</span>${ex2.map(d => bmini2(d, x)).join("")}</div>` : "")(extrasOf(x.id))}</div>`; };          // רק התיבות שנדרשות לפי הרישום (או שכבר יש בהן מסמך)
    const bmini2 = (d, x) => `<div class="pd-mg-bdoc"><div class="pd-mg-bth" onclick="PD.openDoc('${d.id}','${x.id}')" title="פתיחה בגדול"><img data-thumb="${d.id}" alt="" ${thumbUrls.get(d.id) ? `src="${thumbUrls.get(d.id)}"` : ""}><span class="pd-mg-ld" ${thumbUrls.get(d.id) ? 'style="display:none"' : ""}>…</span></div>
      <div style="min-width:0"><div class="pd-name" style="cursor:pointer;text-decoration:underline;font-size:12px;overflow-wrap:anywhere" onclick="PD.openDoc('${d.id}','${x.id}')">${E(d.original_name || d.id)}</div><div class="pd-btns" style="gap:2px 8px">${slotsOf(d, x.id).length ? `<button class="pd-link2" onclick="PD._subLink('${d.id}','${x.id}','')" title="המסמך יישאר משויך לתת-השורה, בלי הת&quot;ע">הורדה למסמכים נוספים</button>` : ["general", "private"].filter(t => needOf(x)[t]).map(t => `<button class="pd-link2" onclick="PD._subLink('${d.id}','${x.id}','${t}')">כהת"ע ${SLOT_HE[t]}</button>`).join("")}<select class="pd-sel" style="font-size:11.5px;padding:0 2px" onchange="if(this.value)PD._subToMain('${d.id}','${x.id}',this.value)" title="המסמך שייך לחברה הראשית, לא לתת-השורה: הוא יעבור לחברה והשיוך לתת-השורה יוסר"><option value="">העברה לחברה…</option>${["general", "private"].filter(t => needOf(b)[t]).map(t => `<option value="${t}">כהת"ע ${SLOT_HE[t]}${slotDoc(b.id, t) ? " (מחליף את הקיים)" : ""}</option>`).join("")}${needOf(b).general && needOf(b).private ? `<option value="both">כהת"ע פרטי + כללי${slotDoc(b.id, "general") || slotDoc(b.id, "private") ? " (מחליף את הקיים)" : ""}</option>` : ""}<option value="extra">כמסמך נוסף</option></select><button class="pd-link2" style="color:#c0392b" onclick="PD._subDel('${d.id}','${x.id}')">ביטול שיוך</button></div></div></div>`;
    const addBox = M.subNew ? `<div class="pd-mg-bslot sub"><h5>תת-שורה חדשה</h5><input class="pd-in" id="pd-sub-new" placeholder="פירוט (למשל: מסלול הלכה)" onkeydown="if(event.key==='Enter')PD._subCreate()" autocomplete="off">
        <div class="pd-btns" style="margin-top:6px;align-items:center"><select class="pd-sel" id="pd-sub-vis" style="font-size:12px">${[["", "כללי"], ["פרטי", "פרטי + כללי"], ["רק פרטי", "רק פרטי"]].map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select><button class="pd-mini link" onclick="PD._subCreate()">הוספה</button><button class="pd-link2" onclick="PD._subNew(false)">ביטול</button></div></div>` : "";
    const scol = digitsOf(b.chp_number) ? `<h4 style="margin:16px 0 8px">תתי-שורות <button class="pd-mini" style="margin-inline-start:8px" onclick="PD._subNew(true)" title="רישום נוסף לאותה חברה (אותו ח.פ.), למשל &quot;מסלול הלכה&quot;: מופיע ברשימות מתחת לחברה">+ הוספת תת-שורה</button></h4>${fam.length || M.subNew ? `<div class="pd-mg-bgrid">${fam.map(subBox).join("")}${addBox}</div>` : ""}` : "";
    root.innerHTML = `<div class="pd-head"><b>ניהול מסמכים · ${displayName(b, true)}</b><span class="pd-chip" style="background:#1a3a5c;margin-inline-start:8px" title="הרישום של החברה ברשימות האתר">רישום: ${regLabel(b)}</span><button class="pd-mini" onclick="PD._regChange()" title="שינוי הרישום או מחיקת החברה מהרשימה">לשינוי</button>
        <span id="pd-mg-undo"></span><button class="pd-btn" onclick="PD._home()" title="סגירת החלונות וחזרה לדף הראשי של הניהול">🏠 ראשי</button><button class="pd-btn" onclick="PD._close('pd-manage');PD.openUpload({bizId:'${b.id}'})">⬆ העלאת היתר</button><button class="pd-x" onclick="PD._close('pd-manage')">✕</button></div>
      <div class="pd-body"><div class="pd-mg-top">${["private", "general"].filter(t => need[t] || slotDoc(b.id, t)).map(slotBox).join("")}</div>${scol}${bcol}
        <h4 style="margin:18px 0 8px">מסמכים נוספים לבדיקה (${ex.length})</h4>
        <div class="pd-mg-grid" id="pd-mg-extras" ondragover="PD._dragOver(event)" ondragleave="PD._dragLeave(event)" ondrop="PD._drop(event,'extra')">${ex.map(d => mgCard(d, b)).join("") || `<div class="pd-sub">אין מסמכים נוספים. אפשר לגרור לכאן מסמך כדי להוריד אותו מהת"ע.</div>`}</div>${suggestHtml(b.id)}</div>`;
    const body = root.querySelector(".pd-body"); if (body) body.scrollTop = keep;
    undoRefresh();
    if (M.bond && S.byId.get(M.bond)) mgBondSearch(M.bond, M.bondQ, true);
    root.querySelectorAll("img[data-thumb]").forEach(img => thumb(img.dataset.thumb).then(u => {
      if (!img.isConnected) return;
      if (u) { img.src = u; img.nextElementSibling && (img.nextElementSibling.style.display = "none"); } else if (img.nextElementSibling) img.nextElementSibling.textContent = "אין תצוגה מקדימה";
    }));
  }
  let dragId = "";
  function dragStart(ev, id) { dragId = id; try { ev.dataTransfer.setData("text/plain", id); ev.dataTransfer.effectAllowed = "move"; } catch { /* בלי תמיכה */ } }
  function dragEnd() { dragId = ""; document.querySelectorAll(".pd-drop-on").forEach(x => x.classList.remove("pd-drop-on")); }
  function dragOver(ev) { if (!dragId) return; ev.preventDefault(); ev.currentTarget.classList.add("pd-drop-on"); }
  function dragLeave(ev) { ev.currentTarget.classList.remove("pd-drop-on"); }
  async function toExtras(id, biz) {
    biz = biz || M.biz;
    const d = S.byId.get(id); if (!d || !biz || !slotsOf(d, biz).length) return;
    const before = snapDoc(d);
    if (await updateDoc(id, { slots: { [biz]: [] } })) { pushHist(before, "הורד מהת\"ע ל\"מסמכים נוספים\" (" + bizName(biz) + ")"); if ($("pd-cd")) cdShow(); say("המסמך עבר ל\"מסמכים נוספים\" והוא עדיין משויך לחברה"); }
  }
  async function dropOn(ev, target) {          // גרירה לתיבת הת"ע: המסמך נהפך לראשי (והקודם עובר למסמכים נוספים); גרירה ל"מסמכים נוספים": מסיר את הקישור לרשימות
    ev.preventDefault(); ev.currentTarget.classList.remove("pd-drop-on");
    const id = dragId || (ev.dataTransfer && ev.dataTransfer.getData("text/plain")); dragId = "";
    const d = S.byId.get(id); if (!d || !M.biz) return;
    if (target === "extra") return toExtras(id);
    if (target.startsWith("bond:")) { const [, sid, role] = target.split(":"); return mgBondAdd(id, sid, role); }
    if (target.startsWith("sub:")) { const [, bid, role] = target.split(":"); return subLink(id, bid, role); }
    if (slotsOf(d, M.biz).includes(target)) return;
    await toggleSlot(id, M.biz, target);
  }
  // ───────── העלאת מסמך משורת חברה בדשבורד: העלאה, ואז בחירת הת"ע (פרטי / כללי) בחלון שמראה מה כבר קיים ─────────
  const RU = { biz: "", doc: "", want: new Set(), err: "", name: "" };
  function rowUpload(bizId) {
    const inp = document.createElement("input"); inp.type = "file"; inp.accept = "application/pdf,.pdf";
    inp.onchange = () => { if (inp.files && inp.files[0]) ruPost(inp.files[0], bizId); };
    inp.click();
  }
  async function ruPost(file, bizId) {
    RU.biz = bizId; RU.doc = ""; RU.want = new Set(); RU.err = ""; RU.name = file.name;
    overlay("pd-rowup", `<div class="pd-head"><b>העלאת מסמך · ${displayName(bizById(bizId), true)}</b><button class="pd-x" onclick="PD._close('pd-rowup')">✕</button></div><div class="pd-body" id="pd-ru-body"></div>`);
    ruPaint();          // הכפתורים זמינים מיד; ההעלאה ברקע, והקישור שנבחר מתבצע כשהיא מסתיימת
    try {
      const buf = await file.arrayBuffer();
      let doc = await upPost({ buf, file, type: "unknown", note: "" }, [bizId]);
      if (!(doc.business_ids || []).includes(bizId)) { const r = await api("/permit-docs/" + doc.id, "PUT", { business_ids: [...(doc.business_ids || []), bizId] }); doc = r.doc; }
      replaceDoc(doc); RU.doc = doc.id; S._fm = null; refresh();
      const want = [...RU.want]; RU.want = new Set();
      for (const t of want) await toggleSlot(RU.doc, RU.biz, t, true);
      ruPaint(); if (want.length && $("pd-nd-body")) ndShow();
    } catch (e) { RU.err = e.message; ruPaint(); }
  }
  function ruPaint() {
    const body = $("pd-ru-body"), d = RU.doc && S.byId.get(RU.doc), b = bizById(RU.biz); if (!body || !b) return;
    if (RU.err) { body.innerHTML = `<div class="pd-empty" style="color:#c0392b">ההעלאה נכשלה: ${E(RU.err)}</div>`; return; }
    const row = t => { const cur = slotDoc(b.id, t), mine = d && cur && cur.id === d.id, want = RU.want.has(t);
      return `<div class="pd-mg-slot" style="margin-bottom:8px"><h4>הת"ע ${SLOT_HE[t]}</h4>${cur ? `<div class="pd-name">${E(cur.original_name || cur.id)}${mine ? ' <span class="pd-chip" style="background:#1e7e4a">המסמך שהועלה</span>' : ""}</div>` : `<div class="pd-sub">אין מסמך מקושר</div>`}
        ${mine ? "" : `<button class="pd-btn ${want ? "sel" : "primary"}" style="margin-top:6px" onclick="PD._ruPick('${t}')">${want ? "✓ יקושר ברגע שההעלאה תסתיים (לחיצה לביטול)" : cur ? "החלפה במסמך שהועלה" : "קישור המסמך שהועלה"}</button>`}</div>`; };
    body.innerHTML = (d ? `<div class="pd-ok-msg">✓ המסמך הועלה ושויך לחברה: <b>${E(d.original_name || d.id)}</b></div>` : `<div class="pd-sub" style="background:#eef3fb;padding:8px;border-radius:6px">⏳ מעלה את <b>${E(RU.name)}</b> ברקע… אפשר כבר לבחור לאיזה הת"ע לקשר.</div>`) +
      `<div class="pd-sub" style="margin:8px 0">לאיזה הת"ע לקשר אותו? (אפשר גם להשאיר כמסמך נוסף)</div>${["private", "general"].map(row).join("")}
      <div class="pd-btns" style="margin-top:10px"><button class="pd-btn" onclick="PD._close('pd-rowup')">סיום${d ? " (כמסמך נוסף)" : ""}</button>${d ? `<button class="pd-btn" onclick="PD._close('pd-rowup');PD.openDoc('${d.id}','${b.id}')">פתיחת המסמך</button>` : ""}</div>`;
  }
  async function ruPick(t) {
    const prev = slotDoc(RU.biz, t);
    if (!RU.doc) { if (RU.want.has(t)) RU.want.delete(t); else if (!prev || confirm("להחליף המסמך הקיים?")) RU.want.add(t); ruPaint(); return; }
    if (prev && prev.id !== RU.doc && !confirm("להחליף המסמך הקיים?")) return;
    await toggleSlot(RU.doc, RU.biz, t, true); ruPaint(); if ($("pd-nd-body")) ndShow();
  }
  async function toggleSlot(docId, bizId, t, noAsk) {
    const d = S.byId.get(docId); if (!d) return;
    const cur = slotsOf(d, bizId), on = !cur.includes(t);
    const next = on ? [...cur, t] : cur.filter(x => x !== t);
    const patch = { slots: { [bizId]: next } };
    const before = snapDoc(d), others = [];
    let prev = null;
    if (on) {
      prev = slotDoc(bizId, t);
      if (prev && prev.id !== docId) others.push({ id: prev.id, bid: bizId, slot: slotsOf(prev, bizId) });
      if (prev && prev.id !== docId && !noAsk && !confirm(`כבר מקושר מסמך אחר (${prev.original_name || prev.id}) להת"ע ${SLOT_HE[t]} של החברה. להחליף? המסמך הקודם יעבור למסמכים נוספים.`)) return;
      if (d.doc_type === "unknown") patch.doc_type = next.length === 2 ? "both" : t;
      else if (d.doc_type !== "both" && d.doc_type !== t) patch.doc_type = "both";          // הסיווג אינו מוצג למשתמש: הקישור לסלוט קובע אותו אוטומטית
      else if (d.doc_type === t && next.length === 2) patch.doc_type = "both";
    }
    // עדכון מיידי במסך, ושמירה ברקע בתור (כך אפשר ללחוץ מיד על הת"ע השני, בלי לחכות לשרת)
    const setSl = (doc, arr) => { doc.slots = { ...(doc.slots || {}), [bizId]: arr.join(",") }; };
    setSl(d, next); if (patch.doc_type) d.doc_type = patch.doc_type;
    if (on && prev && prev.id !== docId) setSl(prev, slotsOf(prev, bizId).filter(x => x !== t));
    S._fm = null; refresh(); if (S._paintDoc && $("pd-doc")) S._paintDoc();
    S._pend = S._pend || new Map(); S._pend.set(docId, (S._pend.get(docId) || 0) + 1);
    S._q = (S._q || Promise.resolve()).then(async () => {
      try {
        const r = await api("/permit-docs/" + docId, "PUT", patch);
        S._pend.set(docId, S._pend.get(docId) - 1);
        if (!S._pend.get(docId)) replaceDoc(r.doc);          // תשובת השרת מחליפה את המצב המקומי רק כשאין עוד שמירה ממתינה לאותו מסמך (אחרת התצוגה הייתה קופצת אחורה)
        await refetchDocs(others.map(o => o.id));
        pushHist(before, (on ? "קישור להת\"ע " : "ביטול קישור להת\"ע ") + SLOT_HE[t] + " של " + bizName(bizId), others);
      } catch (e) {
        S._pend.set(docId, S._pend.get(docId) - 1);
        alert("השמירה נכשלה: " + e.message); await refetchDocs([docId, ...others.map(o => o.id)]);
      }
      refresh(); if (S._paintDoc && $("pd-doc")) S._paintDoc();
    });
  }
  function mgShare(id, on) {
    const d = S.byId.get(id); if (!d) return;
    const others = (d.business_ids || []).filter(x => x !== M.biz);
    if (on) { M.share.add(id); paintMg(); return; }
    if (others.length && !confirm(`להסיר את השיוך ל-${others.length} החברות האחרות? המסמך יישאר רק לחברה הזו.`)) { paintMg(); return; }
    M.share.delete(id);
    if (others.length) updateDoc(id, { business_ids: [M.biz] }); else paintMg();
  }
  const mgRemove = (id, bid) => { const d = S.byId.get(id); if (d) updateDoc(id, { business_ids: (d.business_ids || []).filter(x => x !== bid) }); };
  function mgMove(id) { M.move = M.move === id ? "" : id; M.menu = id; paintMg(); }
  function mgSearch(id, mode, q) {
    const d = S.byId.get(id), out = $("pd-mgs-" + id); if (!d || !out) return;
    const act = async bid => {
      const ids = d.business_ids || [];
      const next = mode === "move" ? [...new Set(ids.map(x => (x === M.biz ? bid : x)))] : [...new Set([...ids, bid])];
      M.move = "";
      return updateDoc(id, { business_ids: next });
    };
    runCompanySearch(q, out, { exclude: x => (d.business_ids || []).includes(x), pick: act,
      mark: () => alert("סימון 'חסר במאגר' אפשרי רק בחלון המסמכים הלא משויכים."),
      mkAdded: () => async bid => { await act(bid); openManage(M.biz); } });
  }
  function nav(docId, bizId, step) {
    const ord = manageOrder(bizId); if (ord.length < 2) return;
    const i = ord.indexOf(docId), next = ord[(i + step + ord.length * 2) % ord.length];
    const fl = S.docFromList;
    S._nav = true; close("pd-doc"); S._nav = false;
    openDoc(next, bizId, fl);
  }

  // ───────── עיצוב ─────────
  const css = document.createElement("style");
  css.textContent = `
  .pd-na{color:#a0a0a0}
  .pd-box.wide.full.fs{width:100vw;height:100vh;max-height:100vh;border-radius:0}#pd-up-body.acfs{display:flex;flex:1;min-height:0;padding:8px 10px;overflow:hidden}
  .pd-ac{display:flex;flex-direction:row;gap:12px;width:100%;height:100%;min-height:0}.pd-ac #pd-ac-thw{display:contents}.pd-ac-thumbs{flex:0 0 132px;overflow-y:auto;display:flex;flex-direction:column;gap:8px;padding-inline-end:4px}.pd-ac-view{flex:1 1 50%;min-width:0;display:flex;flex-direction:column}.pd-ac-view iframe{flex:1;width:100%;border:1px solid #cfcac0;border-radius:6px;background:#777}.pd-ac.multi .pd-ac-view{flex:1 1 44%}.pd-ac-side{flex:1 1 50%;min-width:0;overflow-y:auto;padding-inline-start:6px}.pd-ac.multi .pd-ac-side{flex:1 1 38%}
  .pd-ac-th{position:relative;border:2px solid #d5d0c6;border-radius:8px;background:#fff;cursor:pointer;padding:3px;text-align:center}.pd-ac-th.on{border-color:#1a7f73;box-shadow:0 0 0 2px #bfe3dd}.pd-ac-th img{width:100%;height:auto;border-radius:4px}.pd-ac-thp{font-size:32px;padding:14px 0}.pd-ac-thn{font-size:11px;color:#555;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.pd-ac-th.st-sent,.pd-ac-th.st-skip{opacity:.65}.pd-ac-thb{position:absolute;top:4px;inset-inline-start:4px;font-size:11px;font-weight:700;border-radius:8px;padding:0 6px;color:#fff}.pd-ac-thb.ok{background:#1e7e4a}.pd-ac-thb.sk{background:#888}
  .pd-ac-main{display:flex;gap:14px;align-items:flex-start}.pd-ac-thumb{position:relative;flex:0 0 170px;height:235px;border:1px solid #cfcac0;border-radius:6px;overflow:hidden;cursor:zoom-in;background:#fff}.pd-ac-thumb iframe{width:100%;height:100%;border:0;pointer-events:none}.pd-ac-zoom{position:absolute;bottom:0;inset-inline:0;background:rgba(26,58,92,.78);color:#fff;font-size:12px;text-align:center;padding:3px}
  .pd-ac-sugs{flex:1;min-width:0}.pd-ac-card{border:1px solid #d5d0c6;border-radius:8px;padding:8px 12px;margin:6px 0;cursor:pointer;background:#fff}.pd-ac-card:hover{background:#f3f8f7}.pd-ac-card.on{border-color:#1a7f73;box-shadow:0 0 0 2px #bfe3dd;background:#eef8f6}.pd-ac-card.new{border-style:dashed}.pd-ac-sim{margin-top:6px;padding:6px 10px;background:#fff4d6;border:1px solid #e8c36a;border-radius:6px;color:#7a4d00;font-size:13px}.pd-ac-sim ul{margin:3px 18px 0}.pd-chipx-s2>span.chg,.pd-chipx.big .pd-chipx-s2>span.chg{background:#eaf2fd;color:#1a5fb4;font-weight:700}.pd-chipx.big.chg{border-color:#1a5fb4;border-style:dashed}.pd-chipx.big.chg .pd-chipx-s{background:#eaf2fd;color:#1a5fb4;font-size:15px}.pd-ac-nc{border:1px dashed #c0392b;border-radius:8px;padding:8px 10px;background:#fff8f7}.pd-ac-addbtn{background:#1e7e4a !important;border-color:#1e7e4a !important;color:#fff !important;font-weight:700}.pd-ac-addbtn:hover{background:#176a3d !important}.pd-ac-plain{background:none !important;border:1px solid #cfcac0 !important;color:#555 !important;font-size:12px !important;padding:2px 8px !important}
  .pd-ac-grid,.pd-ac #pd-up-res,.pd-ac #pd-up-res .pd-regbox{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:8px;align-items:start}.pd-ac-grid .pd-ac-card,.pd-ac #pd-up-res .pd-ac-card{margin:0;height:100%;box-sizing:border-box}.pd-ac #pd-up-res{margin-top:8px}.pd-ac #pd-up-res .pd-grp,.pd-ac #pd-up-res>.pd-sub,.pd-ac #pd-up-res>.pd-regbox,.pd-ac #pd-up-res .pd-regbox>.pd-grp,.pd-ac #pd-up-res .pd-regbox>.pd-sub{grid-column:1/-1}.pd-ac-bc .pd-sub{margin-top:2px}.pd-ac-chips{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-top:5px}
  .pd-chipx{display:inline-flex;flex-direction:column;align-items:center;min-width:64px;border-radius:8px;overflow:hidden;border:1px solid #cfcac0;font-size:12px;line-height:1.3;background:#fff}.pd-chipx-t{padding:1px 8px;background:#f1efe9;color:#333;font-weight:600;width:100%;text-align:center;box-sizing:border-box}.pd-chipx-s{padding:1px 8px;font-weight:700;width:100%;text-align:center;box-sizing:border-box}
  .pd-chipx.ok{border-color:#9ccfae}.pd-chipx.ok .pd-chipx-s{background:#e3f4e8;color:#1e7e4a;font-size:14px}.pd-chipx.miss{border-color:#eab0a8}.pd-chipx.miss .pd-chipx-s{background:#fdecea;color:#c0392b}.pd-chipx.na .pd-chipx-s{background:#f4f4f4;color:#888;font-weight:400}
  .pd-chipx-s2{display:flex;width:100%}.pd-chipx-s2>span{flex:1;padding:1px 8px;text-align:center;font-weight:700;background:#e3f4e8;color:#1e7e4a;white-space:nowrap}.pd-chipx-s2>span+span{border-inline-start:1px solid #9ccfae}.pd-chipx.shared{min-width:130px}.pd-chipx-s2>span.miss{background:#fdecea;color:#c0392b}.pd-chipx-s2>span.na{background:#f4f4f4;color:#888;font-weight:400}
  button.pd-chipx{font-family:inherit;padding:0;cursor:pointer;text-align:center}.pd-chipx.big{flex:1;min-width:0;font-size:15px;border-width:2px;border-radius:10px}.pd-chipx.big .pd-chipx-t{font-size:17px;padding:6px 10px}.pd-chipx.big .pd-chipx-s{font-size:18px;padding:6px 10px}.pd-chipx.big:hover{box-shadow:0 0 0 3px #bfe3dd}.pd-chipx.big.new .pd-chipx-t{padding:14px 10px;background:#fff}.pd-chipx.big.wide{display:flex;width:100%;margin-top:6px}.pd-chipx.big .pd-chipx-s2>span{padding:6px 10px;font-size:15px}.pd-chipx.big .pd-ac-warn{width:calc(100% - 12px);margin:4px 6px;box-sizing:border-box;text-align:start}.pd-chipx.big.both .pd-chipx-t{font-size:17px}.pd-chipx.new{border-color:#1a7f73}
  .pd-ac-topcard{border:2px solid #1a7f73;border-radius:10px;padding:10px 12px;background:#f3faf8}.pd-ac-det{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:2px 14px;font-size:13px;margin:6px 0 8px;padding:6px 8px;background:#fff;border:1px solid #d7e6e3;border-radius:6px}.pd-ac-head{display:flex;justify-content:space-between;align-items:center;gap:8px}.pd-ac-row{display:flex;gap:10px;margin-bottom:8px}.pd-ac-col{flex:1;display:flex;flex-direction:column;gap:4px}.pd-ac-btn{width:100%;padding:10px;font-size:16px;font-weight:700;border:1px solid #1a7f73;border-radius:8px;background:#fff;color:#1a5f56;cursor:pointer}.pd-ac-btn:hover{background:#1a7f73;color:#fff}.pd-ac-btn.both{display:flex}.pd-ac-plus{display:inline-block}.pd-ac-btn{display:flex;flex-direction:column;align-items:center;gap:4px}.pd-ac-col .pd-ac-btn{flex:1}.pd-ac-t{font-size:16px}.pd-ac-warn{display:block;font-size:12px;font-weight:400;color:#8a5a00;background:#fff8e6;border:1px solid #ecd88a;border-radius:6px;padding:3px 8px;width:calc(100% - 16px)}.pd-ac-btn:hover .pd-ac-warn{color:#8a5a00}.pd-ac-lnk{display:inline-block;color:#0645ad;text-decoration:underline;cursor:pointer;margin-inline-start:6px}
  .pd-viewhead{padding:6px 12px;background:#faf9f6;border-bottom:1px solid #e0ddd8;font-size:13px}
  .pd-cdgrid{display:grid;grid-template-columns:1fr;gap:8px}
  .pd-cdc{border:1px solid #d6d2ca;border-radius:9px;background:#fff;overflow:hidden}.pd-cdc.sel{border:2px solid #1a3a5c;box-shadow:0 0 0 2px #cfe0f3}
  .pd-cdc-top{display:flex;gap:8px;padding:6px 8px;cursor:pointer}.pd-cdc-top:hover{background:#f7f7f5}
  .pd-cdc-th{width:62px;height:84px;flex:none;background:#eee;border-radius:5px;overflow:hidden;display:flex;align-items:center;justify-content:center}.pd-cdc-th img{max-width:100%;max-height:100%}
  .pd-uc.bond{border-color:#9db7d8;background:#f4f8fd}
  .pd-viewcol{flex:1;min-width:0;display:flex;flex-direction:column;min-height:0}.pd-viewcol .pd-view{flex:1;min-height:0}
  .pd-toolbar{display:flex;flex-direction:column;gap:6px;padding:8px 12px;background:#f1efe9;border-bottom:1px solid #e0ddd8}
  .pd-tbrow{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
  .pd-viewfoot{display:flex;gap:10px;padding:8px 12px;background:#f1efe9;border-top:1px solid #e0ddd8}
  .pd-sidecol{width:430px;max-width:44%}
  .pd-ucs{display:grid;grid-template-columns:repeat(auto-fill,minmax(185px,1fr));gap:8px;margin-top:8px}
  .pd-uc{border:1px solid #d6d2ca;border-radius:9px;background:#fff;display:flex;flex-direction:column;overflow:hidden}.pd-uc.ext{border-color:#c9b46a;background:#fffaf0}
  .pd-uc-top{padding:7px 8px;cursor:pointer;flex:1}.pd-uc-top:hover{background:#f7f7f5}.pd-uc-top b{font-size:13px}
  .pd-uc-act{display:flex;gap:5px;align-items:center;flex-wrap:wrap;padding:5px 8px;background:#f7f7f5;border-top:1px solid #eee}
  .pd-ucf{display:flex;gap:6px;margin-top:5px;flex-wrap:wrap}
  .pd-feat{border-radius:9px;padding:2px 9px;font-size:12px;font-weight:700;background:#eee;color:#555}.pd-feat.full{background:#e1f3e8;color:#1e7e4a}.pd-feat.part{background:#fdecea;color:#c0392b}.pd-feat.ex{background:#fff1d6;color:#8a5a00}
  .pd-feat.glow{box-shadow:0 0 0 3px #ffd400,0 0 12px 3px #ffb300;background:#fff7c2;color:#5a4300}
  .pd-asg{border-radius:8px;padding:6px 10px;font-weight:700;font-size:13.5px;margin-top:8px}.pd-asg.ok{background:#e1f3e8;color:#1e7e4a}.pd-asg.no{background:#fdecea;color:#c0392b}
  .pd-picker{border:2px solid #b9c7da;background:#f7f9fc;border-radius:10px;padding:8px 10px;margin-top:8px}.pd-picker-h{display:flex;justify-content:space-between;align-items:center;margin-bottom:4px}
  .pd-nav{display:flex;gap:6px;align-items:center}.pd-nav .pd-btn{flex:none}.pd-navpos{flex:1;text-align:center;font-weight:600;font-size:13px}
  .pd-link2{border:none;background:none;color:#1a3a5c;font-size:12.5px;cursor:pointer;text-decoration:underline;padding:2px 4px}
  .pd-sel{border:1px solid #cfcac0;border-radius:6px;padding:2px 4px;font-size:12px;background:#fff}
  .pd-menu summary{cursor:pointer;font-size:12.5px;color:#555;list-style:none}.pd-menu summary::-webkit-details-marker{display:none}.pd-menu[open]{background:#f7f7f5;border-radius:6px;padding:4px 6px}
  .pd-box.wide.full{width:min(1750px,99vw);height:96vh}
  .pd-rv{display:flex;flex:1;min-height:0;height:100%}.pd-rv .pd-view{flex:1;min-width:0}
  .pd-sidecol{width:440px;max-width:46%;display:flex;flex-direction:column;min-height:0;border-inline-start:1px solid #e0ddd8}
  .pd-sidehead{padding:10px 12px;background:#f1efe9;border-bottom:1px solid #e0ddd8;display:flex;flex-direction:column;gap:7px}
  .pd-sidecol .pd-side{width:auto;max-width:none;flex:1;border:0}
  .pd-tabs{display:flex;gap:4px;flex-wrap:wrap}.pd-tab{border:1px solid #cfcac0;background:#fff;border-radius:7px;padding:4px 9px;font-size:12.5px;cursor:pointer}.pd-tab.sel{background:#1a3a5c;color:#fff;border-color:#1a3a5c}
  .pd-qsel{outline:2px solid #1a3a5c}.pd-cdbar{position:sticky;bottom:0;background:#fff;border-top:2px solid #cfcac0;padding:8px 4px;margin-top:14px;display:flex;gap:6px;flex-wrap:wrap;align-items:center;box-shadow:0 -4px 8px #0001}.pd-tab{font-weight:600}.pd-tab.sub{font-weight:400;font-size:12px;padding:3px 8px;background:#f6f4ee}.pd-tab.sub.sel{background:#3d6a99;color:#fff}
  .pd-tabn{display:inline-block;background:#e9e6df;color:#333;border-radius:9px;padding:0 6px;font-size:11px;margin-inline-start:3px}.pd-tab.sel .pd-tabn{background:#fff3;color:#fff}
  .pd-marks{display:flex;gap:4px;flex-wrap:wrap;margin-top:3px}.pd-mk{font-size:11px;border-radius:8px;padding:1px 7px;background:#eee;color:#555}
  .pd-mk.private{background:#f0e3f5;color:#7a3b8f}.pd-mk.general{background:#e0ebf7;color:#1e4570}.pd-mk.miss{background:#fdecea;color:#c0392b;font-weight:600}.pd-mk.off{background:#f4f4f2;color:#9a9a9a}
  .pd-mk.me{outline:2px solid #1e7e4a;font-weight:700}.pd-mk.ex{background:#fff1d6;color:#8a5a00}
  .pd-ext-tbl{width:100%;border-collapse:collapse;font-size:13px}.pd-ext-tbl th,.pd-ext-tbl td{padding:6px 8px;border-bottom:1px solid #eee;text-align:right;vertical-align:top}
  .pd-drop-on{outline:3px dashed #1e7e4a;outline-offset:-3px;background:#edf7f1}
  #pd-assign .pd-ov,#pd-ext .pd-ov,#pd-recent .pd-ov{z-index:1050}#pd-doc .pd-ov{z-index:1080}#pd-confirm .pd-ov{z-index:1100}
  .pd-as-top{display:flex;gap:16px;align-items:flex-start}.pd-as-new{flex:1.1;min-width:0}.pd-as-have{flex:1;min-width:0}
  .pd-as-cap{font-size:12.5px;margin:3px 0}
  .pd-as-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}
  .pd-as-mini{border:1px solid #d6d2ca;border-radius:8px;padding:6px;background:#fff;cursor:pointer;display:flex;flex-direction:column;gap:4px}
  @media(max-width:900px){.pd-as-top{flex-direction:column}}
  .pd-spin{display:inline-block;width:14px;height:14px;border:2px solid #b9c9e6;border-top-color:#1a3a5c;border-radius:50%;animation:pd-spin .8s linear infinite;vertical-align:-2px}@keyframes pd-spin{to{transform:rotate(360deg)}}
  .pd-ok{white-space:nowrap}.pd-ok .pd-chip{white-space:normal;line-height:1.2;text-align:center;font-size:10.5px}.pd-ok.pd-c-private{background:#7a3b8f;color:#fff;border-color:#7a3b8f}.pd-ok.pd-c-general{background:#1e4570;color:#fff;border-color:#1e4570}.pd-ok[class*=pd-c-]:hover{filter:brightness(1.15)}.pd-ok.pd-long{width:100%;justify-content:center;border:none;color:#fff;font-weight:600;background:linear-gradient(72deg,#1e4570 0 42%,#7a3b8f 58% 100%)}.pd-ok.pd-long:hover{filter:brightness(1.12)}
  .pd-warn{background:#fff1d6;color:#8a5a00;border:1px solid #e8c36a;border-radius:6px;padding:3px 8px;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap}
  .pd-mg-top{display:flex;gap:16px;align-items:stretch}
  .pd-mg-slot{flex:1;min-width:0;border:2px solid #b9c7da;border-radius:10px;padding:8px 10px;background:#f7f9fc}.pd-mg-slot.off{opacity:.65}
  .pd-mg-slot h4{margin:0 0 6px;font-size:14px;color:#1a3a5c}
  .pd-mg-empty{border:2px dashed #cfcac0;border-radius:8px;padding:34px 10px;text-align:center;color:#6b6b6b}.pd-mg-empty.need{border-color:#e6a39b;color:#c0392b;font-weight:600}
  .pd-mg-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(420px,1fr));gap:12px}
  .pd-mg-card{display:flex;gap:10px;border:1px solid #d6d2ca;border-radius:10px;padding:8px;background:#fff}
  .pd-mg-l{width:150px;flex:none}.pd-mg-r{flex:1;min-width:0;display:flex;flex-direction:column;gap:6px}
  .pd-mg-th{height:200px;background:#eee;border-radius:6px;overflow:hidden;cursor:pointer;display:flex;align-items:center;justify-content:center;position:relative}
  .pd-mg-pg{text-align:center;font-size:12px;color:#555;margin-top:3px;min-height:16px}.pd-mg-th img{max-width:100%;max-height:100%;display:block}.pd-mg-th img:not([src]){display:none}.pd-mg-ld{position:absolute;font-size:12px;color:#777}
  .pd-mg-share{display:flex;gap:5px;align-items:center;font-size:12px;margin-top:5px;cursor:pointer}
  .pd-mg-sh{background:#f7f7f5;border-radius:6px;padding:5px}
  .pd-mini{border:1px solid #cfcac0;background:#fff;border-radius:6px;padding:3px 8px;font-size:12px;cursor:pointer}.pd-mini.sel{background:#1a3a5c;color:#fff;border-color:#1a3a5c}
  .pd-mini.link.sel{background:#7a3b8f;border-color:#7a3b8f}.pd-mini.danger{color:#c0392b;border-color:#e6a39b}
  .pd-mg-bgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:8px;align-items:start}
  #pd-mg .pd-mg-grid{grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:10px}#pd-mg .pd-mg-l{width:105px}#pd-mg .pd-mg-th{height:140px}#pd-mg .pd-mg-card{padding:6px;gap:8px}#pd-mg .pd-mg-r{gap:4px}
  .pd-mg-bslot.sub{border-color:#b7a6d8;background:#f7f4fc}.pd-mg-bslot{border:2px solid #9db7d8;border-radius:8px;padding:5px 7px;background:#f4f8fd}.pd-mg-bslot.gone{border-style:dashed;border-color:#c9b27a;background:#fbf8f0}.pd-mg-bslot.dup{border-color:#e6a39b;background:#fdf4f3}.pd-mg-bslot h5{margin:0 0 4px;font-size:12.5px;color:#1a3a5c}
  .pd-mg-brow{border-top:1px solid #dbe4f0;padding:4px 0 2px}.pd-mg-brow:first-of-type{border-top:0}.pd-mg-brow.off{opacity:.6}.pd-mg-brow.dup,.pd-mg-brow.need{background:#fdf4f3;border-radius:6px;padding:4px}.pd-mg-brl{display:block;font-size:11.5px;font-weight:600;color:#3f6ea8;margin-bottom:2px}.pd-mg-brow.need .pd-mg-brl{color:#c0392b}
  .pd-mg-bempty{border:1.5px dashed #cfcac0;border-radius:6px;padding:7px;text-align:center;font-size:12px;color:#777}
  .pd-mg-bdoc{display:flex;gap:6px;align-items:center;margin-bottom:3px}.pd-mg-bth{width:42px;height:54px;flex:none;background:#eee;border-radius:4px;overflow:hidden;cursor:pointer;display:flex;align-items:center;justify-content:center;position:relative}.pd-mg-bth img{max-width:100%;max-height:100%;display:block}.pd-mg-bth img:not([src]){display:none}.pd-mg-bth .pd-mg-ld{font-size:9px;line-height:1.1;text-align:center}
  @media(max-width:900px){.pd-mg-top{flex-direction:column}.pd-mg-grid{grid-template-columns:1fr}}
  .pd-f-cols{display:grid;grid-template-columns:1fr 1fr;gap:24px;align-items:start}.pd-f-col{min-width:0}@media(max-width:900px){.pd-f-cols{grid-template-columns:1fr}}
  .pd-homeh{margin:26px 0 10px;font-size:16px;color:#1a3a5c}
  .pd-missing{background:#fdecea;color:#c0392b;border:1px solid #e6a39b;border-radius:6px;padding:3px 8px;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap}
  .pd-ok{background:#fff;border:1px solid #d6d2ca;border-radius:6px;padding:3px 8px;font-size:12px;cursor:pointer;display:inline-flex;gap:4px;align-items:center;flex-wrap:wrap}
  .pd-warn2{color:#b85c00;font-size:11px;margin-top:2px}
  .pd-chip{color:#fff;border-radius:10px;padding:1px 7px;font-size:11px;white-space:nowrap}
  .pd-ov{position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:1000;display:flex;align-items:center;justify-content:center;padding:12px}
  #pd-confirm .pd-ov{z-index:1100}
  .pd-box{background:#fff;color:#1a1a1a;border-radius:12px;width:min(560px,96vw);max-height:92vh;display:flex;flex-direction:column;overflow:hidden;direction:rtl}
  .pd-box.wide{width:min(1250px,97vw);height:92vh}
  .pd-head{display:flex;gap:10px;align-items:center;padding:10px 14px;background:#f1efe9;border-bottom:1px solid #e0ddd8}
  .pd-head b{flex:1;font-size:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .pd-x{border:none;background:none;font-size:18px;cursor:pointer}
  .pd-body{padding:14px;overflow:auto;flex:1}
  .pd-split{display:flex;gap:0;flex:1;min-height:0;height:100%}
  .pd-view{flex:1;min-width:0;background:#777}.pd-view iframe{width:100%;height:100%;border:0}
  .pd-side{width:360px;max-width:42%;padding:12px 14px;overflow:auto;border-inline-start:1px solid #e0ddd8}
  #pd-up-body{padding:0;display:flex;flex-direction:column}#pd-up-body .pd-split{height:calc(92vh - 60px)}
  .pd-side h4{margin:12px 0 5px;font-size:13px;color:#1a3a5c}
  .pd-row{display:flex;gap:10px;align-items:center;padding:8px 6px;border-bottom:1px solid #eee;cursor:pointer}.pd-row:hover{background:#f7f7f5}
  .pd-grow{flex:1;min-width:0}.pd-name{font-size:13px;font-weight:500;overflow:hidden;text-overflow:ellipsis}
  .pd-sub{font-size:11.5px;color:#6b6b6b}.pd-go{font-size:12px;color:#1a3a5c}
  .pd-empty{padding:26px;text-align:center;color:#c0392b;font-weight:500}
  .pd-btns{display:flex;gap:6px;flex-wrap:wrap}
  .pd-btn{border:1px solid #cfcac0;background:#fff;border-radius:7px;padding:6px 11px;font-size:13px;cursor:pointer}
  .pd-btn.sel{background:#1a3a5c;color:#fff;border-color:#1a3a5c}.pd-btn.primary{background:#1e7e4a;color:#fff;border-color:#1e7e4a}
  .pd-btn.danger{background:#c0392b;color:#fff;border-color:#c0392b}.pd-btn:disabled{opacity:.45;cursor:default}
  .pd-co{display:flex;gap:8px;align-items:center;justify-content:space-between;padding:5px 8px;background:#f7f7f5;border-radius:6px;margin-bottom:4px;font-size:13px}
  .pd-link{border:none;background:none;color:#c0392b;cursor:pointer;font-size:12px;text-decoration:underline;white-space:nowrap}
  .pd-in{width:100%;border:1px solid #cfcac0;border-radius:7px;padding:6px 9px;font:inherit;font-size:13px;box-sizing:border-box}
  .pd-pick{display:block;width:100%;text-align:right;border:1px solid #e0ddd8;background:#fff;border-radius:6px;padding:5px 8px;margin-top:3px;cursor:pointer;font-size:13px}.pd-pick:hover{background:#f1efe9}
  .pd-danger{margin-top:18px;padding-top:12px;border-top:1px dashed #e6a39b}
  .pd-drop{border:2px dashed #b8b2a6;border-radius:12px;padding:40px;text-align:center;cursor:pointer;margin:14px}.pd-drop.over{background:#edf7f1;border-color:#1e7e4a}
  .pd-cand{display:flex;gap:8px;align-items:flex-start;padding:6px 8px;border:1px solid #e0ddd8;border-radius:7px;margin-bottom:4px;cursor:pointer;font-size:13px}
  .pd-tag{background:#e7f1fb;color:#1a3a5c;border-radius:9px;padding:1px 7px;font-size:11px;margin-inline-start:6px;font-weight:400;white-space:nowrap;display:inline-block}.pd-tag.warn{background:#fff1d6;color:#8a5a00}
  .pd-warnbox{background:#fff6e0;border:1px solid #e8c36a;border-radius:7px;padding:7px 10px;font-size:12.5px;margin:6px 0}
  .pd-dup{background:#fdecea;border:1px solid #e6a39b;border-radius:8px;padding:12px;font-size:13.5px;line-height:1.6}
  .pd-ok-msg{background:#edf7f1;border:1px solid #a8d9bc;border-radius:8px;padding:8px 12px;margin:10px 14px 0}
  .pd-st{font-size:11px;border-radius:9px;padding:1px 7px;background:#eee;color:#555;margin-inline-start:6px;white-space:nowrap}.pd-st.bad{background:#fdecea;color:#c0392b;font-weight:600}
  .pd-reg{border:2px solid #c0392b;background:#fdecea;border-radius:8px;padding:7px 9px;margin-top:5px}.pd-tag.red{background:#c0392b;color:#fff}
  .pd-grp{font-size:12px;font-weight:600;color:#1e7e4a;margin:8px 0 4px}.pd-grp.weak{color:#8a8a8a}
  @media(max-width:800px){.pd-split{flex-direction:column}.pd-side{width:auto;max-width:none}}
  `;
  document.head.appendChild(css);

  window.PD = { reload: () => load(), apprReload, apprOf: chp => ((S.appr && S.appr.get(digitsOf(chp))) || []).slice().sort((a, b) => bondLabel(a).localeCompare(bondLabel(b), "he")), bondLabel: x => bondLabel(x), onView: v => PD._formHooks.onView(v), hideTabs: () => PD._formHooks.hideTabs(), similar: (n, id) => similarBiz(n, id), simHtml: (n, id) => simHtml(n, id), searchPage, _fQ: v => { ND.fq = v; later(ND, "_ft", fSearch); }, _evOpen: evOpen, _evAdd: () => { const g = evGroup(); if (g) extAdd(g, g.name); }, _evSearch: evSearch, _evNew: evAddNew, _rowUp: rowUpload, _ruPick: ruPick, _sugRej: sugRej, _regEdit: regEdit, _sugOk: sugOk, _regChange: regChange, _regSet: regSet, _regDel: regDel, _jQ: jAct.q, _jF: jAct.f, _jFA: jAct.fa, _jCF: jAct.cf, _jOpen: jAct.open, _jMore: jAct.more, _jRetry: jAct.retry, _jFile: jFile, _jPlay: jPlay, _jEdit: jEdit, _jView: v => jAct.view(v), _jFind: jFind, _jCDel: jCDel, _jSave: jSave, _jDel: jDel, _jDelGo: jDelGo, _jCancel: jCancel, _jImp: jImp, _jSync: jSync, _jNed: jNed, _jMail: jMail, _jmGo: jmGo, _jmStop: () => { JM.stop = true; }, _jmSet: (k, v) => { JM[k] = v; jmPaint(); }, _jmSrc: (x, on) => { if (on) JM.src.add(x); else JM.src.delete(x); jmPaint(); }, _bulk: bulkRun, _bulkStop: () => { BK.stop = true; }, _bulkOpen: bulkOpen, _upPick: () => upPick(), _unBatchOff: () => { Q.batch = ""; Q.curId = ""; Q.i = 0; uqShow(); }, openDash, dashPage, _ndTab: ndAct.tab, _ndAddCo: ndAddCo, _ndQ: ndAct.q, _ndMiss: ndAct.miss, _ndSug: ndAct.sug, _ndTq: ndAct.tq, _ndGone: ndAct.gone, _ndOpenDoc: ndAct.openDoc, bondDocs: bondDocsOf, docStatus, docCounts, bizAdded, cell, slotCell, slotCells, extraCell, openManage, _slot: toggleSlot, _nav: nav, _mgShare: mgShare, _mgRemove: mgRemove, _mgMove: mgMove, _toExtras: (id, biz) => toExtras(id, biz), _menu: (id, on) => { M.menu = on ? id : (M.menu === id ? "" : M.menu); }, _mgSearch: mgSearch, refresh, homeCards, openUnassigned, unassignedCount, state: S, load, openUpload, openCompany, openDoc, suggest, phraseKind,
    _close: close, _setType: setType, _setNote: setNote, _unassign: unassign, _addSearch: addSearch, _assign: assign, _askDelete: askDelete, _doDelete: doDelete,
    _files: upFiles, _upNew: upNewFor, _upRetry: upRetry, _acPick: acPick, _acPcat: acPcat, _acShow: acShow, _formHooks: { onView: v => { if (U.formFlow && v !== "form") { U.formFlow = false; setTimeout(() => { if (U.list && U.list.some(e => e.st === "pending")) openUpload({ addCompany: true, bizId: U.preset, resume: true }); else acCleanup(); }, 60); } }, hideTabs: () => !!U.formFlow }, _similar: similarBiz, _simHtml: simHtml, _acNc: acNc, _acNcGo: acNcGo, _acNcVal: v => { if (U.cur) U.cur.ncVal = v; const el = $("pd-ac-ncsim"); if (el) el.innerHTML = simHtml(v); }, _acExt: hp => { const c = U.cur; if (c && c.pick && c.pick.kind === "new") acExt(hp, c.pick.name); }, _acDoc: acDoc, _acUnpick: acUnpick, _acGo: acGo, _acBig: acBig, _next: upNext, _tog: upTog, _type: t => { U.cur.type = t; U.cur.typeTouched = true; upReview(); }, _upNote: v => { U.cur.note = v; }, _upSearch: upSearch,
    _upAdd: id => { U.cur.sel.add(id); upReview(); }, _save: upSave, _ocr: upOcr,
    _unSrc: k => { srcMode = k; try { localStorage.setItem("pd_src", k); } catch { /* בלי אחסון */ } Q.curId = ""; Q.i = 0; const el = $("pd-un-src"); if (el) el.innerHTML = SRC.map(([x, l]) => `<button class="pd-mini ${srcMode === x ? "sel" : ""}" onclick="PD._unSrc('${x}')">${l}</button>`).join(""); uqShow(); },
    _unFilter: v => {          // סינון מושהה, והמסמך המוצג לא נטען מחדש אם הוא עדיין ברשימה
      Q.filter = v; clearTimeout(Q._ft);
      Q._ft = setTimeout(() => { const k = unassignedList().findIndex(x => x.id === Q.curId); Q.i = k >= 0 ? k : 0; if (k < 0) Q.curId = ""; uqShow(); }, 300);
    }, _unOk: uqOk, _unUnstage: i => { (Q.pend[Q.curId] || []).splice(i, 1); uqShow(true); }, _unView: v => { Q.view = v; Q.resume = readPos(v); Q.i = 0; Q.curId = ""; uqShow(); },
    _unExtAdd: uqExtAdd, _unExtDetach: uqExtDetach, _unDetach: uqDetach, _unRestore: uqRestore, _unManage: id => { const d = unassignedList()[Q.i]; if (d) openAssign(d.id, [id], d.doc_type, true); }, _unPicker: uqPicker, _upBond: (id, on) => { const c = U.cur; if (!c || !c.bondSel) return; on ? c.bondSel.add(id) : c.bondSel.delete(id); }, _upNewCo: upNewCo, _upExtCo: upExtCo, openCompanyDash, _postExt: (docId, hp, extId) => { if ($("pd-cd") && CD.curBiz) stage({ t: "ext", docId, hp, extId }); else if ($("pd-un") && Q.curId === docId) uqStage({ t: "ext", docId, hp, extId }); else postExtApply(docId, hp, extId).then(() => refresh()).catch(() => {}); }, _cdType: (docId, dtype) => stage({ t: "type", docId, dtype }), _cdVis: (bid, value) => stage({ t: "vis", bid, value }), _spEdit: (d, b) => spEdit(d, b, false), _spSave: spSave, _spDel: spDel, _cdSpecial: (docId, bid) => spEdit(docId, bid, true), _cdOk: cdOk, _cdUnrev: m => cdUnrev(m === true), _cdUnstage: i => { (CD.pend[cdKey()] || []).splice(i, 1); cdShow(); }, _cdExtras: (docId, bid) => stage({ t: "extras", docId, bid }), _postAdd: postAdd, _top: topGo, _cdMode: m => { CD.mode = m; CD.curBiz = ""; CD.i = 0; CD.resume = (() => { try { return JSON.parse(localStorage.getItem(cdPosKey()) || "null"); } catch { return null; } })(); cdShow(); }, _cdGo: cdGo, _cdSkip: () => { if (CD.curBiz) CD.skipped.add(CD.curBiz); CD.curBiz = ""; cdShow(); }, _cdFilter: v => { CD.filter = v; clearTimeout(CD._ft); CD._ft = setTimeout(() => { CD.curBiz = ""; CD.i = 0; cdShow(); }, 300); }, _cdSel: id => { CD.selDoc = id; cdShow(); }, _cdAct: (docId, bid, act) => stage({ t: "act", docId, bid, act }), _cdDetach: (docId, bid) => { const d = S.byId.get(docId); stage({ t: d && (d.business_ids || []).includes(bid) ? "detach" : "reject", docId, bid }); }, _legacy: legacyConvert, _subNew: on => { M.subNew = on; paintMg(); if (on) setTimeout(() => { const i = $("pd-sub-new"); if (i) i.focus(); }, 0); }, _subCreate: subCreate, _subLink: subLink, _subToMain: subToMain, _subDel: subDel, _subVis: subVis, _mgBond: mgBond, _mgBondSearch: mgBondSearch, _mgBondSet: async (docId, sid, slot) => { const d = S.byId.get(docId), x = d && bLink(d, sid); if (x) await mgBondSet(docId, x, slot); }, _mgBondAdd: mgBondAdd, _mgBondDel: mgBondDel, _unBondDel: bondDel, _unAct: uqAct, _unSetType: uqSetType, _cf: cfChoose,
    _home: goHome, goHome, _openExt: openExt, openExt, _extStatus: extStatus, _extDel: extDel, _dragStart: dragStart, _dragEnd: dragEnd, _dragOver: dragOver, _dragLeave: dragLeave, _drop: dropOn,
    _undo: undoLast, _recent: openRecent, _unassignAll: unassignAll, _asAdd: asAdd, _asDrop: asDrop,
    _unPick: uqPick, _unShared: uqShared, _unAssign: uqAssign, _asType: asType, _asSlot: asSlot, _asDo: asDo, _asNext: asNext,
    _unTog: (id, on) => { on ? Q.sel.add(id) : Q.sel.delete(id); uqShow(); }, _unAdd: id => { Q.sel.add(id); uqShow(); }, _unSearch: uqSearch,
    _unType: t => { Q.type = t; Q.typeTouched = true; uqShow(); }, _unNote: v => { Q.note = v; }, _unSave: uqSave, _unOtherDoc: uqOther,
    _unSkip: () => { const d = unassignedList()[Q.i]; if (d) Q.skipped.add(d.id); Q.curId = ""; uqShow(); }, _unUnskip: () => { Q.skipped = new Set(); Q.curId = ""; uqShow(); },
    _unGo: n => { const len = unassignedList().length; Q.i = Math.min(Math.max(0, Q.i + n), Math.max(0, len - 1)); Q.curId = ""; uqShow(); } };
  // חלונות שבהם משנים נתונים נפתחים רק אחרי שהגיעו הנתונים העדכניים מהשרת (בזמן שמוצג העותק השמור)
  function whenFresh(fn) {
    if (window.checkUpdates) window.checkUpdates();          // שינוי ממחשב אחר: נטען ברקע, והחלון מתעדכן כשהוא מגיע
    if (!S.stale) return fn();
    let t = document.getElementById("pd-wait");
    if (!t) { t = document.createElement("div"); t.id = "pd-wait"; t.style.cssText = "position:fixed;bottom:18px;left:50%;transform:translateX(-50%);background:#274d5b;color:#fff;padding:8px 16px;border-radius:20px;z-index:99999;font-size:14px"; document.body.appendChild(t); }
    t.textContent = "טוען נתונים עדכניים מהשרת…";
    S.freshP.then(() => { t.remove(); if (S.stale) alert("אין חיבור לשרת: מוצג עותק שמור, ואי אפשר לפתוח חלון עריכה כרגע"); else fn(); });
  }
  for (const k of ["openManage", "openDoc", "openUpload", "openCompany", "openCompanyDash", "openDash", "openExt", "openRecent", "openUnassigned", "_upNew", "_rowUp"]) {
    const f = window.PD[k]; if (typeof f === "function") window.PD[k] = (...a) => whenFresh(() => f(...a));
  }
})();
