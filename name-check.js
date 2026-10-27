/* בדיקת השמות בשטרות (admin): עוברים אחד-אחד על חברות שהשם בהיתר עסקה שלהן לא (או חלקית) מופיע בשטר המשויך,
   מהכי פחות בטוח. לכל חברה: השטר, השם שבאתר (אפשר לעדכן), הקטע הדומה בשטר והשמות שחולצו ממנו.
   הנתונים: data/probe/permit_name_check.json (נבנה ע"י .github/workflows/permit-name-check.yml); ההחלטות נשמרות ב-/api/permit-review (מפתח namecheck:<עסק>:<שטר>). */
(function () {
  "use strict";
  const $ = id => document.getElementById(id);
  const E = s => String(s ?? "").replace(/[&<>"]/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m]));
  const S = { items: [], i: 0, done: new Map(), showDone: false, skipped: new Set(), rot: new Map(), when: "", blobUrl: "", seq: 0, saving: false };
  const hdr = () => (typeof adminToken !== "undefined" && adminToken ? { Authorization: "Bearer " + adminToken } : {});
  const key = it => "namecheck:" + it.bid + ":" + it.doc_id;
  const SLOT = { general: "כללי", private: "פרטי", "general,private": "כללי+פרטי" };
  const ST = { none: "אין התאמה", partial: "חלקית", notext: "אין טקסט" };

  async function pdfBlob(id) {
    const viaJson = async () => {
      const r = await fetch(`/api/permit-docs/${id}/file?enc=b64`, { headers: hdr() }), j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "HTTP " + r.status);
      const bin = atob(j.data), u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      return new Blob([u8], { type: "application/pdf" });
    };
    try {
      const r = await fetch(`/api/permit-docs/${id}/file`, { headers: hdr() });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const b = await r.blob();
      if (new TextDecoder().decode(await b.slice(0, 5).arrayBuffer()) !== "%PDF-") throw new Error("לא PDF");
      return new Blob([b], { type: "application/pdf" });
    } catch (e) { return viaJson(); }
  }
  const order = it => (it.status === "notext" ? 3000 : it.status === "partial" ? 1000 : 0) + (+it.cover || 0);      // הכי פחות בטוח ראשון: אין התאמה (0% ואילך), אחר כך חלקית, ובסוף בלי טקסט

  async function load() {
    const [r, rv] = await Promise.all([fetch("/data/probe/permit_name_check.json?_=" + Date.now()), fetch("/api/permit-review", { headers: hdr() }).then(x => x.ok ? x.json() : { items: [] }).catch(() => ({ items: [] }))]);
    if (!r.ok) throw new Error("אין עדיין נתוני בדיקה (להריץ את הפעולה permit-name-check ב-GitHub)");
    const d = await r.json();
    S.items = (d.rows || []).filter(x => x.status !== "ok").sort((a, b) => order(a) - order(b) || String(a.permit_name).localeCompare(String(b.permit_name), "he"));
    S.done = new Map((rv.items || []).filter(x => x.key.startsWith("namecheck:")).map(x => [x.key, x]));
    S.when = d.when || "";
  }
  const pending = () => S.items.map((it, n) => n).filter(n => !S.skipped.has(key(S.items[n])) && (S.showDone || !S.done.has(key(S.items[n]))));      // דילוג נשמר עד לפתיחה חוזרת של החלון

  function paint() {
    S.reg = "";
    const box = $("nc-body"); if (!box) return;
    const list = pending();
    if (!list.length) { box.innerHTML = `<div style="padding:50px;text-align:center;font-size:20px">אין עוד פריטים לבדיקה 🎉${S.skipped.size ? `<div style="font-size:14px;color:#667;margin-top:6px">דולגו ${S.skipped.size} פריטים (יחזרו בפתיחה חוזרת של החלון)</div>` : ""}<br><button class="btn-ghost" onclick="NC.toggleDone()">${S.showDone ? "הסתר" : "הצג"} פריטים שטופלו</button></div>`; return; }
    if (!list.includes(S.i)) S.i = list.find(n => n >= S.i) ?? list[list.length - 1];
    const it = S.items[S.i], pos = list.indexOf(S.i) + 1, dn = String(it.doc_names || "").split(" | ").map(x => x.trim()).filter(x => x.length >= 4);
    const dec = S.done.get(key(it));
    box.innerHTML = `<div style="display:flex;gap:14px;height:100%;min-height:0">
      <div style="flex:1 1 55%;min-width:0;display:flex;flex-direction:column"><div style="font-size:13px;color:#667;margin-bottom:4px;display:flex;align-items:center;gap:6px"><span style="flex:1">השטר (${E(SLOT[it.slot] || it.slot)}): ${E(it.doc_name)}</span><button type="button" class="btn-ghost" id="nc-rl" title="סיבוב נגד כיוון השעון" style="padding:2px 10px">⟲</button><button type="button" class="btn-ghost" id="nc-rr" title="סיבוב עם כיוון השעון" style="padding:2px 10px">⟳</button></div><div id="nc-view" style="flex:1;position:relative;overflow:hidden;background:#eef2f3;border:1px solid #cfd8da;border-radius:6px;min-height:0"><div style="padding:30px;color:#667">טוען את השטר…</div></div></div>
      <div style="flex:1 1 45%;min-width:300px;overflow:auto;padding-inline-end:4px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><b style="font-size:16px">${pos} / ${list.length}</b><span style="font-size:13px;padding:2px 10px;border-radius:999px;background:${it.status === "none" ? "#fde4e1" : "#fff1d6"}">${E(ST[it.status] || it.status)} · ${it.cover}%</span></div>
        ${dec ? `<div style="background:#e6f4ea;border:1px solid #a8d5b4;border-radius:6px;padding:6px 10px;margin-bottom:8px;font-size:13px">כבר טופל: ${E(dec.note || "אושר")}</div>` : ""}
        <label style="font-size:13px;color:#445">שם בהיתר עסקה (באתר)</label>
        <div style="display:flex;gap:6px;margin:2px 0 8px"><input id="nc-name" type="text" value="${E(it.permit_name || it.registrar_name || "")}" style="flex:1;min-width:0;box-sizing:border-box;font:inherit;font-size:18px;padding:8px 10px;border:2px solid #8fb7c2;border-radius:6px"><button type="button" class="btn-ghost" id="nc-reg" title="${it.chp ? "משיכת השם הרשמי מהרשם לפי ח.פ." : "אין ח.פ. - ייעשה שימוש בשם ברשם השמור"}" style="white-space:nowrap;padding:6px 12px">משיכה מהרשם</button></div>
        <div id="nc-same" style="display:none;background:#e6f4ea;border:1px solid #a8d5b4;border-radius:6px;padding:5px 10px;margin-bottom:8px;font-size:14px;font-weight:700;color:#1b6b3a">✓ זהה לשם מהרשם. אפשר לאשר בלי למשוך שוב</div>
        <div style="font-size:13px;color:#556;margin-bottom:8px">שם ברשם: <b>${E(it.registrar_name || "—")}</b>${it.reg_cover !== "" && it.reg_cover != null ? ` · התאמה לשטר ${E(it.reg_cover)}%` : ""} · ח.פ. ${E(it.chp || "—")}</div>
        ${it.snippet ? `<div style="font-size:13px;color:#445;margin-bottom:3px">הקטע בשטר הדומה ביותר לשם:</div><div dir="rtl" style="background:#fffbe6;border:1px solid #eadf9c;border-radius:6px;padding:8px 10px;font-size:15px;margin-bottom:8px">${E(it.snippet)}</div>` : `<div style="font-size:13px;color:#a33;margin-bottom:8px">לא נמצא בשטר קטע דומה לשם (ייתכן שטר סרוק / כתב יד).</div>`}
        ${dn.length ? `<div style="font-size:13px;color:#445;margin-bottom:3px">שמות שחולצו מהשטר (לחיצה מעתיקה לשדה השם):</div><div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px">${dn.map(x => `<button type="button" class="btn-ghost nc-chip" data-v="${E(x)}" style="font-size:13px;padding:3px 9px">${E(x.length > 60 ? x.slice(0, 60) + "…" : x)}</button>`).join("")}</div>` : ""}
        ${it.prev_scan ? `<div style="font-size:13px;color:#a56a00;margin-bottom:8px">סריקה קודמת: ${E(it.prev_scan)}</div>` : ""}
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px">
          <button class="btn-primary" id="nc-upd" style="padding:9px 18px">עדכון השם</button>
          <button class="btn-ghost" id="nc-ok" style="padding:9px 18px">השם תקין, המשך</button>
          <button class="btn-ghost" id="nc-skip" style="padding:9px 14px">דלג</button>
          <button class="btn-ghost" id="nc-prev" style="padding:9px 14px">הקודם</button>
        </div>
        <div id="nc-msg" style="margin-top:8px;font-size:13px;color:#a33"></div>
        <div style="margin-top:14px"><label style="font-size:13px"><input type="checkbox" id="nc-sd" ${S.showDone ? "checked" : ""}> הצג גם פריטים שטופלו</label></div>
      </div></div>`;
    box.querySelectorAll(".nc-chip").forEach(b => b.onclick = () => { $("nc-name").value = b.dataset.v; $("nc-name").focus(); });
    $("nc-name").oninput = same; same();
    $("nc-rl").onclick = () => rotate(-90); $("nc-rr").onclick = () => rotate(90);
    $("nc-reg").onclick = pullReg; $("nc-upd").onclick = () => act("upd"); $("nc-ok").onclick = () => act("ok"); $("nc-skip").onclick = skip; $("nc-prev").onclick = () => step(-1);
    $("nc-sd").onchange = e => { S.showDone = e.target.checked; paint(); };
    const my = ++S.seq;
    pdfBlob(it.doc_id).then(b => { if (my !== S.seq || !$("nc-view")) return; if (S.blobUrl) URL.revokeObjectURL(S.blobUrl); S.blobUrl = URL.createObjectURL(b); $("nc-view").innerHTML = `<iframe id="nc-frame" src="${S.blobUrl}#toolbar=0&navpanes=0&view=FitH" style="position:absolute;border:0" title="השטר"></iframe>`; applyRot(); })
      .catch(e => { if (my === S.seq && $("nc-view")) $("nc-view").innerHTML = `<div style="padding:30px;color:#a33">לא ניתן לטעון את השטר: ${E(e.message)}</div>`; });
  }
  const nm = x => String(x || "").replace(/["'`״׳]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
  function same() {          // השם בשדה זהה (אחרי נרמול גרשיים ורווחים) לשם ברשם: מציינים וממליצים לאשר בלי למשוך שוב
    const it = S.items[S.i], v = nm($("nc-name").value), isSame = !!v && (v === nm(it.registrar_name) || (!!S.reg && v === nm(S.reg)));
    $("nc-same").style.display = isSame ? "" : "none";
    $("nc-ok").className = isSame ? "btn-primary" : "btn-ghost"; $("nc-upd").className = isSame ? "btn-ghost" : "btn-primary";
  }
  async function pullReg() {          // השם הרשמי העדכני מהרשם (לפי ח.פ.), במקום הקלדה ידנית
    const it = S.items[S.i], msg = $("nc-msg"), b = $("nc-reg"); msg.style.color = "#556";
    if (!it.chp) { if (it.registrar_name) { $("nc-name").value = it.registrar_name; S.reg = it.registrar_name; msg.textContent = "אין ח.פ.: הוכנס השם ברשם השמור"; same(); } else { msg.style.color = "#a33"; msg.textContent = "אין ח.פ. ואין שם ברשם"; } return; }
    b.disabled = true; msg.textContent = "מושך מהרשם…";
    try {
      const r = await apiFetch("/lookup?number=" + encodeURIComponent(it.chp));
      if (!r.found) throw new Error("לא נמצא תאגיד עם ח.פ. " + it.chp + " ברשם");
      $("nc-name").value = r.name; S.reg = r.name; msg.textContent = "נמשך מהרשם: " + r.name; same();
    } catch (e) { msg.style.color = "#a33"; msg.textContent = e.message; }
    b.disabled = false;
  }
  function applyRot() {          // סיבוב השטר (לשטרות סרוקים הפוכים / על הצד): הזכרון לפי שטר, עד לסגירת החלון
    const f = $("nc-frame"), v = $("nc-view"); if (!f || !v) return;
    const deg = (S.rot.get(S.items[S.i].doc_id) || 0) % 360, W = v.clientWidth, H = v.clientHeight, side = deg === 90 || deg === 270;
    const w = side ? H : W, h = side ? W : H;
    f.style.width = w + "px"; f.style.height = h + "px"; f.style.left = (W - w) / 2 + "px"; f.style.top = (H - h) / 2 + "px"; f.style.transform = "rotate(" + deg + "deg)";
  }
  function rotate(d) { const id = S.items[S.i].doc_id; S.rot.set(id, (((S.rot.get(id) || 0) + d) % 360 + 360) % 360); applyRot(); }
  window.addEventListener("resize", () => applyRot());
  function skip() {          // דלג: הפריט יוצא מהתור עד פתיחה חוזרת של החלון (לא חוזר אחרי השטר הבא)
    const list = pending(), k = list.indexOf(S.i); S.skipped.add(key(S.items[S.i]));
    const rest = pending(); S.i = rest.find(n => n > S.i) ?? rest[rest.length - 1] ?? S.i; paint();
  }
  function step(d) { const list = pending(), k = list.indexOf(S.i); const n = list[Math.min(Math.max(k + d, 0), list.length - 1)]; S.i = n ?? S.i; paint(); }
  async function review(it, note) {
    const res = await fetch("/api/permit-review", { method: "PUT", headers: { "Content-Type": "application/json", ...hdr() }, body: JSON.stringify({ key: key(it), status: "approved", note: note.slice(0, 490) }) });
    if (!res.ok) throw new Error("שמירת ההחלטה נכשלה");
    S.done.set(key(it), { key: key(it), status: "approved", note });
  }
  async function act(kind) {
    if (S.saving) return; const it = S.items[S.i], msg = $("nc-msg"), name = $("nc-name").value.trim();
    S.saving = true; msg.style.color = "#556"; msg.textContent = "שומר…";
    try {
      if (kind === "upd") {
        if (!name) throw new Error("השם ריק");
        const biz = (typeof businesses !== "undefined" ? businesses : []).find(b => String(b.id) === String(it.bid));
        if (!biz) throw new Error("העסק לא נמצא ברשימה שנטענה (לרענן את הדף)");
        if (name !== (biz.permit_name || "")) {
          const upd = { ...biz, permit_name: name }; if (S.reg && S.reg === name) upd.registrar_name = name;      // נמשך מהרשם: גם השם ברשם מתעדכן
          await apiFetch("/businesses/" + encodeURIComponent(biz.id), { method: "PUT", body: JSON.stringify(upd) });
          const old = biz.permit_name || ""; biz.permit_name = name; it.permit_name = name; if (upd.registrar_name !== undefined) { biz.registrar_name = upd.registrar_name; it.registrar_name = upd.registrar_name; }
          await review(it, `עודכן: ${old} ← ${name}`);
        } else await review(it, "השם תקין");
      } else await review(it, "השם תקין");
      const list = pending(); const k = list.indexOf(S.i); S.i = list[k + 1] ?? list[k - 1] ?? S.i;
      S.saving = false; paint();
    } catch (e) { S.saving = false; msg.style.color = "#a33"; msg.textContent = e.message; }
  }
  function close() { const ov = $("nc-ov"); if (ov) ov.remove(); document.body.style.overflow = ""; if (S.blobUrl) { URL.revokeObjectURL(S.blobUrl); S.blobUrl = ""; } S.seq++; }
  async function open() {
    close(); S.skipped = new Set(); S.rot = new Map();
    const ov = document.createElement("div"); ov.id = "nc-ov";
    ov.style.cssText = "position:fixed;inset:0;z-index:100000;background:#fff;display:flex;flex-direction:column;direction:rtl;padding:12px 16px;box-sizing:border-box";
    ov.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><h2 style="margin:0;font-size:20px">בדיקת השמות בשטרות <small id="nc-when" style="font-weight:400;font-size:12px;color:#667"></small></h2><button class="btn-ghost" onclick="NC.close()">✕ סגירה</button></div><div id="nc-body" style="flex:1;min-height:0"><div style="padding:40px;text-align:center">טוען…</div></div>`;
    document.body.appendChild(ov); document.body.style.overflow = "hidden";
    try { await load(); S.i = 0; const w = $("nc-when"); if (w && S.when) w.textContent = "(נתוני הבדיקה מ-" + new Date(S.when).toLocaleString("he-IL") + ")"; paint(); } catch (e) { $("nc-body").innerHTML = `<div style="padding:40px;text-align:center;color:#a33">${E(e.message)}</div>`; }
  }
  window.NC = { open, close, toggleDone: () => { S.showDone = !S.showDone; paint(); } };
})();
