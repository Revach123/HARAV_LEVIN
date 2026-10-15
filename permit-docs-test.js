/* גרסת בדיקה (admin_test.html): מאגר מסמכי היתר עסקה עם קישור מסמך לרשימות כללי / פרטי של כל חברה, וחלון "ניהול מסמכים".
   תלוי בגלובלים של דף הניהול: businesses, adminToken, apiFetch, escHtml, displayName, showStatus, render, view.
   חשיפה: window.PD (cell, slotCell, extraCell, openManage, homeCards, load, openUpload, openUnassigned, openCompany, openDoc ...) */
(function () {
  "use strict";
  const S = { docs: [], byBiz: new Map(), byId: new Map(), loaded: false, loading: false, err: "" };
  const TL = { general: "כללי", private: "פרטי", both: "כללי + פרטי", unknown: "לא ידוע", other: "לא קשור / לא היתר" };
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
  const bizList = () => (typeof businesses !== "undefined" ? businesses : []);
  const bizById = id => bizList().find(b => b.id === id);
  const bizName = id => { const b = bizById(id); return b ? displayName(b) : "(חברה שנמחקה)"; };
  const SLOT_HE = { private: "פרטי", general: "כללי" };
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
    out.innerHTML = (local.map(b => `<button class="pd-pick" data-pick="${b.id}">${displayName(b, true)} <span class="pd-sub">${E(b.chp_number || "")}</span>${stTag(b.registry_status)}</button>`).join("") ||
      `<div class="pd-sub">לא נמצאה חברה במאגר שלנו</div>`) + `<div class="pd-regbox"></div>`;
    out.onclick = e => {
      const pk = e.target.closest("[data-pick]"); if (pk) return o.pick(pk.dataset.pick);
      const mk = e.target.closest("[data-mark]"); if (mk) return o.mark({ id: mk.dataset.mark, name: mk.dataset.name, status: mk.dataset.status });
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
    box.innerHTML = (inDb.length ? `<div class="pd-grp weak">במאגר שלנו (לפי הרשם)</div>` + inDb.slice(0, 6).map(x => `<button class="pd-pick" data-pick="${x.b.id}">${displayName(x.b, true)} <span class="pd-sub">${E(x.r.id)}</span>${stTag(x.r.status)}</button>`).join("") : "") +
      (miss.length ? `<div class="pd-grp" style="color:#c0392b">לא במאגר שלנו (נמצאו ברשם)</div>` + miss.slice(0, 8).map(r => `
        <div class="pd-reg"><div><b>${E(r.name)}</b> <span class="pd-tag red">לא במאגר</span>${r.defunct ? ' <span class="pd-tag red">⚠ מחוסלת / נמחקה</span>' : ""}</div>
          <div class="pd-sub">${E(r.type || "")} · ח.פ. ${E(r.id)}${r.status ? " · " + E(r.status) : ""}</div>
          <div class="pd-btns" style="margin-top:4px"><button class="pd-btn" data-mark="${E(r.id)}" data-name="${E(r.name)}" data-status="${E(r.status || "")}">סמן במסמך: חסר במאגר</button>
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
    r.innerHTML = `<div class="pd-ov" onmousedown="if(event.target===this)PD._close('${id}')"><div class="pd-box ${wide ? "wide" : ""}">${inner}</div></div>`;
    document.body.appendChild(r);
    return r;
  }
  const closers = {};
  function close(id) { $(id)?.remove(); if (closers[id]) { closers[id](); delete closers[id]; } }
  document.addEventListener("keydown", e => {
    if (e.key !== "Escape") return;
    for (const id of ["pd-confirm", "pd-doc", "pd-upload", "pd-manage", "pd-company"]) if ($(id)) { close(id); break; }
  });

  // כרטיסי הדף הראשי: "מסמכי היתר עיסקא"
  function homeCards() {
    if (!S.loaded && !S.loading && typeof isAdmin !== "undefined" && isAdmin) load();
    const n = S.loaded && !S.err ? unassignedCount() : null;
    return `<h3 class="pd-homeh">מסמכי היתר עיסקא</h3><div class="home-grid">
      <button class="home-card" onclick="PD.openUpload()"><span class="ico">📄</span><b>העלאת היתר עסקה</b><span class="sub">זיהוי חברה מתאימה והצעת שיוך</span></button>
      <button class="home-card" onclick="PD.openUnassigned()"><span class="ico">🗂️</span><b>מסמכים לא משויכים${n !== null ? " (" + n + ")" : ""}</b><span class="sub">חיפוש חברה מתאימה לכל מסמך</span></button></div>`;
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
      const headHtml = `<div class="pd-head">${nav}<b>${E(doc.original_name || doc.id)}</b><span class="pd-sub">${fmtSize(doc.size)}${S.lastMs ? " · נטען ב-" + (S.lastMs / 1000).toFixed(1) + " שנ'" : ""}</span>${S.integrity && S.integrity[docId] === false ? ' <span style="color:#c0392b;font-weight:600">⚠ הקובץ שהתקבל שונה מהקובץ שנשמר (ייתכן סינון תוכן ברשת)</span>' : ""}<button class="pd-x" onclick="PD._close('pd-doc')">✕</button></div>`;
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
      showStatus("המסמך נמחק");
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
  // משפטי מפתח (אותם כללים כמו בבדיקה המקומית private_wording.py): "החברה מאשרת בזאת..." = משולב; "הביעה את הסכמתה..." = רק פרטי
  const PO = "החברה הביעה הסכמתה התקשרות באופן פרטי פי היתר עיסקא עם מי שמעו חתימתה שטר רישום חברה".split(" "), PO_MUST = ["הסכמתה", "הביעה", "שטר", "חתימתה"];
  const CB = "החברה מאשרת בזאת התקשרות היתר עיסקא באופן פרטי עם כל המעוניין בכך".split(" "), CB_MUST = ["מאשרת", "בזאת", "המעוניין"];
  function phraseAt(win, words, must, need) {
    const e = new Set(win); for (const x of win) if (x.length > 3) e.add(x.slice(1));
    let c = 0; for (const k of new Set(words)) if (e.has(k)) c++;
    return c >= need && must.some(k => e.has(k)) && e.has("פרטי") && (e.has("עיסקא") || e.has("התקשרות"));
  }
  function phraseKind(text) {
    let po = false;
    for (const tv of textVariants(text)) {
      const seq = tv.split(/\s+/).map(hebOnly).filter(Boolean);
      for (let i = 0; i < seq.length; i++) {
        if (seq[i] === "מאשרת") { const w = new Set(seq.slice(Math.max(0, i - 4), i + 5)); if (w.has("בזאת") && (w.has("החברה") || w.has("חברה"))) return "combined"; }
        if (!["פרטי", "עיסקא", "התקשרות", "המעוניין", "הסכמתה"].includes(seq[i])) continue;
        const win = seq.slice(Math.max(0, i - 14), i + 14);
        if (phraseAt(win, CB, CB_MUST, 6)) return "combined";
        if (phraseAt(win, PO, PO_MUST, 7)) po = true;
      }
    }
    return po ? "private" : "";
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
    // סיווג מוצע: משפט "החברה מאשרת בזאת" = כללי+פרטי; "הביעה את הסכמתה" = פרטי; אחרת, אם יש טקסט קריא ואין נוסח פרטי = כללי
    return { cands, outside: [...outside], shared: strong.length > 1, doubt: !strong.length && cands.length > 1, readable,
             type: kind === "combined" ? "both" : kind === "private" ? "private" : readable ? "general" : "unknown",
             typeWhy: kind === "combined" ? "נוסח \"החברה מאשרת בזאת\" = כללי ופרטי ביחד" : kind === "private" ? "נוסח \"הביעה את הסכמתה\" = פרטי בלבד" : readable ? "לא נמצא נוסח פרטי בטקסט, ולכן כללי" : "" };
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
    overlay("pd-upload", `<div class="pd-head"><b>העלאת היתר עסקה</b><button class="pd-x" onclick="PD._close('pd-upload')">✕</button></div>
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
      replaceDoc(data.doc); showStatus("המסמך נשמר"); refresh();
      if (U.queue.length) upNext(); else { U.cur = { ...c, url: "" }; upPick(`✓ נשמר: ${E(c.file.name)}`); }
    } catch (e) { if (btn) btn.disabled = false; const el = $("pd-up-err"); if (el) el.textContent = "השמירה נכשלה: " + e.message; }
  }


  // ───────── דשבורד: מסמכים לא משויכים ─────────
  const Q = { i: 0, skipped: new Set(), curId: "", token: 0, sel: new Set(), type: "unknown", typeTouched: false, cands: new Map(), note: "", showOther: false, filter: "", blobUrl: "", readable: null };
  const sugOf = d => { try { return JSON.parse(d.suggest || "[]"); } catch { return []; } };
  const isUnassigned = d => !(d.business_ids || []).length;
  const unassignedCount = () => S.docs.filter(d => isUnassigned(d) && d.doc_type !== "other").length;
  function unassignedList() {
    const f = Q.filter.trim().toLowerCase();
    return S.docs.filter(d => isUnassigned(d) && !Q.skipped.has(d.id) && (Q.showOther || d.doc_type !== "other") &&
        (!f || [d.original_name, d.source_title, d.note].some(x => String(x || "").toLowerCase().includes(f))))
      .sort((a, b) => sugOf(b).length - sugOf(a).length || String(a.source_title || a.original_name).localeCompare(String(b.source_title || b.original_name), "he"));
  }
  function openUnassigned() {
    Q.i = 0; Q.curId = ""; Q.filter = ""; Q.showOther = false; Q.skipped = new Set();      // דילוג תקף רק לפתיחה הזו של החלון
    overlay("pd-un", `
      <div class="pd-head"><b>מסמכים לא משויכים</b><span class="pd-sub" id="pd-un-count"></span><span id="pd-un-skipped"></span>
        <input class="pd-in" style="width:230px" placeholder="סינון לפי שם קובץ / כותרת / הערה" oninput="PD._unFilter(this.value)" autocomplete="off">
        <label class="pd-sub"><input type="checkbox" onchange="PD._unOther(this.checked)"> הצג גם "לא קשור"</label>
        <button class="pd-x" onclick="PD._close('pd-un')">✕</button></div>
      <div class="pd-split"><div class="pd-view" id="pd-un-view"></div><div class="pd-side" id="pd-un-side"></div></div>`, true);
    closers["pd-un"] = () => { if (Q.blobUrl) URL.revokeObjectURL(Q.blobUrl); Q.blobUrl = ""; Q.curId = ""; if (typeof render === "function" && typeof view !== "undefined" && view === "home") render(); };
    if (!S.loaded) load().then(uqShow); else uqShow();
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
    if (cnt) cnt.textContent = `נותרו ${list.length} מסמכים`;
    const sk = $("pd-un-skipped"); if (sk) sk.innerHTML = Q.skipped.size ? ` · דולגו ${Q.skipped.size} <button class="pd-link" style="color:#1a3a5c" onclick="PD._unUnskip()">הצג אותם שוב</button>` : "";
    if (Q.i >= list.length) Q.i = Math.max(0, list.length - 1);
    const d = list[Q.i], side = $("pd-un-side"), view = $("pd-un-view");
    if (!d) {
      side.innerHTML = Q.skipped.size ? `<div class="pd-empty" style="color:#1e7e4a">אין עוד מסמכים בתור (דולגו ${Q.skipped.size}).<br><button class="pd-btn" style="margin-top:10px" onclick="PD._unUnskip()">הצג את מה שדולג</button></div>`
        : `<div class="pd-empty" style="color:#1e7e4a">אין מסמכים לא משויכים 🎉</div>`;
      view.innerHTML = ""; Q.curId = ""; return;
    }
    if (Q.curId !== d.id) {
      Q.curId = d.id; Q.sel = new Set(); Q.typeTouched = false; Q.typeWhy = ""; Q.note = d.note || ""; Q.type = d.doc_type === "other" ? "unknown" : d.doc_type;
      Q.cands = uqMergeCands(d); Q.liveDone = false;
      const tok = ++Q.token;
      view.innerHTML = `<div class="pd-empty" style="color:#fff">טוען מסמך… <span id="pd-un-sec"></span></div>`;
      { const t0 = Date.now(), iv = setInterval(() => { const el = $("pd-un-sec"); if (!el || tok !== Q.token) return clearInterval(iv); el.textContent = Math.round((Date.now() - t0) / 1000) + " שנ'"; }, 500); }
      if (Q.blobUrl) { URL.revokeObjectURL(Q.blobUrl); Q.blobUrl = ""; }
      (async () => {
        try {
          const blob = await fetchPdfBlob(d.id); if (tok !== Q.token) return;
          Q.blobUrl = URL.createObjectURL(blob); view.innerHTML = `<iframe src="${Q.blobUrl}" title="המסמך"></iframe>`;
          unassignedList().slice(Q.i + 1, Q.i + 3).forEach(x => fetchPdfBlob(x.id).catch(() => {}));      // טעינה מראש של שני המסמכים הבאים
          try {           // הצעות נוספות מהטקסט של הקובץ עצמו (אם יש בו טקסט); קבצים סרוקים מסתמכים על ההצעות השמורות
            const r = await extractText(await blob.arrayBuffer(), 6); if (tok !== Q.token) return;
            const sug = suggest(r.text, d.original_name);
            Q.cands = uqMergeCands(d, sug.cands); Q.liveDone = true;
            if (!Q.typeTouched && (d.doc_type === "unknown") && sug.type !== "unknown") Q.type = sug.type, Q.typeWhy = sug.typeWhy;
            uqShow(true);
          } catch { /* אין טקסט או שגיאת קריאה */ }
        } catch (e) { if (tok === Q.token) view.innerHTML = `<div class="pd-empty" style="color:#fff">${E(e.message)}</div>`; }
      })();
    }
    const card = c => `<label class="pd-cand"><input type="checkbox" ${Q.sel.has(c.b.id) ? "checked" : ""} onchange="PD._unTog('${c.b.id}',this.checked)"> <span class="pd-grow"><b>${displayName(c.b, true)}</b> <span class="pd-sub">${E(c.b.chp_number || "")} · ${E(c.why.join(", "))}</span>${stTag(c.b.registry_status)}</span></label>`;
    const extra = [...Q.sel].filter(id => !Q.cands.some(c => c.b.id === id)).map(id => bizById(id)).filter(Boolean).map(b => card({ b, why: ["נבחר ידנית"] }));
    const tb = ["general", "private", "both", "unknown"].map(t => `<button class="pd-btn ${Q.type === t ? "sel" : ""}" onclick="PD._unType('${t}')">${TL[t]}</button>`).join("");
    const keepIn = document.activeElement && document.activeElement.id === "pd-un-q" ? document.getElementById("pd-un-q").value : null;
    side.innerHTML = `
      <div class="pd-sub">${Q.i + 1} / ${list.length}</div>
      <div style="font-weight:600;font-size:14px;word-break:break-all">${E(d.source_title || d.original_name || d.id)}</div>
      <div class="pd-sub">${E(d.original_name || "")} · ${fmtSize(d.size)}${d.doc_type === "other" ? " · מסומן כלא קשור" : ""}</div>
      ${d.note ? `<div class="pd-warnbox">${E(d.note)}</div>` : ""}
      <h4>חברות מתאימות ${Q.cands.length ? "" : '<span class="pd-sub">(לא נמצאו הצעות: חפשו ידנית)</span>'}</h4>
      ${Q.cands.length ? candGroups(Q.cands.slice(0, 20), card) : ""}${extra.join("")}
      <input class="pd-in" id="pd-un-q" placeholder="חיפוש חברה: שם או ח.פ." oninput="PD._unSearch(this.value)" autocomplete="off" style="margin-top:6px"><div id="pd-un-res"></div>
      <h4>סיווג</h4><div class="pd-btns">${tb}</div>${Q.typeWhy && !Q.typeTouched ? `<div class="pd-sub">הצעה אוטומטית: ${E(Q.typeWhy)}</div>` : ""}
      <h4>הערה</h4><textarea class="pd-in" rows="2" onchange="PD._unNote(this.value)">${E(Q.note)}</textarea>
      <div class="pd-btns" style="margin-top:12px">
        <button class="pd-btn primary" ${Q.sel.size ? "" : "disabled"} onclick="PD._unSave()">${Q.sel.size ? `שמירה ושיוך ל-${Q.sel.size} חברות` : "בחרו חברה לשיוך"} ←</button>
        <button class="pd-btn" onclick="PD._unSkip()" title="מסתיר את המסמך עד לפתיחה הבאה של החלון">דילוג</button><button class="pd-btn" onclick="PD._unGo(-1)">→ הקודם</button>
      </div>
      <div class="pd-btns" style="margin-top:10px"><button class="pd-btn" onclick="PD._unOtherDoc()" title="מסמך שאינו היתר עסקה של חברה: יוצא מהתור">לא קשור</button>
        <button class="pd-btn danger" onclick="PD._askDelete('${d.id}')">🗑 מחיקה</button></div>
      <div id="pd-un-err" style="color:#c0392b;margin-top:6px"></div>`;
    if (keepIn !== null) { const q = $("pd-un-q"); q.value = keepIn; q.focus(); }
  }
  function uqSearch(q) {
    const out = $("pd-un-res"); if (!out) return;
    runCompanySearch(q, out, { exclude: x => Q.sel.has(x), pick: id => { Q.sel.add(id); uqShow(); }, mark: uqMark,
      mkAdded: () => { const d0 = unassignedList()[Q.i], sel0 = [...Q.sel], type0 = Q.type, note0 = Q.note; return async bid => {
        try { if (d0) replaceDoc((await api("/permit-docs/" + d0.id, "PUT", { doc_type: type0, business_ids: [...sel0, bid], note: note0 })).doc); showStatus("החברה נוספה והמסמך שויך אליה"); }
        catch (e) { alert("החברה נוספה, אך שיוך המסמך נכשל: " + e.message); }
        openUnassigned();
      }; } });
  }
  async function uqMark(reg) {        // סימון "חסר במאגר" בהערת המסמך (המסמך נשאר לא משויך)
    const d = unassignedList()[Q.i]; if (!d) return;
    const note = (Q.note ? Q.note + " | " : "") + markText(reg); Q.note = note;
    try { const r = await api("/permit-docs/" + d.id, "PUT", { note }); replaceDoc(r.doc); showStatus("נוסף סימון: חסר במאגר"); }
    catch (e) { const el = $("pd-un-err"); if (el) el.textContent = "הסימון נכשל: " + e.message; }
    uqShow();
  }
  async function uqSave() {
    const d = unassignedList()[Q.i]; if (!d || !Q.sel.size) return;
    try {
      const r = await api("/permit-docs/" + d.id, "PUT", { doc_type: Q.type, business_ids: [...Q.sel], note: Q.note });
      replaceDoc(r.doc); showStatus("נשמר"); Q.curId = ""; uqShow();
    } catch (e) { const el = $("pd-un-err"); if (el) el.textContent = "השמירה נכשלה: " + e.message; }
  }
  async function uqOther() {
    const d = unassignedList()[Q.i]; if (!d) return;
    try { const r = await api("/permit-docs/" + d.id, "PUT", { doc_type: "other", note: Q.note }); replaceDoc(r.doc); Q.curId = ""; uqShow(); }
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

  // ───────── תמונה קטנה של העמוד הראשון (pdf.js, עד 3 במקביל) ─────────
  const thumbs = new Map(), thumbUrls = new Map(), thumbWait = []; let thumbActive = 0;
  function thumb(id) {
    if (thumbs.has(id)) return thumbs.get(id);
    const run = async () => {
      try {
        const pdf = await pdfDoc(await (await fetchPdfBlob(id)).arrayBuffer());
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
  const M = { biz: "", share: new Set(), move: "" };
  function openManage(bizId) {
    if (!bizById(bizId)) return;
    M.biz = bizId; M.share = new Set(); M.move = "";
    ["pd-company"].forEach(close);
    overlay("pd-manage", `<div id="pd-mg" style="display:flex;flex-direction:column;height:100%;min-height:0"></div>`, true);
    S._paintMg = paintMg;
    closers["pd-manage"] = () => { if (S._paintMg === paintMg) S._paintMg = null; };
    paintMg();
    if (!S.loaded && !S.loading) load();
  }
  function mgCard(d, b) {
    const others = (d.business_ids || []).filter(x => x !== b.id), sl = slotsOf(d, b.id);
    const shared = others.length > 0 || M.share.has(d.id);
    const tb = t => `<button class="pd-mini ${d.doc_type === t ? "sel" : ""}" onclick="PD._setType('${d.id}','${t}')">${{ general: "כללי", private: "פרטי", both: "משולב", unknown: "?", other: "לא קשור" }[t]}</button>`;
    const lb = t => `<button class="pd-mini link ${sl.includes(t) ? "sel" : ""}" onclick="PD._slot('${d.id}','${b.id}','${t}')">${sl.includes(t) ? "✓ " : ""}הת"ע ${SLOT_HE[t]}</button>`;
    const shareBox = shared ? `<div class="pd-mg-sh">${others.map(o => `<div class="pd-co"><span>${E(bizName(o))}</span><button class="pd-link" onclick="PD._mgRemove('${d.id}','${o}')">הסר</button></div>`).join("")}
        ${M.move === d.id ? "" : `<input class="pd-in" placeholder="הוספת חברה: שם או ח.פ." oninput="PD._mgSearch('${d.id}','add',this.value)" autocomplete="off">`}</div>` : "";
    const moveBox = M.move === d.id ? `<div class="pd-mg-sh"><input class="pd-in" placeholder="העברה לחברה: שם או ח.פ." oninput="PD._mgSearch('${d.id}','move',this.value)" autocomplete="off"></div>` : "";
    return `<div class="pd-mg-card">
      <div class="pd-mg-l">
        <div class="pd-mg-th" onclick="PD.openDoc('${d.id}','${b.id}')" title="פתיחה בגדול"><img data-thumb="${d.id}" alt="" ${thumbUrls.get(d.id) ? `src="${thumbUrls.get(d.id)}"` : ""}><span class="pd-mg-ld" ${thumbUrls.get(d.id) ? 'style="display:none"' : ""}>טוען…</span></div>
        <label class="pd-mg-share"><input type="checkbox" ${shared ? "checked" : ""} onchange="PD._mgShare('${d.id}',this.checked)"> מסמך משותף</label>
      </div>
      <div class="pd-mg-r">
        <div class="pd-name" title="${E(d.original_name || "")}">${E(d.original_name || d.id)}</div>
        <div class="pd-sub">${fmtSize(d.size)}${d.note ? " · " + E(d.note).slice(0, 80) : ""}</div>
        <div class="pd-btns">${["general", "private", "both", "unknown", "other"].map(tb).join("")}</div>
        <div class="pd-btns">${lb("private")}${lb("general")}</div>
        <div class="pd-btns"><button class="pd-mini" onclick="PD._mgMove('${d.id}')">העברה לחברה אחרת</button><button class="pd-mini danger" onclick="PD._askDelete('${d.id}')">🗑 מחיקה</button></div>
        ${shareBox}${moveBox}<div id="pd-mgs-${d.id}"></div>
      </div></div>`;
  }
  function paintMg() {
    const root = $("pd-mg"); if (!root) return;
    const b = bizById(M.biz); if (!b) { close("pd-manage"); return; }
    const need = needOf(b), keep = (root.querySelector(".pd-body") || {}).scrollTop || 0;
    const slotBox = t => { const d = slotDoc(b.id, t);
      return `<div class="pd-mg-slot ${need[t] ? "" : "off"}"><h4>הת"ע ${SLOT_HE[t]}${need[t] ? "" : ' <span class="pd-sub">(לא נדרש לפי הרישום)</span>'}</h4>${d ? mgCard(d, b)
        : `<div class="pd-mg-empty ${need[t] ? "need" : ""}">${need[t] ? "⚠ אין מסמך מקושר" : "אין מסמך מקושר"}<div class="pd-sub">לקישור: בחרו מסמך מלמטה ולחצו "הת"ע ${SLOT_HE[t]}"</div></div>`}</div>`; };
    const ex = extrasOf(b.id);
    root.innerHTML = `<div class="pd-head"><b>ניהול מסמכים · ${displayName(b, true)}</b>
        <button class="pd-btn" onclick="PD._close('pd-manage');PD.openUpload({bizId:'${b.id}'})">⬆ העלאת היתר</button><button class="pd-x" onclick="PD._close('pd-manage')">✕</button></div>
      <div class="pd-body"><div class="pd-mg-top">${slotBox("private")}${slotBox("general")}</div>
        <h4 style="margin:18px 0 8px">מסמכים נוספים לבדיקה (${ex.length})</h4>
        <div class="pd-mg-grid">${ex.map(d => mgCard(d, b)).join("") || `<div class="pd-sub">אין מסמכים נוספים.</div>`}</div></div>`;
    const body = root.querySelector(".pd-body"); if (body) body.scrollTop = keep;
    root.querySelectorAll("img[data-thumb]").forEach(img => thumb(img.dataset.thumb).then(u => {
      if (!img.isConnected) return;
      if (u) { img.src = u; img.nextElementSibling && (img.nextElementSibling.style.display = "none"); } else if (img.nextElementSibling) img.nextElementSibling.textContent = "אין תצוגה מקדימה";
    }));
  }
  async function toggleSlot(docId, bizId, t) {
    const d = S.byId.get(docId); if (!d) return;
    const cur = slotsOf(d, bizId), on = !cur.includes(t);
    const next = on ? [...cur, t] : cur.filter(x => x !== t);
    const patch = { slots: { [bizId]: next } };
    if (on) {
      const prev = slotDoc(bizId, t);
      if (prev && prev.id !== docId && !confirm(`כבר מקושר מסמך אחר (${prev.original_name || prev.id}) להת"ע ${SLOT_HE[t]} של החברה. להחליף? המסמך הקודם יעבור למסמכים נוספים.`)) return;
      if (d.doc_type === "unknown") patch.doc_type = next.length === 2 ? "both" : t;
      else if (d.doc_type !== "both" && d.doc_type !== t) { if (!confirm(`המסמך מסווג "${TL[d.doc_type] || d.doc_type}". לקשר להת"ע ${SLOT_HE[t]} ולשנות את הסיווג ל"כללי + פרטי"?`)) return; patch.doc_type = "both"; }
      else if (d.doc_type === t && next.length === 2) patch.doc_type = "both";
    }
    await updateDoc(docId, patch);
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
  function mgMove(id) { M.move = M.move === id ? "" : id; paintMg(); }
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

  window.PD = { bizAdded, cell, slotCell, slotCells, extraCell, openManage, _slot: toggleSlot, _nav: nav, _mgShare: mgShare, _mgRemove: mgRemove, _mgMove: mgMove, _mgSearch: mgSearch, refresh, homeCards, openUnassigned, unassignedCount, state: S, load, openUpload, openCompany, openDoc, suggest, phraseKind,
    _close: close, _setType: setType, _setNote: setNote, _unassign: unassign, _addSearch: addSearch, _assign: assign, _askDelete: askDelete, _doDelete: doDelete,
    _files: upFiles, _next: upNext, _tog: upTog, _type: t => { U.cur.type = t; U.cur.typeTouched = true; upReview(); }, _upNote: v => { U.cur.note = v; }, _upSearch: upSearch,
    _upAdd: id => { U.cur.sel.add(id); upReview(); }, _save: upSave, _ocr: upOcr,
    _unFilter: v => { Q.filter = v; Q.i = 0; Q.curId = ""; uqShow(); }, _unOther: v => { Q.showOther = v; Q.i = 0; Q.curId = ""; uqShow(); },
    _unTog: (id, on) => { on ? Q.sel.add(id) : Q.sel.delete(id); uqShow(); }, _unAdd: id => { Q.sel.add(id); uqShow(); }, _unSearch: uqSearch,
    _unType: t => { Q.type = t; Q.typeTouched = true; uqShow(); }, _unNote: v => { Q.note = v; }, _unSave: uqSave, _unOtherDoc: uqOther,
    _unSkip: () => { const d = unassignedList()[Q.i]; if (d) Q.skipped.add(d.id); Q.curId = ""; uqShow(); }, _unUnskip: () => { Q.skipped = new Set(); Q.curId = ""; uqShow(); },
    _unGo: n => { const len = unassignedList().length; Q.i = Math.min(Math.max(0, Q.i + n), Math.max(0, len - 1)); Q.curId = ""; uqShow(); } };
})();
