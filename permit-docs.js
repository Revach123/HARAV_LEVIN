/* מאגר מסמכי היתר עסקה - ממשק בדף הניהול (admin_test.html). בשלב זה אין תצוגה ציבורית.
   תלוי בגלובלים של דף הניהול: businesses, adminToken, apiFetch, escHtml, displayName, showStatus, render, view.
   חשיפה: window.PD = { cell, refresh, load, openUpload, openCompany, openDoc } */
(function () {
  "use strict";
  const S = { docs: [], byBiz: new Map(), byId: new Map(), loaded: false, loading: false, err: "" };
  const TL = { general: "כללי", private: "פרטי", both: "כללי + פרטי", unknown: "לא ידוע" };
  const TCOL = { general: "#1e4570", private: "#7a3b8f", both: "#1e7e4a", unknown: "#8a6d00" };
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
  }
  const bizList = () => (typeof businesses !== "undefined" ? businesses : []);
  const bizById = id => bizList().find(b => b.id === id);
  const bizName = id => { const b = bizById(id); return b ? displayName(b) : "(חברה שנמחקה)"; };
  const fmtSize = n => (n > 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB");

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
    for (const id of ["pd-confirm", "pd-doc", "pd-upload", "pd-company"]) if ($(id)) { close(id); break; }
  });

  // ───────── חלון: מסמכי חברה ─────────
  function openCompany(bizId) {
    const b = bizById(bizId); if (!b) return;
    const ds = S.byBiz.get(bizId) || [];
    const rows = ds.map(d => {
      const others = (d.business_ids || []).filter(x => x !== bizId);
      return `<div class="pd-row" onclick="PD.openDoc('${d.id}','${bizId}')">
        <span class="pd-chip" style="background:${TCOL[d.doc_type] || TCOL.unknown}">${TL[d.doc_type] || TL.unknown}</span>
        <div class="pd-grow"><div class="pd-name">${E(d.original_name || d.id)}</div>
        <div class="pd-sub">${fmtSize(d.size)} · ${E((d.created_at || "").slice(0, 10))}${others.length ? ` · משותף גם עם ${others.length} חברות` : ""}${d.note ? " · " + E(d.note) : ""}</div></div>
        <span class="pd-go">פתיחה ←</span></div>`;
    }).join("");
    overlay("pd-company", `
      <div class="pd-head"><b>היתרי עסקה · ${displayName(b, true)}</b><button class="pd-x" onclick="PD._close('pd-company')">✕</button></div>
      <div class="pd-body">
        ${ds.length ? rows : `<div class="pd-empty">⚠ חסר היתר עסקה — אין אף מסמך משויך לחברה הזו.</div>`}
        <div style="margin-top:12px"><button class="pd-btn primary" onclick="PD._close('pd-company');PD.openUpload({bizId:'${bizId}'})">⬆ העלאת היתר עסקה לחברה זו</button></div>
      </div>`);
  }

  // ───────── חלון: צפייה ועריכה של מסמך ─────────
  async function openDoc(docId, fromBiz) {
    const d = S.byId.get(docId); if (!d) return;
    close("pd-company");
    let blobUrl = "", fileErr = "";
    overlay("pd-doc", `<div class="pd-body">טוען…</div>`, true);
    closers["pd-doc"] = () => { if (blobUrl) URL.revokeObjectURL(blobUrl); if (fromBiz && S.byBiz.get(fromBiz)) openCompany(fromBiz); };
    try {
      const res = await fetch(`/api/permit-docs/${docId}/file`, { headers: authH() });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
      blobUrl = URL.createObjectURL(await res.blob());
    } catch (e) { blobUrl = ""; fileErr = e.message; }
    const paint = () => {
      const doc = S.byId.get(docId); if (!doc) { close("pd-doc"); return; }
      const side = $("pd-doc-side"), keep = side ? side.scrollTop : 0;
      const ids = doc.business_ids || [];
      const typeBtns = Object.keys(TL).map(t => `<button class="pd-btn ${doc.doc_type === t ? "sel" : ""}" onclick="PD._setType('${docId}','${t}')">${TL[t]}</button>`).join("");
      const chips = ids.map(b => `<div class="pd-co"><span>${E(bizName(b))}</span><button class="pd-link" onclick="PD._unassign('${docId}','${b}')" title="ביטול שיוך המסמך לחברה הזו">ביטול שיוך</button></div>`).join("") || `<div class="pd-sub">המסמך לא משויך לאף חברה</div>`;
      const html = `
        <div class="pd-head"><b>${E(doc.original_name || doc.id)}</b><span class="pd-sub">${fmtSize(doc.size)}</span><button class="pd-x" onclick="PD._close('pd-doc')">✕</button></div>
        <div class="pd-split">
          <div class="pd-view">${blobUrl ? `<iframe src="${blobUrl}" title="המסמך"></iframe>` : `<div class="pd-empty">${E(fileErr || "הקובץ לא זמין")}</div>`}</div>
          <div class="pd-side" id="pd-doc-side">
            <h4>סיווג</h4><div class="pd-btns">${typeBtns}</div>
            <h4>חברות משויכות (${ids.length})</h4>${chips}
            <div style="margin-top:6px"><input class="pd-in" id="pd-add-q" placeholder="הוספת / שינוי שיוך: שם או ח.פ." oninput="PD._addSearch('${docId}',this.value)" autocomplete="off"><div id="pd-add-res"></div></div>
            <h4>הערה</h4><textarea class="pd-in" id="pd-note" rows="2" onchange="PD._setNote('${docId}',this.value)">${E(doc.note || "")}</textarea>
            <div class="pd-danger"><button class="pd-btn danger" onclick="PD._askDelete('${docId}')">🗑 מחיקת המסמך לגמרי</button></div>
          </div>
        </div>`;
      $("pd-doc").querySelector(".pd-box").innerHTML = html;
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
    q = (q || "").trim(); if (q.length < 2) { out.innerHTML = ""; return; }
    const d = S.byId.get(id), have = new Set(d.business_ids || []);
    const digits = q.replace(/\D/g, "");
    const hit = bizList().filter(b => !have.has(b.id) && ((b.registrar_name || "").includes(q) || (b.permit_name || "").includes(q) || (digits.length >= 4 && (b.chp_number || "").includes(digits)))).slice(0, 10);
    out.innerHTML = hit.map(b => `<button class="pd-pick" onclick="PD._assign('${id}','${b.id}')">${displayName(b, true)} <span class="pd-sub">${E(b.chp_number || "")}</span></button>`).join("") || `<div class="pd-sub">לא נמצאה חברה</div>`;
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
      S.docs = S.docs.filter(d => d.id !== id); reindex();
      close("pd-confirm"); close("pd-doc");
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
    const add = (b, key, why) => { const c = found.get(b.id) || { b, hp: false, name: false, why: [] }; c[key] = true; if (!c.why.includes(why)) c.why.push(why); found.set(b.id, c); };
    const hps = new Set((String(text || "").replace(/,/g, "").match(/(?<!\d)\d{8,9}(?!\d)/g) || []).map(x => x.padStart(9, "0")));
    for (const h of hps) { if (!hpOk(h) || h[0] !== "5") continue; const b = byChp.get(h); if (b) add(b, "hp", "ח.פ. " + h + " בקובץ"); else outside.add(h); }
    for (const { b, names } of nameIndex()) {
      const hit = names.find(n => nts.some(t => t.includes(n)));
      if (hit) add(b, "name", "השם בקובץ");
      else if (fn.length >= 6 && names.some(n => n.includes(fn) || fn.includes(n))) add(b, "name", "שם הקובץ");
    }
    const cands = [...found.values()].sort((a, b) => (b.hp - a.hp) || (b.name - a.name));
    const strong = cands.filter(c => c.hp);
    const pre = strong.length ? strong : cands.length === 1 ? cands : [];
    const kind = phraseKind(text);
    return { cands, preselect: new Set(pre.map(c => c.b.id)), outside: [...outside], shared: strong.length > 1, doubt: !strong.length && cands.length > 1,
             type: kind === "combined" ? "both" : kind === "private" ? "private" : "unknown", typeWhy: kind === "combined" ? "נוסח \"החברה מאשרת בזאת\" = כללי ופרטי ביחד" : kind === "private" ? "נוסח \"הביעה את הסכמתה\" = פרטי בלבד" : "" };
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
      c.sel = new Set(c.sug.preselect); if (U.preset) c.sel.add(U.preset);
      if (!c.typeTouched) c.type = c.sug.type;
    }
    const sug = c.sug;
    const noText = normText(c.text).length < 40;
    const card = x => `<label class="pd-cand"><input type="checkbox" ${c.sel.has(x.b.id) ? "checked" : ""} onchange="PD._tog('${x.b.id}',this.checked)"> <span class="pd-grow"><b>${displayName(x.b, true)}</b> <span class="pd-sub">${E(x.b.chp_number || "")} · ${x.hp ? "התאמה לפי ח.פ." : "התאמה לפי שם"} (${E(x.why.join(", "))})</span></span></label>`;
    const extra = [...c.sel].filter(id => !sug.cands.some(x => x.b.id === id)).map(id => bizById(id)).filter(Boolean).map(b => card({ b, hp: false, why: ["נבחר ידנית"] }));
    const tb = Object.keys(TL).map(t => `<button class="pd-btn ${c.type === t ? "sel" : ""}" onclick="PD._type('${t}')">${TL[t]}</button>`).join("");
    $("pd-up-body").innerHTML = `
      <div class="pd-split">
        <div class="pd-view"><iframe src="${c.url}" title="תצוגה מקדימה"></iframe></div>
        <div class="pd-side">
          <div class="pd-sub">${E(c.file.name)} · ${fmtSize(c.file.size)}${c.pages ? " · " + c.pages + " עמ'" : ""}${U.queue.length ? " · נותרו בתור: " + U.queue.length : ""}</div>
          ${noText ? `<div class="pd-warnbox">${c.textErr ? "שגיאה בקריאת הקובץ: " + E(c.textErr) : "אין בקובץ טקסט (כנראה סריקה)."} ${c.ocr ? "" : `<button class="pd-link" onclick="PD._ocr()">זיהוי טקסט (OCR) — עשוי לקחת כדקה</button>`}</div>` : ""}
          <h4>שיוך לחברה ${sug.shared ? '<span class="pd-tag">מסמך משותף: כמה חברות</span>' : ""}${sug.doubt ? '<span class="pd-tag warn">יש ספק: כמה התאמות לפי שם</span>' : ""}</h4>
          ${sug.cands.slice(0, 12).map(card).join("") || `<div class="pd-sub">לא נמצאה חברה מתאימה בקובץ. אפשר לחפש ידנית.</div>`}${extra.join("")}
          ${sug.outside.length ? `<div class="pd-sub" style="margin-top:4px">ח.פ. של תאגידים בקובץ שאינם במאגר: ${sug.outside.map(E).join(", ")}</div>` : ""}
          <input class="pd-in" placeholder="חיפוש חברה אחרת: שם או ח.פ." oninput="PD._upSearch(this.value)" autocomplete="off" style="margin-top:6px"><div id="pd-up-res"></div>
          <h4>סיווג</h4><div class="pd-btns">${tb}</div>${sug.typeWhy && !c.typeTouched ? `<div class="pd-sub">הצעה אוטומטית: ${E(sug.typeWhy)}</div>` : ""}
          <h4>הערה (אופציונלי)</h4><textarea class="pd-in" rows="2" onchange="PD._upNote(this.value)">${E(c.note)}</textarea>
          <div class="pd-btns" style="margin-top:12px"><button class="pd-btn primary" id="pd-save" onclick="PD._save()">${c.sel.size ? `שמירה ושיוך ל-${c.sel.size} חברות` : "שמירה בלי שיוך"}</button><button class="pd-btn" onclick="PD._next()">דילוג על הקובץ</button></div>
          <div id="pd-up-err" style="color:#c0392b;margin-top:6px"></div>
        </div></div>`;
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
    const out = $("pd-up-res"); if (!out) return; q = (q || "").trim(); if (q.length < 2) { out.innerHTML = ""; return; }
    const digits = q.replace(/\D/g, "");
    const hit = bizList().filter(b => !U.cur.sel.has(b.id) && ((b.registrar_name || "").includes(q) || (b.permit_name || "").includes(q) || (digits.length >= 4 && (b.chp_number || "").includes(digits)))).slice(0, 10);
    out.innerHTML = hit.map(b => `<button class="pd-pick" onclick="PD._upAdd('${b.id}')">${displayName(b, true)} <span class="pd-sub">${E(b.chp_number || "")}</span></button>`).join("") || `<div class="pd-sub">לא נמצאה חברה</div>`;
  }
  async function upSave() {
    const c = U.cur, btn = $("pd-save"); if (btn) btn.disabled = true;
    const fd = new FormData();
    fd.append("file", c.file); fd.append("doc_type", c.type); fd.append("business_ids", JSON.stringify([...c.sel])); fd.append("note", c.note || "");
    try {
      const res = await fetch("/api/permit-docs", { method: "POST", headers: authH(), body: fd });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409 && data.doc) { upDuplicate(data.doc); return; }
      if (!res.ok) throw new Error(data.error || res.statusText);
      replaceDoc(data.doc); showStatus("המסמך נשמר"); refresh();
      if (U.queue.length) upNext(); else { U.cur = { ...c, url: "" }; upPick(`✓ נשמר: ${E(c.file.name)}`); }
    } catch (e) { if (btn) btn.disabled = false; const el = $("pd-up-err"); if (el) el.textContent = "השמירה נכשלה: " + e.message; }
  }

  // ───────── עיצוב ─────────
  const css = document.createElement("style");
  css.textContent = `
  .pd-na{color:#a0a0a0}
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
  @media(max-width:800px){.pd-split{flex-direction:column}.pd-side{width:auto;max-width:none}}
  `;
  document.head.appendChild(css);

  window.PD = { cell, refresh, load, openUpload, openCompany, openDoc, suggest, phraseKind,
    _close: close, _setType: setType, _setNote: setNote, _unassign: unassign, _addSearch: addSearch, _assign: assign, _askDelete: askDelete, _doDelete: doDelete,
    _files: upFiles, _next: upNext, _tog: upTog, _type: t => { U.cur.type = t; U.cur.typeTouched = true; upReview(); }, _upNote: v => { U.cur.note = v; }, _upSearch: upSearch,
    _upAdd: id => { U.cur.sel.add(id); upReview(); }, _save: upSave, _ocr: upOcr };
})();
