/* מאגר מסמכי היתר עסקה (admin.html): עם קישור מסמך לרשימות כללי / פרטי של כל חברה, וחלון "ניהול מסמכים".
   תלוי בגלובלים של דף הניהול: businesses, adminToken, apiFetch, escHtml, displayName, showStatus, render, view.
   חשיפה: window.PD (cell, slotCell, extraCell, openManage, homeCards, load, openUpload, openUnassigned, openCompany, openDoc ...) */
(function () {
  "use strict";
  const S = { ext: [], docs: [], byBiz: new Map(), byId: new Map(), loaded: false, loading: false, err: "" };
  const TL = { general: "כללי", private: "רק פרטי", both: "פרטי", unknown: "לא ידוע", other: "לא קשור / לא היתר" };
  const TCOL = { general: "#1e4570", private: "#7a3b8f", both: "#1e7e4a", unknown: "#8a6d00", other: "#777" };
  const $ = id => document.getElementById(id);
  const E = s => escHtml(s);
  const PDFJS = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
  const PDFJS_WORKER = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  const TESS = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";

  const authH = () => (adminToken ? { Authorization: "Bearer " + adminToken } : {});
  async function api(path, method, body) {
    const res = await fetch("/api" + path, {
      method: method || "GET",
      headers: { ...authH(), ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
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
  const extById = id => S.ext.find(x => x.id === id);
  const extName = id => { const x = extById(id); return x ? x.name : "(חברה שנמחקה מהרשימה)"; };
  const extGuess = st => (/מיזוג|מוזג/.test(st || "") ? "merged" : /מחוק|נמחק|מבוטל|פירוק|מפורק|מחוסל|חוסל|חיסול/.test(st || "") ? "deleted" : "not_in_db");
  const slotsOf = (d, b) => String((d.slots || {})[b] || "").split(",").filter(Boolean);       // לאילו רשימות (general / private) המסמך מקושר אצל החברה
  const liveDocs = bizId => (S.byBiz.get(bizId) || []).filter(d => d.doc_type !== "other");
  const slotDoc = (bizId, t) => liveDocs(bizId).find(d => slotsOf(d, bizId).includes(t)) || null;
  const needOf = b => ({ private: b.visibility === "פרטי" || b.visibility === "רק פרטי", general: b.visibility !== "רק פרטי" });
  const extrasOf = bizId => liveDocs(bizId).filter(d => !slotsOf(d, bizId).length);
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
  const metaHtml = d => `<span data-meta="${d.id}" title="${E(datesOf(d).length ? "תאריכים שנמצאו במסמך: " + datesOf(d).map(fmtDate).join(", ") : "")}">${E(metaText(d))}</span>`;
  const metaBusy = new Set();
  async function ensureMeta(docId, pdf) {          // ממלא מספר עמודים ותאריכים פעם אחת לכל מסמך, כשהוא נפתח / נטענת לו תמונה
    const d = S.byId.get(docId); if (!d || d.pages || metaBusy.has(docId) || S.metaOff) return;
    metaBusy.add(docId);
    try {
      const n = pdf.numPages, want = [...new Set([1, 2, n - 1, n].filter(p => p >= 1 && p <= n))]; let text = "";
      for (const p of want) { try { text += "\n" + (await (await pdf.getPage(p)).getTextContent()).items.map(x => x.str).join(" "); } catch { /* עמוד בלי טקסט */ } }
      const r = await api("/permit-docs/" + docId, "PUT", { pages: n, doc_dates: extractDates(text) });
      replaceDoc(r.doc); const nd = S.byId.get(docId);
      document.querySelectorAll(`[data-meta="${docId}"]`).forEach(el => { el.textContent = metaText(nd); el.title = datesOf(nd).length ? "תאריכים שנמצאו במסמך: " + datesOf(nd).map(fmtDate).join(", ") : ""; });
    } catch (e) { if (/no such column/.test(e.message || "")) S.metaOff = true; }      // לפני מיגרציה 0010: לא מנסים שוב
    metaBusy.delete(docId);
  }

  // ───────── חיפוש חברה: במאגר שלנו, ובמאגר הרשם (חברות שאינן במאגר: כרטיסייה אדומה; סימון חברות מחוסלות/נמחקו) ─────────
  const DEFUNCT = /מחוק|נמחק|מבוטל|פירוק|מפורק|מחוסל|חוסל|חיסול/;
  const stTag = st => (st ? `<span class="pd-st${DEFUNCT.test(st) ? " bad" : ""}">${E(st)}</span>` : "");
  const digitsOf = x => String(x || "").replace(/\D/g, "").replace(/^0+/, "");
  const markText = r => `חסר במאגר: ${r.name} (ח.פ. ${r.id}${r.status ? ", " + r.status : ""})`;
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
      const ad = e.target.closest("[data-addreg]"); if (ad) return addReg(ad.dataset.addreg, ad.dataset.defunct === "1", o.mkAdded && o.mkAdded());
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
    const inDb = rs.map(r => ({ r, b: byChp.get(digitsOf(r.id)) })).filter(x => x.b && !o.exclude(x.b.id));
    const miss = rs.filter(r => !byChp.has(digitsOf(r.id)));
    box.innerHTML = (inDb.length ? `<div class="pd-grp weak">במאגר שלנו (לפי הרשם)</div>` + inDb.slice(0, 6).map(x => o.card ? o.card(x.b) : `<button class="pd-pick" data-pick="${x.b.id}">${displayName(x.b, true)} <span class="pd-sub">${E(x.r.id)}</span>${stTag(x.r.status)}</button>`).join("") : "") +
      (miss.length ? `<div class="pd-grp" style="color:#c0392b">לא במאגר שלנו (נמצאו ברשם)</div>` + miss.slice(0, 8).map(r => `
        <div class="pd-reg"><div><b>${E(r.name)}</b> <span class="pd-tag red">לא במאגר</span>${r.defunct ? ' <span class="pd-tag red">⚠ מחוסלת / נמחקה</span>' : ""}</div>
          <div class="pd-sub">${E(r.type || "")} · ח.פ. ${E(r.id)}${r.status ? " · " + E(r.status) : ""}</div>
          <div class="pd-btns" style="margin-top:4px">${o.ext ? `<span class="pd-sub">שיוך כחברה שאינה במאגר:</span> ${["deleted", "merged", "not_in_db"].map(st => `<button class="pd-btn ${extGuess(r.status) === st ? "sel" : ""}" data-ext="${st}" data-id="${E(r.id)}" data-name="${E(r.name)}" data-status="${E(r.status || "")}">${EXT_HE[st]}</button>`).join("")}` : `<button class="pd-btn" data-mark="${E(r.id)}" data-name="${E(r.name)}" data-status="${E(r.status || "")}">סמן במסמך: חסר במאגר</button>`}
            <button class="pd-btn" data-addreg="${E(r.id)}" data-defunct="${r.defunct ? 1 : 0}">הוספה למאגר…</button></div></div>`).join("") +
        (d.more ? `<div class="pd-sub">יש עוד תוצאות: חדדו את החיפוש</div>` : "") : (inDb.length ? "" : `<div class="pd-sub">לא נמצאה גם ברשם</div>`));
  }
  let pendingAdd = null;
  function addReg(id, defunct, added) {        // הוספת חברה שנמצאה ברשם למאגר: פותח את טופס "הוספת עסק" הרגיל עם ח.פ. ממולא; אם יש added - אחרי השמירה הוא משייך אוטומטית
    if (defunct && !confirm("החברה מחוסלת / נמחקה ברשם. להוסיף אותה למאגר בכל זאת?")) return;
    pendingAdd = added ? { chp: digitsOf(id), added } : null;
    ["pd-confirm", "pd-un", "pd-upload", "pd-doc", "pd-manage", "pd-company"].forEach(close);
    if (typeof openForm === "function") { openForm(null); setTimeout(() => { if (typeof addCompany === "function") addCompany(String(id)); }, 150); }
  }

  function bizAdded(b) {        // נקרא מטופס העסקים אחרי שמירת עסק חדש
    const p = pendingAdd; pendingAdd = null;
    if (p && b && digitsOf(b.chp_number) === p.chp) p.added(b.id);
  }

  // ───────── טעינה ואינדקס ─────────
  function reindex() {
    S.byBiz = new Map(); S.byId = new Map();
    for (const d of S.docs) {
      S.byId.set(d.id, d);
      for (const b of d.business_ids || []) { if (!S.byBiz.has(b)) S.byBiz.set(b, []); S.byBiz.get(b).push(d); }
    }
  }
  async function load() {
    if (S.loading) return;
    S.loading = true;
    try { const r = await api("/permit-docs"); S.docs = r.docs || []; S.err = ""; reindex(); S.loaded = true; }
    catch (e) { S.err = e.message || "שגיאה"; S.loaded = true; }
    try { S.ext = (await api("/permit-ext")).companies || []; S.extErr = ""; } catch (e) { S.ext = []; S.extErr = e.message || "שגיאה"; }      // לפני מיגרציה 0008 אין חברות שאינן במאגר
    S.loading = false;
    refresh();
  }
  function replaceDoc(doc) {
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
    for (const id of ["pd-confirm", "pd-ext", "pd-recent", "pd-assign", "pd-doc", "pd-upload", "pd-manage", "pd-company"]) if ($(id)) { close(id); break; }
  });

  // כרטיסי הדף הראשי: "מסמכי היתר עיסקא"
  function homeCards() {
    if (!S.loaded && !S.loading && typeof isAdmin !== "undefined" && isAdmin) load();
    const c = S.loaded && !S.err ? viewCounts() : null;
    return `<h3 class="pd-homeh">מסמכי היתר עיסקא</h3><div class="home-grid">
      <button class="home-card" onclick="PD.openUpload()"><span class="ico">📄</span><b>העלאת היתר עסקה</b><span class="sub">זיהוי חברה מתאימה והצעת שיוך</span></button>
      <button class="home-card" onclick="PD.openUnassigned()"><span class="ico">🗂️</span><b>מסמכי היתר: שיוך ובדיקה${c ? " (" + (c.un + c.review) + ")" : ""}</b><span class="sub">${c ? `${c.un} לא משויכים · ${c.review} לבדיקה · ${c.other} אחרים` : "לא משויכים, לבדיקה, מסמכים אחרים"}</span></button>
      <button class="home-card" onclick="PD.openExt()"><span class="ico">🏚️</span><b>חברות שאינן במאגר (${S.ext.length})</b><span class="sub">מחוקות / מוזגו / לא במאגר</span></button></div>`;
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
  async function openDoc(docId, fromBiz, fromList) {
    const d = S.byId.get(docId); if (!d) return;
    close("pd-manage");
    S.docFromList = !!fromList;          // נפתח מהרשימה הראשית: בסגירה חוזרים אליה ולא לחלון הניהול
    let blobUrl = "", fileErr = "";
    overlay("pd-doc", `<div class="pd-body">טוען…</div>`, true);
    closers["pd-doc"] = () => { if (blobUrl) URL.revokeObjectURL(blobUrl); if (fromBiz && !S._nav && !fromList && bizById(fromBiz)) openManage(fromBiz); };
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
      const typeBtns = Object.keys(TL).map(t => `<button class="pd-btn ${doc.doc_type === t ? "sel" : ""}" onclick="PD._setType('${docId}','${t}')">${TL[t]}</button>`).join("");
      const chips = ids.map(b => `<div class="pd-co"><span>${E(bizName(b))}</span><button class="pd-link" onclick="PD._unassign('${docId}','${b}')" title="ביטול שיוך המסמך לחברה הזו">ביטול שיוך</button></div>`).join("") || `<div class="pd-sub">המסמך לא משויך לאף חברה</div>`;
      const ord = fromBiz ? manageOrder(fromBiz) : [], pos = ord.indexOf(docId);
      const nav = fromBiz && ord.length > 1 ? `<button class="pd-btn" onclick="PD._nav('${docId}','${fromBiz}',-1)" title="המסמך הקודם של החברה">→</button><span class="pd-sub">${pos + 1} / ${ord.length}</span><button class="pd-btn" onclick="PD._nav('${docId}','${fromBiz}',1)" title="המסמך הבא של החברה">←</button>` : "";
      const slotBtns = fromBiz ? `<h4>קישור לרשימה של ${E(bizName(fromBiz))}</h4><div class="pd-btns">${["private", "general"].map(t => `<button class="pd-btn ${slotsOf(doc, fromBiz).includes(t) ? "sel" : ""}" onclick="PD._slot('${docId}','${fromBiz}','${t}')">${slotsOf(doc, fromBiz).includes(t) ? "✓ " : ""}הת"ע ${SLOT_HE[t]}</button>`).join("")}</div>` : "";
      const headHtml = `<div class="pd-head">${nav}<b>${E(doc.original_name || doc.id)}</b><span class="pd-sub">${fmtSize(doc.size)}${metaText(doc) ? " · " + E(metaText(doc)) : ""}${S.lastMs ? " · נטען ב-" + (S.lastMs / 1000).toFixed(1) + " שנ'" : ""}</span>${S.integrity && S.integrity[docId] === false ? ' <span style="color:#c0392b;font-weight:600">⚠ הקובץ שהתקבל שונה מהקובץ שנשמר (ייתכן סינון תוכן ברשת)</span>' : ""}<button class="pd-btn" onclick="PD._home()" title="סגירת החלונות וחזרה לדף הראשי של הניהול">🏠 ראשי</button><button class="pd-x" onclick="PD._close('pd-doc')">✕</button></div>`;
      const sideHtml = `
            <h4>סיווג</h4><div class="pd-btns">${typeBtns}</div>${slotBtns}
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
        box.innerHTML = headHtml + `<div class="pd-split"><div class="pd-view">${blobUrl ? `<iframe src="${blobUrl}" title="המסמך"></iframe>` : `<div class="pd-empty">${E(fileErr || "הקובץ לא זמין")}</div>`}</div><div class="pd-side" id="pd-doc-side">` + sideHtml + `</div></div>`;
      }
      const s2 = $("pd-doc-side"); if (s2) s2.scrollTop = keep;
    };
    S._paintDoc = paint; paint();
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
          if (w.has("בזאת") && w.has("אישית") && (w.has("עיסקא") || w.has("היתר")) && (w.has("המעוניין") || w.has("התקשרות"))) pe = true;
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
    for (const h of hps) { if (!hpOk(h) || h[0] !== "5") continue; const b = byChp.get(h); if (b) add(b, "hp", "ח.פ. " + h + " בקובץ"); else outside.add(h); }
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
  const U = { queue: [], cur: null, preset: null };
  function openUpload(opts) {
    U.queue = []; U.cur = null; U.preset = opts && opts.bizId || null;
    overlay("pd-upload", `<div class="pd-head"><b>העלאת היתר עסקה</b><button class="pd-btn" onclick="PD._home()" title="סגירת החלונות וחזרה לדף הראשי של הניהול">🏠 ראשי</button><button class="pd-x" onclick="PD._close('pd-upload')">✕</button></div>
      <div class="pd-body" id="pd-up-body"></div>`, true);
    closers["pd-upload"] = () => { if (U.cur && U.cur.url) URL.revokeObjectURL(U.cur.url); U.cur = null; };
    upPick();
  }
  function upPick(msg) {
    $("pd-up-body").innerHTML = `
      ${msg ? `<div class="pd-ok-msg">${msg}</div>` : ""}
      <div class="pd-drop" id="pd-drop" onclick="document.getElementById('pd-file').click()">
        <div style="font-size:34px">📄</div><b>גררו לכאן קובצי PDF או לחצו לבחירה</b>
        <div class="pd-sub">אפשר לבחור כמה קבצים; הם יעברו אחד אחד. אחרי הבחירה המערכת תחפש חברה מתאימה ותציע שיוך.</div>
        <input type="file" id="pd-file" accept="application/pdf,.pdf" multiple style="display:none" onchange="PD._files(this.files)">
      </div>${U.preset ? `<p class="pd-sub">המסמך ישויך מראש לחברה: <b>${E(bizName(U.preset))}</b> (אפשר לשנות בשלב הבא)</p>` : ""}`;
    const dz = $("pd-drop");
    ["dragenter", "dragover"].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add("over"); }));
    ["dragleave", "drop"].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove("over"); }));
    dz.addEventListener("drop", e => upFiles(e.dataTransfer.files));
  }
  function upFiles(files) { U.queue = [...files].filter(f => /\.pdf$/i.test(f.name) || f.type === "application/pdf"); if (!U.queue.length) return; upNext(); }
  async function upNext() {
    if (U.cur && U.cur.url) URL.revokeObjectURL(U.cur.url);
    const file = U.queue.shift();
    if (!file) { upPick(U.cur ? "✓ כל הקבצים טופלו." : ""); U.cur = null; return; }
    const body = $("pd-up-body");
    body.innerHTML = `<div class="pd-empty">בודק את הקובץ <b>${E(file.name)}</b>…<br><span class="pd-sub" id="pd-up-st">בדיקת כפילות</span>${U.queue.length ? `<br><span class="pd-sub">נותרו בתור: ${U.queue.length}</span>` : ""}</div>`;
    const st = t => { const el = $("pd-up-st"); if (el) el.textContent = t; };
    const buf = await file.arrayBuffer();
    U.cur = { file, buf, url: URL.createObjectURL(file), text: "", sel: new Set(), type: "unknown", note: "", ocr: false };
    try {
      const sha = await sha256(buf); U.cur.sha = sha;
      const ex = await api("/permit-docs?sha=" + sha);
      if (ex.exists) { upDuplicate(ex.doc); return; }
    } catch (e) { body.innerHTML = `<div class="pd-empty" style="color:#c0392b">שגיאה: ${E(e.message)}</div><button class="pd-btn" onclick="PD._next()">דילוג</button>`; return; }
    st("קריאת טקסט מהמסמך");
    try { const r = await extractText(buf, 15); U.cur.text = r.text; U.cur.pages = r.pages; } catch (e) { U.cur.textErr = e.message; }
    upReview(true);
  }
  function upDuplicate(doc) {
    const cos = (doc.business_ids || []).map(b => E(bizName(b))).join(", ") || "ללא שיוך";
    $("pd-up-body").innerHTML = `<div class="pd-dup"><b>⚠ קובץ זהה בדיוק כבר קיים במאגר</b> (${E(doc.original_name || doc.id)}, ${TL[doc.doc_type]}).<br>משויך אל: ${cos}.<br>קובץ זהה לא נכנס פעמיים. אפשר לפתוח את המסמך הקיים ולהוסיף לו שיוך.</div>
      <div class="pd-btns" style="margin-top:12px"><button class="pd-btn primary" onclick="PD._close('pd-upload');PD.openDoc('${doc.id}')">פתיחת המסמך הקיים</button><button class="pd-btn" onclick="PD._next()">${U.queue.length ? "דילוג לקובץ הבא" : "סיום"}</button></div>`;
  }
  function upReview(fresh) {
    const c = U.cur;
    if (fresh || !c.sug) {      // ההצעה מחושבת פעם אחת לכל טקסט; בחירות ידניות נשמרות בעת רענון התצוגה
      c.sug = suggest(c.text, c.file.name);
      c.sel = new Set(); if (U.preset) c.sel.add(U.preset);      // אין בחירה אוטומטית של חברות: המשתמש בוחר
      if (!c.typeTouched) c.type = c.sug.type;
    }
    const sug = c.sug;
    const noText = normText(c.text).length < 40;
    const card = x => `<label class="pd-cand"><input type="checkbox" ${c.sel.has(x.b.id) ? "checked" : ""} onchange="PD._tog('${x.b.id}',this.checked)"> <span class="pd-grow"><b>${displayName(x.b, true)}</b> <span class="pd-sub">${E(x.b.chp_number || "")} · ${x.hp ? "התאמה לפי ח.פ." : "התאמה לפי שם"} (${E(x.why.join(", "))})</span>${stTag(x.b.registry_status)}</span></label>`;
    const extra = [...c.sel].filter(id => !sug.cands.some(x => x.b.id === id)).map(id => bizById(id)).filter(Boolean).map(b => card({ b, hp: false, why: ["נבחר ידנית"] }));
    const tb = Object.keys(TL).map(t => `<button class="pd-btn ${c.type === t ? "sel" : ""}" onclick="PD._type('${t}')">${TL[t]}</button>`).join("");
    $("pd-up-body").innerHTML = `
      <div class="pd-split">
        <div class="pd-view"><iframe src="${c.url}" title="תצוגה מקדימה"></iframe></div>
        <div class="pd-side">
          <div class="pd-sub">${E(c.file.name)} · ${fmtSize(c.file.size)}${c.pages ? " · " + c.pages + " עמ'" : ""}${U.queue.length ? " · נותרו בתור: " + U.queue.length : ""}</div>
          ${noText ? `<div class="pd-warnbox">${c.textErr ? "שגיאה בקריאת הקובץ: " + E(c.textErr) : "אין בקובץ טקסט (כנראה סריקה)."} ${c.ocr ? "" : `<button class="pd-link" onclick="PD._ocr()">זיהוי טקסט (OCR) — עשוי לקחת כדקה</button>`}</div>` : ""}
          <h4>שיוך לחברה ${sug.shared ? '<span class="pd-tag">מסמך משותף: כמה חברות</span>' : ""}${sug.doubt ? '<span class="pd-tag warn">יש ספק: כמה התאמות לפי שם</span>' : ""}</h4>
          ${sug.cands.length ? candGroups(sug.cands.slice(0, 20), card) : `<div class="pd-sub">לא נמצאה חברה מתאימה בקובץ. אפשר לחפש ידנית.</div>`}${extra.join("")}
          ${sug.outside.length ? `<div class="pd-sub" style="margin-top:4px">ח.פ. של תאגידים בקובץ שאינם במאגר: ${sug.outside.map(E).join(", ")}</div>` : ""}
          <input class="pd-in" placeholder="חיפוש חברה אחרת: שם או ח.פ." oninput="PD._upSearch(this.value)" autocomplete="off" style="margin-top:6px"><div id="pd-up-res"></div>
          <h4>סיווג</h4><div class="pd-btns">${tb}</div>${sug.typeWhy && !c.typeTouched ? `<div class="pd-sub">הצעה אוטומטית: ${E(sug.typeWhy)}</div>` : ""}
          <h4>הערה (אופציונלי)</h4><textarea class="pd-in" rows="2" onchange="PD._upNote(this.value)">${E(c.note)}</textarea>
          <div class="pd-btns" style="margin-top:12px"><button class="pd-btn primary" id="pd-save" onclick="PD._save()">${c.sel.size ? `שמירה ושיוך ל-${c.sel.size} חברות` : "שמירה בלי שיוך"}</button><button class="pd-btn" onclick="PD._next()">דילוג על הקובץ</button></div>
          <div id="pd-up-err" style="color:#c0392b;margin-top:6px"></div>
        </div></div>`;
  }
  // התאמות מובילות למעלה (ח.פ. או שם ברור), פחות מתאימות מתחת
  function candGroups(cands, card) {
    const top = cands.filter(x => x.score >= 2.5), rest = cands.filter(x => x.score < 2.5);
    return (top.length ? `<div class="pd-grp">התאמות מובילות</div>` + top.map(card).join("") : "") +
           (rest.length ? `<div class="pd-grp weak">התאמות נוספות (פחות מתאימות)</div>` + rest.map(card).join("") : "");
  }
  async function upOcr() {
    const c = U.cur; c.ocr = true;
    $("pd-up-body").insertAdjacentHTML("afterbegin", `<div class="pd-warnbox" id="pd-ocr-st">מריץ OCR…</div>`);
    try { c.text += "\n" + await ocrText(c.buf, i => { const el = $("pd-ocr-st"); if (el) el.textContent = "מריץ OCR… עמוד " + i; }); }
    catch (e) { c.textErr = "OCR נכשל: " + e.message; }
    upReview(true);
  }
  function upTog(id, on) { on ? U.cur.sel.add(id) : U.cur.sel.delete(id); const b = $("pd-save"); if (b) b.textContent = U.cur.sel.size ? `שמירה ושיוך ל-${U.cur.sel.size} חברות` : "שמירה בלי שיוך"; }
  function upSearch(q) {
    const out = $("pd-up-res"); if (!out) return;
    runCompanySearch(q, out, { exclude: x => U.cur.sel.has(x), pick: id => { U.cur.sel.add(id); upReview(); },
      mark: r => { U.cur.note = (U.cur.note ? U.cur.note + " | " : "") + markText(r); upReview(); } });
  }
  async function upSave() {
    const c = U.cur, btn = $("pd-save"); if (btn) btn.disabled = true;
    try {
      const u8 = new Uint8Array(c.buf); let bin = "";
      for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
      const res = await fetch("/api/permit-docs", { method: "POST", headers: { ...authH(), "Content-Type": "application/json" },
        body: JSON.stringify({ file_b64: btoa(bin), name: c.file.name, doc_type: c.type, business_ids: [...c.sel], note: c.note || "" }) });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409 && data.doc) { upDuplicate(data.doc); return; }
      if (!res.ok) throw new Error(data.error || res.statusText);
      replaceDoc(data.doc); say("המסמך נשמר"); refresh();
      if (U.queue.length) upNext(); else { U.cur = { ...c, url: "" }; upPick(`✓ נשמר: ${E(c.file.name)}`); }
    } catch (e) { if (btn) btn.disabled = false; const el = $("pd-up-err"); if (el) el.textContent = "השמירה נכשלה: " + e.message; }
  }


  // ───────── דשבורד מסמכי היתר: לא משויכים / לבדיקה / לחברות שאינן במאגר / מסמכים אחרים ─────────
  const Q = { bondPicker: false, bondQ: "", view: "un", picker: null, replace: null, shared: false, i: 0, skipped: new Set(), curId: "", token: 0, sel: new Set(), type: "unknown", typeTouched: false, cands: new Map(), note: "", filter: "", blobUrl: "", readable: null };
  const VIEWS = [["un", "לא משויכים"], ["review", "לבדיקה"], ["ext", "חברות שאינן במאגר"], ["other", "מסמכים אחרים"]];
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
    if (v === "ext") return !(d.business_ids || []).length && (d.ext_ids || []).length > 0;
    if (v === "review") return (d.business_ids || []).length > 0 && reviewReasons(d).length > 0;
    return false;
  };
  const unassignedCount = () => S.docs.filter(d => inView(d, "un")).length;
  const viewCounts = () => { const c = {}; for (const [v] of VIEWS) c[v] = 0; for (const d of S.docs) for (const [v] of VIEWS) if (inView(d, v)) c[v]++; return c; };
  function docHay(d) {        // טקסט לסינון: שם קובץ, כותרת, הערה, ושמות / ח.פ. של החברות המשויכות (גם שאינן במאגר)
    if (d._hay && d._hayN === S.docs.length + ":" + S.ext.length) return d._hay;
    const cos = (d.business_ids || []).map(bizById).filter(Boolean).flatMap(b => [displayName(b), b.chp_number, b.registrar_name, b.permit_name]);
    const exts = (d.ext_ids || []).map(extById).filter(Boolean).flatMap(x => [x.name, x.chp]);
    d._hayN = S.docs.length + ":" + S.ext.length;
    return (d._hay = [d.original_name, d.source_title, d.note, ...cos, ...exts].map(x => String(x || "").toLowerCase()).join(" | "));
  }
  function unassignedList() {
    const f = Q.filter.trim().toLowerCase();
    const l = S.docs.filter(d => inView(d, Q.view) && !Q.skipped.has(d.id) &&
        (!f || docHay(d).includes(f)));
    if (Q.view === "review") return l.sort((a, b) => String(bizName((a.business_ids || [])[0])).localeCompare(String(bizName((b.business_ids || [])[0])), "he"));      // מסמכים של אותה חברה צמודים
    return l.sort((a, b) => sugOf(b).length - sugOf(a).length || String(a.source_title || a.original_name).localeCompare(String(b.source_title || b.original_name), "he"));
  }
  function openUnassigned(view) {
    Q.view = view || "review"; Q.i = 0; Q.curId = ""; Q.filter = ""; Q.shared = false; Q.skipped = new Set(); Q.replace = null;      // דילוג תקף רק לפתיחה הזו של החלון
    overlay("pd-un", `<div class="pd-rv"><div class="pd-viewcol">
        <div class="pd-toolbar">
          <div class="pd-tbrow"><div class="pd-tabs" id="pd-un-tabs"></div><span style="flex:1"></span>
            <button class="pd-btn" onclick="PD._home()" title="סגירת החלונות וחזרה לדף הראשי של הניהול">🏠 ראשי</button><button class="pd-x" onclick="PD._close('pd-un')">✕</button></div>
          <div class="pd-tbrow"><div class="pd-nav"><button class="pd-btn" onclick="PD._unGo(-1)" title="המסמך הקודם">→ הקודם</button><span class="pd-navpos" id="pd-un-pos"></span><button class="pd-btn" onclick="PD._unGo(1)" title="המסמך הבא">הבא ←</button><button class="pd-btn" onclick="PD._unSkip()" title="מסתיר את המסמך עד לפתיחה הבאה של החלון">דילוג</button></div>
            <input class="pd-in" style="flex:1;min-width:180px" placeholder="חיפוש / סינון המסמכים: שם קובץ, חברה, ח.פ., הערה" oninput="PD._unFilter(this.value)" autocomplete="off">
            <span class="pd-sub"><span id="pd-un-count"></span><span id="pd-un-skipped"></span></span>
            <span id="pd-un-undo"></span><button class="pd-link2" onclick="PD._recent()">שיוכים אחרונים</button><button class="pd-link2" onclick="PD._openExt()">חברות שאינן במאגר (<span id="pd-un-extn">${S.ext.length}</span>)</button></div>
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
    if (tabs) tabs.innerHTML = VIEWS.map(([v, l]) => `<button class="pd-tab ${Q.view === v ? "sel" : ""}" onclick="PD._unView('${v}')">${l} <span class="pd-tabn">${vc[v]}</span></button>`).join("");
    const xn = $("pd-un-extn"); if (xn) xn.textContent = S.ext.length;
    if (cnt) cnt.textContent = `${list.length} מסמכים בתצוגה`;
    const pos = $("pd-un-pos"); if (pos) pos.textContent = list.length ? `${Math.min(Q.i, list.length - 1) + 1} / ${list.length}` : "0 / 0";
    const sk = $("pd-un-skipped"); if (sk) sk.innerHTML = Q.skipped.size ? ` · דולגו ${Q.skipped.size} <button class="pd-link" style="color:#1a3a5c" onclick="PD._unUnskip()">הצג אותם שוב</button>` : "";
    if (Q.i >= list.length) Q.i = Math.max(0, list.length - 1);
    const d = list[Q.i], side = $("pd-un-side"), view = $("pd-un-view");
    if (!d) {
      side.innerHTML = Q.skipped.size ? `<div class="pd-empty" style="color:#1e7e4a">אין עוד מסמכים בתור (דולגו ${Q.skipped.size}).<br><button class="pd-btn" style="margin-top:10px" onclick="PD._unUnskip()">הצג את מה שדולג</button></div>`
        : `<div class="pd-empty" style="color:#1e7e4a">${{ un: "אין מסמכים לא משויכים 🎉", review: "אין מסמכים לבדיקה ידנית 🎉", ext: "אין מסמכים ששויכו לחברות שאינן במאגר", other: "אין מסמכים אחרים" }[Q.view]}</div>`;
      view.innerHTML = ""; Q.curId = ""; const ft = $("pd-un-foot"); if (ft) ft.innerHTML = ""; return;
    }
    if (Q.curId !== d.id) {
      Q.curId = d.id; Q.sel = new Set(); Q.typeTouched = false; Q.typeWhy = ""; Q.note = d.note || ""; Q.type = d.doc_type === "other" ? "unknown" : d.doc_type; Q.shared = false; Q.picker = isUnassigned(d) ? "add" : null; Q.replace = null; Q.bondPicker = false; Q.bondQ = "";
      Q.cands = uqMergeCands(d); Q.liveDone = false;
      const tok = ++Q.token;
      view.innerHTML = `<div class="pd-empty" style="color:#fff">טוען מסמך… <span id="pd-un-sec"></span></div>`;
      { const t0 = Date.now(), iv = setInterval(() => { const el = $("pd-un-sec"); if (!el || tok !== Q.token) return clearInterval(iv); el.textContent = Math.round((Date.now() - t0) / 1000) + " שנ'"; }, 500); }
      if (Q.blobUrl) { URL.revokeObjectURL(Q.blobUrl); Q.blobUrl = ""; }
      (async () => {
        try {
          const blob = await fetchPdfBlob(d.id); if (tok !== Q.token) return;
          Q.blobUrl = URL.createObjectURL(blob); view.innerHTML = `<iframe src="${Q.blobUrl}" title="המסמך"></iframe>`;
          if (!d.pages) blob.arrayBuffer().then(buf => pdfDoc(buf)).then(pdf => ensureMeta(d.id, pdf)).catch(() => {});
          unassignedList().slice(Q.i + 1, Q.i + 3).forEach(x => fetchPdfBlob(x.id).catch(() => {}));      // טעינה מראש של שני המסמכים הבאים
          try {           // הצעות נוספות מהטקסט של הקובץ עצמו (אם יש בו טקסט); קבצים סרוקים מסתמכים על ההצעות השמורות
            const r = await extractText(await blob.arrayBuffer(), 6); if (tok !== Q.token) return;
            const sug = suggest(r.text, d.original_name);
            Q.cands = uqMergeCands(d, sug.cands); Q.liveDone = true;
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
      <div class="pd-sub">${E(d.original_name || "")} · ${fmtSize(d.size)} · ${metaHtml(d)}</div>
      ${reasons.length ? `<div class="pd-warnbox">${reasons.map(E).join("<br>")}</div>` : ""}
      ${d.note ? `<div class="pd-warnbox">${E(d.note)}</div>` : ""}
      <div style="margin-top:8px"><span class="pd-sub">סיווג המסמך:</span><div class="pd-btns" style="margin-top:3px">${typeBtns}</div>
        ${d.doc_type === "unknown" && Q.type !== "unknown" ? `<div class="pd-sub" style="margin-top:3px">הצעה: ${TL[Q.type]}${Q.typeWhy ? " (" + E(Q.typeWhy) + ")" : ""} <button class="pd-link2" onclick="PD._unSetType('${Q.type}')">אימוץ ההצעה</button></div>` : ""}</div>
      ${Q.view === "un" && legacyDocs().length ? `<button class="pd-btn" style="margin-top:8px" onclick="PD._legacy()" title="ממיר את הסימון הישן בהערה לשיוך לחברה ברשימת החברות שאינן במאגר">המרת ${legacyDocs().length} סימוני "חסר במאגר" ישנים</button>` : ""}
      ${statusBar}
      ${assigned ? `<div class="pd-ucs">${assigned}</div>` : ""}
      <h4 style="margin-top:14px">${Q.replace ? `שינוי שיוך: בחרו חברה במקום "${E(replName)}" <button class="pd-link2" onclick="PD._unPicker('')">ביטול</button>` : nAsg ? "הוספת שיוך נוסף" : "שיוך לחברה"}</h4>
      <input class="pd-in" id="pd-un-q" placeholder="חיפוש לפי ח.פ. או שם חברה" oninput="PD._unSearch(this.value)" autocomplete="off"><div id="pd-un-res"></div>
      ${sugg.length ? `<div class="pd-sub" style="margin-top:8px">הצעות לפי סריקת המסמך:</div><div class="pd-ucs">${sugg.map(c => ucard(c.b, d, { why: c.why })).join("")}</div>` : `<div class="pd-sub" style="margin-top:8px">לא נמצאו הצעות לפי תוכן המסמך: חפשו ידנית.</div>`}
      <details style="margin-top:8px"><summary class="pd-sub" style="cursor:pointer">חברה שאינה במאגר: הוספה ידנית (בלי חיפוש ברשם)</summary>
        <div style="display:flex;gap:6px;margin-top:5px"><input class="pd-in" id="pd-ext-name" placeholder="שם החברה"><input class="pd-in" id="pd-ext-chp" placeholder="ח.פ." style="max-width:120px"></div>
        <div class="pd-btns" style="margin-top:5px">${["deleted", "merged", "not_in_db"].map(st => `<button class="pd-btn" onclick="PD._unExtAdd('${st}')">שיוך כ"${EXT_HE[st]}"</button>`).join("")}</div></details>
      <details style="margin-top:6px" ${Q.note ? "open" : ""}><summary class="pd-sub" style="cursor:pointer">הערה</summary><textarea class="pd-in" rows="2" onchange="PD._unNote(this.value)">${E(Q.note)}</textarea></details>
      <div id="pd-un-err" style="color:#c0392b;margin-top:6px"></div>`;
    const foot = $("pd-un-foot");
    if (foot) foot.innerHTML = `<button class="pd-btn danger" onclick="PD._askDelete('${d.id}')">🗑 מחיקת המסמך</button>${isOther(d) ? `<button class="pd-btn" onclick="PD._unRestore()">↩ החזרה לתור</button>` : `<button class="pd-btn" onclick="PD._unOtherDoc()" title="עובר ללשונית 'מסמכים אחרים'">סימון: מסמך שאינו היתר עסקה</button>`}`;
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
        <b>${displayName(b)}</b><div class="pd-sub">${b.chp_number ? "ח.פ. " + E(b.chp_number) + " · " : ""}${reg}${stTag(b.registry_status)}</div>
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
  function bcard(x, d) {
    const own = (d.business_ids || []).map(bizById).filter(Boolean).some(b => digitsOf(b.chp_number) && digitsOf(b.chp_number) === digitsOf(x.chp));
    return `<div class="pd-uc bond"><div class="pd-uc-top" style="cursor:default"><b>${E(x.name || x.id)}</b><div class="pd-sub">אג"ח · ${E(x.symbol)} · נייר ${E(x.id)}</div><div class="pd-sub">${E(x.company)}${x.chp && !own ? ' <span class="pd-st bad">החברה לא משויכת למסמך</span>' : ""}</div></div>
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
    out.innerHTML = list.slice(0, 40).map(r => `<button class="pd-pick" onclick="PD._mgBondAdd('${docId}','${E(r.id)}')">${E(r.name)} <span class="pd-sub">${E(r.symbol)}${own(r) ? "" : " · " + E(r.company)}</span>${own(r) ? ' <span class="pd-tag">של החברה</span>' : ""}</button>`).join("")
      || `<div class="pd-sub" style="padding:5px">${qq ? "לא נמצאו אג\"ח" : "אין אג\"ח רשומות לחברה הזו. הקלידו לחיפוש בכל האג\"ח."}</div>`;
  }
  async function mgBondAdd(docId, id) {
    const d = S.byId.get(docId), r = (await bondList()).find(x => x.id === id); if (!d || !r) return;
    try { const before = snapDoc(d); replaceDoc((await api("/permit-docs/" + docId, "PUT", { bonds: [...(d.bonds || []), r] })).doc); pushHist(before, "שויך לאג\"ח " + r.name); }
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
    return `<div class="pd-uc ext"><div class="pd-uc-top"><b>${E(extName(id))}</b><div class="pd-sub">${x && x.chp ? "ח.פ. " + E(x.chp) + " · " : ""}חברה שאינה במאגר <span class="pd-st bad">${x ? EXT_HE[x.status] : ""}</span></div></div>
      <div class="pd-uc-act"><span class="pd-sub">שיוך:</span><button class="pd-link2" onclick="PD._unPicker('change','ext','${id}')">שינוי</button><button class="pd-link2" style="color:#c0392b" onclick="PD._unExtDetach('${id}')">ביטול</button></div></div>`;
  }
  const C = { docId: "", bizId: "", t: "" };
  async function uqAct(bizId, act) {
    const d = unassignedList()[Q.i]; if (!d) return;
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
    refresh(); if ($("pd-un")) uqAfter();
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
  const snapDoc = d => ({ id: d.id, name: d.original_name || d.id, ext_ids: [...(d.ext_ids || [])], bonds: (d.bonds || []).map(x => ({ ...x })), business_ids: [...(d.business_ids || [])], slots: { ...(d.slots || {}) }, doc_type: d.doc_type, note: d.note || "" });
  function pushHist(before, what, others, sid) { const h = histGet(); h.push({ ...before, what, others: others || [], sid: sid || "", at: Date.now() }); histSet(h); undoRefresh(); }
  function undoRefresh() {
    const e = histGet().slice(-1)[0];
    const html = e ? `<button class="pd-link2" onclick="PD._undo()" title="${E(e.name)}: ${E(e.what)}. מחזיר את המסמך למצב שלפני">↩ ביטול אחרון</button>` : "";
    for (const id of ["pd-un-undo", "pd-mg-undo"]) { const el = $(id); if (el) el.innerHTML = html; }
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
      const r = await api("/permit-docs/" + e.id, "PUT", { business_ids: e.business_ids, doc_type: e.doc_type, note: e.note, slots: slotArrs(e.slots, e.business_ids), ...(e.ext_ids ? { ext_ids: e.ext_ids } : {}), ...(e.bonds ? { bonds: e.bonds } : {}) });
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
    try { const c = await extEnsure({ chp: reg.id, name: reg.name, status: st }); await extAssign(d.id, c.id); await uqApplyReplace(d.id); }
    catch (e) { const el = $("pd-un-err"); if (el) el.textContent = "השיוך נכשל: " + e.message + (/no such table/.test(e.message) ? " (חסרה מיגרציה 0008 ב-D1)" : ""); return; }
    uqAfter();
  }
  async function uqExtPick(id) {
    const d = unassignedList()[Q.i]; if (!d) return;
    try { await extAssign(d.id, id); await uqApplyReplace(d.id); } catch (e) { const el = $("pd-un-err"); if (el) el.textContent = "השיוך נכשל: " + e.message; return; }
    uqAfter();
  }
  async function uqExtAdd(st) {
    const d = unassignedList()[Q.i], name = ($("pd-ext-name") || {}).value || "", chp = ($("pd-ext-chp") || {}).value || "";
    if (!d || !(name.trim() || chp.trim())) { const el = $("pd-un-err"); if (el) el.textContent = "יש להקליד שם או ח.פ."; return; }
    try { const c = await extEnsure({ chp, name, status: st }); await extAssign(d.id, c.id); await uqApplyReplace(d.id); }
    catch (e) { const el = $("pd-un-err"); if (el) el.textContent = "השיוך נכשל: " + e.message; return; }
    uqAfter();
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
    for (const id of ["pd-confirm", "pd-ext", "pd-recent", "pd-assign", "pd-doc", "pd-upload", "pd-manage", "pd-company", "pd-un"]) close(id);
    S._nav = false;
    if (typeof setView === "function") setView("home");
  }
  function openExt() {
    const rows = S.ext.slice().sort((a, b) => String(a.name).localeCompare(String(b.name), "he"));
    overlay("pd-ext", `<div class="pd-head"><b>חברות שאינן במאגר (${rows.length})</b><button class="pd-btn" onclick="PD._home()" title="סגירת החלונות וחזרה לדף הראשי של הניהול">🏠 ראשי</button><button class="pd-x" onclick="PD._close('pd-ext')">✕</button></div>
      <div class="pd-body"><div class="pd-sub" style="margin-bottom:8px">חברות שמסמכי היתר משויכים אליהן אבל אינן במאגר העסקים. כל שיוך כזה מוסיף את החברה לכאן. ${S.extErr ? `<span style="color:#c0392b">(${E(S.extErr)}: אם חסרה מיגרציה 0008 - להריץ ב-D1)</span>` : ""}</div>
        <table class="pd-ext-tbl"><thead><tr><th>שם</th><th>ח.פ.</th><th>סטטוס</th><th>מסמכים</th><th></th></tr></thead><tbody>
        ${rows.map(x => `<tr><td>${E(x.name)}</td><td dir="ltr" style="text-align:right">${E(x.chp || "")}</td>
          <td><select class="pd-in" style="padding:3px" onchange="PD._extStatus('${x.id}',this.value)">${["deleted", "merged", "not_in_db"].map(st => `<option value="${st}" ${x.status === st ? "selected" : ""}>${EXT_HE[st]}</option>`).join("")}</select></td>
          <td>${(x.doc_ids || []).map(id => { const d = S.byId.get(id); return d ? `<a href="#" onclick="PD.openDoc('${id}');return false">${E(d.original_name || id)}</a>` : ""; }).filter(Boolean).join(" · ") || '<span class="pd-sub">אין</span>'}</td>
          <td><button class="pd-link" onclick="PD._extDel('${x.id}')">מחיקה מהרשימה</button></td></tr>`).join("") || `<tr><td colspan="5" class="pd-sub">הרשימה ריקה.</td></tr>`}
        </tbody></table></div>`);
  }
  async function extStatus(id, st) {
    try { await api("/permit-ext/" + id, "PUT", { status: st }); const x = extById(id); if (x) x.status = st; say("הסטטוס עודכן"); refresh(); }
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
    if (d) return `<button type="button" class="pd-ok pd-c-${t}" onclick="PD.openDoc('${d.id}','${b.id}',true)" title="${E(d.original_name || "")}">📄 פתיחה${(d.business_ids || []).length > 1 ? ' <span class="pd-chip" style="background:#1e7e4a">משותף</span>' : ""}</button>`;
    if (!needOf(b)[t]) return `<span class="pd-na">—</span>`;
    return liveDocs(b.id).length
      ? `<button type="button" class="pd-warn" onclick="PD.openManage('${b.id}')" title="יש מסמכים לחברה, אבל אף אחד לא קושר לרשימה הזו">לא קושר מסמך</button>`
      : `<button type="button" class="pd-missing" onclick="PD.openManage('${b.id}')" title="אין אף מסמך לחברה">⚠ חסר</button>`;
  }
  // שני התאים של הת"ע פרטי / כללי. אם אותו מסמך (משולב) מקושר לשתי הרשימות: כפתור ארוך אחד לרוחב שתי העמודות
  function slotCells(b) {
    const w = ready(), pr = slotDoc(b.id, "private"), ge = slotDoc(b.id, "general");
    if (!w && pr && ge && pr.id === ge.id)
      return `<td class="pd-cell" colspan="2" style="text-align:center;"><button type="button" class="pd-ok pd-long" onclick="PD.openDoc('${pr.id}','${b.id}',true)" title="${E(pr.original_name || "")}">📄 פתיחה${(pr.business_ids || []).length > 1 ? ' <span class="pd-chip" style="background:#1e7e4a">משותף</span>' : ""}</button></td>`;
    return `<td class="pd-cell" style="text-align:center;">${slotCell(b, "private")}</td><td class="pd-cell" style="text-align:center;">${slotCell(b, "general")}</td>`;
  }
  function extraCell(b) {
    const w = ready(); if (w) return w;
    const n = extrasOf(b.id).length;
    return `<button type="button" class="pd-ok" onclick="PD.openManage('${b.id}')">🗂 ניהול מסמכים${n ? ` <span class="pd-chip" style="background:#b85c00">${n} לבדיקה</span>` : ""}</button>`;
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
  const M = { biz: "", share: new Set(), move: "", menu: "", bond: "", bondQ: "" };
  function openManage(bizId) {
    if (!bizById(bizId)) return;
    M.biz = bizId; M.share = new Set(); M.move = "";
    ["pd-company"].forEach(close);
    overlay("pd-manage", `<div id="pd-mg" style="display:flex;flex-direction:column;height:100%;min-height:0"></div>`, true);
    S._paintMg = paintMg;
    closers["pd-manage"] = () => { if (S._paintMg === paintMg) S._paintMg = null; if ($("pd-un") && !S._nav) { Q.replace = null; uqShow(); } };
    paintMg();
    if (!S.loaded && !S.loading) load();
  }
  function mgCard(d, b) {
    const others = (d.business_ids || []).filter(x => x !== b.id), sl = slotsOf(d, b.id);
    const shared = others.length > 0 || M.share.has(d.id), menuOpen = M.menu === d.id || M.move === d.id;
    const typeSel = `<select class="pd-sel" onchange="PD._setType('${d.id}',this.value)" title="סיווג המסמך">${["general", "private", "both", "unknown", "other"].map(t => `<option value="${t}" ${d.doc_type === t ? "selected" : ""}>${TL[t]}</option>`).join("")}</select>`;
    const linkBtns = sl.length ? `<button class="pd-link2" onclick="PD._toExtras('${d.id}')" title="המסמך יעבור ל'מסמכים נוספים' ויישאר משויך לחברה">הורדה למסמכים נוספים</button>`
      : ["private", "general"].map(t => `<button class="pd-mini link" onclick="PD._slot('${d.id}','${b.id}','${t}')">קשר כהת"ע ${SLOT_HE[t]}</button>`).join("");
    const shareBox = shared ? `<div class="pd-mg-sh">${others.map(o => `<div class="pd-co"><span>${E(bizName(o))}</span><button class="pd-link" onclick="PD._mgRemove('${d.id}','${o}')">הסר</button></div>`).join("")}
        ${M.move === d.id ? "" : `<input class="pd-in" placeholder="הוספת חברה: שם או ח.פ." oninput="PD._mgSearch('${d.id}','add',this.value)" autocomplete="off">`}</div>` : "";
    const moveBox = M.move === d.id ? `<div class="pd-mg-sh"><input class="pd-in" placeholder="העברה לחברה: שם או ח.פ." oninput="PD._mgSearch('${d.id}','move',this.value)" autocomplete="off"></div>` : "";
    return `<div class="pd-mg-card" draggable="true" ondragstart="PD._dragStart(event,'${d.id}')" ondragend="PD._dragEnd()" title="אפשר לגרור לתיבת הת&quot;ע פרטי / כללי או למסמכים נוספים">
      <div class="pd-mg-l"><div class="pd-mg-th" onclick="PD.openDoc('${d.id}','${b.id}')" title="פתיחה בגדול"><img data-thumb="${d.id}" alt="" ${thumbUrls.get(d.id) ? `src="${thumbUrls.get(d.id)}"` : ""}><span class="pd-mg-ld" ${thumbUrls.get(d.id) ? 'style="display:none"' : ""}>טוען…</span></div></div>
      <div class="pd-mg-r">
        <div class="pd-name" style="cursor:pointer;text-decoration:underline" onclick="PD.openDoc('${d.id}','${b.id}')" title="פתיחה בגדול">${E(d.original_name || d.id)}</div>
        <div class="pd-sub">${typeSel} ${fmtSize(d.size)} · ${metaHtml(d)}${others.length ? ` · משותף עם ${others.length} חברות` : ""}${d.note ? " · " + E(d.note).slice(0, 60) : ""}</div>
        <div class="pd-btns">${linkBtns}</div>
        <div class="pd-btns" style="align-items:center">${(d.bonds || []).map(x => `<span class="pd-chip" style="background:#3f6ea8" title="${E(x.company)}">${E(x.symbol || x.name)} <a href="#" style="color:#fff;text-decoration:none" onclick="PD._mgBondDel('${d.id}','${E(x.id)}');return false" title="ביטול השיוך לאג&quot;ח">✕</a></span>`).join("")}<button class="pd-mini ${M.bond === d.id ? "sel" : ""}" onclick="PD._mgBond('${d.id}')" title="שיוך המסמך לאג&quot;ח של החברה">+ שיוך לאג"ח</button></div>
        ${M.bond === d.id ? `<div class="pd-mg-sh"><input class="pd-in" id="pd-mgb-${d.id}" value="${E(M.bondQ)}" placeholder="אג&quot;ח של החברה (או הקלידו לחיפוש בכל האג&quot;ח)" oninput="PD._mgBondSearch('${d.id}',this.value)" autocomplete="off"><div id="pd-mgbr-${d.id}" style="max-height:200px;overflow:auto"></div></div>` : ""}
        <details class="pd-menu" ${menuOpen ? "open" : ""} ontoggle="PD._menu('${d.id}',this.open)"><summary>⋯ עוד</summary>
          <label class="pd-mg-share"><input type="checkbox" ${shared ? "checked" : ""} onchange="PD._mgShare('${d.id}',this.checked)"> מסמך משותף (כמה חברות)</label>${shareBox}
          <div class="pd-btns" style="margin-top:6px"><button class="pd-link2" onclick="PD._mgMove('${d.id}')">העברה לחברה אחרת</button><button class="pd-link2" style="color:#c0392b" onclick="PD._askDelete('${d.id}')">מחיקה</button></div>${moveBox}</details>
        <div id="pd-mgs-${d.id}"></div>
      </div></div>`;
  }
  function paintMg() {
    const root = $("pd-mg"); if (!root) return;
    const b = bizById(M.biz); if (!b) { close("pd-manage"); return; }
    const need = needOf(b), keep = (root.querySelector(".pd-body") || {}).scrollTop || 0;
    const slotBox = t => { const d = slotDoc(b.id, t);
      return `<div class="pd-mg-slot ${need[t] ? "" : "off"}" ondragover="PD._dragOver(event)" ondragleave="PD._dragLeave(event)" ondrop="PD._drop(event,'${t}')"><h4>הת"ע ${SLOT_HE[t]}${need[t] ? "" : ' <span class="pd-sub">(לא נדרש לפי הרישום)</span>'}</h4>${d ? mgCard(d, b)
        : `<div class="pd-mg-empty ${need[t] ? "need" : ""}">${need[t] ? "⚠ אין מסמך מקושר" : "אין מסמך מקושר"}<div class="pd-sub">לקישור: בחרו מסמך מלמטה ולחצו "הת"ע ${SLOT_HE[t]}"</div></div>`}</div>`; };
    const ex = extrasOf(b.id);
    root.innerHTML = `<div class="pd-head"><b>ניהול מסמכים · ${displayName(b, true)}</b>
        <span id="pd-mg-undo"></span><button class="pd-btn" onclick="PD._home()" title="סגירת החלונות וחזרה לדף הראשי של הניהול">🏠 ראשי</button><button class="pd-btn" onclick="PD._close('pd-manage');PD.openUpload({bizId:'${b.id}'})">⬆ העלאת היתר</button><button class="pd-x" onclick="PD._close('pd-manage')">✕</button></div>
      <div class="pd-body"><div class="pd-mg-top">${slotBox("private")}${slotBox("general")}</div>
        <h4 style="margin:18px 0 8px">מסמכים נוספים לבדיקה (${ex.length})</h4>
        <div class="pd-mg-grid" id="pd-mg-extras" ondragover="PD._dragOver(event)" ondragleave="PD._dragLeave(event)" ondrop="PD._drop(event,'extra')">${ex.map(d => mgCard(d, b)).join("") || `<div class="pd-sub">אין מסמכים נוספים. אפשר לגרור לכאן מסמך כדי להוריד אותו מהת"ע.</div>`}</div></div>`;
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
  async function toExtras(id) {
    const d = S.byId.get(id); if (!d || !M.biz || !slotsOf(d, M.biz).length) return;
    const before = snapDoc(d);
    if (await updateDoc(id, { slots: { [M.biz]: [] } })) { pushHist(before, "הורד מהת\"ע ל\"מסמכים נוספים\" (" + bizName(M.biz) + ")"); say("המסמך עבר ל\"מסמכים נוספים\" והוא עדיין משויך לחברה"); }
  }
  async function dropOn(ev, target) {          // גרירה לתיבת הת"ע: המסמך נהפך לראשי (והקודם עובר למסמכים נוספים); גרירה ל"מסמכים נוספים": מסיר את הקישור לרשימות
    ev.preventDefault(); ev.currentTarget.classList.remove("pd-drop-on");
    const id = dragId || (ev.dataTransfer && ev.dataTransfer.getData("text/plain")); dragId = "";
    const d = S.byId.get(id); if (!d || !M.biz) return;
    if (target === "extra") return toExtras(id);
    if (slotsOf(d, M.biz).includes(target)) return;
    await toggleSlot(id, M.biz, target);
  }
  async function toggleSlot(docId, bizId, t) {
    const d = S.byId.get(docId); if (!d) return;
    const cur = slotsOf(d, bizId), on = !cur.includes(t);
    const next = on ? [...cur, t] : cur.filter(x => x !== t);
    const patch = { slots: { [bizId]: next } };
    const before = snapDoc(d), others = [];
    let prev = null;
    if (on) {
      prev = slotDoc(bizId, t);
      if (prev && prev.id !== docId) others.push({ id: prev.id, bid: bizId, slot: slotsOf(prev, bizId) });
      if (prev && prev.id !== docId && !confirm(`כבר מקושר מסמך אחר (${prev.original_name || prev.id}) להת"ע ${SLOT_HE[t]} של החברה. להחליף? המסמך הקודם יעבור למסמכים נוספים.`)) return;
      if (d.doc_type === "unknown") patch.doc_type = next.length === 2 ? "both" : t;
      else if (d.doc_type !== "both" && d.doc_type !== t) { if (!confirm(`המסמך מסווג "${TL[d.doc_type] || d.doc_type}". לקשר להת"ע ${SLOT_HE[t]} ולשנות את הסיווג ל"כללי + פרטי"?`)) return; patch.doc_type = "both"; }
      else if (d.doc_type === t && next.length === 2) patch.doc_type = "both";
    }
    if (await updateDoc(docId, patch)) {
      await refetchDocs(others.map(o => o.id)); refresh();
      pushHist(before, (on ? "קישור להת\"ע " : "ביטול קישור להת\"ע ") + SLOT_HE[t] + " של " + bizName(bizId), others);
      say(on && prev && prev.id !== docId ? `קושר. המסמך הקודם (${prev.original_name || prev.id}) לא נמחק: הוא נשאר בחברה תחת "מסמכים נוספים". לביטול: ↩` : on ? "המסמך קושר לרשימה" : "הקישור לרשימה בוטל");
    }
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
  .pd-ok{white-space:nowrap}.pd-ok.pd-c-private{background:#7a3b8f;color:#fff;border-color:#7a3b8f}.pd-ok.pd-c-general{background:#1e4570;color:#fff;border-color:#1e4570}.pd-ok[class*=pd-c-]:hover{filter:brightness(1.15)}.pd-ok.pd-long{width:100%;justify-content:center;border:none;color:#fff;font-weight:600;background:linear-gradient(72deg,#1e4570 0 42%,#7a3b8f 58% 100%)}.pd-ok.pd-long:hover{filter:brightness(1.12)}
  .pd-warn{background:#fff1d6;color:#8a5a00;border:1px solid #e8c36a;border-radius:6px;padding:3px 8px;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap}
  .pd-mg-top{display:flex;gap:16px;align-items:stretch}
  .pd-mg-slot{flex:1;min-width:0;border:2px solid #b9c7da;border-radius:10px;padding:8px 10px;background:#f7f9fc}.pd-mg-slot.off{opacity:.65}
  .pd-mg-slot h4{margin:0 0 6px;font-size:14px;color:#1a3a5c}
  .pd-mg-empty{border:2px dashed #cfcac0;border-radius:8px;padding:34px 10px;text-align:center;color:#6b6b6b}.pd-mg-empty.need{border-color:#e6a39b;color:#c0392b;font-weight:600}
  .pd-mg-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(420px,1fr));gap:12px}
  .pd-mg-card{display:flex;gap:10px;border:1px solid #d6d2ca;border-radius:10px;padding:8px;background:#fff}
  .pd-mg-l{width:150px;flex:none}.pd-mg-r{flex:1;min-width:0;display:flex;flex-direction:column;gap:6px}
  .pd-mg-th{height:200px;background:#eee;border-radius:6px;overflow:hidden;cursor:pointer;display:flex;align-items:center;justify-content:center;position:relative}
  .pd-mg-th img{max-width:100%;max-height:100%;display:block}.pd-mg-th img:not([src]){display:none}.pd-mg-ld{position:absolute;font-size:12px;color:#777}
  .pd-mg-share{display:flex;gap:5px;align-items:center;font-size:12px;margin-top:5px;cursor:pointer}
  .pd-mg-sh{background:#f7f7f5;border-radius:6px;padding:5px}
  .pd-mini{border:1px solid #cfcac0;background:#fff;border-radius:6px;padding:3px 8px;font-size:12px;cursor:pointer}.pd-mini.sel{background:#1a3a5c;color:#fff;border-color:#1a3a5c}
  .pd-mini.link.sel{background:#7a3b8f;border-color:#7a3b8f}.pd-mini.danger{color:#c0392b;border-color:#e6a39b}
  @media(max-width:900px){.pd-mg-top{flex-direction:column}.pd-mg-grid{grid-template-columns:1fr}}
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
  .pd-tag{background:#e7f1fb;color:#1a3a5c;border-radius:9px;padding:1px 7px;font-size:11px;margin-inline-start:6px;font-weight:400}.pd-tag.warn{background:#fff1d6;color:#8a5a00}
  .pd-warnbox{background:#fff6e0;border:1px solid #e8c36a;border-radius:7px;padding:7px 10px;font-size:12.5px;margin:6px 0}
  .pd-dup{background:#fdecea;border:1px solid #e6a39b;border-radius:8px;padding:12px;font-size:13.5px;line-height:1.6}
  .pd-ok-msg{background:#edf7f1;border:1px solid #a8d9bc;border-radius:8px;padding:8px 12px;margin:10px 14px 0}
  .pd-st{font-size:11px;border-radius:9px;padding:1px 7px;background:#eee;color:#555;margin-inline-start:6px;white-space:nowrap}.pd-st.bad{background:#fdecea;color:#c0392b;font-weight:600}
  .pd-reg{border:2px solid #c0392b;background:#fdecea;border-radius:8px;padding:7px 9px;margin-top:5px}.pd-tag.red{background:#c0392b;color:#fff}
  .pd-grp{font-size:12px;font-weight:600;color:#1e7e4a;margin:8px 0 4px}.pd-grp.weak{color:#8a8a8a}
  @media(max-width:800px){.pd-split{flex-direction:column}.pd-side{width:auto;max-width:none}}
  `;
  document.head.appendChild(css);

  window.PD = { docStatus, docCounts, bizAdded, cell, slotCell, slotCells, extraCell, openManage, _slot: toggleSlot, _nav: nav, _mgShare: mgShare, _mgRemove: mgRemove, _mgMove: mgMove, _toExtras: toExtras, _menu: (id, on) => { M.menu = on ? id : (M.menu === id ? "" : M.menu); }, _mgSearch: mgSearch, refresh, homeCards, openUnassigned, unassignedCount, state: S, load, openUpload, openCompany, openDoc, suggest, phraseKind,
    _close: close, _setType: setType, _setNote: setNote, _unassign: unassign, _addSearch: addSearch, _assign: assign, _askDelete: askDelete, _doDelete: doDelete,
    _files: upFiles, _next: upNext, _tog: upTog, _type: t => { U.cur.type = t; U.cur.typeTouched = true; upReview(); }, _upNote: v => { U.cur.note = v; }, _upSearch: upSearch,
    _upAdd: id => { U.cur.sel.add(id); upReview(); }, _save: upSave, _ocr: upOcr,
    _unFilter: v => {          // סינון מושהה, והמסמך המוצג לא נטען מחדש אם הוא עדיין ברשימה
      Q.filter = v; clearTimeout(Q._ft);
      Q._ft = setTimeout(() => { const k = unassignedList().findIndex(x => x.id === Q.curId); Q.i = k >= 0 ? k : 0; if (k < 0) Q.curId = ""; uqShow(); }, 300);
    }, _unView: v => { Q.view = v; Q.i = 0; Q.curId = ""; uqShow(); },
    _unExtAdd: uqExtAdd, _unExtDetach: uqExtDetach, _unDetach: uqDetach, _unRestore: uqRestore, _unManage: id => { const d = unassignedList()[Q.i]; if (d) openAssign(d.id, [id], d.doc_type, true); }, _unPicker: uqPicker, _legacy: legacyConvert, _mgBond: mgBond, _mgBondSearch: mgBondSearch, _mgBondAdd: mgBondAdd, _mgBondDel: mgBondDel, _unBondDel: bondDel, _unAct: uqAct, _unSetType: uqSetType, _cf: cfChoose,
    _home: goHome, goHome, _openExt: openExt, openExt, _extStatus: extStatus, _extDel: extDel, _dragStart: dragStart, _dragEnd: dragEnd, _dragOver: dragOver, _dragLeave: dragLeave, _drop: dropOn,
    _undo: undoLast, _recent: openRecent, _unassignAll: unassignAll, _asAdd: asAdd, _asDrop: asDrop,
    _unPick: uqPick, _unShared: uqShared, _unAssign: uqAssign, _asType: asType, _asSlot: asSlot, _asDo: asDo, _asNext: asNext,
    _unTog: (id, on) => { on ? Q.sel.add(id) : Q.sel.delete(id); uqShow(); }, _unAdd: id => { Q.sel.add(id); uqShow(); }, _unSearch: uqSearch,
    _unType: t => { Q.type = t; Q.typeTouched = true; uqShow(); }, _unNote: v => { Q.note = v; }, _unSave: uqSave, _unOtherDoc: uqOther,
    _unSkip: () => { const d = unassignedList()[Q.i]; if (d) Q.skipped.add(d.id); Q.curId = ""; uqShow(); }, _unUnskip: () => { Q.skipped = new Set(); Q.curId = ""; uqShow(); },
    _unGo: n => { const len = unassignedList().length; Q.i = Math.min(Math.max(0, Q.i + n), Math.max(0, len - 1)); Q.curId = ""; uqShow(); } };
})();
