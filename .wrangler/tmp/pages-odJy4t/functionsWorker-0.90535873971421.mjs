var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// ../.wrangler/tmp/bundle-ZRmA18/strip-cf-connecting-ip-header.js
function stripCfConnectingIPHeader(input, init) {
  const request = new Request(input, init);
  request.headers.delete("CF-Connecting-IP");
  return request;
}
__name(stripCfConnectingIPHeader, "stripCfConnectingIPHeader");
globalThis.fetch = new Proxy(globalThis.fetch, {
  apply(target, thisArg, argArray) {
    return Reflect.apply(target, thisArg, [
      stripCfConnectingIPHeader.apply(null, argArray)
    ]);
  }
});

// api/_shared/auth.js
var enc = new TextEncoder();
var hex = /* @__PURE__ */ __name((buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join(""), "hex");
var sha = /* @__PURE__ */ __name(async (s) => hex(await crypto.subtle.digest("SHA-256", enc.encode(s))), "sha");
var same = /* @__PURE__ */ __name((a, b) => {
  if (a.length !== b.length)
    return false;
  let d = 0;
  for (let i = 0; i < a.length; i++)
    d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}, "same");
async function storedPassword(env) {
  try {
    const r = await env.DB.prepare("SELECT value FROM admin_settings WHERE key = 'password'").first();
    return r ? r.value : null;
  } catch {
    return null;
  }
}
__name(storedPassword, "storedPassword");
async function checkPassword(token, env) {
  token = (token || "").trim();
  if (!token)
    return false;
  const stored = await storedPassword(env);
  if (stored) {
    const [salt, h] = stored.split(":");
    return same(await sha(salt + token), h);
  }
  return !!env.ADMIN_PASSWORD && same(token, env.ADMIN_PASSWORD);
}
__name(checkPassword, "checkPassword");
var MAX_DEVICES = 2;
var COOKIE = "adm_dev";
async function storedDevices(env) {
  try {
    const r = await env.DB.prepare("SELECT value FROM admin_settings WHERE key = 'trusted_devices'").first();
    return r ? JSON.parse(r.value) : [];
  } catch {
    return [];
  }
}
__name(storedDevices, "storedDevices");
var deviceCookie = /* @__PURE__ */ __name((request) => {
  const m = (request.headers.get("Cookie") || "").match(new RegExp("(?:^|;\\s*)" + COOKIE + "=([0-9a-f]{64})"));
  return m ? m[1] : "";
}, "deviceCookie");
async function isTrustedDevice(request, env) {
  const c = deviceCookie(request);
  if (!c)
    return false;
  return (await storedDevices(env)).includes(await sha(c));
}
__name(isTrustedDevice, "isTrustedDevice");
async function registerDevice(request, env) {
  if (await isTrustedDevice(request, env))
    return null;
  const list = await storedDevices(env);
  if (list.length >= MAX_DEVICES)
    return null;
  const token = hex(crypto.getRandomValues(new Uint8Array(32)));
  try {
    await env.DB.prepare("CREATE TABLE IF NOT EXISTS admin_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)").run();
    await env.DB.prepare("INSERT OR REPLACE INTO admin_settings (key, value) VALUES ('trusted_devices', ?)").bind(JSON.stringify([...list, await sha(token)])).run();
  } catch {
    return null;
  }
  return `${COOKIE}=${token}; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Lax`;
}
__name(registerDevice, "registerDevice");
var checkAdmin = /* @__PURE__ */ __name(async (request, env) => await checkPassword((request.headers.get("Authorization") || "").replace("Bearer ", ""), env) || await isTrustedDevice(request, env), "checkAdmin");
async function setPassword(env, pw) {
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS admin_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)").run();
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
  await env.DB.prepare("INSERT OR REPLACE INTO admin_settings (key, value) VALUES ('password', ?)").bind(salt + ":" + await sha(salt + pw)).run();
}
__name(setPassword, "setPassword");

// api/_shared/permit-docs.js
var TYPES = ["general", "private", "both", "unknown", "other"];
var MAX_BYTES = 50 * 1024 * 1024;
var hex2 = /* @__PURE__ */ __name((buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join(""), "hex");
var noAuth = /* @__PURE__ */ __name(() => Response.json({ error: "Unauthorized" }, { status: 401 }), "noAuth");
var noStore = /* @__PURE__ */ __name(() => Response.json({ error: "\u05D0\u05D7\u05E1\u05D5\u05DF \u05D4\u05E7\u05D1\u05E6\u05D9\u05DD (R2) \u05E2\u05D3\u05D9\u05D9\u05DF \u05DC\u05D0 \u05D4\u05D5\u05D2\u05D3\u05E8: \u05E8\u05D0\u05D4 \u05D4\u05D5\u05E8\u05D0\u05D5\u05EA \u05D1-wrangler.toml" }, { status: 503 }), "noStore");
var newId = /* @__PURE__ */ __name(() => crypto.randomUUID().replace(/-/g, "").slice(0, 12), "newId");
var SLOTS = ["general", "private"];
var cleanSlot = /* @__PURE__ */ __name((v) => SLOTS.filter((x) => (Array.isArray(v) ? v : String(v || "").split(",")).includes(x)).join(","), "cleanSlot");
async function withBusinesses(env, rows) {
  const ids = rows.map((r) => r.id);
  const links = new Map(ids.map((i) => [i, []])), slots = new Map(ids.map((i) => [i, {}]));
  if (ids.length) {
    let all;
    try {
      all = await env.DB.prepare("SELECT doc_id, business_id, slot FROM permit_doc_companies").all();
    } catch {
      all = await env.DB.prepare("SELECT doc_id, business_id FROM permit_doc_companies").all();
    }
    for (const l of all.results ?? [])
      if (links.has(l.doc_id)) {
        links.get(l.doc_id).push(l.business_id);
        if (l.slot)
          slots.get(l.doc_id)[l.business_id] = l.slot;
      }
  }
  const ext = new Map(ids.map((i) => [i, []]));
  if (ids.length) {
    try {
      for (const l of (await env.DB.prepare("SELECT doc_id, ext_id FROM permit_doc_ext").all()).results ?? [])
        if (ext.has(l.doc_id))
          ext.get(l.doc_id).push(l.ext_id);
    } catch {
    }
  }
  const specials = new Map(ids.map((i) => [i, {}]));
  if (ids.length) {
    let sp;
    try {
      sp = await env.DB.prepare("SELECT doc_id, business_id, title, detail FROM permit_doc_special").all();
    } catch {
      try {
        sp = await env.DB.prepare("SELECT doc_id, business_id, title FROM permit_doc_special").all();
      } catch {
        sp = null;
      }
    }
    for (const l of sp && sp.results || [])
      if (specials.has(l.doc_id))
        specials.get(l.doc_id)[l.business_id] = { title: l.title, detail: l.detail || "" };
  }
  const bonds = new Map(ids.map((i) => [i, []]));
  if (ids.length) {
    try {
      for (const l of (await env.DB.prepare("SELECT doc_id, security_id, name, symbol, company, chp FROM permit_doc_bonds").all()).results ?? [])
        if (bonds.has(l.doc_id))
          bonds.get(l.doc_id).push({ id: l.security_id, name: l.name, symbol: l.symbol, company: l.company, chp: l.chp });
    } catch {
    }
  }
  return rows.map((r) => ({ ...r, business_ids: links.get(r.id) || [], slots: slots.get(r.id) || {}, ext_ids: ext.get(r.id) || [], bonds: bonds.get(r.id) || [], specials: specials.get(r.id) || {} }));
}
__name(withBusinesses, "withBusinesses");
async function slotStatements(env, docId, slotMap) {
  const stmts = [];
  let hasSpecial = true;
  try {
    await env.DB.prepare("SELECT 1 FROM permit_doc_special LIMIT 1").first();
  } catch {
    hasSpecial = false;
  }
  for (const [bid, v] of Object.entries(slotMap || {})) {
    const mine = cleanSlot(v);
    stmts.push(env.DB.prepare("UPDATE permit_doc_companies SET slot = ? WHERE doc_id = ? AND business_id = ?").bind(mine, docId, bid));
    if (!mine)
      continue;
    if (hasSpecial)
      stmts.push(env.DB.prepare("DELETE FROM permit_doc_special WHERE doc_id = ? AND business_id = ?").bind(docId, bid));
    const others = await env.DB.prepare("SELECT doc_id, slot FROM permit_doc_companies WHERE business_id = ? AND doc_id != ? AND slot != ''").bind(bid, docId).all();
    for (const o of others.results ?? []) {
      const keep = cleanSlot(String(o.slot).split(",").filter((x) => !mine.split(",").includes(x)));
      if (keep !== o.slot)
        stmts.push(env.DB.prepare("UPDATE permit_doc_companies SET slot = ? WHERE doc_id = ? AND business_id = ?").bind(keep, o.doc_id, bid));
    }
  }
  return stmts;
}
__name(slotStatements, "slotStatements");
async function existingBusinessIds(env, ids) {
  const clean = [...new Set((ids || []).map(String).filter(Boolean))];
  if (!clean.length)
    return [];
  const all = await env.DB.prepare("SELECT id FROM businesses").all();
  const have = new Set((all.results ?? []).map((r) => r.id));
  return clean.filter((i) => have.has(i));
}
__name(existingBusinessIds, "existingBusinessIds");

// api/permit-docs/[id]/file.js
async function onRequestGet({ request, env, params }) {
  if (!await checkAdmin(request, env))
    return noAuth();
  if (!env.PERMITS)
    return noStore();
  try {
    const row = await env.DB.prepare("SELECT file_key, original_name FROM permit_docs WHERE id = ?").bind(params.id).first();
    if (!row)
      return Response.json({ error: "\u05DC\u05D0 \u05E0\u05DE\u05E6\u05D0" }, { status: 404 });
    const obj = await env.PERMITS.get(row.file_key);
    if (!obj)
      return Response.json({ error: "\u05D4\u05E7\u05D5\u05D1\u05E5 \u05DC\u05D0 \u05E0\u05DE\u05E6\u05D0 \u05D1\u05D0\u05D7\u05E1\u05D5\u05DF" }, { status: 404 });
    if (new URL(request.url).searchParams.get("enc") === "b64") {
      const u8 = new Uint8Array(await obj.arrayBuffer());
      let bin = "";
      for (let i = 0; i < u8.length; i += 32768)
        bin += String.fromCharCode.apply(null, u8.subarray(i, i + 32768));
      return Response.json({ name: row.original_name || "permit.pdf", data: btoa(bin) }, { headers: { "Cache-Control": "private, no-store" } });
    }
    return new Response(obj.body, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(row.original_name || "permit.pdf")}`,
        "Cache-Control": "private, no-store"
      }
    });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
__name(onRequestGet, "onRequestGet");

// api/businesses/[id].js
var isAuthed = /* @__PURE__ */ __name((request, env) => checkAdmin(request, env), "isAuthed");
async function onRequestPut({ request, env, params }) {
  if (!await isAuthed(request, env)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const id = params.id;
    const body = await request.json();
    const { chp_number, entity_type, registrar_name, permit_name, category, region, notes: notes2, notes_scope, visibility, agch_approved, has_details } = body;
    const vals = [
      chp_number || "",
      entity_type || "company",
      registrar_name || "",
      permit_name || "",
      category || "",
      region || "",
      notes2 || "",
      visibility || "",
      agch_approved || "",
      has_details ? 1 : 0
    ];
    let result;
    try {
      result = await env.DB.prepare(
        `UPDATE businesses
         SET chp_number=?, entity_type=?, registrar_name=?, permit_name=?, category=?, region=?, notes=?, visibility=?, agch_approved=?, has_details=?,
             notes_scope=?, updated_at=datetime('now')
         WHERE id=?`
      ).bind(...vals, notes_scope || "", id).run();
    } catch (e) {
      if (!/no such column: notes_scope/i.test(String(e.message)))
        throw e;
      result = await env.DB.prepare(
        // העמודה notes_scope עדיין לא נוספה למסד (migrations/0004)
        `UPDATE businesses
         SET chp_number=?, entity_type=?, registrar_name=?, permit_name=?, category=?, region=?, notes=?, visibility=?, agch_approved=?, has_details=?,
             updated_at=datetime('now')
         WHERE id=?`
      ).bind(...vals, id).run();
    }
    if (result.changes === 0) {
      return Response.json({ error: "Business not found" }, { status: 404 });
    }
    return Response.json({ success: true });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
__name(onRequestPut, "onRequestPut");
async function onRequestDelete({ request, env, params }) {
  if (!await isAuthed(request, env)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    await env.DB.prepare("DELETE FROM businesses WHERE id=?").bind(params.id).run();
    return Response.json({ success: true });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
__name(onRequestDelete, "onRequestDelete");

// api/permit-docs-public/[id].js
async function onRequestGet2({ env, params }) {
  if (!env.PERMITS)
    return new Response("not found", { status: 404 });
  try {
    const row = await env.DB.prepare(`
      SELECT d.file_key, d.original_name FROM permit_docs d
      WHERE d.id = ? AND d.doc_type != 'other' AND EXISTS (SELECT 1 FROM permit_doc_companies c WHERE c.doc_id = d.id AND c.slot != '')`).bind(params.id).first() || await env.DB.prepare(`SELECT d.file_key, d.original_name FROM permit_docs d WHERE d.id = ? AND d.doc_type != 'other' AND EXISTS (SELECT 1 FROM permit_doc_special s WHERE s.doc_id = d.id)`).bind(params.id).first().catch(() => null);
    if (!row)
      return new Response("not found", { status: 404 });
    const obj = await env.PERMITS.get(row.file_key);
    if (!obj)
      return new Response("not found", { status: 404 });
    return new Response(obj.body, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(row.original_name || "permit.pdf")}`,
        "Cache-Control": "public, max-age=300",
        "Access-Control-Allow-Origin": "*"
      }
    });
  } catch {
    return new Response("not found", { status: 404 });
  }
}
__name(onRequestGet2, "onRequestGet");

// api/permit-docs/[id].js
async function onRequestGet3({ request, env, params }) {
  if (!await checkAdmin(request, env))
    return noAuth();
  try {
    const row = await env.DB.prepare("SELECT * FROM permit_docs WHERE id = ?").bind(params.id).first();
    if (!row)
      return Response.json({ error: "\u05DC\u05D0 \u05E0\u05DE\u05E6\u05D0" }, { status: 404 });
    return Response.json({ doc: (await withBusinesses(env, [row]))[0] });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
__name(onRequestGet3, "onRequestGet");
async function onRequestPut2({ request, env, params }) {
  if (!await checkAdmin(request, env))
    return noAuth();
  try {
    const row = await env.DB.prepare("SELECT * FROM permit_docs WHERE id = ?").bind(params.id).first();
    if (!row)
      return Response.json({ error: "\u05DC\u05D0 \u05E0\u05DE\u05E6\u05D0" }, { status: 404 });
    const body = await request.json();
    const stmts = [];
    const docType = body.doc_type !== void 0 ? body.doc_type : row.doc_type;
    if (!TYPES.includes(docType))
      return Response.json({ error: "\u05E1\u05D9\u05D5\u05D5\u05D2 \u05DC\u05D0 \u05EA\u05E7\u05D9\u05DF" }, { status: 400 });
    const note = body.note !== void 0 ? String(body.note) : row.note;
    const metaOnly = Object.keys(body).every((k) => ["intel", "pages", "doc_dates"].includes(k));
    stmts.push(metaOnly ? env.DB.prepare("UPDATE permit_docs SET doc_type=?, note=? WHERE id=?").bind(docType, note, params.id) : env.DB.prepare("UPDATE permit_docs SET doc_type=?, note=?, updated_at=datetime('now') WHERE id=?").bind(docType, note, params.id));
    if (Array.isArray(body.business_ids)) {
      const ids = await existingBusinessIds(env, body.business_ids);
      const old = {};
      try {
        for (const l of (await env.DB.prepare("SELECT business_id, slot FROM permit_doc_companies WHERE doc_id = ?").bind(params.id).all()).results ?? [])
          old[l.business_id] = l.slot || "";
      } catch {
      }
      stmts.push(env.DB.prepare("DELETE FROM permit_doc_companies WHERE doc_id = ?").bind(params.id));
      for (const b of ids)
        stmts.push(env.DB.prepare("INSERT OR IGNORE INTO permit_doc_companies (doc_id, business_id) VALUES (?, ?)").bind(params.id, b));
      for (const b of ids)
        if (old[b] && !(body.slots && typeof body.slots === "object" && b in body.slots))
          stmts.push(env.DB.prepare("UPDATE permit_doc_companies SET slot = ? WHERE doc_id = ? AND business_id = ?").bind(old[b], params.id, b));
    }
    if (body.slots && typeof body.slots === "object") {
      stmts.push(...await slotStatements(env, params.id, body.slots));
    }
    if (body.specials && typeof body.specials === "object") {
      const ids = await existingBusinessIds(env, Object.keys(body.specials));
      let hasDetail = true;
      try {
        await env.DB.prepare("SELECT detail FROM permit_doc_special LIMIT 1").first();
      } catch {
        hasDetail = false;
      }
      for (const b of ids) {
        const raw = body.specials[b], obj = raw && typeof raw === "object" ? raw : { title: raw };
        const title = String(obj.title || "").trim().slice(0, 200), detail = String(obj.detail || "").trim().slice(0, 1e3);
        if (!title) {
          stmts.push(env.DB.prepare("DELETE FROM permit_doc_special WHERE doc_id = ? AND business_id = ?").bind(params.id, b));
          continue;
        }
        stmts.push(env.DB.prepare("INSERT OR IGNORE INTO permit_doc_companies (doc_id, business_id) VALUES (?, ?)").bind(params.id, b));
        stmts.push(env.DB.prepare("UPDATE permit_doc_companies SET slot = '' WHERE doc_id = ? AND business_id = ?").bind(params.id, b));
        if (hasDetail)
          stmts.push(env.DB.prepare("INSERT INTO permit_doc_special (doc_id, business_id, title, detail) VALUES (?,?,?,?) ON CONFLICT(doc_id, business_id) DO UPDATE SET title = excluded.title, detail = excluded.detail").bind(params.id, b, title, detail));
        else
          stmts.push(env.DB.prepare("INSERT INTO permit_doc_special (doc_id, business_id, title) VALUES (?,?,?) ON CONFLICT(doc_id, business_id) DO UPDATE SET title = excluded.title").bind(params.id, b, title));
      }
    }
    if (Array.isArray(body.ext_ids)) {
      const have = new Set(((await env.DB.prepare("SELECT id FROM permit_ext_companies").all()).results ?? []).map((r) => r.id));
      stmts.push(env.DB.prepare("DELETE FROM permit_doc_ext WHERE doc_id = ?").bind(params.id));
      for (const x of [...new Set(body.ext_ids.map(String))].filter((i) => have.has(i)))
        stmts.push(env.DB.prepare("INSERT OR IGNORE INTO permit_doc_ext (doc_id, ext_id) VALUES (?, ?)").bind(params.id, x));
    }
    if (Array.isArray(body.bonds)) {
      stmts.push(env.DB.prepare("DELETE FROM permit_doc_bonds WHERE doc_id = ?").bind(params.id));
      const seen = /* @__PURE__ */ new Set();
      for (const x of body.bonds.slice(0, 300)) {
        const sid = String(x && x.id || "").trim();
        if (!sid || seen.has(sid))
          continue;
        seen.add(sid);
        stmts.push(env.DB.prepare("INSERT INTO permit_doc_bonds (doc_id, security_id, name, symbol, company, chp) VALUES (?,?,?,?,?,?)").bind(params.id, sid, String(x.name || "").slice(0, 200), String(x.symbol || "").slice(0, 60), String(x.company || "").slice(0, 200), String(x.chp || "").slice(0, 20)));
      }
    }
    if (body.intel !== void 0) {
      const txt = body.intel && typeof body.intel === "object" ? JSON.stringify(body.intel) : "";
      stmts.push(env.DB.prepare("UPDATE permit_docs SET intel = ? WHERE id = ?").bind(txt.length > 8e3 ? "" : txt, params.id));
    }
    if (body.pages !== void 0 || body.doc_dates !== void 0) {
      const pages = Math.max(0, Math.min(5e3, parseInt(body.pages, 10) || 0));
      const dates = (Array.isArray(body.doc_dates) ? body.doc_dates : []).map(String).filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x)).slice(0, 12);
      stmts.push(env.DB.prepare("UPDATE permit_docs SET pages = ?, doc_dates = ? WHERE id = ?").bind(pages, dates.length ? JSON.stringify(dates) : "", params.id));
    }
    await env.DB.batch(stmts);
    const fresh = await env.DB.prepare("SELECT * FROM permit_docs WHERE id = ?").bind(params.id).first();
    return Response.json({ success: true, doc: (await withBusinesses(env, [fresh]))[0] });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
__name(onRequestPut2, "onRequestPut");
async function onRequestDelete2({ request, env, params }) {
  if (!await checkAdmin(request, env))
    return noAuth();
  try {
    const row = await env.DB.prepare("SELECT * FROM permit_docs WHERE id = ?").bind(params.id).first();
    if (!row)
      return Response.json({ error: "\u05DC\u05D0 \u05E0\u05DE\u05E6\u05D0" }, { status: 404 });
    await env.DB.batch([
      env.DB.prepare("DELETE FROM permit_doc_companies WHERE doc_id = ?").bind(params.id),
      env.DB.prepare("DELETE FROM permit_docs WHERE id = ?").bind(params.id)
    ]);
    await env.DB.prepare("DELETE FROM permit_doc_special WHERE doc_id = ?").bind(params.id).run().catch(() => {
    });
    if (env.PERMITS)
      await env.PERMITS.delete(row.file_key).catch(() => {
      });
    return Response.json({ success: true });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
__name(onRequestDelete2, "onRequestDelete");

// api/permit-ext/[id].js
var STATUSES = ["deleted", "merged", "not_in_db"];
async function onRequestPut3({ request, env, params }) {
  if (!await checkAdmin(request, env))
    return noAuth();
  try {
    const row = await env.DB.prepare("SELECT * FROM permit_ext_companies WHERE id = ?").bind(params.id).first();
    if (!row)
      return Response.json({ error: "\u05DC\u05D0 \u05E0\u05DE\u05E6\u05D0" }, { status: 404 });
    const b = await request.json();
    const status = b.status !== void 0 ? b.status : row.status;
    if (!STATUSES.includes(status))
      return Response.json({ error: "\u05E1\u05D8\u05D8\u05D5\u05E1 \u05DC\u05D0 \u05EA\u05E7\u05D9\u05DF" }, { status: 400 });
    await env.DB.prepare("UPDATE permit_ext_companies SET name = ?, chp = ?, status = ?, note = ?, updated_at = datetime('now') WHERE id = ?").bind(b.name !== void 0 ? String(b.name).trim().slice(0, 300) : row.name, b.chp !== void 0 ? String(b.chp).replace(/\D/g, "") : row.chp, status, b.note !== void 0 ? String(b.note).slice(0, 500) : row.note, params.id).run();
    return Response.json({ company: await env.DB.prepare("SELECT * FROM permit_ext_companies WHERE id = ?").bind(params.id).first() });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
__name(onRequestPut3, "onRequestPut");
async function onRequestDelete3({ request, env, params }) {
  if (!await checkAdmin(request, env))
    return noAuth();
  try {
    await env.DB.batch([env.DB.prepare("DELETE FROM permit_doc_ext WHERE ext_id = ?").bind(params.id), env.DB.prepare("DELETE FROM permit_ext_companies WHERE id = ?").bind(params.id)]);
    return Response.json({ success: true });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
__name(onRequestDelete3, "onRequestDelete");

// api/approved-bonds.js
var SCOPES = ["private", "general", "both"];
var isAuthed2 = /* @__PURE__ */ __name((request, env) => checkAdmin(request, env), "isAuthed");
async function triggerBondsBuild(env, chp) {
  if (!env.GITHUB_DISPATCH_TOKEN)
    return { triggered: false, reason: "missing_secret" };
  try {
    const res = await fetch("https://api.github.com/repos/Revach123/HARAV_LEVIN/actions/workflows/bonds-list.yml/dispatches", {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${env.GITHUB_DISPATCH_TOKEN}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "harav-levin-admin",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ ref: "main", inputs: { mode: "fast", chp: String(chp || "") } })
      // בנייה מהירה (כדקה); אם אין בסיס, היא עוברת לבנייה מלאה
    });
    return res.status === 204 ? { triggered: true } : { triggered: false, reason: `github_${res.status}` };
  } catch {
    return { triggered: false, reason: "github_unreachable" };
  }
}
__name(triggerBondsBuild, "triggerBondsBuild");
async function onRequestGet4({ request, env }) {
  const chp = (new URL(request.url).searchParams.get("chp") || "").trim();
  try {
    const stmt = chp ? env.DB.prepare("SELECT * FROM approved_bonds WHERE chp_number = ? ORDER BY security_id").bind(chp) : env.DB.prepare("SELECT * FROM approved_bonds ORDER BY chp_number, security_id");
    const { results } = await stmt.all();
    return Response.json({ ok: true, rows: results ?? [] });
  } catch (e) {
    if (/no such table/i.test(String(e.message)))
      return Response.json({ ok: true, rows: [], table: "missing" });
    return Response.json({ ok: false, error: e.message }, { status: 500 });
  }
}
__name(onRequestGet4, "onRequestGet");
async function onRequestPut4({ request, env }) {
  if (!await isAuthed2(request, env))
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await request.json();
    const chp = String(body.chp || "").trim();
    if (!chp)
      return Response.json({ error: "Missing chp" }, { status: 400 });
    const items = Array.isArray(body.items) ? body.items : [];
    const remove = Array.isArray(body.remove) ? body.remove : [];
    const stmts = [];
    for (const it of items) {
      const sid = Number(it.security_id);
      if (!Number.isInteger(sid) || sid <= 0)
        return Response.json({ error: "Bad security_id" }, { status: 400 });
      if (!SCOPES.includes(it.scope))
        return Response.json({ error: "Bad scope" }, { status: 400 });
      stmts.push(env.DB.prepare(
        `INSERT INTO approved_bonds (security_id, chp_number, bond_name, symbol, scope)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(security_id) DO UPDATE SET chp_number = excluded.chp_number, bond_name = excluded.bond_name,
           symbol = excluded.symbol, scope = excluded.scope, updated_at = datetime('now')`
      ).bind(sid, chp, String(it.bond_name || ""), String(it.symbol || ""), it.scope));
    }
    for (const r of remove) {
      const sid = Number(r);
      if (Number.isInteger(sid) && sid > 0)
        stmts.push(env.DB.prepare("DELETE FROM approved_bonds WHERE security_id = ? AND chp_number = ?").bind(sid, chp));
    }
    if (stmts.length)
      await env.DB.batch(stmts);
    const refresh = stmts.length ? await triggerBondsBuild(env, chp) : { triggered: false, reason: "no_changes" };
    return Response.json({ success: true, saved: items.length, removed: remove.length, refresh });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
__name(onRequestPut4, "onRequestPut");

// api/businesses.js
var isAuthed3 = /* @__PURE__ */ __name((request, env) => checkAdmin(request, env), "isAuthed");
async function onRequestGet5({ env }) {
  try {
    const result = await env.DB.prepare("SELECT * FROM businesses ORDER BY registrar_name, permit_name COLLATE NOCASE").all();
    return Response.json(result.results ?? []);
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
__name(onRequestGet5, "onRequestGet");
async function onRequestPost({ request, env }) {
  if (!await isAuthed3(request, env)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const body = await request.json();
    const { id, chp_number, entity_type, registrar_name, permit_name, category, region, notes: notes2, notes_scope, visibility, agch_approved, has_details } = body;
    if (!id)
      return Response.json({ error: "Missing id" }, { status: 400 });
    if (!registrar_name && !permit_name) {
      return Response.json({ error: "At least one name is required" }, { status: 400 });
    }
    const vals = [
      id,
      chp_number || "",
      entity_type || "company",
      registrar_name || "",
      permit_name || "",
      category || "",
      region || "",
      notes2 || "",
      visibility || "",
      agch_approved || "",
      has_details ? 1 : 0
    ];
    try {
      await env.DB.prepare(
        `INSERT INTO businesses (id, chp_number, entity_type, registrar_name, permit_name, category, region, notes, visibility, agch_approved, has_details, notes_scope)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(...vals, notes_scope || "").run();
    } catch (e) {
      if (!/no such column: notes_scope|has no column named notes_scope/i.test(String(e.message)))
        throw e;
      await env.DB.prepare(
        // העמודה notes_scope עדיין לא נוספה למסד (migrations/0004)
        `INSERT INTO businesses (id, chp_number, entity_type, registrar_name, permit_name, category, region, notes, visibility, agch_approved, has_details)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(...vals).run();
    }
    return Response.json({ success: true });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
__name(onRequestPost, "onRequestPost");

// api/change-password.js
async function onRequestPost2({ request, env }) {
  let b;
  try {
    b = await request.json();
  } catch {
    return Response.json({ error: "\u05D1\u05E7\u05E9\u05D4 \u05DC\u05D0 \u05EA\u05E7\u05D9\u05E0\u05D4" }, { status: 400 });
  }
  if (!await checkPassword(b.current, env) && !await isTrustedDevice(request, env))
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  const next = String(b.next || "").trim();
  if (next.length < 4)
    return Response.json({ error: "\u05D4\u05E1\u05D9\u05E1\u05DE\u05D4 \u05D4\u05D7\u05D3\u05E9\u05D4 \u05E7\u05E6\u05E8\u05D4 \u05DE\u05D3\u05D9 (\u05DC\u05E4\u05D7\u05D5\u05EA 4 \u05EA\u05D5\u05D5\u05D9\u05DD)" }, { status: 400 });
  try {
    await setPassword(env, next);
  } catch (e) {
    return Response.json({ error: "\u05E9\u05DE\u05D9\u05E8\u05EA \u05D4\u05E1\u05D9\u05E1\u05DE\u05D4 \u05E0\u05DB\u05E9\u05DC\u05D4: " + e.message }, { status: 500 });
  }
  return Response.json({ success: true });
}
__name(onRequestPost2, "onRequestPost");

// api/company-bonds.js
var BASE = "https://datawise.tase.co.il";
var BOND_PREFIXES = ["03", "05", "11", "36"];
var norm = /* @__PURE__ */ __name((v) => String(v ?? "").trim().replace(/^0+/, ""), "norm");
async function tradeList(env, ctx) {
  const headers = { accept: "application/json", "accept-language": "he-IL", apikey: env.TASE_DATAWISE_KEY };
  for (let d = 0; d <= 7; d++) {
    const dt = new Date(Date.now() - d * 864e5);
    const path = `/v1/basic-securities/trade-securities-list/${dt.getUTCFullYear()}/${String(dt.getUTCMonth() + 1).padStart(2, "0")}/${String(dt.getUTCDate()).padStart(2, "0")}`;
    const key = new Request(BASE + path);
    const cache2 = typeof caches !== "undefined" ? caches.default : null;
    let list = null;
    const hit = cache2 && await cache2.match(key);
    if (hit)
      list = await hit.json();
    else {
      const res = await fetch(BASE + path, { headers });
      if (!res.ok)
        continue;
      list = (await res.json())?.tradeSecuritiesList?.result || [];
      if (list.length && cache2) {
        const slim = list.filter((r) => BOND_PREFIXES.includes(String(r.securityFullTypeCode || "").slice(0, 2))).map((r) => ({ securityId: r.securityId, securityName: r.securityName, symbol: r.symbol, corporateId: r.corporateId, securityFullTypeCode: r.securityFullTypeCode }));
        ctx?.waitUntil(cache2.put(key, new Response(JSON.stringify(slim), { headers: { "Cache-Control": "max-age=900", "Content-Type": "application/json" } })));
        list = slim;
      }
    }
    if (list.length)
      return { list, date: dt.toISOString().slice(0, 10) };
  }
  return { list: [], date: "" };
}
__name(tradeList, "tradeList");
async function onRequestGet6({ request, env, waitUntil }) {
  if (!await checkAdmin(request, env))
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!env.TASE_DATAWISE_KEY)
    return Response.json({ ok: false, error: "no_key", message: "\u05DC\u05D0 \u05D4\u05D5\u05D2\u05D3\u05E8 TASE_DATAWISE_KEY \u05D1-Cloudflare Pages" });
  const chp = norm(new URL(request.url).searchParams.get("chp"));
  if (!chp)
    return Response.json({ ok: false, error: "missing chp" }, { status: 400 });
  try {
    const { list, date } = await tradeList(env, { waitUntil });
    const rows = list.filter((r) => norm(r.corporateId) === chp && BOND_PREFIXES.includes(String(r.securityFullTypeCode || "").slice(0, 2))).map((r) => ({ security_id: Number(r.securityId), name: String(r.securityName || "").trim(), symbol: r.symbol || "" }));
    return Response.json({ ok: true, date, rows });
  } catch (e) {
    return Response.json({ ok: false, error: e.message }, { status: 502 });
  }
}
__name(onRequestGet6, "onRequestGet");

// api/debug-tase.js
var TASE_API = "https://datawise.tase.co.il";
var TASE_KEY = "OpB1TDhiRrF5kbQtjx75Qgcm6Csh31to";
var BOND_TYPES = ["03", "05", "11", "36"];
async function onRequestGet7({ request, env }) {
  const auth = (request.headers.get("Authorization") || "").replace("Bearer ", "").trim();
  if (!await checkPassword(auth, env)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  let taseRaw = null, taseError = null;
  for (let d = 0; d <= 7; d++) {
    const dt = /* @__PURE__ */ new Date();
    dt.setDate(dt.getDate() - d);
    const year = dt.getFullYear();
    const month = String(dt.getMonth() + 1).padStart(2, "0");
    const day = String(dt.getDate()).padStart(2, "0");
    try {
      const res = await fetch(
        `${TASE_API}/v1/basic-securities/trade-securities-list/${year}/${month}/${day}`,
        { headers: { accept: "application/json", "accept-language": "he-IL", apikey: TASE_KEY } }
      );
      const json2 = await res.json();
      const list = json2?.tradeSecuritiesList?.result;
      if (list?.length) {
        taseRaw = list;
        break;
      }
    } catch (e) {
      taseError = e.message;
    }
  }
  if (!taseRaw) {
    return Response.json({ error: "No TASE data", taseError });
  }
  const bonds = taseRaw.filter(
    (s) => BOND_TYPES.includes(String(s.securityFullTypeCode || "").slice(0, 2))
  );
  const sample = bonds.slice(0, 10).map((s) => ({
    securityId: s.securityId,
    securityFullTypeCode: s.securityFullTypeCode,
    corporateId: s.corporateId,
    corporateId_type: typeof s.corporateId,
    issuerId: s.issuerId,
    issuerId_type: typeof s.issuerId
  }));
  const { results: dbRows } = await env.DB.prepare(
    "SELECT id, chp_number FROM businesses WHERE chp_number != '' LIMIT 20"
  ).all();
  const corpIds = new Set(bonds.map((s) => String(s.corporateId || "").trim()).filter(Boolean));
  const issuerIds = new Set(bonds.map((s) => String(s.issuerId || "").trim()).filter(Boolean));
  const matchResults = dbRows.map((b) => {
    const chp = String(b.chp_number).trim();
    return {
      chp_number: chp,
      match_corporateId: corpIds.has(chp),
      match_issuerId: issuerIds.has(chp)
    };
  });
  return Response.json({
    totalSecurities: taseRaw.length,
    totalBonds: bonds.length,
    uniqueCorporateIds: corpIds.size,
    sampleBondRecords: sample,
    dbSample: matchResults
  }, { headers: { "Content-Type": "application/json" } });
}
__name(onRequestGet7, "onRequestGet");

// api/lists.js
var CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};
var json = /* @__PURE__ */ __name((data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" }
}), "json");
var normName = /* @__PURE__ */ __name((s) => String(s || "").toLowerCase().replace(/בע"?מ|בע״מ|בע''מ|\bltd\b|\blimited\b/g, "").replace(/[^0-9a-z\u0590-\u05ff]/g, ""), "normName");
var sameName = /* @__PURE__ */ __name((a, b) => {
  const x = normName(a), y = normName(b);
  if (x === y)
    return true;
  const [s, l] = x.length <= y.length ? [x, y] : [y, x];
  return s.length >= 20 && l.startsWith(s);
}, "sameName");
async function loadOfferings(request, env) {
  try {
    const url = new URL("/data/bonds_list/offerings.json", request.url);
    const res = await (env.ASSETS ? env.ASSETS.fetch(url) : fetch(url));
    if (!res.ok)
      return { byChp: /* @__PURE__ */ new Map(), byName: [] };
    const d = await res.json();
    const byChp = /* @__PURE__ */ new Map(), byName = [];
    const add = /* @__PURE__ */ __name((chp, name, kind) => {
      if (chp) {
        const k = String(chp);
        if (byChp.get(k) !== "open")
          byChp.set(k, kind);
      } else if (name)
        byName.push({ name, kind });
    }, "add");
    for (const o of d.open || [])
      add(o.chp_number, o.issuer_name, "open");
    for (const o of d.upcoming || [])
      add(o.chp_number, o.company_name, "upcoming");
    return { byChp, byName };
  } catch {
    return { byChp: /* @__PURE__ */ new Map(), byName: [] };
  }
}
__name(loadOfferings, "loadOfferings");
var nameWords = /* @__PURE__ */ __name((n) => String(n || "").toLowerCase().replace(/בע"?מ|בע״מ|בע''מ/g, " ").split(/\s+/).map((w) => w.replace(/[^0-9a-z\u0590-\u05ff]/g, "")).filter(Boolean), "nameWords");
var startsWithWords = /* @__PURE__ */ __name((full, short) => {
  const f = nameWords(full), w = short;
  return w.length > 0 && f.length >= w.length && w.every((v, i) => f[i] === v);
}, "startsWithWords");
function withRegistrarNames(rows, offerings = { byChp: /* @__PURE__ */ new Map(), byName: [] }) {
  const byRow = /* @__PURE__ */ new Map();
  for (const o of offerings.byName) {
    const w = nameWords(o.name);
    const hit = rows.filter((r) => startsWithWords(r._registrar, w) || startsWithWords(r.permit_name, w));
    if (hit.length === 1) {
      const cur = byRow.get(hit[0]);
      if (cur !== "open")
        byRow.set(hit[0], o.kind);
    }
  }
  const out = rows.map((r) => {
    const { _registrar, _bonds_note_all, ...rest } = r;
    const off = rest.bonds_status === '\u05D0\u05D9\u05DF \u05D0\u05D2"\u05D7' ? offerings.byChp.get(String(rest.chp_number || "").trim()) || byRow.get(r) : "";
    if (off) {
      rest.bonds_status = off === "open" ? '\u05D9\u05E9 \u05D0\u05D2"\u05D7 \u05D1\u05D4\u05E0\u05E4\u05E7\u05D4' : '\u05D9\u05E9 \u05D0\u05D2"\u05D7 \u05D1\u05D4\u05E0\u05E4\u05E7\u05D4 \u05E2\u05EA\u05D9\u05D3\u05D9\u05EA';
      rest.bonds_note = _bonds_note_all || "";
    }
    const reg = String(_registrar || "").replace(/\s+/g, " ").trim();
    const permit = String(r.permit_name || "").replace(/\s+/g, " ").trim();
    let name = permit;
    if (reg)
      name = !permit || sameName(reg, permit) ? reg : `${reg} (${permit})`;
    return { ...rest, permit_name: name };
  });
  return out.sort((a, b) => a.permit_name.localeCompare(b.permit_name, "he"));
}
__name(withRegistrarNames, "withRegistrarNames");
function toCsv(rows) {
  if (!rows.length)
    return "\uFEFF";
  const cols = Object.keys(rows[0]);
  const esc = /* @__PURE__ */ __name((v) => {
    const s = v == null ? "" : String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }, "esc");
  const lines = [cols.join(",")];
  for (const r of rows)
    lines.push(cols.map((c) => esc(r[c])).join(","));
  return "\uFEFF" + lines.join("\r\n");
}
__name(toCsv, "toCsv");
var csvResponse = /* @__PURE__ */ __name((rows, name) => new Response(toCsv(rows), {
  status: 200,
  headers: {
    ...CORS,
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="${name}.csv"`
  }
}), "csvResponse");
async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}
__name(onRequestOptions, "onRequestOptions");
async function onRequestGet8(context) {
  const { request, env } = context;
  const params = new URL(request.url).searchParams;
  const type = params.get("type") || "";
  const format = (params.get("format") || "").toLowerCase();
  try {
    let sql, sqlVariants = [];
    if (type === "companies-private" || type === "companies-general") {
      const isPrivate = type === "companies-private";
      const approvedCond = isPrivate ? "agch_approved IN ('\u05DB\u05DF','\u05E8\u05E7 \u05E4\u05E8\u05D8\u05D9')" : "agch_approved IN ('\u05DB\u05DF','\u05E8\u05E7 \u05DB\u05DC\u05DC\u05D9')";
      const selective = `agch_approved = '\u05D1\u05D7\u05D9\u05E8\u05EA \u05D0\u05D2"\u05D7 \u05DE\u05E1\u05D5\u05D9\u05DE\u05D9\u05DD'`;
      const hasBonds = `COALESCE(tase_has_agch,'') = '\u05D9\u05E9'`;
      const approvedExpr = `CASE WHEN ${hasBonds} AND (${approvedCond} OR ${selective}) THEN 1 ELSE 0 END`;
      const bondsStatusExpr = `CASE WHEN NOT (${hasBonds}) THEN '\u05D0\u05D9\u05DF \u05D0\u05D2"\u05D7'
                                    WHEN ${approvedCond} OR ${selective} THEN '\u05D9\u05E9 \u05D0\u05D2"\u05D7 - \u05DE\u05D0\u05D5\u05E9\u05E8'
                                    ELSE '\u05D9\u05E9 \u05D0\u05D2"\u05D7 - \u05DC\u05D0 \u05DE\u05D0\u05D5\u05E9\u05E8' END`;
      const hasPrivateExpr = `CASE WHEN COALESCE(visibility,'') IN ('\u05E4\u05E8\u05D8\u05D9','\u05E8\u05E7 \u05E4\u05E8\u05D8\u05D9') THEN '\u05DB\u05DF' ELSE '\u05DC\u05D0' END`;
      const onlyPrivateExplicit = `(COALESCE(visibility,'') = '\u05E8\u05E7 \u05E4\u05E8\u05D8\u05D9'
        OR ((COALESCE(notes,'') LIKE '%\u05E8\u05E7 \u05E4\u05E8\u05D8\u05D9%' OR COALESCE(notes,'') LIKE '%\u05E4\u05E8\u05D8\u05D9 \u05D1\u05DC\u05D1\u05D3%')
            AND COALESCE(notes,'') NOT LIKE '%\u05D0\u05D2"\u05D7%' AND COALESCE(notes,'') NOT LIKE '%\u05D0\u05D2\u05D7%'))`;
      const isBondNote = `(COALESCE(notes,'') LIKE '%\u05D0\u05D2"\u05D7%' OR COALESCE(notes,'') LIKE '%\u05D0\u05D2\u05D7%')`;
      const bondsNoteExprBase = `CASE WHEN ${isBondNote} THEN TRIM(REPLACE(notes, char(160), ' ')) ELSE '' END`;
      const notesExprBase = `CASE WHEN ${isBondNote} THEN '' ELSE TRIM(REPLACE(COALESCE(notes,''), char(160), ' ')) END`;
      const whereClause = isPrivate ? "COALESCE(visibility,'') IN ('\u05E4\u05E8\u05D8\u05D9','\u05E8\u05E7 \u05E4\u05E8\u05D8\u05D9')" : `NOT ${onlyPrivateExplicit}`;
      const build = /* @__PURE__ */ __name((withStatus, withScope) => {
        const hideNote = withScope ? `COALESCE(notes_scope,'') = 'bonds'` : `0`;
        const bondsNoteAll = `CASE WHEN ${hideNote} THEN '' ELSE ${bondsNoteExprBase} END`;
        const bondsNoteExpr = `CASE WHEN ${hideNote} OR NOT (${hasBonds}) THEN '' ELSE ${bondsNoteExprBase} END`;
        const notesExpr = `CASE WHEN ${hideNote} THEN '' ELSE ${notesExprBase} END`;
        const liquidated = withStatus ? `AND COALESCE(registry_status,'') NOT LIKE '\u05DE\u05D7\u05D5\u05E1\u05DC%' AND COALESCE(registry_status,'') NOT LIKE '\u05D7\u05D9\u05E1\u05D5\u05DC%' AND COALESCE(registry_status,'') NOT LIKE '\u05DE\u05D7\u05D5\u05E7%' AND COALESCE(registry_status,'') NOT LIKE '\u05E0\u05D2\u05E8\u05E2%'` : "";
        const notesOut = withStatus ? `CASE WHEN COALESCE(registry_status,'') LIKE '\u05D1\u05E4\u05E8\u05D5\u05E7%'
                  THEN '\u05D1\u05E4\u05D9\u05E8\u05D5\u05E7' || CASE WHEN ${notesExpr} != '' THEN '; ' || ${notesExpr} ELSE '' END
                  ELSE ${notesExpr} END` : notesExpr;
        return `
        SELECT permit_name, registrar_name AS _registrar, chp_number, category, region,
               ${hasPrivateExpr} AS has_private_permit,
               ${approvedExpr} AS approved,
               ${bondsStatusExpr} AS bonds_status,
               ${bondsNoteExpr} AS bonds_note,
               ${bondsNoteAll} AS _bonds_note_all,
               ${notesOut} AS notes
        FROM businesses
        WHERE ${whereClause} ${liquidated}
        ORDER BY permit_name`;
      }, "build");
      sql = build(true, true);
      sqlVariants = [build(true, false), build(false, true), build(false, false)];
    } else if (type === "companies-all") {
      sql = `SELECT * FROM businesses ORDER BY permit_name`;
    } else if (type.startsWith("bonds-")) {
      return json({
        ok: false,
        error: "moved",
        type,
        message: '\u05E8\u05E9\u05D9\u05DE\u05EA \u05D4\u05D0\u05D2"\u05D7 \u05D4\u05D9\u05D0 \u05E7\u05D1\u05E6\u05D9\u05DD \u05E1\u05D8\u05D8\u05D9\u05D9\u05DD: /data/bonds_list/bonds_private|bonds_general|bonds_all (.json / .csv)'
      }, 410);
    } else {
      return json({ ok: false, error: "unknown_type", type }, 400);
    }
    let results;
    const missingCol = /* @__PURE__ */ __name((e) => /no such column: (registry_status|notes_scope)/i.test(String(e.message)), "missingCol");
    try {
      ({ results } = await env.DB.prepare(sql).all());
    } catch (e) {
      if (!sqlVariants.length || !missingCol(e))
        throw e;
      let last = e;
      for (const v of sqlVariants) {
        try {
          ({ results } = await env.DB.prepare(v).all());
          last = null;
          break;
        } catch (e2) {
          if (!missingCol(e2))
            throw e2;
          last = e2;
        }
      }
      if (last)
        throw last;
    }
    if (type === "companies-private" || type === "companies-general")
      results = withRegistrarNames(results, await loadOfferings(request, env));
    if (format === "csv") {
      return csvResponse(results, type);
    }
    return json({ ok: true, type, count: results.length, rows: results });
  } catch (e) {
    return json({ ok: false, error: e.message, type }, 500);
  }
}
__name(onRequestGet8, "onRequestGet");

// api/login.js
async function onRequestGet9({ request, env }) {
  return Response.json({ trusted: await isTrustedDevice(request, env) }, { headers: { "Cache-Control": "no-store" } });
}
__name(onRequestGet9, "onRequestGet");
async function onRequestPost3({ request, env }) {
  let b;
  try {
    b = await request.json();
  } catch {
    b = {};
  }
  if (!await checkPassword(b.password, env))
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  const cookie = await registerDevice(request, env);
  return new Response(JSON.stringify({ ok: true, registered: !!cookie }), { headers: { "Content-Type": "application/json", ...cookie ? { "Set-Cookie": cookie } : {} } });
}
__name(onRequestPost3, "onRequestPost");

// api/lookup.js
var SOURCES = [
  {
    entityType: "company",
    resource: "f004176c-b85f-4542-8901-7b3176f9a054",
    filterField: "\u05DE\u05E1\u05E4\u05E8 \u05D7\u05D1\u05E8\u05D4",
    nameField: "\u05E9\u05DD \u05D7\u05D1\u05E8\u05D4",
    typeField: "\u05E1\u05D5\u05D2 \u05EA\u05D0\u05D2\u05D9\u05D3",
    limField: "\u05DE\u05D2\u05D1\u05DC\u05D5\u05EA",
    statusField: "\u05E1\u05D8\u05D8\u05D5\u05E1 \u05D7\u05D1\u05E8\u05D4",
    classify(rec) {
      const typeRaw = String(rec["\u05E1\u05D5\u05D2 \u05EA\u05D0\u05D2\u05D9\u05D3"] || "").trim();
      const limRaw = String(rec["\u05DE\u05D2\u05D1\u05DC\u05D5\u05EA"] || "").trim();
      const isPublic = typeRaw.includes("\u05E6\u05D9\u05D1\u05D5\u05E8\u05D9\u05EA");
      const type = isPublic ? "\u05D7\u05D1\u05E8\u05D4 \u05E6\u05D9\u05D1\u05D5\u05E8\u05D9\u05EA" : "\u05D7\u05D1\u05E8\u05D4 \u05E4\u05E8\u05D8\u05D9\u05EA";
      const lim = limRaw.includes("\u05DC\u05D0 \u05DE\u05D5\u05D2\u05D1\u05DC\u05EA") ? "\u05DC\u05D0 \u05DE\u05D5\u05D2\u05D1\u05DC\u05EA" : '\u05D1\u05E2"\u05DE';
      return `${type} - ${lim}`;
    }
  },
  {
    entityType: "partnership",
    resource: "139aa193-fabb-4f6b-a71b-0bb40fd73eb2",
    filterField: "\u05DE\u05E1\u05E4\u05E8 \u05E9\u05D5\u05EA\u05E4\u05D5\u05EA",
    nameField: "\u05E9\u05DD \u05E9\u05D5\u05EA\u05E4\u05D5\u05EA",
    typeField: "\u05E1\u05D5\u05D2 \u05EA\u05D0\u05D2\u05D9\u05D3",
    statusField: "\u05E1\u05D8\u05D8\u05D5\u05E1 \u05EA\u05D0\u05D2\u05D9\u05D3",
    classify() {
      return '\u05E9\u05D5\u05EA\u05E4\u05D5\u05EA - \u05DC\u05D0 \u05D1\u05E2"\u05DE';
    }
  },
  {
    entityType: "association",
    resource: "be5b7935-3922-45d4-9638-08871b17ec95",
    filterField: "\u05DE\u05E1\u05E4\u05E8 \u05E2\u05DE\u05D5\u05EA\u05D4",
    nameField: "\u05E9\u05DD \u05E2\u05DE\u05D5\u05EA\u05D4 \u05D1\u05E2\u05D1\u05E8\u05D9\u05EA",
    typeField: "\u05E1\u05D9\u05D5\u05D5\u05D2 \u05E4\u05E2\u05D9\u05DC\u05D5\u05EA \u05E2\u05E0\u05E4\u05D9",
    statusField: "\u05E1\u05D8\u05D8\u05D5\u05E1 \u05E2\u05DE\u05D5\u05EA\u05D4",
    classify() {
      return "\u05E2\u05DE\u05D5\u05EA\u05D4 \u05E8\u05E9\u05D5\u05DE\u05D4";
    }
  }
];
function cleanName(name) {
  return (name || "").replace(/~/g, '"').replace(/שותפות מוגבלת/g, "").trim().replace(/[.,\-!?~"]+$/, "").trim();
}
__name(cleanName, "cleanName");
async function searchSource(source, number) {
  const filters = encodeURIComponent(JSON.stringify({ [source.filterField]: number }));
  const url = `https://data.gov.il/api/3/action/datastore_search?resource_id=${source.resource}&filters=${filters}&limit=1`;
  const res = await fetch(url, { headers: { "User-Agent": "Business-Registry/1.0" } });
  const json2 = await res.json();
  const rec = json2?.result?.records?.[0];
  if (!rec)
    return null;
  const name = cleanName(rec[source.nameField]);
  if (!name)
    return null;
  return {
    found: true,
    entityType: source.entityType,
    name,
    bizType: source.classify(rec),
    type: rec[source.typeField] || "",
    status: rec[source.statusField] || ""
  };
}
__name(searchSource, "searchSource");
async function searchRegistryDb(db, number) {
  if (!db || !/^\d{1,12}$/.test(number))
    return null;
  const id = Number(number);
  const [c, p, a] = await Promise.allSettled([
    db.prepare("SELECT name,status,corp_type,restrictions FROM companies WHERE id=? LIMIT 1").bind(id).first(),
    db.prepare("SELECT name,status,ptype FROM partnerships WHERE id=? LIMIT 1").bind(id).first(),
    db.prepare("SELECT name,status,category FROM associations WHERE id=? LIMIT 1").bind(id).first()
  ]);
  const row = /* @__PURE__ */ __name((x) => x.status === "fulfilled" && x.value && cleanName(x.value.name) ? x.value : null, "row");
  if (row(c)) {
    const r = c.value;
    const isPublic = String(r.corp_type || "").includes("\u05E6\u05D9\u05D1\u05D5\u05E8\u05D9\u05EA");
    const lim = String(r.restrictions || "").includes("\u05DC\u05D0 \u05DE\u05D5\u05D2\u05D1\u05DC\u05EA") ? "\u05DC\u05D0 \u05DE\u05D5\u05D2\u05D1\u05DC\u05EA" : '\u05D1\u05E2"\u05DE';
    return { found: true, entityType: "company", name: cleanName(r.name), bizType: `${isPublic ? "\u05D7\u05D1\u05E8\u05D4 \u05E6\u05D9\u05D1\u05D5\u05E8\u05D9\u05EA" : "\u05D7\u05D1\u05E8\u05D4 \u05E4\u05E8\u05D8\u05D9\u05EA"} - ${lim}`, type: r.corp_type || "", status: r.status || "" };
  }
  if (row(p))
    return { found: true, entityType: "partnership", name: cleanName(p.value.name), bizType: '\u05E9\u05D5\u05EA\u05E4\u05D5\u05EA - \u05DC\u05D0 \u05D1\u05E2"\u05DE', type: p.value.ptype || "", status: p.value.status || "" };
  if (row(a))
    return { found: true, entityType: "association", name: cleanName(a.value.name), bizType: "\u05E2\u05DE\u05D5\u05EA\u05D4 \u05E8\u05E9\u05D5\u05DE\u05D4", type: a.value.category || "", status: a.value.status || "" };
  return null;
}
__name(searchRegistryDb, "searchRegistryDb");
async function onRequestGet10({ request, env }) {
  const url = new URL(request.url);
  const number = (url.searchParams.get("number") || "").trim();
  if (!number) {
    return Response.json({ error: "Missing number parameter" }, { status: 400 });
  }
  try {
    const local = await searchRegistryDb(env && env.DB1, number).catch(() => null);
    if (local)
      return Response.json(local);
    const found = await new Promise((resolve) => {
      let pending = SOURCES.length;
      SOURCES.forEach((s) => searchSource(s, number).catch(() => null).then((r) => {
        if (r)
          resolve(r);
        else if (--pending === 0)
          resolve(null);
      }));
    });
    if (found)
      return Response.json(found);
    return Response.json({ found: false });
  } catch (e) {
    return Response.json({ error: "Failed to reach registrar: " + e.message }, { status: 502 });
  }
}
__name(onRequestGet10, "onRequestGet");

// api/permit-docs.js
var cleanJson = /* @__PURE__ */ __name((v) => {
  try {
    const t = String(v || "");
    if (!t)
      return "";
    JSON.parse(t);
    return t.length > 2e4 ? "" : t;
  } catch {
    return "";
  }
}, "cleanJson");
async function onRequestGet11({ request, env }) {
  if (!await checkAdmin(request, env))
    return noAuth();
  try {
    const url = new URL(request.url);
    const sha2 = (url.searchParams.get("sha") || "").toLowerCase();
    if (sha2) {
      const row = await env.DB.prepare("SELECT * FROM permit_docs WHERE sha256 = ?").bind(sha2).first();
      const doc = row ? (await withBusinesses(env, [row]))[0] : null;
      return Response.json({ exists: !!row, doc });
    }
    const res = await env.DB.prepare("SELECT * FROM permit_docs ORDER BY created_at DESC, id").all();
    return Response.json({ docs: await withBusinesses(env, res.results ?? []) });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
__name(onRequestGet11, "onRequestGet");
async function onRequestPost4({ request, env }) {
  if (!await checkAdmin(request, env))
    return noAuth();
  if (!env.PERMITS)
    return noStore();
  try {
    let form;
    if ((request.headers.get("Content-Type") || "").includes("application/json")) {
      const j = await request.json();
      form = new FormData();
      const bin = atob(String(j.file_b64 || ""));
      const u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++)
        u8[i] = bin.charCodeAt(i);
      form.set("file", new File([u8], String(j.name || "permit.pdf"), { type: "application/pdf" }));
      for (const k of ["doc_type", "business_ids", "note", "source", "source_ref", "source_title", "suggest"])
        if (j[k] !== void 0)
          form.set(k, typeof j[k] === "string" ? j[k] : JSON.stringify(j[k]));
    } else
      form = await request.formData();
    const file = form.get("file");
    if (!file || typeof file === "string")
      return Response.json({ error: "\u05DC\u05D0 \u05E0\u05D1\u05D7\u05E8 \u05E7\u05D5\u05D1\u05E5" }, { status: 400 });
    if (file.size > MAX_BYTES)
      return Response.json({ error: "\u05D4\u05E7\u05D5\u05D1\u05E5 \u05D2\u05D3\u05D5\u05DC \u05DE\u05D3\u05D9 (\u05DE\u05E2\u05DC 50MB)" }, { status: 413 });
    const buf = await file.arrayBuffer();
    if (new TextDecoder().decode(buf.slice(0, 5)) !== "%PDF-")
      return Response.json({ error: "\u05E8\u05E7 \u05E7\u05D5\u05D1\u05E6\u05D9 PDF" }, { status: 400 });
    const sha2 = hex2(await crypto.subtle.digest("SHA-256", buf));
    const dup = await env.DB.prepare("SELECT * FROM permit_docs WHERE sha256 = ?").bind(sha2).first();
    if (dup)
      return Response.json({ error: "\u05E7\u05D5\u05D1\u05E5 \u05D6\u05D4\u05D4 \u05DB\u05D1\u05E8 \u05E7\u05D9\u05D9\u05DD \u05D1\u05DE\u05D0\u05D2\u05E8", duplicate: true, doc: (await withBusinesses(env, [dup]))[0] }, { status: 409 });
    const docType = TYPES.includes(form.get("doc_type")) ? form.get("doc_type") : "unknown";
    let bids = [];
    try {
      bids = JSON.parse(form.get("business_ids") || "[]");
    } catch {
      bids = String(form.get("business_ids") || "").split(",").filter(Boolean);
    }
    bids = await existingBusinessIds(env, bids);
    const id = newId(), key = `docs/${sha2}.pdf`;
    await env.PERMITS.put(key, buf, { httpMetadata: { contentType: "application/pdf" } });
    try {
      await env.DB.batch([
        env.DB.prepare("INSERT INTO permit_docs (id, sha256, file_key, original_name, size, doc_type, note, source, source_ref, source_title, suggest) VALUES (?,?,?,?,?,?,?,?,?,?,?)").bind(
          id,
          sha2,
          key,
          String(file.name || "").slice(0, 300),
          buf.byteLength,
          docType,
          String(form.get("note") || ""),
          String(form.get("source") || "upload"),
          String(form.get("source_ref") || ""),
          String(form.get("source_title") || "").slice(0, 500),
          cleanJson(form.get("suggest"))
        ),
        ...bids.map((b) => env.DB.prepare("INSERT OR IGNORE INTO permit_doc_companies (doc_id, business_id) VALUES (?, ?)").bind(id, b))
      ]);
    } catch (e) {
      await env.PERMITS.delete(key).catch(() => {
      });
      throw e;
    }
    const row = await env.DB.prepare("SELECT * FROM permit_docs WHERE id = ?").bind(id).first();
    return Response.json({ success: true, doc: (await withBusinesses(env, [row]))[0] });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
__name(onRequestPost4, "onRequestPost");

// api/permit-docs-public.js
var CORS2 = { "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=300" };
async function onRequestGet12({ env }) {
  try {
    const res = await env.DB.prepare(`
      SELECT c.doc_id, c.slot, b.chp_number, b.permit_name, b.registrar_name
      FROM permit_doc_companies c
      JOIN businesses b ON b.id = c.business_id
      JOIN permit_docs d ON d.id = c.doc_id
      WHERE c.slot != '' AND d.doc_type != 'other'`).all();
    const by = /* @__PURE__ */ new Map();
    for (const r of res.results ?? []) {
      const k = r.chp_number || "n:" + (r.permit_name || r.registrar_name);
      const e = by.get(k) || { chp: r.chp_number || "", name: r.permit_name || r.registrar_name || "" };
      for (const s of String(r.slot).split(","))
        if (s === "general" || s === "private")
          e[s] = r.doc_id;
      by.set(k, e);
    }
    try {
      const q = /* @__PURE__ */ __name((cols) => env.DB.prepare(`
        SELECT s.doc_id, s.title, ${cols} b.chp_number, b.permit_name, b.registrar_name
        FROM permit_doc_special s
        JOIN businesses b ON b.id = s.business_id
        JOIN permit_docs d ON d.id = s.doc_id
        WHERE d.doc_type != 'other' ORDER BY s.created_at, s.title`).all(), "q");
      const sp = await q("s.detail,").catch(() => q(""));
      for (const r of sp.results ?? []) {
        const k = r.chp_number || "n:" + (r.permit_name || r.registrar_name);
        const e = by.get(k) || { chp: r.chp_number || "", name: r.permit_name || r.registrar_name || "" };
        (e.specials = e.specials || []).push({ id: r.doc_id, title: r.title, detail: r.detail || "" });
        by.set(k, e);
      }
    } catch {
    }
    try {
      const bd = await env.DB.prepare(`
        SELECT x.doc_id, x.name AS bname, x.symbol, d.doc_type, b.chp_number, b.permit_name, b.registrar_name
        FROM permit_doc_bonds x
        JOIN permit_docs d ON d.id = x.doc_id
        JOIN permit_doc_companies c ON c.doc_id = d.id
        JOIN businesses b ON b.id = c.business_id
        WHERE d.doc_type != 'other' AND c.slot = '' AND (x.chp = '' OR x.chp = b.chp_number)`).all();
      const series = /* @__PURE__ */ __name((n) => {
        const m = String(n || "").replace(/["'׳״`]/g, "").replace(/\s+/g, " ").match(/אגח\s*([א-ת]{1,3}|\d{1,2})(?:\s|$)/);
        return m ? /^\d/.test(m[1]) ? m[1] : m[1].length === 1 ? m[1] + "'" : m[1].slice(0, -1) + '"' + m[1].slice(-1) : "";
      }, "series");
      const g = /* @__PURE__ */ new Map();
      for (const r of bd.results ?? []) {
        const k = (r.chp_number || "n:" + (r.permit_name || r.registrar_name)) + "|" + r.doc_id;
        const e = g.get(k) || { key: r.chp_number || "n:" + (r.permit_name || r.registrar_name), chp: r.chp_number || "", name: r.permit_name || r.registrar_name || "", id: r.doc_id, list: r.doc_type === "general" ? "general" : "private", ser: [], other: [] };
        const s = series(r.bname);
        if (s) {
          if (!e.ser.includes(s))
            e.ser.push(s);
        } else
          e.other.push(r.symbol || r.bname);
        g.set(k, e);
      }
      for (const e of g.values()) {
        const en = by.get(e.key) || { chp: e.chp, name: e.name };
        (en.bond_docs = en.bond_docs || []).push({ id: e.id, list: e.list, label: '\u05D0\u05D2"\u05D7 ' + [...e.ser, ...e.other].join(" \u05D5-") });
        by.set(e.key, en);
      }
    } catch {
    }
    return Response.json({ links: [...by.values()] }, { headers: CORS2 });
  } catch (e) {
    return Response.json({ links: [], error: "unavailable" }, { headers: { "Access-Control-Allow-Origin": "*" } });
  }
}
__name(onRequestGet12, "onRequestGet");

// api/permit-ext.js
var STATUSES2 = ["deleted", "merged", "not_in_db"];
var norm2 = /* @__PURE__ */ __name((s) => String(s || "").trim(), "norm");
async function onRequestGet13({ request, env }) {
  if (!await checkAdmin(request, env))
    return noAuth();
  try {
    const rows = (await env.DB.prepare("SELECT * FROM permit_ext_companies ORDER BY name").all()).results ?? [];
    const links = (await env.DB.prepare("SELECT doc_id, ext_id FROM permit_doc_ext").all()).results ?? [];
    const by = new Map(rows.map((r) => [r.id, []]));
    for (const l of links)
      if (by.has(l.ext_id))
        by.get(l.ext_id).push(l.doc_id);
    return Response.json({ companies: rows.map((r) => ({ ...r, doc_ids: by.get(r.id) })) });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
__name(onRequestGet13, "onRequestGet");
async function onRequestPost5({ request, env }) {
  if (!await checkAdmin(request, env))
    return noAuth();
  try {
    const b = await request.json();
    const chp = norm2(b.chp).replace(/\D/g, ""), name = norm2(b.name).slice(0, 300);
    if (!name && !chp)
      return Response.json({ error: "\u05D7\u05E1\u05E8 \u05E9\u05DD \u05D0\u05D5 \u05D7.\u05E4." }, { status: 400 });
    const status = STATUSES2.includes(b.status) ? b.status : "not_in_db";
    let row = chp ? await env.DB.prepare("SELECT * FROM permit_ext_companies WHERE chp = ?").bind(chp).first() : await env.DB.prepare("SELECT * FROM permit_ext_companies WHERE chp = '' AND name = ?").bind(name).first();
    if (row) {
      if (b.status && STATUSES2.includes(b.status) && b.status !== row.status)
        await env.DB.prepare("UPDATE permit_ext_companies SET status = ?, updated_at = datetime('now') WHERE id = ?").bind(status, row.id).run();
      row = await env.DB.prepare("SELECT * FROM permit_ext_companies WHERE id = ?").bind(row.id).first();
      return Response.json({ company: { ...row, doc_ids: [] }, existed: true });
    }
    const id = newId();
    await env.DB.prepare("INSERT INTO permit_ext_companies (id, chp, name, status, note) VALUES (?,?,?,?,?)").bind(id, chp, name || chp, status, norm2(b.note).slice(0, 500)).run();
    const fresh = await env.DB.prepare("SELECT * FROM permit_ext_companies WHERE id = ?").bind(id).first();
    return Response.json({ company: { ...fresh, doc_ids: [] }, existed: false });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
__name(onRequestPost5, "onRequestPost");

// api/permit-review.js
async function onRequestGet14({ request, env }) {
  if (!await checkAdmin(request, env))
    return noAuth();
  try {
    return Response.json({ items: (await env.DB.prepare("SELECT key, status, note, updated_at FROM permit_review ORDER BY updated_at DESC").all()).results ?? [] });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
__name(onRequestGet14, "onRequestGet");
async function onRequestPut5({ request, env }) {
  if (!await checkAdmin(request, env))
    return noAuth();
  try {
    const b = await request.json();
    const key = String(b.key || "").trim().slice(0, 200), status = String(b.status || "");
    if (!key)
      return Response.json({ error: "\u05D7\u05E1\u05E8 \u05DE\u05E4\u05EA\u05D7" }, { status: 400 });
    if (!status) {
      await env.DB.prepare("DELETE FROM permit_review WHERE key = ?").bind(key).run();
      return Response.json({ ok: true });
    }
    if (!["approved", "question", "answered"].includes(status))
      return Response.json({ error: "\u05E1\u05D8\u05D8\u05D5\u05E1 \u05DC\u05D0 \u05D7\u05D5\u05E7\u05D9" }, { status: 400 });
    const note = String(b.note || "").slice(0, 500);
    await env.DB.prepare("INSERT INTO permit_review (key, status, note) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET status = excluded.status, note = excluded.note, updated_at = datetime('now')").bind(key, status, note).run();
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
__name(onRequestPut5, "onRequestPut");

// api/_shared/voice-match.js
var MAX_RESULTS = 5;
var LEGAL_SUFFIX = /* @__PURE__ */ new Set(["\u05D1\u05E2\u05DE", "\u05D1\u05E2", "\u05DE", "\u05E2", "\u05E8", "\u05E2\u05DE\u05D5\u05EA\u05D4", "\u05D7\u05D1\u05E8\u05D4", "\u05DC\u05D9\u05DE\u05D9\u05D8\u05D3"]);
var PREFIXES = "\u05D4\u05D5\u05D1\u05DC\u05DE\u05DB\u05E9";
var FOLD = {
  "\u05DA": "\u05DB",
  "\u05DD": "\u05DE",
  "\u05DF": "\u05E0",
  "\u05E3": "\u05E4",
  "\u05E5": "\u05E6",
  "\u05E7": "\u05DB",
  "\u05D7": "\u05DB",
  "\u05D8": "\u05EA",
  "\u05E1": "\u05E9",
  "\u05E2": "\u05D0"
};
function normalize(s) {
  if (!s)
    return "";
  s = String(s).replace(/[֑-ׇ]/g, "");
  s = s.replace(/\([^)]*\)/g, " ");
  s = s.replace(/["'״׳“”‘’\-־`]/g, "");
  s = s.replace(/[^א-ת0-9A-Za-z ]/g, " ");
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}
__name(normalize, "normalize");
function fold(s) {
  let out = "";
  for (const ch of s)
    out += FOLD[ch] || ch;
  return out;
}
__name(fold, "fold");
function tokens(s) {
  return normalize(s).split(" ").filter((w) => w && !LEGAL_SUFFIX.has(w)).map(fold);
}
__name(tokens, "tokens");
function skeleton(w) {
  const k = w.replace(/[וי]/g, "");
  return k || w;
}
__name(skeleton, "skeleton");
function wordForms(w) {
  const forms = [w];
  if (w.length >= 3 && PREFIXES.includes(w[0]))
    forms.push(w.slice(1));
  return forms;
}
__name(wordForms, "wordForms");
function wordInName(forms, nameTokens, nameJoined) {
  for (const f of forms) {
    if (f.length <= 2) {
      if (nameTokens.includes(f))
        return true;
    } else if (nameJoined.includes(f)) {
      return true;
    }
  }
  return false;
}
__name(wordInName, "wordInName");
function scoreName(qTokens, nameTokens, qJoined, nameJoined) {
  if (qJoined === nameJoined)
    return 100;
  const extra = Math.max(0, nameTokens.length - qTokens.length);
  const wholeWords = qTokens.filter((w) => nameTokens.includes(w)).length;
  let score = 50 + wholeWords * 8 - extra * 6;
  if (nameJoined.startsWith(qJoined))
    score += 15;
  return score;
}
__name(scoreName, "scoreName");
function searchBusinesses(query, rows, limit = MAX_RESULTS) {
  const qTokens = tokens(query);
  if (!qTokens.length)
    return { mode: "empty", total: 0, results: [], ambiguous: false };
  const qJoined = qTokens.join(" ");
  const qForms = qTokens.map(wordForms);
  const qSkelForms = qTokens.map((w) => wordForms(skeleton(w)).map(skeleton));
  const prepared = [];
  for (const r of rows) {
    const names = [r.registrar_name, r.permit_name].filter(Boolean);
    const seen = /* @__PURE__ */ new Set();
    for (const n of names) {
      const nt = tokens(n);
      if (!nt.length)
        continue;
      const nj = nt.join(" ");
      if (seen.has(nj))
        continue;
      seen.add(nj);
      const ns = nt.map(skeleton);
      prepared.push({ row: r, name: n, nt, nj, ns, nsj: ns.join(" ") });
    }
  }
  const collect = /* @__PURE__ */ __name((mode2, test) => {
    const best = /* @__PURE__ */ new Map();
    for (const p of prepared) {
      if (!test(p))
        continue;
      const score = scoreName(qTokens, p.nt, qJoined, p.nj) - (mode2 === "near" ? 20 : 0);
      const prev = best.get(p.row.id);
      if (!prev || score > prev.score)
        best.set(p.row.id, { score, p });
    }
    return [...best.values()].sort((a, b) => b.score - a.score || a.p.nj.length - b.p.nj.length);
  }, "collect");
  let mode = "all-words";
  let hits = collect(mode, (p) => qForms.every((f) => wordInName(f, p.nt, p.nj)));
  if (!hits.length) {
    mode = "near";
    hits = collect(mode, (p) => qSkelForms.every((f) => wordInName(f, p.ns, p.nsj)));
  }
  const results = hits.slice(0, limit).map(({ score, p }) => ({
    id: p.row.id,
    chp_number: p.row.chp_number || "",
    name: p.row.registrar_name || p.row.permit_name || p.name,
    score
  }));
  const ambiguous = results.length > 1 && results[0].score - results[1].score < 10;
  return { mode: hits.length ? mode : "none", total: hits.length, results, ambiguous };
}
__name(searchBusinesses, "searchBusinesses");

// api/_shared/registry-search.js
var MAX_LIST = 8;
var FETCH_LIMIT = 30;
var MAX_VARIANTS = 10;
var SWAP = { "\u05E7": "\u05DB", "\u05DB": "\u05E7", "\u05D7": "\u05DB", "\u05D8": "\u05EA", "\u05EA": "\u05D8", "\u05E1": "\u05E9", "\u05E9": "\u05E1", "\u05E2": "\u05D0", "\u05D0": "\u05E2" };
var PREFIXES2 = "\u05D4\u05D5\u05D1\u05DC\u05DE\u05DB\u05E9";
var DEFUNCT = /מחוק|נמחק|מבוטל|פירוק|מפורק|מחוסל|חוסל|חיסול/;
var ftsPhrase = /* @__PURE__ */ __name((w) => `"${w.replace(/"/g, '""')}"`, "ftsPhrase");
var digitsOnly = /* @__PURE__ */ __name((s) => String(s || "").replace(/\D/g, ""), "digitsOnly");
function variantSets(words) {
  const base = words.filter((w) => w.length >= 3);
  if (!base.length)
    return { tier1: [], tier2: [] };
  const tier1 = [base];
  const stripped = base.map((w) => w.length >= 4 && PREFIXES2.includes(w[0]) ? w.slice(1) : w);
  if (stripped.some((w, i) => w !== base[i]))
    tier1.push(stripped);
  const tier2 = [];
  const seen = new Set(tier1.map((v) => v.join(" ")));
  for (let i = 0; i < base.length && tier2.length < MAX_VARIANTS; i++) {
    for (let p = 0; p < base[i].length && tier2.length < MAX_VARIANTS; p++) {
      const alt = SWAP[base[i][p]];
      if (!alt)
        continue;
      const w = base[i].slice(0, p) + alt + base[i].slice(p + 1);
      const v = base.map((x, j) => j === i ? w : x);
      const key = v.join(" ");
      if (!seen.has(key)) {
        seen.add(key);
        tier2.push(v);
      }
    }
  }
  return { tier1, tier2 };
}
__name(variantSets, "variantSets");
function ftsStatements(db, variant, shorts = []) {
  const expr = variant.map(ftsPhrase).join(" AND ");
  const like = shorts.map(() => " AND c.name_norm LIKE ?").join("");
  const args = [expr, ...shorts.map((w) => `%${w}%`)];
  const q = /* @__PURE__ */ __name((tbl, sub) => `SELECT c.id,c.name,c.status,c.${sub} AS sub FROM ${tbl}_fts f JOIN ${tbl} c ON c.id=f.id WHERE ${tbl}_fts MATCH ?${like} LIMIT ${FETCH_LIMIT}`, "q");
  return [
    db.prepare(q("companies", "corp_type")).bind(...args),
    db.prepare(q("partnerships", "ptype")).bind(...args),
    db.prepare(q("associations", "category")).bind(...args)
  ];
}
__name(ftsStatements, "ftsStatements");
var KINDS = ["company", "partnership", "association"];
async function fetchVariants(db, variants, shorts) {
  const stmts = variants.flatMap((v) => ftsStatements(db, v, shorts));
  const out = await db.batch(stmts);
  const rows = /* @__PURE__ */ new Map();
  let truncated = false;
  out.forEach((res, i) => {
    const list = res.results || [];
    if (list.length >= FETCH_LIMIT)
      truncated = true;
    for (const r of list)
      rows.set(`${KINDS[i % 3]}:${r.id}`, { kind: KINDS[i % 3], ...r });
  });
  return { rows: [...rows.values()], truncated };
}
__name(fetchVariants, "fetchVariants");
async function registryCandidates(db, query) {
  const words = normalize(query).split(" ").filter(Boolean);
  const { tier1, tier2 } = variantSets(words);
  if (!tier1.length)
    return { rows: [], truncated: false };
  const shorts = words.filter((w) => w.length < 3);
  let got = await fetchVariants(db, tier1, shorts);
  if (!got.rows.length && tier2.length)
    got = await fetchVariants(db, tier2, shorts);
  return got;
}
__name(registryCandidates, "registryCandidates");
function permitIndex(businesses) {
  const byChp = /* @__PURE__ */ new Map(), byName = /* @__PURE__ */ new Map();
  const put = /* @__PURE__ */ __name((map, key, vis) => {
    if (!key)
      return;
    const kind = vis === "\u05E8\u05E7 \u05E4\u05E8\u05D8\u05D9" ? "\u05E8\u05E7 \u05E4\u05E8\u05D8\u05D9" : vis === "\u05E4\u05E8\u05D8\u05D9" ? "\u05DB\u05DC\u05DC\u05D9+\u05E4\u05E8\u05D8\u05D9" : "\u05DB\u05DC\u05DC\u05D9";
    const prev = map.get(key);
    const rank = { "\u05E8\u05E7 \u05E4\u05E8\u05D8\u05D9": 0, "\u05DB\u05DC\u05DC\u05D9": 1, "\u05DB\u05DC\u05DC\u05D9+\u05E4\u05E8\u05D8\u05D9": 2 };
    if (prev === void 0 || rank[kind] > rank[prev])
      map.set(key, kind);
  }, "put");
  for (const b of businesses) {
    put(byChp, digitsOnly(b.chp_number), b.visibility);
    put(byName, tokens(b.registrar_name || b.permit_name || "").join(" "), b.visibility);
  }
  return (item) => byChp.get(digitsOnly(item.id)) || byName.get(tokens(item.name).join(" ")) || null;
}
__name(permitIndex, "permitIndex");
function typeLabel(item) {
  const s = String(item.sub || "");
  let label;
  if (item.kind === "partnership")
    label = /מוגבלת/.test(s) ? "\u05E9\u05D5\u05EA\u05E4\u05D5\u05EA \u05DE\u05D5\u05D2\u05D1\u05DC\u05EA" : /כללית/.test(s) ? "\u05E9\u05D5\u05EA\u05E4\u05D5\u05EA \u05DB\u05DC\u05DC\u05D9\u05EA" : "\u05E9\u05D5\u05EA\u05E4\u05D5\u05EA";
  else if (item.kind === "association")
    label = "\u05E2\u05DE\u05D5\u05EA\u05D4";
  else
    label = /ציבורי/.test(s) ? "\u05D7\u05D1\u05E8\u05D4 \u05E6\u05D9\u05D1\u05D5\u05E8\u05D9\u05EA" : /פרטי/.test(s) ? "\u05D7\u05D1\u05E8\u05D4 \u05E4\u05E8\u05D8\u05D9\u05EA" : "\u05D7\u05D1\u05E8\u05D4";
  return DEFUNCT.test(item.status || "") ? `${label} \u05DE\u05D7\u05D5\u05E7\u05D4` : label;
}
__name(typeLabel, "typeLabel");
function splitName(name) {
  let n = String(name || "").replace(/\s*\(\s*ע["״']?ר\s*\)\s*$/, "").replace(/\s*שותפות מוגבלת\s*$/, "");
  const baam = /\s*בע["״]?מ\.?\s*$/.test(n);
  if (baam)
    n = n.replace(/\s*בע["״]?מ\.?\s*$/, "");
  return { name: n.replace(/[\s.,\-]+$/, "").trim(), baam };
}
__name(splitName, "splitName");
function describe(item, permitOf) {
  const p = permitOf(item);
  const { name, baam } = splitName(item.name);
  return { type: typeLabel(item), name, baam, permit: p === "\u05E8\u05E7 \u05E4\u05E8\u05D8\u05D9" ? "private" : p === "\u05DB\u05DC\u05DC\u05D9+\u05E4\u05E8\u05D8\u05D9" ? "both" : p === "\u05DB\u05DC\u05DC\u05D9" ? "general" : "none" };
}
__name(describe, "describe");
var toBusinessRow = /* @__PURE__ */ __name((it) => ({ id: `${it.kind}:${it.id}`, registrar_name: it.name, permit_name: "", chp_number: it.id }), "toBusinessRow");
function fromBusinesses(businesses) {
  return businesses.map((b) => ({
    kind: b.entity_type === "partnership" ? "partnership" : b.entity_type === "association" ? "association" : "company",
    id: b.chp_number || b.id,
    name: b.registrar_name || b.permit_name,
    status: "",
    sub: ""
  }));
}
__name(fromBusinesses, "fromBusinesses");
async function searchByName(env, query, businesses) {
  let candidates, truncated = false;
  if (env.DB1) {
    ({ rows: candidates, truncated } = await registryCandidates(env.DB1, query));
  } else {
    console.log("registry-search: DB1 not bound - searching businesses only");
    candidates = fromBusinesses(businesses);
  }
  const byKey = new Map(candidates.map((c) => [`${c.kind}:${c.id}`, c]));
  const found = searchBusinesses(query, candidates.map(toBusinessRow), 50);
  const items = found.results.map((r) => byKey.get(r.id)).filter(Boolean);
  items.sort((a, b) => (DEFUNCT.test(a.status || "") ? 1 : 0) - (DEFUNCT.test(b.status || "") ? 1 : 0));
  return { items, total: found.total, tooMany: truncated || found.total > MAX_LIST };
}
__name(searchByName, "searchByName");
async function searchByChp(env, chp, businesses) {
  const id = digitsOnly(chp);
  if (!id)
    return [];
  if (env.DB1) {
    const db = env.DB1;
    const out = await db.batch([
      db.prepare("SELECT id,name,status,corp_type AS sub FROM companies WHERE id = ? LIMIT 1").bind(id),
      db.prepare("SELECT id,name,status,ptype AS sub FROM partnerships WHERE id = ? LIMIT 1").bind(id),
      db.prepare("SELECT id,name,status,category AS sub FROM associations WHERE id = ? LIMIT 1").bind(id)
    ]);
    const items = [];
    out.forEach((res, i) => (res.results || []).forEach((r) => items.push({ kind: KINDS[i], ...r })));
    return items;
  }
  return fromBusinesses(businesses.filter((b) => digitsOnly(b.chp_number) === id));
}
__name(searchByChp, "searchByChp");

// api/registry-name-search.js
var DEFUNCT2 = /מחוק|נמחק|מבוטל|פירוק|מפורק|מחוסל|חוסל|חיסול/;
var PER_TABLE = 25;
var SUB = { companies: "corp_type", partnerships: "ptype", associations: "category" };
var KINDS2 = { companies: "company", partnerships: "partnership", associations: "association" };
var isAuthed4 = /* @__PURE__ */ __name((request, env) => checkAdmin(request, env), "isAuthed");
function normB(s) {
  s = String(s || "").replace(/~/g, '"').replace(/\([^)]*\)/g, " ").replace(/[^א-ת0-9A-Za-z ]/g, " ");
  return s.replace(/\s+/g, " ").trim();
}
__name(normB, "normB");
var ftsPhrase2 = /* @__PURE__ */ __name((w) => `"${w.replace(/"/g, '""')}"`, "ftsPhrase");
async function onRequestGet15({ request, env }) {
  const t0 = Date.now();
  if (!await isAuthed4(request, env))
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!env.DB1)
    return Response.json({ error: "DB1 (company-info-db) \u05DC\u05D0 \u05DE\u05D7\u05D5\u05D1\u05E8 \u05DC\u05E4\u05E8\u05D5\u05D9\u05E7\u05D8" }, { status: 503 });
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").trim();
  if (q.length < 3)
    return Response.json({ results: [] });
  try {
    const db = env.DB1, tables = Object.keys(SUB);
    let stmts;
    if (/^\d+$/.test(q)) {
      const k = Math.min(q.length, 9), lo = Number(q.slice(0, k)) * 10 ** (9 - k), hi = (Number(q.slice(0, k)) + 1) * 10 ** (9 - k);
      stmts = tables.map((t) => db.prepare(`SELECT id,name,status,${SUB[t]} AS sub FROM ${t} WHERE id >= ? AND id < ? ORDER BY id LIMIT ${PER_TABLE}`).bind(lo, hi));
    } else {
      const words = normB(q).split(" ").filter(Boolean);
      const long = words.filter((w) => w.length >= 3), short = words.filter((w) => w.length < 3);
      if (!long.length)
        return Response.json({ results: [], hint: "\u05D4\u05E7\u05DC\u05D3 \u05DC\u05E4\u05D7\u05D5\u05EA \u05DE\u05D9\u05DC\u05D4 \u05D0\u05D7\u05EA \u05E9\u05DC 3 \u05D0\u05D5\u05EA\u05D9\u05D5\u05EA" });
      const expr = long.map(ftsPhrase2).join(" AND ");
      const like = short.map(() => " AND c.name_norm LIKE ?").join("");
      stmts = tables.map((t) => db.prepare(
        `SELECT c.id,c.name,c.status,c.${SUB[t]} AS sub FROM ${t}_fts f JOIN ${t} c ON c.id=f.id WHERE ${t}_fts MATCH ?${like} LIMIT ${PER_TABLE}`
      ).bind(expr, ...short.map((w) => `%${w}%`)));
    }
    const out = await Promise.allSettled(stmts.map((st) => st.all()));
    const rows = [], errors = [];
    out.forEach((res, i) => {
      if (res.status === "fulfilled")
        (res.value.results || []).forEach((r) => rows.push({ kind: KINDS2[tables[i]], ...r }));
      else
        errors.push(`${tables[i]}: ${String(res.reason && res.reason.message || res.reason)}`);
    });
    if (errors.length === tables.length)
      return Response.json({ error: errors.join(" | ") }, { status: 500 });
    const results = rows.map((r) => ({ id: String(r.id), name: r.name, kind: r.kind, type: typeLabel(r), status: r.status || "", defunct: DEFUNCT2.test(r.status || "") })).sort((a, b) => a.defunct - b.defunct || (a.name || "").localeCompare(b.name || "", "he")).slice(0, 20);
    return Response.json({ results, more: rows.length > 20, errors, ms: Date.now() - t0 });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
__name(onRequestGet15, "onRequestGet");

// api/sync-tase.js
var GH = { owner: "Revach123", repo: "HARAV_LEVIN", workflow: "registry-refresh.yml", ref: "main" };
var SCOPES2 = ["bonds", "all", "names"];
var SCOPE_MESSAGE = {
  bonds: '\u05D4\u05D5\u05E4\u05E2\u05DC \u05E2\u05D3\u05DB\u05D5\u05DF \u05D3\u05D2\u05DC \u05D4\u05D0\u05D2"\u05D7 \u05D1\u05DC\u05D1\u05D3 (\u05E7\u05E6\u05E8, \u05DB\u05D3\u05E7\u05D4-\u05E9\u05EA\u05D9\u05D9\u05DD). \u05D0\u05D7\u05E8\u05D9\u05D5 \u05E8\u05E2\u05E0\u05DF \u05D0\u05EA \u05D4\u05E8\u05E9\u05D9\u05DE\u05D4.',
  all: '\u05D4\u05D5\u05E4\u05E2\u05DC \u05E2\u05D3\u05DB\u05D5\u05DF \u05DE\u05DC\u05D0 (\u05E9\u05DE\u05D5\u05EA, \u05E1\u05D5\u05D2\u05D9\u05DD \u05D5\u05D3\u05D2\u05DC \u05D0\u05D2"\u05D7), \u05D0\u05D5\u05EA\u05D4 \u05E8\u05D9\u05E6\u05D4 \u05E9\u05DC \u05D4\u05E8\u05D9\u05E6\u05D4 \u05D4\u05D9\u05D5\u05DE\u05D9\u05EA. \u05E0\u05DE\u05E9\u05DA \u05DB-6 \u05D3\u05E7\u05D5\u05EA; \u05D0\u05D7\u05E8\u05D9\u05D5 \u05E8\u05E2\u05E0\u05DF \u05D0\u05EA \u05D4\u05E8\u05E9\u05D9\u05DE\u05D4.',
  names: "\u05D4\u05D5\u05E4\u05E2\u05DC \u05E2\u05D3\u05DB\u05D5\u05DF \u05E9\u05DE\u05D5\u05EA \u05D5\u05E1\u05D5\u05D2\u05D9\u05DD \u05D1\u05DC\u05D1\u05D3 (\u05DB-6 \u05D3\u05E7\u05D5\u05EA). \u05D0\u05D7\u05E8\u05D9\u05D5 \u05E8\u05E2\u05E0\u05DF \u05D0\u05EA \u05D4\u05E8\u05E9\u05D9\u05DE\u05D4."
};
var RUNS_URL = `https://github.com/${GH.owner}/${GH.repo}/actions/workflows/${GH.workflow}`;
var isAuthed5 = /* @__PURE__ */ __name((request, env) => checkAdmin(request, env), "isAuthed");
async function onRequestPost6({ request, env }) {
  if (!await isAuthed5(request, env)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!env.GITHUB_DISPATCH_TOKEN) {
    return Response.json({
      code: "missing_secret",
      error: "\u05DC\u05D0 \u05D4\u05D5\u05D2\u05D3\u05E8 GITHUB_DISPATCH_TOKEN \u05D1-Cloudflare Pages (\u05E8' \u05D4\u05E2\u05E8\u05D4 \u05D1\u05E8\u05D0\u05E9 functions/api/sync-tase.js). \u05D4\u05E8\u05D9\u05E6\u05D4 \u05D4\u05D9\u05D5\u05DE\u05D9\u05EA \u05DE\u05DE\u05E9\u05D9\u05DB\u05D4 \u05DB\u05E8\u05D2\u05D9\u05DC."
    }, { status: 500 });
  }
  let scope = "bonds";
  try {
    const body = await request.json();
    if (body && body.scope !== void 0)
      scope = String(body.scope);
  } catch {
  }
  if (!SCOPES2.includes(scope)) {
    return Response.json({ code: "bad_scope", error: `scope \u05DC\u05D0 \u05D7\u05D5\u05E7\u05D9: ${scope}` }, { status: 400 });
  }
  let res;
  try {
    res = await fetch(`https://api.github.com/repos/${GH.owner}/${GH.repo}/actions/workflows/${GH.workflow}/dispatches`, {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${env.GITHUB_DISPATCH_TOKEN}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "harav-levin-admin",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ ref: GH.ref, inputs: { apply: "true", scope } })
    });
  } catch (e) {
    return Response.json({ code: "github_unreachable", error: `\u05DC\u05D0 \u05E0\u05D9\u05EA\u05DF \u05DC\u05D4\u05D2\u05D9\u05E2 \u05DC-GitHub: ${e.message}` }, { status: 502 });
  }
  if (res.status !== 204) {
    const text2 = (await res.text()).slice(0, 200);
    return Response.json({ code: "github_rejected", status: res.status, error: `GitHub \u05D3\u05D7\u05D4 \u05D0\u05EA \u05D4\u05D4\u05E4\u05E2\u05DC\u05D4 (${res.status}): ${text2}` }, { status: 502 });
  }
  return Response.json({
    triggered: true,
    scope,
    message: SCOPE_MESSAGE[scope],
    runsUrl: RUNS_URL
  });
}
__name(onRequestPost6, "onRequestPost");

// api/_shared/businesses-cache.js
var CACHE_MS = 60 * 1e3;
var cache = { at: 0, rows: null };
async function loadBusinesses(env) {
  if (cache.rows && Date.now() - cache.at < CACHE_MS)
    return cache.rows;
  let res;
  try {
    res = await env.DB.prepare("SELECT id, chp_number, entity_type, registrar_name, permit_name, visibility FROM businesses").all();
  } catch (e) {
    res = await env.DB.prepare("SELECT id, chp_number, registrar_name, permit_name FROM businesses").all();
  }
  cache = { at: Date.now(), rows: res.results ?? [] };
  return cache.rows;
}
__name(loadBusinesses, "loadBusinesses");

// api/_shared/stt-azure.js
var YEMOT_API = "https://www.call2all.co.il/ym/api";
var TIMEOUT_MS = 8e3;
function sttConfigured(env) {
  return !!(env.AZURE_SPEECH_KEY && (env.YEMOT_TOKEN || env.YEMOT_TTS));
}
__name(sttConfigured, "sttConfigured");
function withTimeout(ms) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  return { signal: ctl.signal, done: () => clearTimeout(timer) };
}
__name(withTimeout, "withTimeout");
function yemotRequest(env, endpoint, params) {
  const q = new URLSearchParams(params);
  const headers = {};
  if (env.YEMOT_TOKEN)
    q.set("token", env.YEMOT_TOKEN);
  else
    headers.authorization = env.YEMOT_TTS;
  return { url: `${YEMOT_API}/${endpoint}?${q}`, headers };
}
__name(yemotRequest, "yemotRequest");
async function downloadRecording(env, candidates) {
  for (const p of candidates) {
    const path = p.startsWith("ivr2:") ? p : `ivr2:${p.startsWith("/") ? p : "/" + p}`;
    const t = withTimeout(TIMEOUT_MS);
    try {
      const { url, headers } = yemotRequest(env, "DownloadFile", { path });
      const res = await fetch(url, { headers, signal: t.signal });
      const buf = new Uint8Array(await res.arrayBuffer());
      t.done();
      if (res.ok && buf.length > 44 && buf[0] === 82 && buf[1] === 73)
        return { bytes: buf, path };
    } catch (e) {
      t.done();
    }
  }
  return null;
}
__name(downloadRecording, "downloadRecording");
async function deleteRecording(env, path) {
  try {
    const { url, headers } = yemotRequest(env, "FileAction", { action: "delete", what: path });
    await fetch(url, { headers });
  } catch (e) {
  }
}
__name(deleteRecording, "deleteRecording");
async function azureTranscribe(env, wav) {
  const region = env.AZURE_SPEECH_REGION || "eastus";
  const url = `https://${region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=he-IL&format=simple&profanity=raw`;
  const t = withTimeout(TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": env.AZURE_SPEECH_KEY,
        "Content-Type": "audio/wav; codecs=audio/pcm; samplerate=8000",
        Accept: "application/json"
      },
      body: wav,
      signal: t.signal
    });
    t.done();
    if (!res.ok)
      return "";
    const j = await res.json();
    return j.RecognitionStatus === "Success" ? String(j.DisplayText || "") : "";
  } catch (e) {
    t.done();
    return "";
  }
}
__name(azureTranscribe, "azureTranscribe");
async function transcribeRecording(env, candidates) {
  const rec = await downloadRecording(env, candidates);
  if (!rec)
    return { text: "", error: "download" };
  const text2 = await azureTranscribe(env, rec.bytes);
  await deleteRecording(env, rec.path);
  return { text: text2, error: text2 ? "" : "no-speech" };
}
__name(transcribeRecording, "transcribeRecording");

// api/_shared/stt-cache.js
var mem = /* @__PURE__ */ new Map();
var TTL_MS = 6 * 3600 * 1e3;
var ready = false;
async function ensure(env) {
  if (ready)
    return;
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS ivr_stt (call_id TEXT, attempt INTEGER, text TEXT, at INTEGER, PRIMARY KEY (call_id, attempt))"
  ).run();
  ready = true;
}
__name(ensure, "ensure");
async function sttGet(env, callId, attempt) {
  const k = `${callId}:${attempt}`;
  if (mem.has(k))
    return mem.get(k);
  try {
    await ensure(env);
    const r = await env.DB.prepare("SELECT text FROM ivr_stt WHERE call_id = ? AND attempt = ?").bind(callId, attempt).first();
    if (r) {
      mem.set(k, r.text);
      return r.text;
    }
  } catch (e) {
  }
  return null;
}
__name(sttGet, "sttGet");
async function sttPut(env, callId, attempt, text2) {
  mem.set(`${callId}:${attempt}`, text2);
  try {
    await ensure(env);
    await env.DB.prepare("INSERT OR REPLACE INTO ivr_stt (call_id, attempt, text, at) VALUES (?, ?, ?, ?)").bind(callId, attempt, text2, Date.now()).run();
    await env.DB.prepare("DELETE FROM ivr_stt WHERE at < ?").bind(Date.now() - TTL_MS).run();
  } catch (e) {
  }
}
__name(sttPut, "sttPut");

// api/_shared/ivr_phrases.js
var TYPE_LABELS = ["\u05D7\u05D1\u05E8\u05D4 \u05E4\u05E8\u05D8\u05D9\u05EA", "\u05D7\u05D1\u05E8\u05D4 \u05E6\u05D9\u05D1\u05D5\u05E8\u05D9\u05EA", "\u05D7\u05D1\u05E8\u05D4", "\u05E9\u05D5\u05EA\u05E4\u05D5\u05EA \u05DE\u05D5\u05D2\u05D1\u05DC\u05EA", "\u05E9\u05D5\u05EA\u05E4\u05D5\u05EA \u05DB\u05DC\u05DC\u05D9\u05EA", "\u05E9\u05D5\u05EA\u05E4\u05D5\u05EA", "\u05E2\u05DE\u05D5\u05EA\u05D4"];
var PHRASES = {
  menu: "\u05DE\u05D5\u05DE\u05DC\u05E5 \u05DC\u05D7\u05E4\u05E9 \u05DC\u05E4\u05D9 \u05D7 \u05E4 \u05E9\u05DC \u05D4\u05D7\u05D1\u05E8\u05D4. \u05D1\u05DE\u05D9\u05D3\u05D4 \u05E9\u05D9\u05E9 \u05DC\u05DB\u05DD \u05D0\u05EA \u05DE\u05E1\u05E4\u05E8 \u05D4\u05D7 \u05E4, \u05D4\u05E7\u05D9\u05E9\u05D5 1. \u05D0\u05B4\u05DD \u05DC\u05B9\u05D0, \u05D4\u05B7\u05E7\u05B4\u05BC\u05D9\u05E9\u05C1\u05D5\u05BC 2 \u05DC\u05B0\u05D7\u05B4\u05D9\u05E4\u05BC\u05D5\u05BC\u05E9\u05C2 \u05DC\u05B0\u05E4\u05B4\u05D9 \u05E9\u05B5\u05C1\u05DD \u05D4\u05B7\u05D7\u05B6\u05D1\u05B0\u05E8\u05B8\u05D4",
  tooMany: "\u05D4\u05E8\u05D1\u05D4 \u05DE\u05D3\u05D9 \u05D0\u05E4\u05E9\u05E8\u05D5\u05D9\u05D5\u05EA. \u05D0\u05E0\u05D0 \u05D0\u05DE\u05E8\u05D5 \u05D0\u05EA \u05D4\u05E9\u05DD \u05D4\u05DE\u05DC\u05D0, \u05D0\u05D5 \u05D7\u05E4\u05E9\u05D5 \u05DC\u05E4\u05D9 \u05DE\u05E1\u05E4\u05E8 \u05D7 \u05E4. \u05DC\u05D0\u05DE\u05D9\u05E8\u05EA \u05D4\u05E9\u05DD \u05D4\u05DE\u05DC\u05D0 \u05D4\u05E7\u05D9\u05E9\u05D5 1. \u05DC\u05D7\u05D9\u05E4\u05D5\u05E9 \u05DC\u05E4\u05D9 \u05D7 \u05E4 \u05D4\u05E7\u05D9\u05E9\u05D5 2",
  ask1: "\u05D0\u05DE\u05E8\u05D5 \u05D0\u05EA \u05E9\u05DD \u05D4\u05D7\u05D1\u05E8\u05D4",
  ask2: "\u05D0\u05DE\u05E8\u05D5 \u05E9\u05D5\u05D1 \u05D0\u05EA \u05E9\u05DD \u05D4\u05D7\u05D1\u05E8\u05D4",
  askChp: "\u05D4\u05E7\u05D9\u05E9\u05D5 \u05D0\u05EA \u05DE\u05E1\u05E4\u05E8 \u05D4\u05D7 \u05E4, \u05EA\u05E9\u05E2 \u05E1\u05E4\u05E8\u05D5\u05EA, \u05D5\u05D0\u05D7\u05E8\u05D9\u05D5 \u05E1\u05D5\u05DC\u05DE\u05D9\u05EA",
  noName: "\u05DC\u05D0 \u05E0\u05DE\u05E6\u05D0\u05D4 \u05D7\u05D1\u05E8\u05D4 \u05D1\u05E9\u05DD \u05D4\u05D6\u05D4",
  noChp: "\u05DC\u05D0 \u05E0\u05DE\u05E6\u05D0\u05D4 \u05D7\u05D1\u05E8\u05D4 \u05D1\u05DE\u05E1\u05E4\u05E8 \u05D4\u05D6\u05D4",
  noMatch: "\u05DC\u05D0 \u05E0\u05DE\u05E6\u05D0\u05D4 \u05D7\u05D1\u05E8\u05D4 \u05DE\u05EA\u05D0\u05D9\u05DE\u05D4",
  noHear: "\u05DC\u05D0 \u05D4\u05E6\u05DC\u05D7\u05EA\u05D9 \u05DC\u05D4\u05D1\u05D9\u05DF",
  next: "\u05DC\u05D7\u05D9\u05E4\u05D5\u05E9 \u05E0\u05D5\u05E1\u05E3 \u05D4\u05E7\u05D9\u05E9\u05D5 1. \u05DC\u05E1\u05D9\u05D5\u05DD \u05D4\u05E7\u05D9\u05E9\u05D5 2",
  bye: "\u05EA\u05D5\u05D3\u05D4 \u05D5\u05DC\u05D4\u05EA\u05E8\u05D0\u05D5\u05EA",
  baam: "\u05D1\u05B8\u05BC\u05D0 \u05D0\u05B7\u05DD",
  // "בע"מ" מוקרא אחרי שם החברה
  "permit:private": "\u05DC\u05E2\u05E1\u05E7 \u05D6\u05D4 \u05D9\u05E9 \u05E8\u05E7 \u05D4\u05D9\u05EA\u05E8 \u05E2\u05E1\u05E7\u05D4 \u05E4\u05E8\u05D8\u05D9",
  "permit:private2": "\u05D4\u05D4\u05D9\u05EA\u05E8 \u05E2\u05E1\u05E7\u05D4 \u05EA\u05E7\u05E3 \u05E8\u05E7 \u05DC\u05DE\u05D9 \u05E9\u05D7\u05EA\u05DD \u05E2\u05DC \u05D4\u05D9\u05EA\u05E8 \u05E2\u05E1\u05E7\u05D4 \u05E4\u05E8\u05D8\u05D9",
  "permit:general": "\u05E7\u05D9\u05D9\u05DD \u05D4\u05D9\u05EA\u05E8 \u05E2\u05E1\u05E7\u05D4 \u05DB\u05DC\u05DC\u05D9",
  "permit:alsoPrivate": "\u05E7\u05D9\u05D9\u05DD \u05D2\u05DD \u05D4\u05D9\u05EA\u05E8 \u05E2\u05E1\u05E7\u05D4 \u05E4\u05E8\u05D8\u05D9",
  "permit:none": "\u05DC\u05D0 \u05E7\u05D9\u05D9\u05DD \u05D4\u05D9\u05EA\u05E8 \u05E2\u05E1\u05E7\u05D4"
};
for (const label of TYPE_LABELS) {
  PHRASES[`type:${label}`] = label;
  PHRASES[`type:${label} \u05DE\u05D7\u05D5\u05E7\u05D4`] = `${label} \u05DE\u05D7\u05D5\u05E7\u05D4`;
}
var NIQQUD = [
  [/(?<![א-ת])החברה(?![א-ת])/g, "\u05D4\u05B7\u05D7\u05B6\u05D1\u05B0\u05E8\u05B8\u05D4"],
  [/(?<![א-ת])חברה(?![א-ת])/g, "\u05D7\u05B6\u05D1\u05B0\u05E8\u05B8\u05D4"],
  // ח.פ. מוקרא כשמות האותיות: "חֶת פֵּא" (סגול מתחת לח, בלי י) (בכתב "ח פ" - בלי נקודות, שימות מפרקת לפיהן)
  [/(?<![א-ת])(ה?)ח פ(?![א-ת])/g, (m, h) => `${h ? "\u05D4\u05B7" : ""}\u05D7\u05B6\u05EA \u05E4\u05B5\u05BC\u05D0`]
];
for (const k of Object.keys(PHRASES)) {
  for (const [re, rep] of NIQQUD)
    PHRASES[k] = PHRASES[k].replace(re, rep);
}
function ttsClean(s) {
  return String(s || "").replace(/(^|[^א-ת])בע["״]?מ(?![א-ת])/g, `$1${PHRASES.baam}`).replace(/["'״׳“”]/g, "").replace(/[=&,.\n\r]/g, " ").replace(/\s+/g, " ").trim();
}
__name(ttsClean, "ttsClean");
function unit(key, manifest) {
  const text2 = PHRASES[key];
  if (text2 == null)
    throw new Error(`unknown phrase: ${key}`);
  const m = manifest && manifest[key];
  if (m && m.path && m.text === text2)
    return `f-${m.path}`;
  return `t-${ttsClean(text2)}`;
}
__name(unit, "unit");

// api/_shared/ivr_audio_manifest.js
var ivr_audio_manifest_default = {
  "ask1": {
    "text": "\u05D0\u05DE\u05E8\u05D5 \u05D0\u05EA \u05E9\u05DD \u05D4\u05B7\u05D7\u05B6\u05D1\u05B0\u05E8\u05B8\u05D4",
    "voice": "he-IL-AvriNeural",
    "path": "/99/c6_ac4cd71b18286a4e147f",
    "pron": "6a4e147f",
    "phoneme": true
  },
  "ask2": {
    "text": "\u05D0\u05DE\u05E8\u05D5 \u05E9\u05D5\u05D1 \u05D0\u05EA \u05E9\u05DD \u05D4\u05B7\u05D7\u05B6\u05D1\u05B0\u05E8\u05B8\u05D4",
    "voice": "he-IL-AvriNeural",
    "path": "/99/c6_97d3ee9ce7156a4e147f",
    "pron": "6a4e147f",
    "phoneme": true
  },
  "askChp": {
    "text": "\u05D4\u05E7\u05D9\u05E9\u05D5 \u05D0\u05EA \u05DE\u05E1\u05E4\u05E8 \u05D4\u05B7\u05D7\u05B6\u05EA \u05E4\u05B5\u05BC\u05D0, \u05EA\u05E9\u05E2 \u05E1\u05E4\u05E8\u05D5\u05EA, \u05D5\u05D0\u05D7\u05E8\u05D9\u05D5 \u05E1\u05D5\u05DC\u05DE\u05D9\u05EA",
    "voice": "he-IL-AvriNeural",
    "path": "/99/c6_0bda1e78207c6a4e147f",
    "pron": "",
    "phoneme": false
  },
  "baam": {
    "text": "\u05D1\u05B8\u05BC\u05D0 \u05D0\u05B7\u05DD",
    "voice": "he-IL-AvriNeural",
    "path": "/99/c6_74363ed407cf"
  },
  "bye": {
    "text": "\u05EA\u05D5\u05D3\u05D4 \u05D5\u05DC\u05D4\u05EA\u05E8\u05D0\u05D5\u05EA",
    "voice": "he-IL-AvriNeural",
    "path": "/99/c6_00f2a0901252"
  },
  "menu": {
    "text": "\u05DE\u05D5\u05DE\u05DC\u05E5 \u05DC\u05D7\u05E4\u05E9 \u05DC\u05E4\u05D9 \u05D7\u05B6\u05EA \u05E4\u05B5\u05BC\u05D0 \u05E9\u05DC \u05D4\u05B7\u05D7\u05B6\u05D1\u05B0\u05E8\u05B8\u05D4. \u05D1\u05DE\u05D9\u05D3\u05D4 \u05E9\u05D9\u05E9 \u05DC\u05DB\u05DD \u05D0\u05EA \u05DE\u05E1\u05E4\u05E8 \u05D4\u05B7\u05D7\u05B6\u05EA \u05E4\u05B5\u05BC\u05D0, \u05D4\u05E7\u05D9\u05E9\u05D5 1. \u05D0\u05B4\u05DD \u05DC\u05B9\u05D0, \u05D4\u05B7\u05E7\u05B4\u05BC\u05D9\u05E9\u05C1\u05D5\u05BC 2 \u05DC\u05B0\u05D7\u05B4\u05D9\u05E4\u05BC\u05D5\u05BC\u05E9\u05C2 \u05DC\u05B0\u05E4\u05B4\u05D9 \u05E9\u05B5\u05C1\u05DD \u05D4\u05B7\u05D7\u05B6\u05D1\u05B0\u05E8\u05B8\u05D4",
    "voice": "he-IL-AvriNeural",
    "path": "/99/c6_f6fb4debda346a4e147f",
    "pron": "6a4e147f",
    "phoneme": true
  },
  "next": {
    "text": "\u05DC\u05D7\u05D9\u05E4\u05D5\u05E9 \u05E0\u05D5\u05E1\u05E3 \u05D4\u05E7\u05D9\u05E9\u05D5 1. \u05DC\u05E1\u05D9\u05D5\u05DD \u05D4\u05E7\u05D9\u05E9\u05D5 2",
    "voice": "he-IL-AvriNeural",
    "path": "/99/c6_430d980ad66f"
  },
  "noChp": {
    "text": "\u05DC\u05D0 \u05E0\u05DE\u05E6\u05D0\u05D4 \u05D7\u05B6\u05D1\u05B0\u05E8\u05B8\u05D4 \u05D1\u05DE\u05E1\u05E4\u05E8 \u05D4\u05D6\u05D4",
    "voice": "he-IL-AvriNeural",
    "path": "/99/c6_e4413d1eb3196a4e147f",
    "pron": "6a4e147f",
    "phoneme": true
  },
  "noHear": {
    "text": "\u05DC\u05D0 \u05D4\u05E6\u05DC\u05D7\u05EA\u05D9 \u05DC\u05D4\u05D1\u05D9\u05DF",
    "voice": "he-IL-AvriNeural",
    "path": "/99/c6_02e40cef4692"
  },
  "noMatch": {
    "text": "\u05DC\u05D0 \u05E0\u05DE\u05E6\u05D0\u05D4 \u05D7\u05B6\u05D1\u05B0\u05E8\u05B8\u05D4 \u05DE\u05EA\u05D0\u05D9\u05DE\u05D4",
    "voice": "he-IL-AvriNeural",
    "path": "/99/c6_16f8c130ca3c6a4e147f",
    "pron": "6a4e147f",
    "phoneme": true
  },
  "noName": {
    "text": "\u05DC\u05D0 \u05E0\u05DE\u05E6\u05D0\u05D4 \u05D7\u05B6\u05D1\u05B0\u05E8\u05B8\u05D4 \u05D1\u05E9\u05DD \u05D4\u05D6\u05D4",
    "voice": "he-IL-AvriNeural",
    "path": "/99/c6_0347dd27f4aa6a4e147f",
    "pron": "6a4e147f",
    "phoneme": true
  },
  "permit:alsoPrivate": {
    "text": "\u05E7\u05D9\u05D9\u05DD \u05D2\u05DD \u05D4\u05D9\u05EA\u05E8 \u05E2\u05E1\u05E7\u05D4 \u05E4\u05E8\u05D8\u05D9",
    "voice": "he-IL-AvriNeural",
    "path": "/99/c6_ac11b92db0fb6a4e147f",
    "pron": "",
    "phoneme": false
  },
  "permit:general": {
    "text": "\u05E7\u05D9\u05D9\u05DD \u05D4\u05D9\u05EA\u05E8 \u05E2\u05E1\u05E7\u05D4 \u05DB\u05DC\u05DC\u05D9",
    "voice": "he-IL-AvriNeural",
    "path": "/99/c6_047f395e3e5f"
  },
  "permit:none": {
    "text": "\u05DC\u05D0 \u05E7\u05D9\u05D9\u05DD \u05D4\u05D9\u05EA\u05E8 \u05E2\u05E1\u05E7\u05D4",
    "voice": "he-IL-AvriNeural",
    "path": "/99/c6_1a4e24d34135"
  },
  "permit:private": {
    "text": "\u05DC\u05E2\u05E1\u05E7 \u05D6\u05D4 \u05D9\u05E9 \u05E8\u05E7 \u05D4\u05D9\u05EA\u05E8 \u05E2\u05E1\u05E7\u05D4 \u05E4\u05E8\u05D8\u05D9",
    "voice": "he-IL-AvriNeural",
    "path": "/99/c6_69ea58ba352d"
  },
  "permit:private2": {
    "text": "\u05D4\u05D4\u05D9\u05EA\u05E8 \u05E2\u05E1\u05E7\u05D4 \u05EA\u05E7\u05E3 \u05E8\u05E7 \u05DC\u05DE\u05D9 \u05E9\u05D7\u05EA\u05DD \u05E2\u05DC \u05D4\u05D9\u05EA\u05E8 \u05E2\u05E1\u05E7\u05D4 \u05E4\u05E8\u05D8\u05D9",
    "voice": "he-IL-AvriNeural",
    "path": "/99/c6_b041ab352254"
  },
  "tooMany": {
    "text": "\u05D4\u05E8\u05D1\u05D4 \u05DE\u05D3\u05D9 \u05D0\u05E4\u05E9\u05E8\u05D5\u05D9\u05D5\u05EA. \u05D0\u05E0\u05D0 \u05D0\u05DE\u05E8\u05D5 \u05D0\u05EA \u05D4\u05E9\u05DD \u05D4\u05DE\u05DC\u05D0, \u05D0\u05D5 \u05D7\u05E4\u05E9\u05D5 \u05DC\u05E4\u05D9 \u05DE\u05E1\u05E4\u05E8 \u05D7\u05B6\u05EA \u05E4\u05B5\u05BC\u05D0. \u05DC\u05D0\u05DE\u05D9\u05E8\u05EA \u05D4\u05E9\u05DD \u05D4\u05DE\u05DC\u05D0 \u05D4\u05E7\u05D9\u05E9\u05D5 1. \u05DC\u05D7\u05D9\u05E4\u05D5\u05E9 \u05DC\u05E4\u05D9 \u05D7\u05B6\u05EA \u05E4\u05B5\u05BC\u05D0 \u05D4\u05E7\u05D9\u05E9\u05D5 2",
    "voice": "he-IL-AvriNeural",
    "path": "/99/c6_4a05e30269876a4e147f",
    "pron": "",
    "phoneme": false
  },
  "type:\u05D7\u05D1\u05E8\u05D4": {
    "text": "\u05D7\u05B6\u05D1\u05B0\u05E8\u05B8\u05D4",
    "voice": "he-IL-AvriNeural",
    "path": "/99/c6_5aa4ef3eeb726a4e147f",
    "pron": "6a4e147f",
    "phoneme": true
  },
  "type:\u05D7\u05D1\u05E8\u05D4 \u05DE\u05D7\u05D5\u05E7\u05D4": {
    "text": "\u05D7\u05B6\u05D1\u05B0\u05E8\u05B8\u05D4 \u05DE\u05D7\u05D5\u05E7\u05D4",
    "voice": "he-IL-AvriNeural",
    "path": "/99/c6_0ae57426fcb56a4e147f",
    "pron": "6a4e147f",
    "phoneme": true
  },
  "type:\u05D7\u05D1\u05E8\u05D4 \u05E4\u05E8\u05D8\u05D9\u05EA": {
    "text": "\u05D7\u05B6\u05D1\u05B0\u05E8\u05B8\u05D4 \u05E4\u05E8\u05D8\u05D9\u05EA",
    "voice": "he-IL-AvriNeural",
    "path": "/99/c6_f7662618e8306a4e147f",
    "pron": "6a4e147f",
    "phoneme": true
  },
  "type:\u05D7\u05D1\u05E8\u05D4 \u05E4\u05E8\u05D8\u05D9\u05EA \u05DE\u05D7\u05D5\u05E7\u05D4": {
    "text": "\u05D7\u05B6\u05D1\u05B0\u05E8\u05B8\u05D4 \u05E4\u05E8\u05D8\u05D9\u05EA \u05DE\u05D7\u05D5\u05E7\u05D4",
    "voice": "he-IL-AvriNeural",
    "path": "/99/c6_b54857686e696a4e147f",
    "pron": "6a4e147f",
    "phoneme": true
  },
  "type:\u05D7\u05D1\u05E8\u05D4 \u05E6\u05D9\u05D1\u05D5\u05E8\u05D9\u05EA": {
    "text": "\u05D7\u05B6\u05D1\u05B0\u05E8\u05B8\u05D4 \u05E6\u05D9\u05D1\u05D5\u05E8\u05D9\u05EA",
    "voice": "he-IL-AvriNeural",
    "path": "/99/c6_057e4e5b71526a4e147f",
    "pron": "6a4e147f",
    "phoneme": true
  },
  "type:\u05D7\u05D1\u05E8\u05D4 \u05E6\u05D9\u05D1\u05D5\u05E8\u05D9\u05EA \u05DE\u05D7\u05D5\u05E7\u05D4": {
    "text": "\u05D7\u05B6\u05D1\u05B0\u05E8\u05B8\u05D4 \u05E6\u05D9\u05D1\u05D5\u05E8\u05D9\u05EA \u05DE\u05D7\u05D5\u05E7\u05D4",
    "voice": "he-IL-AvriNeural",
    "path": "/99/c6_e9d07a962f3f6a4e147f",
    "pron": "6a4e147f",
    "phoneme": true
  },
  "type:\u05E2\u05DE\u05D5\u05EA\u05D4": {
    "text": "\u05E2\u05DE\u05D5\u05EA\u05D4",
    "voice": "he-IL-AvriNeural",
    "path": "/99/c6_987d565584a4"
  },
  "type:\u05E2\u05DE\u05D5\u05EA\u05D4 \u05DE\u05D7\u05D5\u05E7\u05D4": {
    "text": "\u05E2\u05DE\u05D5\u05EA\u05D4 \u05DE\u05D7\u05D5\u05E7\u05D4",
    "voice": "he-IL-AvriNeural",
    "path": "/99/c6_0ca31e8ccc30"
  },
  "type:\u05E9\u05D5\u05EA\u05E4\u05D5\u05EA": {
    "text": "\u05E9\u05D5\u05EA\u05E4\u05D5\u05EA",
    "voice": "he-IL-AvriNeural",
    "path": "/99/c6_06655e9c5806"
  },
  "type:\u05E9\u05D5\u05EA\u05E4\u05D5\u05EA \u05DB\u05DC\u05DC\u05D9\u05EA": {
    "text": "\u05E9\u05D5\u05EA\u05E4\u05D5\u05EA \u05DB\u05DC\u05DC\u05D9\u05EA",
    "voice": "he-IL-AvriNeural",
    "path": "/99/c6_e61430b4de35"
  },
  "type:\u05E9\u05D5\u05EA\u05E4\u05D5\u05EA \u05DB\u05DC\u05DC\u05D9\u05EA \u05DE\u05D7\u05D5\u05E7\u05D4": {
    "text": "\u05E9\u05D5\u05EA\u05E4\u05D5\u05EA \u05DB\u05DC\u05DC\u05D9\u05EA \u05DE\u05D7\u05D5\u05E7\u05D4",
    "voice": "he-IL-AvriNeural",
    "path": "/99/c6_181009b0804f"
  },
  "type:\u05E9\u05D5\u05EA\u05E4\u05D5\u05EA \u05DE\u05D5\u05D2\u05D1\u05DC\u05EA": {
    "text": "\u05E9\u05D5\u05EA\u05E4\u05D5\u05EA \u05DE\u05D5\u05D2\u05D1\u05DC\u05EA",
    "voice": "he-IL-AvriNeural",
    "path": "/99/c6_3be9bd914da3"
  },
  "type:\u05E9\u05D5\u05EA\u05E4\u05D5\u05EA \u05DE\u05D5\u05D2\u05D1\u05DC\u05EA \u05DE\u05D7\u05D5\u05E7\u05D4": {
    "text": "\u05E9\u05D5\u05EA\u05E4\u05D5\u05EA \u05DE\u05D5\u05D2\u05D1\u05DC\u05EA \u05DE\u05D7\u05D5\u05E7\u05D4",
    "voice": "he-IL-AvriNeural",
    "path": "/99/c6_9daa3d5ff4a5"
  },
  "type:\u05E9\u05D5\u05EA\u05E4\u05D5\u05EA \u05DE\u05D7\u05D5\u05E7\u05D4": {
    "text": "\u05E9\u05D5\u05EA\u05E4\u05D5\u05EA \u05DE\u05D7\u05D5\u05E7\u05D4",
    "voice": "he-IL-AvriNeural",
    "path": "/99/c6_05d10921422f"
  }
};

// api/ivr-company.js
var CFG = {
  TOKEN_PARAM: "sk",
  // api_add_0=sk=<secret> בהגדרת השלוחה
  BACK_FOLDER: "/5",
  // לאן חוזרים בסיום (env.IVR_BACK_FOLDER דורס)
  MAX_SPEECH_ATTEMPTS: 3,
  MAX_ROUNDS: 6,
  EMPTY_VAL: "NONE",
  // הערך שימות מחזירה כשלא נאמר/הוקש כלום
  SEC_WAIT: 7,
  // כמה שניות ממתינים להקשה
  REC_MIN_SEC: 1,
  // הקלטה: מינימום / מקסימום שניות (נדרסים ב-env)
  REC_MAX_SEC: 6
};
var MF = ivr_audio_manifest_default;
var P = /* @__PURE__ */ __name((key) => unit(key, MF), "P");
var msg = /* @__PURE__ */ __name((...parts) => parts.flat().filter(Boolean).join("."), "msg");
var notes = /* @__PURE__ */ __name((keys) => (keys || []).map(P), "notes");
async function onRequest({ request, env }) {
  MF = String(env.IVR_AUDIO_OFF || "") === "1" ? {} : ivr_audio_manifest_default;
  const raw = await parseYemot(request);
  const sent = String(raw[CFG.TOKEN_PARAM] || "").trim();
  const expected = String(env.IVR_SECRET || "").trim();
  if (sent !== expected) {
    console.log(`ivr-company auth fail: IVR_SECRET ${expected ? "set" : "NOT SET"} (len ${expected.length}), sk ${sent ? "sent" : "MISSING"} (len ${sent.length})`);
    return text("id_list_message=t-\u05E9\u05D2\u05D9\u05D0\u05EA \u05D4\u05E8\u05E9\u05D0\u05D4&");
  }
  if (raw.hangup === "yes")
    return text("");
  try {
    const rows = await loadBusinesses(env);
    const ctx = { v: raw, env, rows, permitOf: permitIndex(rows), record: sttConfigured(env) };
    ctx.voice = ctx.record || !!env.IVR_VOICE_READ_OPTS;
    return text(await route(ctx));
  } catch (e) {
    console.log(`ivr-company error: ${e && e.message}`);
    return text(`id_list_message=t-\u05D0\u05D9\u05E8\u05E2\u05D4 \u05E9\u05D2\u05D9\u05D0\u05D4&go_to_folder=${back(env)}&`);
  }
}
__name(onRequest, "onRequest");
async function route(ctx) {
  const { v, env } = ctx;
  for (let r = 1; r <= CFG.MAX_ROUNDS; r++) {
    const nx = `nx${r}`;
    if (has(v, nx)) {
      if (v[nx] === "1")
        continue;
      return `id_list_message=${P("bye")}&go_to_folder=${back(env)}&`;
    }
    return await round(ctx, r);
  }
  return `id_list_message=${P("bye")}&go_to_folder=${back(env)}&`;
}
__name(route, "route");
async function round(ctx, r) {
  const { v } = ctx;
  if (!ctx.voice)
    return (await chpStep(ctx, r, "", false)).body;
  const mKey = `m${r}`;
  if (!has(v, mKey))
    return readTapRaw(P("menu"), mKey, ["1", "2"]);
  let note = [];
  if (v[mKey] === "1") {
    const c = await chpStep(ctx, r, "", true);
    if (c.body)
      return c.body;
    note = c.note;
  }
  const n = await nameStep(ctx, r, note);
  if (n.body)
    return n.body;
  if (n.goChp)
    return (await chpStep(ctx, r, "", false)).body;
  if (!has(v, `h${r}`))
    return (await chpStep(ctx, r, n.note, false)).body;
  return readNext(r, ["noMatch"]);
}
__name(round, "round");
async function chpStep(ctx, r, note, fallbackToName) {
  const { v, env, rows } = ctx;
  const hKey = `h${r}`;
  if (!has(v, hKey)) {
    return { body: readTapRaw(msg(notes(note), P("askChp")), hKey, null, { max: 9, min: 5 }) };
  }
  const items = v[hKey] === CFG.EMPTY_VAL ? [] : await searchByChp(env, v[hKey], rows);
  if (items.length)
    return { body: listing(ctx, r, items) };
  if (fallbackToName && ctx.voice)
    return { note: ["noChp"] };
  return { body: readNext(r, ["noChp"]) };
}
__name(chpStep, "chpStep");
async function nameStep(ctx, r, note) {
  const { v, env, rows, record } = ctx;
  for (let a = 1; a <= CFG.MAX_SPEECH_ATTEMPTS; a++) {
    const sKey = `s${r}_${a}`;
    if (!has(v, sKey)) {
      return { body: readSpeech(env, v, r, a, msg(notes(note), P(a === 1 ? "ask1" : "ask2"))) };
    }
    let spoken = String(v[sKey]);
    if (record && spoken !== CFG.EMPTY_VAL)
      spoken = await recognize(env, v, r, a, spoken);
    else if (looksLikeRecording(spoken)) {
      return { body: `id_list_message=t-\u05D6\u05D9\u05D4\u05D5\u05D9 \u05D4\u05D3\u05D9\u05D1\u05D5\u05E8 \u05E2\u05D3\u05D9\u05D9\u05DF \u05DC\u05D0 \u05D4\u05D5\u05D2\u05D3\u05E8 \u05E0\u05DB\u05D5\u05DF&go_to_folder=${back(env)}&` };
    }
    if (!spoken || spoken === CFG.EMPTY_VAL) {
      note = ["noHear"];
      continue;
    }
    const found = await searchByName(env, spoken, rows);
    if (!found.items.length) {
      note = ["noName"];
      continue;
    }
    if (found.tooMany) {
      const tKey = `t${r}_${a}`;
      if (!has(v, tKey))
        return { body: readTapRaw(P("tooMany"), tKey, ["1", "2"]) };
      if (v[tKey] === "2")
        return { goChp: true };
      note = [];
      continue;
    }
    return { body: listing(ctx, r, found.items) };
  }
  return { note };
}
__name(nameStep, "nameStep");
function listing(ctx, r, items) {
  const parts = [];
  for (const item of items.slice(0, MAX_LIST)) {
    const d = describe(item, ctx.permitOf);
    parts.push(P(`type:${d.type}`), say(d.name));
    if (d.baam)
      parts.push(P("baam"));
    if (d.permit === "private")
      parts.push(P("permit:private"), P("permit:private2"));
    else if (d.permit === "both")
      parts.push(P("permit:alsoPrivate"));
    else
      parts.push(P(d.permit === "general" ? "permit:general" : "permit:none"));
  }
  parts.push(P("next"));
  return readTapRaw(parts.join("."), `nx${r}`, ["1", "2"]);
}
__name(listing, "listing");
function readNext(r, noteKeys) {
  return readTapRaw(msg(notes(noteKeys), P("next")), `nx${r}`, ["1", "2"]);
}
__name(readNext, "readNext");
function readSpeech(env, v, r, a, msgParts) {
  const max = intEnv(env.IVR_REC_MAX_SEC, CFG.REC_MAX_SEC);
  const min = intEnv(env.IVR_REC_MIN_SEC, CFG.REC_MIN_SEC);
  const limits = max > 0 ? `,${min},${max}` : "";
  const tail = (env.IVR_VOICE_READ_OPTS || `no,record,{folder},{file},no,yes,no${limits}`).replace("{folder}", recFolder(env)).replace("{file}", recFile(v, r, a)).replace("{min}", String(min)).replace("{max}", String(max));
  return `read=${msgParts}=s${r}_${a},${tail}`;
}
__name(readSpeech, "readSpeech");
var intEnv = /* @__PURE__ */ __name((val, dflt) => {
  const n = parseInt(val, 10);
  return Number.isFinite(n) ? n : dflt;
}, "intEnv");
var recFolder = /* @__PURE__ */ __name((env) => (env.IVR_REC_FOLDER || "/6").replace(/\/$/, ""), "recFolder");
var recFile = /* @__PURE__ */ __name((v, r, a) => `r${String(v.ApiCallId || "x").replace(/\W/g, "")}_${r}_${a}`, "recFile");
async function recognize(env, v, r, a, value) {
  const callId = String(v.ApiCallId || "");
  const slot = r * 10 + a;
  const cached = await sttGet(env, callId, slot);
  if (cached !== null)
    return cached;
  const folder = recFolder(env), file = recFile(v, r, a);
  const { text: text2 } = await transcribeRecording(env, [
    ...looksLikeRecording(value) ? [value] : [],
    `${folder}/${file}.wav`,
    `${folder}/${file}`
  ]);
  await sttPut(env, callId, slot, text2);
  return text2;
}
__name(recognize, "recognize");
function readTapRaw(msgParts, valName, digitsAllowed, opts = {}) {
  const ops = [
    valName,
    "no",
    opts.max != null ? opts.max : 1,
    opts.min != null ? opts.min : 1,
    CFG.SEC_WAIT,
    "No",
    "no",
    "no",
    "",
    digitsAllowed ? digitsAllowed.join(".") : "",
    "",
    "Ok",
    CFG.EMPTY_VAL,
    ""
  ];
  return `read=${msgParts}=${ops.join(",")}`;
}
__name(readTapRaw, "readTapRaw");
var say = /* @__PURE__ */ __name((s) => "t-" + ttsClean(s), "say");
var back = /* @__PURE__ */ __name((env) => env && env.IVR_BACK_FOLDER || CFG.BACK_FOLDER, "back");
var has = /* @__PURE__ */ __name((v, k) => Object.prototype.hasOwnProperty.call(v, k), "has");
var looksLikeRecording = /* @__PURE__ */ __name((s) => /\.(wav|mp3|ogg)$/i.test(s) || /^\/.*\//.test(s), "looksLikeRecording");
function text(body) {
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
__name(text, "text");
async function parseYemot(request) {
  const out = {};
  const url = new URL(request.url);
  for (const [k, val] of url.searchParams)
    out[k] = val;
  if (request.method === "POST") {
    const ct = request.headers.get("content-type") || "";
    if (ct.includes("application/json")) {
      Object.assign(out, await request.json().catch(() => ({})));
    } else {
      const body = await request.text();
      for (const [k, val] of new URLSearchParams(body))
        out[k] = val;
    }
  }
  return out;
}
__name(parseYemot, "parseYemot");

// api/voice-search.js
async function onRequest2({ request, env }) {
  try {
    let q = new URL(request.url).searchParams.get("q");
    if (q === null && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      q = typeof body.q === "string" ? body.q : "";
    }
    q = (q || "").trim().slice(0, 200);
    if (q.length < 2)
      return Response.json({ mode: "empty", total: 0, ambiguous: false, results: [] });
    return Response.json({ query: q, ...searchBusinesses(q, await loadBusinesses(env)) });
  } catch (e) {
    return Response.json({ error: e.message, results: [] }, { status: 500 });
  }
}
__name(onRequest2, "onRequest");

// api/_middleware.js
async function onRequest3(context) {
  const { request, next } = context;
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization"
  };
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  const response = await next();
  const newHeaders = new Headers(response.headers);
  Object.entries(corsHeaders).forEach(([k, v]) => newHeaders.set(k, v));
  return new Response(response.body, {
    status: response.status,
    headers: newHeaders
  });
}
__name(onRequest3, "onRequest");

// ../.wrangler/tmp/pages-odJy4t/functionsRoutes-0.8091530050339826.mjs
var routes = [
  {
    routePath: "/api/permit-docs/:id/file",
    mountPath: "/api/permit-docs/:id",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet]
  },
  {
    routePath: "/api/businesses/:id",
    mountPath: "/api/businesses",
    method: "DELETE",
    middlewares: [],
    modules: [onRequestDelete]
  },
  {
    routePath: "/api/businesses/:id",
    mountPath: "/api/businesses",
    method: "PUT",
    middlewares: [],
    modules: [onRequestPut]
  },
  {
    routePath: "/api/permit-docs-public/:id",
    mountPath: "/api/permit-docs-public",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet2]
  },
  {
    routePath: "/api/permit-docs/:id",
    mountPath: "/api/permit-docs",
    method: "DELETE",
    middlewares: [],
    modules: [onRequestDelete2]
  },
  {
    routePath: "/api/permit-docs/:id",
    mountPath: "/api/permit-docs",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet3]
  },
  {
    routePath: "/api/permit-docs/:id",
    mountPath: "/api/permit-docs",
    method: "PUT",
    middlewares: [],
    modules: [onRequestPut2]
  },
  {
    routePath: "/api/permit-ext/:id",
    mountPath: "/api/permit-ext",
    method: "DELETE",
    middlewares: [],
    modules: [onRequestDelete3]
  },
  {
    routePath: "/api/permit-ext/:id",
    mountPath: "/api/permit-ext",
    method: "PUT",
    middlewares: [],
    modules: [onRequestPut3]
  },
  {
    routePath: "/api/approved-bonds",
    mountPath: "/api",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet4]
  },
  {
    routePath: "/api/approved-bonds",
    mountPath: "/api",
    method: "PUT",
    middlewares: [],
    modules: [onRequestPut4]
  },
  {
    routePath: "/api/businesses",
    mountPath: "/api",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet5]
  },
  {
    routePath: "/api/businesses",
    mountPath: "/api",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost]
  },
  {
    routePath: "/api/change-password",
    mountPath: "/api",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost2]
  },
  {
    routePath: "/api/company-bonds",
    mountPath: "/api",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet6]
  },
  {
    routePath: "/api/debug-tase",
    mountPath: "/api",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet7]
  },
  {
    routePath: "/api/lists",
    mountPath: "/api",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet8]
  },
  {
    routePath: "/api/lists",
    mountPath: "/api",
    method: "OPTIONS",
    middlewares: [],
    modules: [onRequestOptions]
  },
  {
    routePath: "/api/login",
    mountPath: "/api",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet9]
  },
  {
    routePath: "/api/login",
    mountPath: "/api",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost3]
  },
  {
    routePath: "/api/lookup",
    mountPath: "/api",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet10]
  },
  {
    routePath: "/api/permit-docs",
    mountPath: "/api",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet11]
  },
  {
    routePath: "/api/permit-docs",
    mountPath: "/api",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost4]
  },
  {
    routePath: "/api/permit-docs-public",
    mountPath: "/api",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet12]
  },
  {
    routePath: "/api/permit-ext",
    mountPath: "/api",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet13]
  },
  {
    routePath: "/api/permit-ext",
    mountPath: "/api",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost5]
  },
  {
    routePath: "/api/permit-review",
    mountPath: "/api",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet14]
  },
  {
    routePath: "/api/permit-review",
    mountPath: "/api",
    method: "PUT",
    middlewares: [],
    modules: [onRequestPut5]
  },
  {
    routePath: "/api/registry-name-search",
    mountPath: "/api",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet15]
  },
  {
    routePath: "/api/sync-tase",
    mountPath: "/api",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost6]
  },
  {
    routePath: "/api/ivr-company",
    mountPath: "/api",
    method: "",
    middlewares: [],
    modules: [onRequest]
  },
  {
    routePath: "/api/voice-search",
    mountPath: "/api",
    method: "",
    middlewares: [],
    modules: [onRequest2]
  },
  {
    routePath: "/api",
    mountPath: "/api",
    method: "",
    middlewares: [onRequest3],
    modules: []
  }
];

// ../../../../root/.npm/_npx/0eedb5afd4158ff3/node_modules/path-to-regexp/dist.es2015/index.js
function lexer(str) {
  var tokens2 = [];
  var i = 0;
  while (i < str.length) {
    var char = str[i];
    if (char === "*" || char === "+" || char === "?") {
      tokens2.push({ type: "MODIFIER", index: i, value: str[i++] });
      continue;
    }
    if (char === "\\") {
      tokens2.push({ type: "ESCAPED_CHAR", index: i++, value: str[i++] });
      continue;
    }
    if (char === "{") {
      tokens2.push({ type: "OPEN", index: i, value: str[i++] });
      continue;
    }
    if (char === "}") {
      tokens2.push({ type: "CLOSE", index: i, value: str[i++] });
      continue;
    }
    if (char === ":") {
      var name = "";
      var j = i + 1;
      while (j < str.length) {
        var code = str.charCodeAt(j);
        if (
          // `0-9`
          code >= 48 && code <= 57 || // `A-Z`
          code >= 65 && code <= 90 || // `a-z`
          code >= 97 && code <= 122 || // `_`
          code === 95
        ) {
          name += str[j++];
          continue;
        }
        break;
      }
      if (!name)
        throw new TypeError("Missing parameter name at ".concat(i));
      tokens2.push({ type: "NAME", index: i, value: name });
      i = j;
      continue;
    }
    if (char === "(") {
      var count = 1;
      var pattern = "";
      var j = i + 1;
      if (str[j] === "?") {
        throw new TypeError('Pattern cannot start with "?" at '.concat(j));
      }
      while (j < str.length) {
        if (str[j] === "\\") {
          pattern += str[j++] + str[j++];
          continue;
        }
        if (str[j] === ")") {
          count--;
          if (count === 0) {
            j++;
            break;
          }
        } else if (str[j] === "(") {
          count++;
          if (str[j + 1] !== "?") {
            throw new TypeError("Capturing groups are not allowed at ".concat(j));
          }
        }
        pattern += str[j++];
      }
      if (count)
        throw new TypeError("Unbalanced pattern at ".concat(i));
      if (!pattern)
        throw new TypeError("Missing pattern at ".concat(i));
      tokens2.push({ type: "PATTERN", index: i, value: pattern });
      i = j;
      continue;
    }
    tokens2.push({ type: "CHAR", index: i, value: str[i++] });
  }
  tokens2.push({ type: "END", index: i, value: "" });
  return tokens2;
}
__name(lexer, "lexer");
function parse(str, options) {
  if (options === void 0) {
    options = {};
  }
  var tokens2 = lexer(str);
  var _a = options.prefixes, prefixes = _a === void 0 ? "./" : _a, _b = options.delimiter, delimiter = _b === void 0 ? "/#?" : _b;
  var result = [];
  var key = 0;
  var i = 0;
  var path = "";
  var tryConsume = /* @__PURE__ */ __name(function(type) {
    if (i < tokens2.length && tokens2[i].type === type)
      return tokens2[i++].value;
  }, "tryConsume");
  var mustConsume = /* @__PURE__ */ __name(function(type) {
    var value2 = tryConsume(type);
    if (value2 !== void 0)
      return value2;
    var _a2 = tokens2[i], nextType = _a2.type, index = _a2.index;
    throw new TypeError("Unexpected ".concat(nextType, " at ").concat(index, ", expected ").concat(type));
  }, "mustConsume");
  var consumeText = /* @__PURE__ */ __name(function() {
    var result2 = "";
    var value2;
    while (value2 = tryConsume("CHAR") || tryConsume("ESCAPED_CHAR")) {
      result2 += value2;
    }
    return result2;
  }, "consumeText");
  var isSafe = /* @__PURE__ */ __name(function(value2) {
    for (var _i = 0, delimiter_1 = delimiter; _i < delimiter_1.length; _i++) {
      var char2 = delimiter_1[_i];
      if (value2.indexOf(char2) > -1)
        return true;
    }
    return false;
  }, "isSafe");
  var safePattern = /* @__PURE__ */ __name(function(prefix2) {
    var prev = result[result.length - 1];
    var prevText = prefix2 || (prev && typeof prev === "string" ? prev : "");
    if (prev && !prevText) {
      throw new TypeError('Must have text between two parameters, missing text after "'.concat(prev.name, '"'));
    }
    if (!prevText || isSafe(prevText))
      return "[^".concat(escapeString(delimiter), "]+?");
    return "(?:(?!".concat(escapeString(prevText), ")[^").concat(escapeString(delimiter), "])+?");
  }, "safePattern");
  while (i < tokens2.length) {
    var char = tryConsume("CHAR");
    var name = tryConsume("NAME");
    var pattern = tryConsume("PATTERN");
    if (name || pattern) {
      var prefix = char || "";
      if (prefixes.indexOf(prefix) === -1) {
        path += prefix;
        prefix = "";
      }
      if (path) {
        result.push(path);
        path = "";
      }
      result.push({
        name: name || key++,
        prefix,
        suffix: "",
        pattern: pattern || safePattern(prefix),
        modifier: tryConsume("MODIFIER") || ""
      });
      continue;
    }
    var value = char || tryConsume("ESCAPED_CHAR");
    if (value) {
      path += value;
      continue;
    }
    if (path) {
      result.push(path);
      path = "";
    }
    var open = tryConsume("OPEN");
    if (open) {
      var prefix = consumeText();
      var name_1 = tryConsume("NAME") || "";
      var pattern_1 = tryConsume("PATTERN") || "";
      var suffix = consumeText();
      mustConsume("CLOSE");
      result.push({
        name: name_1 || (pattern_1 ? key++ : ""),
        pattern: name_1 && !pattern_1 ? safePattern(prefix) : pattern_1,
        prefix,
        suffix,
        modifier: tryConsume("MODIFIER") || ""
      });
      continue;
    }
    mustConsume("END");
  }
  return result;
}
__name(parse, "parse");
function match(str, options) {
  var keys = [];
  var re = pathToRegexp(str, keys, options);
  return regexpToFunction(re, keys, options);
}
__name(match, "match");
function regexpToFunction(re, keys, options) {
  if (options === void 0) {
    options = {};
  }
  var _a = options.decode, decode = _a === void 0 ? function(x) {
    return x;
  } : _a;
  return function(pathname) {
    var m = re.exec(pathname);
    if (!m)
      return false;
    var path = m[0], index = m.index;
    var params = /* @__PURE__ */ Object.create(null);
    var _loop_1 = /* @__PURE__ */ __name(function(i2) {
      if (m[i2] === void 0)
        return "continue";
      var key = keys[i2 - 1];
      if (key.modifier === "*" || key.modifier === "+") {
        params[key.name] = m[i2].split(key.prefix + key.suffix).map(function(value) {
          return decode(value, key);
        });
      } else {
        params[key.name] = decode(m[i2], key);
      }
    }, "_loop_1");
    for (var i = 1; i < m.length; i++) {
      _loop_1(i);
    }
    return { path, index, params };
  };
}
__name(regexpToFunction, "regexpToFunction");
function escapeString(str) {
  return str.replace(/([.+*?=^!:${}()[\]|/\\])/g, "\\$1");
}
__name(escapeString, "escapeString");
function flags(options) {
  return options && options.sensitive ? "" : "i";
}
__name(flags, "flags");
function regexpToRegexp(path, keys) {
  if (!keys)
    return path;
  var groupsRegex = /\((?:\?<(.*?)>)?(?!\?)/g;
  var index = 0;
  var execResult = groupsRegex.exec(path.source);
  while (execResult) {
    keys.push({
      // Use parenthesized substring match if available, index otherwise
      name: execResult[1] || index++,
      prefix: "",
      suffix: "",
      modifier: "",
      pattern: ""
    });
    execResult = groupsRegex.exec(path.source);
  }
  return path;
}
__name(regexpToRegexp, "regexpToRegexp");
function arrayToRegexp(paths, keys, options) {
  var parts = paths.map(function(path) {
    return pathToRegexp(path, keys, options).source;
  });
  return new RegExp("(?:".concat(parts.join("|"), ")"), flags(options));
}
__name(arrayToRegexp, "arrayToRegexp");
function stringToRegexp(path, keys, options) {
  return tokensToRegexp(parse(path, options), keys, options);
}
__name(stringToRegexp, "stringToRegexp");
function tokensToRegexp(tokens2, keys, options) {
  if (options === void 0) {
    options = {};
  }
  var _a = options.strict, strict = _a === void 0 ? false : _a, _b = options.start, start = _b === void 0 ? true : _b, _c = options.end, end = _c === void 0 ? true : _c, _d = options.encode, encode = _d === void 0 ? function(x) {
    return x;
  } : _d, _e = options.delimiter, delimiter = _e === void 0 ? "/#?" : _e, _f = options.endsWith, endsWith = _f === void 0 ? "" : _f;
  var endsWithRe = "[".concat(escapeString(endsWith), "]|$");
  var delimiterRe = "[".concat(escapeString(delimiter), "]");
  var route2 = start ? "^" : "";
  for (var _i = 0, tokens_1 = tokens2; _i < tokens_1.length; _i++) {
    var token = tokens_1[_i];
    if (typeof token === "string") {
      route2 += escapeString(encode(token));
    } else {
      var prefix = escapeString(encode(token.prefix));
      var suffix = escapeString(encode(token.suffix));
      if (token.pattern) {
        if (keys)
          keys.push(token);
        if (prefix || suffix) {
          if (token.modifier === "+" || token.modifier === "*") {
            var mod = token.modifier === "*" ? "?" : "";
            route2 += "(?:".concat(prefix, "((?:").concat(token.pattern, ")(?:").concat(suffix).concat(prefix, "(?:").concat(token.pattern, "))*)").concat(suffix, ")").concat(mod);
          } else {
            route2 += "(?:".concat(prefix, "(").concat(token.pattern, ")").concat(suffix, ")").concat(token.modifier);
          }
        } else {
          if (token.modifier === "+" || token.modifier === "*") {
            throw new TypeError('Can not repeat "'.concat(token.name, '" without a prefix and suffix'));
          }
          route2 += "(".concat(token.pattern, ")").concat(token.modifier);
        }
      } else {
        route2 += "(?:".concat(prefix).concat(suffix, ")").concat(token.modifier);
      }
    }
  }
  if (end) {
    if (!strict)
      route2 += "".concat(delimiterRe, "?");
    route2 += !options.endsWith ? "$" : "(?=".concat(endsWithRe, ")");
  } else {
    var endToken = tokens2[tokens2.length - 1];
    var isEndDelimited = typeof endToken === "string" ? delimiterRe.indexOf(endToken[endToken.length - 1]) > -1 : endToken === void 0;
    if (!strict) {
      route2 += "(?:".concat(delimiterRe, "(?=").concat(endsWithRe, "))?");
    }
    if (!isEndDelimited) {
      route2 += "(?=".concat(delimiterRe, "|").concat(endsWithRe, ")");
    }
  }
  return new RegExp(route2, flags(options));
}
__name(tokensToRegexp, "tokensToRegexp");
function pathToRegexp(path, keys, options) {
  if (path instanceof RegExp)
    return regexpToRegexp(path, keys);
  if (Array.isArray(path))
    return arrayToRegexp(path, keys, options);
  return stringToRegexp(path, keys, options);
}
__name(pathToRegexp, "pathToRegexp");

// ../../../../root/.npm/_npx/0eedb5afd4158ff3/node_modules/wrangler/templates/pages-template-worker.ts
var escapeRegex = /[.+?^${}()|[\]\\]/g;
function* executeRequest(request) {
  const requestPath = new URL(request.url).pathname;
  for (const route2 of [...routes].reverse()) {
    if (route2.method && route2.method !== request.method) {
      continue;
    }
    const routeMatcher = match(route2.routePath.replace(escapeRegex, "\\$&"), {
      end: false
    });
    const mountMatcher = match(route2.mountPath.replace(escapeRegex, "\\$&"), {
      end: false
    });
    const matchResult = routeMatcher(requestPath);
    const mountMatchResult = mountMatcher(requestPath);
    if (matchResult && mountMatchResult) {
      for (const handler of route2.middlewares.flat()) {
        yield {
          handler,
          params: matchResult.params,
          path: mountMatchResult.path
        };
      }
    }
  }
  for (const route2 of routes) {
    if (route2.method && route2.method !== request.method) {
      continue;
    }
    const routeMatcher = match(route2.routePath.replace(escapeRegex, "\\$&"), {
      end: true
    });
    const mountMatcher = match(route2.mountPath.replace(escapeRegex, "\\$&"), {
      end: false
    });
    const matchResult = routeMatcher(requestPath);
    const mountMatchResult = mountMatcher(requestPath);
    if (matchResult && mountMatchResult && route2.modules.length) {
      for (const handler of route2.modules.flat()) {
        yield {
          handler,
          params: matchResult.params,
          path: matchResult.path
        };
      }
      break;
    }
  }
}
__name(executeRequest, "executeRequest");
var pages_template_worker_default = {
  async fetch(originalRequest, env, workerContext) {
    let request = originalRequest;
    const handlerIterator = executeRequest(request);
    let data = {};
    let isFailOpen = false;
    const next = /* @__PURE__ */ __name(async (input, init) => {
      if (input !== void 0) {
        let url = input;
        if (typeof input === "string") {
          url = new URL(input, request.url).toString();
        }
        request = new Request(url, init);
      }
      const result = handlerIterator.next();
      if (result.done === false) {
        const { handler, params, path } = result.value;
        const context = {
          request: new Request(request.clone()),
          functionPath: path,
          next,
          params,
          get data() {
            return data;
          },
          set data(value) {
            if (typeof value !== "object" || value === null) {
              throw new Error("context.data must be an object");
            }
            data = value;
          },
          env,
          waitUntil: workerContext.waitUntil.bind(workerContext),
          passThroughOnException: () => {
            isFailOpen = true;
          }
        };
        const response = await handler(context);
        if (!(response instanceof Response)) {
          throw new Error("Your Pages function should return a Response");
        }
        return cloneResponse(response);
      } else if ("ASSETS") {
        const response = await env["ASSETS"].fetch(request);
        return cloneResponse(response);
      } else {
        const response = await fetch(request);
        return cloneResponse(response);
      }
    }, "next");
    try {
      return await next();
    } catch (error) {
      if (isFailOpen) {
        const response = await env["ASSETS"].fetch(request);
        return cloneResponse(response);
      }
      throw error;
    }
  }
};
var cloneResponse = /* @__PURE__ */ __name((response) => (
  // https://fetch.spec.whatwg.org/#null-body-status
  new Response(
    [101, 204, 205, 304].includes(response.status) ? null : response.body,
    response
  )
), "cloneResponse");

// ../../../../root/.npm/_npx/0eedb5afd4158ff3/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// ../../../../root/.npm/_npx/0eedb5afd4158ff3/node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    return Response.json(error, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// ../.wrangler/tmp/bundle-ZRmA18/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = pages_template_worker_default;

// ../../../../root/.npm/_npx/0eedb5afd4158ff3/node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// ../.wrangler/tmp/bundle-ZRmA18/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof __Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
__name(__Facade_ScheduledController__, "__Facade_ScheduledController__");
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = (request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    };
    #dispatcher = (type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    };
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=functionsWorker-0.90535873971421.mjs.map
