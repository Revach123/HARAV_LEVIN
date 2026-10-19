# -*- coding: utf-8 -*-
"""
דשבורד מקומי לאישור קישורים בין מסמכי היתר עיסקא לחברות ולסלוטים (הת"ע פרטי / כללי).
עובר על כל הרשימה שהפיק old_vs_site.py (תוכנית + הצעות לפי ח.פ.): לכל פריט רואים את המסמך, את החברה ואת הראיות
(שם זהה, ח.פ. שנמצא בתוך המסמך, שיוך קיים), ובלחיצת "אשר" הקישור נשמר מיד באתר (שיוך לחברה + קישור לסלוט).
כל פעולה נרשמת, ואפשר לבטל אותה ("ביטול"). דילוג / "לא מתאים" נשמרים מקומית ולא משנים כלום באתר.

הרצה מתיקיית האתר המקומי (אחרי old_vs_site.py):
    python link_review_server.py
ואז לפתוח http://localhost:8766     (סיסמת מנהל: ADMIN_PASSWORD / admin_password.txt / תישאל)

קבצים: link_decisions.jsonl (החלטות, אפשר להפסיק ולהמשיך), link_undo.jsonl (מצב קודם של כל מסמך שנשנה).
"""
import argparse
import base64
import csv
import getpass
import json
import os
import ssl
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

LOCK = threading.Lock()
PDFC = {}          # מזהה מסמך -> bytes של ה-PDF (מטמון בזיכרון, כדי שהמסמכים הבאים ייפתחו מיד)
PDFL = threading.Lock()
A = None
TOKEN = ""
S = {"docs": {}, "biz": {}, "hp": {}, "items": [], "dec": {}, "strict": True}
SLOT_HE = {"general": "כללי", "private": "פרטי"}
CONF_ORDER = ["גבוהה מאוד", "גבוהה", "בינונית", "נמוכה", "הצעת ח.פ."]


def ctx():
    c = ssl.create_default_context()
    if not S["strict"] and hasattr(ssl, "VERIFY_X509_STRICT"):
        c.verify_flags &= ~ssl.VERIFY_X509_STRICT
    return c


def site(path, body=None, method=None, raw=False):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(A.site.rstrip("/") + "/api" + path, data=data, method=method or ("PUT" if data else "GET"),
                                 headers={"User-Agent": "Mozilla/5.0 (link-review)", "Authorization": "Bearer " + TOKEN, "Content-Type": "application/json"})
    last = None
    for attempt in range(5):
        try:
            with urllib.request.urlopen(req, timeout=90, context=ctx()) as r:
                b = r.read()
                return b if raw else json.loads(b.decode("utf-8"))
        except urllib.error.HTTPError as e:
            raise RuntimeError(f"{e.code}: {e.read().decode('utf-8', 'replace')[:200]}")
        except urllib.error.URLError as e:
            last = e
            if S["strict"] and isinstance(e.reason, ssl.SSLCertVerificationError) and "key usage" in str(e.reason):
                S["strict"] = False
                continue
        except (TimeoutError, OSError) as e:
            last = e
        time.sleep(2 * (attempt + 1))
    raise RuntimeError(str(last))


def rcsv(p):
    return list(csv.DictReader(open(p, encoding="utf-8-sig"))) if os.path.exists(p) else []


def bname(i):
    b = S["biz"].get(i) or {}
    return (b.get("permit_name") or b.get("registrar_name") or i) + (f" ({b.get('chp_number')})" if b.get("chp_number") else "")


def load_site():
    docs = site("/permit-docs")["docs"]
    biz = site("/businesses")
    biz = biz if isinstance(biz, list) else biz.get("businesses", [])
    S["docs"] = {d["id"]: d for d in docs}
    S["biz"] = {b["id"]: b for b in biz}
    try:
        hp = {}
        for r in site("/permit-text?hints=1").get("hp") or []:
            hp.setdefault(r["id"], set()).add(str(r["hp"]).zfill(9))
        S["hp"] = hp
    except Exception:  # noqa: BLE001
        S["hp"] = {}


def load_posts():
    S["posts"] = {}
    for r in rcsv(A.posts):
        if r.get("חתימה"):
            S["posts"].setdefault(r["חתימה"][:12], []).append((r.get("סוג", ""), r.get("כותרת (חברה בישן)", "")))


def build_items():
    items, seen = [], set()
    for r in rcsv(A.plan):
        key = (r["doc_id"], r["business_id"], r["סלוט"])
        if key in seen:
            continue
        seen.add(key)
        items.append({"key": "|".join(key), "doc_id": r["doc_id"], "business_id": r["business_id"], "slot": r["סלוט"], "conf": r["ביטחון"],
                      "evidence": r.get("ראיות", ""), "old_title": r.get("כותרת בישן", ""), "note": r.get("הערה מהחילוץ", ""), "how": r.get("התאמת שם", "")})
    inv = {v: k for k, v in SLOT_HE.items()}
    for r in rcsv(A.suggest):
        if r.get("מתאים לסלוט") != "כן":
            continue
        key = (r["doc_id"], r["business_id"], inv.get(r["סלוט שחסר"], r["סלוט שחסר"]))
        if key in seen:
            continue
        seen.add(key)
        items.append({"key": "|".join(key), "doc_id": key[0], "business_id": key[1], "slot": key[2], "conf": "הצעת ח.פ.",
                      "evidence": "ח.פ. החברה נמצא בטקסט המסמך (אין פוסט ישן תואם)", "old_title": "", "note": "", "how": "לפי ח.פ."})
    items.sort(key=lambda x: (CONF_ORDER.index(x["conf"]) if x["conf"] in CONF_ORDER else 9, bname(x["business_id"])))
    S["items"] = items


def load_decisions():
    S["dec"] = {}
    if os.path.exists(A.decisions):
        for line in open(A.decisions, encoding="utf-8"):
            if line.strip():
                e = json.loads(line)
                S["dec"][e["key"]] = e


def decide(key, what, undo=None):
    e = {"key": key, "decision": what, "time": time.strftime("%Y-%m-%d %H:%M:%S")}
    if undo:
        e["undo"] = undo
    S["dec"][key] = e
    with open(A.decisions, "a", encoding="utf-8") as f:
        f.write(json.dumps(e, ensure_ascii=False) + "\n")


def slot_holder(b, t, except_doc):
    for d in S["docs"].values():
        if d["id"] != except_doc and d.get("doc_type") != "other" and t in str((d.get("slots") or {}).get(b, "")).split(","):
            return d
    return None


def company_state(bid, doc_id):
    b = S["biz"].get(bid) or {}
    vis = b.get("visibility") or ""
    need = {"private": vis in ("פרטי", "רק פרטי"), "general": vis != "רק פרטי"}
    linked = [d for d in S["docs"].values() if bid in (d.get("business_ids") or []) and d.get("doc_type") != "other"]
    slots = {}
    for t in ("private", "general"):
        h = next((d for d in linked if t in str((d.get("slots") or {}).get(bid, "")).split(",")), None)
        slots[t] = h and {"name": h.get("original_name") or h["id"], "self": h["id"] == doc_id}
    others = [{"name": d.get("original_name") or d["id"], "type": d.get("doc_type"), "slots": [SLOT_HE.get(x, x) for x in str((d.get("slots") or {}).get(bid, "")).split(",") if x], "pages": d.get("pages")}
              for d in linked if d["id"] != doc_id]
    return need, slots, others


def advice(it, need, slots, others, old_types, doc_type):
    parts, both = [], False
    if not others:
        parts.append("זה המסמך היחיד של החברה במאגר")
    else:
        parts.append(f"לחברה יש עוד {len(others)} מסמכים אחרים (ראה למטה)")
    if old_types:
        parts.append("באתר הישן הקובץ הזה הופיע כהת\"ע " + " וגם ".join(sorted(set(old_types))))
    need_he = [SLOT_HE[t] for t in ("private", "general") if need[t]]
    parts.append("החברה רשומה " + (" + ".join(need_he) if need_he else "") + (" ולכן דורשת גם פרטי וגם כללי" if len(need_he) == 2 else ""))
    open_ = [t for t in ("private", "general") if need[t] and not slots[t]]
    if len(open_) == 2 and not others:
        parts.append("אין לה מסמך אחר, ולכן אם אין סיבה אחרת מומלץ לקשר אותו לשני הסלוטים (כמו שנהוג כשמסמך אחד משמש כללי ופרטי)")
        both = True
    elif len(open_) == 2 and set(old_types) >= {"כללי", "פרטי"}:
        parts.append("האתר הישן הציג אותו לשני הסוגים: מומלץ לשני הסלוטים")
        both = True
    return ". ".join(parts) + ".", both, open_


def view(it):
    d, b = S["docs"].get(it["doc_id"]) or {}, S["biz"].get(it["business_id"]) or {}
    have = [x for x in str((d.get("slots") or {}).get(it["business_id"], "")).split(",") if x]
    holder = None if it["slot"] in have else slot_holder(it["business_id"], it["slot"], it["doc_id"])
    dec = S["dec"].get(it["key"])
    hps = sorted(S["hp"].get(it["doc_id"], set()))
    mine = "".join(c for c in str(b.get("chp_number") or "") if c.isdigit()).zfill(9) if b.get("chp_number") else ""
    state = "בוצע" if it["slot"] in have else (dec["decision"] if dec and dec["decision"] in ("דולג", "לא מתאים") else "פתוח")
    need, cslots, others = company_state(it["business_id"], it["doc_id"])
    sha12 = (d.get("sha256") or "")[:12]
    old_refs = S.get("posts", {}).get(sha12, [])
    rec, both, open_ = advice(it, need, cslots, others, [t for t, _ in old_refs if t in ("כללי", "פרטי")], d.get("doc_type"))
    other_slot = [t for t in open_ if t != it["slot"]]
    other_items = [{"name": (S["docs"].get(x["doc_id"]) or {}).get("original_name") or x["doc_id"], "slot": SLOT_HE.get(x["slot"], x["slot"])} for x in S["items"] if x["business_id"] == it["business_id"] and x["doc_id"] != it["doc_id"]][:6]
    return {**it, "need": need, "cslots": cslots, "others": others[:8], "old_refs": [f"{t}: {ti}" for t, ti in old_refs[:6]], "rec": rec, "both": both and bool(other_slot) and not holder, "other_slot": other_slot[0] if other_slot else "",
            "other_items": other_items, "company": bname(it["business_id"]), "vis": b.get("visibility") or "כללי", "chp": b.get("chp_number") or "", "entity": b.get("entity_type") or "",
            "doc_name": d.get("original_name") or it["doc_id"], "doc_type": d.get("doc_type"), "pages": d.get("pages"),
            "linked": [bname(i) for i in (d.get("business_ids") or [])], "assoc": it["business_id"] in (d.get("business_ids") or []),
            "holder": holder and (holder.get("original_name") or holder["id"]), "hps": hps[:12], "hp_ok": bool(mine and mine in hps), "hp_bad": bool(mine and hps and mine not in hps),
            "state": state, "slot_he": SLOT_HE.get(it["slot"], it["slot"])}


def approve(doc_id, biz_id, slot, replace=False, extra=None):
    with LOCK:
        d = site("/permit-docs/" + doc_id)["doc"]
        undo = [{"id": doc_id, "business_ids": d.get("business_ids") or [], "slots": d.get("slots") or {}}]
        holder = slot_holder(biz_id, slot, doc_id)
        if holder and not replace:
            raise RuntimeError("הסלוט כבר תפוס במסמך אחר: " + (holder.get("original_name") or holder["id"]))
        if holder:
            h = site("/permit-docs/" + holder["id"])["doc"]
            undo.append({"id": holder["id"], "business_ids": h.get("business_ids") or [], "slots": h.get("slots") or {}})
        ids = list(d.get("business_ids") or [])
        if biz_id not in ids:
            ids.append(biz_id)
        have = [x for x in str((d.get("slots") or {}).get(biz_id, "")).split(",") if x]
        for sl in [slot] + ([extra] if extra else []):
            if extra and sl == extra and slot_holder(biz_id, extra, doc_id):
                raise RuntimeError("הסלוט השני תפוס במסמך אחר")
            if sl not in have:
                have.append(sl)
        with open(A.undo, "a", encoding="utf-8") as f:
            f.write(json.dumps({"time": time.strftime("%Y-%m-%d %H:%M:%S"), "undo": undo}, ensure_ascii=False) + "\n")
        site("/permit-docs/" + doc_id, {"business_ids": ids, "slots": {biz_id: have}})
        for u in undo:
            S["docs"][u["id"]] = site("/permit-docs/" + u["id"])["doc"]
        return undo


def revert(undo):
    with LOCK:
        for u in reversed(undo):
            cur = site("/permit-docs/" + u["id"])["doc"]
            prev = u["slots"]
            body = {b: [x for x in str(prev.get(b, "")).split(",") if x] for b in set(cur.get("slots") or {}) | set(prev)}          # סלוט שלא היה קודם נשלח ריק (אחרת השרת משאיר אותו)
            site("/permit-docs/" + u["id"], {"business_ids": u["business_ids"], "slots": body})
            S["docs"][u["id"]] = site("/permit-docs/" + u["id"])["doc"]


def get_pdf(doc_id):
    with PDFL:
        if doc_id in PDFC:
            return PDFC[doc_id]
    j = site("/permit-docs/" + doc_id + "/file?enc=b64")          # JSON עם base64 (כמו בדשבורד): עובד גם ברשת עם סינון תוכן שחוסמת הורדת PDF
    data = base64.b64decode(j["data"])
    with PDFL:
        PDFC[doc_id] = data
        while len(PDFC) > 60:
            PDFC.pop(next(iter(PDFC)))
    return data


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def send(self, code, body, ctype="application/json; charset=utf-8", cache=False):
        b = body if isinstance(body, bytes) else (body if isinstance(body, str) else json.dumps(body, ensure_ascii=False)).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        try:
            self.send_header("Content-Length", str(len(b)))
            if cache:
                self.send_header("Cache-Control", "private, max-age=3600")
            self.end_headers()
            self.wfile.write(b)
        except (ConnectionError, OSError):          # הדפדפן ביטל את הבקשה (למשל מעבר מהיר למסמך הבא): לא שגיאה
            pass

    def do_GET(self):
        u = urlparse(self.path)
        q = parse_qs(u.query)
        try:
            if u.path == "/":
                return self.send(200, HTML, "text/html; charset=utf-8")
            if u.path == "/api/items":
                return self.send(200, [view(i) for i in S["items"]])
            if u.path.startswith("/api/pdf/"):
                return self.send(200, get_pdf(u.path.rsplit("/", 1)[1]), "application/pdf", cache=True)
            if u.path == "/api/biz":
                t = (q.get("q") or [""])[0].strip().lower()
                dg = "".join(c for c in t if c.isdigit())
                out = [{"id": b["id"], "name": bname(b["id"]), "vis": b.get("visibility") or "כללי"} for b in S["biz"].values()
                       if t and (t in (b.get("permit_name") or "").lower() or t in (b.get("registrar_name") or "").lower() or (len(dg) >= 4 and dg in str(b.get("chp_number") or "")))][:15]
                return self.send(200, out)
            if u.path == "/api/reload":
                load_site(); load_posts(); load_decisions(); build_items()
                return self.send(200, {"ok": True})
            return self.send(404, {"error": "לא נמצא"})
        except Exception as e:  # noqa: BLE001
            return self.send(500, {"error": str(e)})

    def do_POST(self):
        try:
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0)) or 0) or b"{}")
            if self.path == "/api/approve":
                undo = approve(body["doc_id"], body["business_id"], body["slot"], bool(body.get("replace")), body.get("extra"))
                decide(body["key"], "אושר", undo)
                return self.send(200, {"ok": True})
            if self.path == "/api/skip":
                decide(body["key"], body.get("decision") or "דולג")
                return self.send(200, {"ok": True})
            if self.path == "/api/undo":
                e = S["dec"].get(body["key"])
                if e and e.get("undo"):
                    revert(e["undo"])
                decide(body["key"], "בוטל")
                return self.send(200, {"ok": True})
            return self.send(404, {"error": "לא נמצא"})
        except Exception as e:  # noqa: BLE001
            return self.send(500, {"error": str(e)})


HTML = r"""<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>אישור קישורי היתרים</title>
<style>
body{margin:0;font-family:system-ui,Arial,sans-serif;background:#10222a;color:#1b2b33;display:flex;flex-direction:column;height:100vh}
#top{background:#274d5b;color:#fff;padding:8px 14px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
#top b{margin-inline-end:10px}.tab{background:#3b6678;border:0;color:#fff;border-radius:16px;padding:5px 12px;cursor:pointer;font-size:14px}.tab.on{background:#fff;color:#274d5b;font-weight:700}
#main{flex:1;display:flex;min-height:0}#list{width:300px;overflow:auto;background:#eef3f5;border-inline-end:2px solid #274d5b}
.it{padding:7px 10px;border-bottom:1px solid #d5dfe3;cursor:pointer;font-size:13px}.it.cur{background:#fff3c4}.it.done{color:#1e7e4a}.it.skip{color:#888;text-decoration:line-through}
.cf{display:inline-block;border-radius:9px;padding:0 7px;font-size:11px;color:#fff;margin-inline-start:4px}
#card{flex:1;display:flex;min-width:0;background:#fff}#side{width:430px;padding:14px 16px;overflow:auto;border-inline-end:1px solid #cfd9dd}
#pv{flex:1;display:flex;flex-direction:column;min-width:0}#pt{padding:4px 10px;background:#eef3f5;border-bottom:1px solid #cfd9dd;display:flex;gap:6px;align-items:center}#pt button{border:0;background:#dbe5ea;border-radius:6px;padding:4px 10px;font-size:16px;cursor:pointer}#pw{flex:1;position:relative;overflow:hidden;background:#777}#pdf{border:0;position:absolute;top:50%;left:50%;width:100%;height:100%;transform:translate(-50%,-50%);background:#fff}h2{margin:0 0 8px;font-size:20px}.row{margin:5px 0;font-size:14px}.k{color:#667;font-size:12px}
.ev{background:#e9f6ee;border:1px solid #b7dfc6;border-radius:8px;padding:6px 9px;margin:8px 0;font-size:13px}.ev.bad{background:#fdecea;border-color:#f0b9b3}
.btn{border:0;border-radius:9px;padding:9px 16px;font-size:15px;cursor:pointer;margin:3px 0}.ok{background:#1e7e4a;color:#fff;font-weight:700;font-size:17px}.sk{background:#e4e9ec}.no{background:#c0392b;color:#fff}.un{background:#d98a1b;color:#fff}
input{padding:6px;border:1px solid #aab;border-radius:6px;width:92%}#res div{padding:5px;border-bottom:1px solid #eee;cursor:pointer}#res div:hover{background:#fff3c4}
#msg{position:fixed;bottom:12px;left:50%;transform:translateX(-50%);background:#222;color:#fff;padding:8px 16px;border-radius:8px;display:none}
</style></head><body>
<div id="top"><b>אישור קישורי היתרים</b><span id="tabs"></span><span id="prog"></span></div>
<div id="main"><div id="list"></div><div id="card"><div id="side"></div><div id="pv"><div id="pt"><button onclick="rot(-1)" title="סיבוב שמאלה (Shift+R)">⟲</button><button onclick="rot(1)" title="סיבוב ימינה (R)">⟳</button><button onclick="rot(0)" title="איפוס סיבוב">איפוס</button><span id="pr" style="font-size:13px;color:#667"></span><span style="font-size:12px;color:#889">סיבוב התצוגה בלבד (לא משנה את הקובץ)</span></div><div id="pw"><iframe id="pdf"></iframe></div></div></div></div><div id="msg"></div>
<script>
let ITEMS=[],CUR=0,TAB="פתוח",OVR=null;const PEND=new Set();
const CF={"גבוהה מאוד":"#1e7e4a","גבוהה":"#3f8f5a","בינונית":"#b8860b","נמוכה":"#c0392b","הצעת ח.פ.":"#3f6ea8"};
const $=id=>document.getElementById(id),E=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
function msg(t){const m=$("msg");m.textContent=t;m.style.display="block";clearTimeout(m._t);m._t=setTimeout(()=>m.style.display="none",3500)}
async function api(p,b){const r=await fetch(p,b?{method:"POST",body:JSON.stringify(b)}:{});const j=await r.json();if(!r.ok)throw new Error(j.error||r.status);return j}
async function load(keep){const k=keep&&ITEMS[CUR]&&ITEMS[CUR].key;ITEMS=await api("/api/items");const v=vis();let i=v.findIndex(x=>x.key===k);CUR=i>=0?i:0;draw()}
function vis(){return ITEMS.filter(x=>!PEND.has(x.key)).filter(x=>TAB==="הכל"||(TAB==="פתוח"?x.state==="פתוח":TAB==="בוצע"?x.state==="בוצע":TAB==="דולג"?(x.state==="דולג"||x.state==="לא מתאים"):x.conf===TAB&&x.state==="פתוח"))}
function draw(){const v=vis();const cnt=t=>ITEMS.filter(x=>x.conf===t&&x.state==="פתוח").length;
$("tabs").innerHTML=["פתוח","בוצע","דולג"].map(t=>`<button class="tab ${TAB===t?"on":""}" onclick="tab('${t}')">${t} (${ITEMS.filter(x=>t==="פתוח"?x.state==="פתוח":t==="בוצע"?x.state==="בוצע":(x.state==="דולג"||x.state==="לא מתאים")).length})</button>`).join("")+" | "+Object.keys(CF).map(t=>`<button class="tab ${TAB===t?"on":""}" onclick="tab('${t}')">${t} (${cnt(t)})</button>`).join("");
$("prog").textContent=`  בוצעו ${ITEMS.filter(x=>x.state==="בוצע").length} מתוך ${ITEMS.length}`+(PEND.size?`  ·  ⏳ מעלה לאתר: ${PEND.size}`:"");
$("list").innerHTML=v.map((x,i)=>`<div class="it ${i===CUR?"cur":""} ${x.state==="בוצע"?"done":x.state==="פתוח"?"":"skip"}" onclick="go(${i})"><span class="cf" style="background:${CF[x.conf]||"#555"}">${x.conf}</span>${E(x.company)}<br><span class="k">${E(x.slot_he)} · ${E(x.doc_name)}</span></div>`).join("")||"<div class='it'>אין פריטים</div>";
card()}
let ROT={};try{ROT=JSON.parse(localStorage.getItem("rot")||"{}")}catch(e){}
function applyRot(){const x=vis()[CUR],d=x?(ROT[x.doc_id]||0):0,w=$("pw"),f=$("pdf");if(!w)return;if(d%180){f.style.width=w.clientHeight+"px";f.style.height=w.clientWidth+"px"}else{f.style.width="100%";f.style.height="100%"}f.style.transform=`translate(-50%,-50%) rotate(${d}deg)`;$("pr").textContent=d?d+"°":""}
function rot(dir){const x=vis()[CUR];if(!x)return;ROT[x.doc_id]=dir?((ROT[x.doc_id]||0)+dir*90+360)%360:0;try{localStorage.setItem("rot",JSON.stringify(ROT))}catch(e){}applyRot()}
window.addEventListener("resize",applyRot);
const PRE=new Set();function prefetch(){const v=vis();for(let i=1;i<=4;i++){const x=v[CUR+i];if(x&&!PRE.has(x.doc_id)){PRE.add(x.doc_id);fetch("/api/pdf/"+x.doc_id).catch(()=>PRE.delete(x.doc_id))}}}          // טעינה מראש של המסמכים הבאים
function tab(t){TAB=t;CUR=0;OVR=null;draw()}
function go(i){CUR=i;OVR=null;draw()}
function card(){const v=vis(),x=v[CUR];if(!x){$("side").innerHTML="<h2>אין פריט</h2>";$("pdf").src="about:blank";return}
const ev=x.hp_bad?`<div class="ev bad">⚠ במסמך ח.פ. אחר (${x.hps.join(", ")}) — ייתכן מסמך קבוצה / חברת אם</div>`:"";
$("side").innerHTML=`<h2>${E(x.company)}</h2>
<div class="row"><span class="k">רישום:</span> ${E(x.vis)} &nbsp; <span class="k">סלוט לקישור:</span> <b>הת"ע ${E(x.slot_he)}</b> &nbsp; <span class="cf" style="background:${CF[x.conf]||"#555"}">${E(x.conf)}</span></div>
<div class="row"><span class="k">מסמך:</span> <b>${E(x.doc_name)}</b> (${E(x.doc_type||"")}, ${x.pages||"?"} עמ')</div>
<div class="row"><span class="k">משויך כרגע ל:</span> ${x.linked.length?E(x.linked.join(", ")):"אף חברה"}${x.assoc?"":" <b style='color:#c0392b'>(לא משויך לחברה הזו: יתווסף שיוך)</b>"}</div>
${x.old_title?`<div class="row"><span class="k">כותרת באתר הישן:</span> ${E(x.old_title)}</div>`:""}
<div class="ev ${x.hp_ok?"":"bad"}">${x.hp_ok?"✔ ח.פ. החברה נמצא בתוך המסמך":"ח.פ. החברה לא נמצא בטקסט המסמך"}<br>ראיות: ${E(x.evidence)||"—"}</div>${ev}
<div class="ev" style="background:#eef3fb;border-color:#b9c9e6"><b>מצב החברה</b><br>
${["private","general"].map(t=>{const he=t==="private"?"פרטי":"כללי",c=x.cslots[t];return `הת"ע ${he}: ${x.need[t]?"נדרש":"לא נדרש"} — ${c?(c.self?"<b>המסמך הזה</b>":"מקושר: "+E(c.name)):(x.need[t]?"<b style='color:#c0392b'>חסר</b>":"—")}`}).join("<br>")}
${x.others.length?`<br><span class="k">מסמכים אחרים של החברה:</span><br>${x.others.map(o=>`• ${E(o.name)} (${E(o.type||"")}${o.slots.length?", סלוט: "+E(o.slots.join("+")):", לא מקושר לסלוט"})`).join("<br>")}`:""}
${x.old_refs.length?`<br><span class="k">בפוסטים של האתר הישן:</span><br>${x.old_refs.map(o=>"• "+E(o)).join("<br>")}`:""}
${x.other_items.length?`<br><span class="k">הצעות נוספות לחברה:</span><br>${x.other_items.map(o=>`• ${E(o.name)} (${E(o.slot)})`).join("<br>")}`:""}</div>
<div class="ev" style="background:#fff8e1;border-color:#ecd88a"><b>המלצה:</b> ${E(x.rec)}</div>
${x.note?`<div class="ev bad">הערה: ${E(x.note)}</div>`:""}
${x.holder?`<div class="ev bad">הסלוט כבר תפוס במסמך: <b>${E(x.holder)}</b></div>`:""}
${OVR?`<div class="ev">יאושר עבור: <b>${E(OVR.name)}</b> <button class="btn sk" onclick="OVR=null;card()">ביטול</button></div>`:""}
${x.state==="בוצע"?`<button class="btn un" onclick="undo()">↩ ביטול הקישור</button>`:`<button class="btn ok" onclick="ok(${x.holder?"true":"false"})">✔ אשר ${x.holder?"והחלף":""} הת"ע ${E(x.slot_he)} (Enter)</button>${x.both?`<br><button class="btn ok" style="background:#2f6f9f" onclick="ok(false,'${x.other_slot}')">✔ אשר לשני הסלוטים: פרטי + כללי</button>`:""}<br>
<button class="btn sk" onclick="skip('דולג')">דילוג (→)</button> <button class="btn no" onclick="skip('לא מתאים')">לא מתאים</button>`}
<hr><div class="k">אשר עבור חברה אחרת (שם / ח.פ.):</div><input id="q" oninput="srch(this.value)" placeholder="חיפוש חברה"><div id="res"></div>
<hr><button class="btn sk" onclick="go(Math.max(0,CUR-1))">← הקודם</button> <button class="btn sk" onclick="go(Math.min(vis().length-1,CUR+1))">הבא →</button>`;
prefetch();const f=$("pdf");const s="/api/pdf/"+x.doc_id;if(f.dataset.d!==x.doc_id){f.dataset.d=x.doc_id;f.src=s+"#toolbar=0&view=FitH"}applyRot()}
function ok(rep,extra){const x=vis()[CUR];if(!x)return;const key=x.key,name=x.company,body={key,doc_id:x.doc_id,business_id:OVR?OVR.id:x.business_id,slot:x.slot,replace:rep,extra:extra||null};
PEND.add(key);OVR=null;const n=vis().length;if(CUR>=n)CUR=Math.max(0,n-1);draw();          // עוברים מיד לפריט הבא; ההעלאה לאתר ממשיכה ברקע
api("/api/approve",body).then(()=>{PEND.delete(key);return load(true)}).then(()=>msg("✔ נשמר באתר: "+name)).catch(e=>{PEND.delete(key);msg("שגיאה ב"+name+": "+e.message);load(true)})}
function skip(w){const x=vis()[CUR];if(!x)return;const key=x.key;PEND.add(key);const n=vis().length;if(CUR>=n)CUR=Math.max(0,n-1);draw();api("/api/skip",{key,decision:w}).then(()=>{PEND.delete(key);return load(true)}).catch(e=>{PEND.delete(key);msg("שגיאה: "+e.message);load(true)})}
async function undo(){const x=vis()[CUR];try{await api("/api/undo",{key:x.key});msg("↩ בוטל");await load(true)}catch(e){msg("שגיאה: "+e.message)}}
function next(){const v=vis();if(CUR>=v.length)CUR=Math.max(0,v.length-1);draw()}
let _t;function srch(q){clearTimeout(_t);_t=setTimeout(async()=>{const r=await api("/api/biz?q="+encodeURIComponent(q));$("res").innerHTML=r.map(b=>`<div onclick='pick(${JSON.stringify(b)})'>${E(b.name)} <span class="k">${E(b.vis)}</span></div>`).join("")},300)}
function pick(b){OVR=b;card()}
document.addEventListener("keydown",e=>{if(e.target.tagName==="INPUT")return;if(e.key==="r"||e.key==="R"){rot(e.shiftKey?-1:1);return}if(e.key==="Enter"){const x=vis()[CUR];if(x&&x.state!=="בוצע")ok(!!x.holder)}else if(e.key==="ArrowRight"||e.key==="ArrowLeft"){skipnav(e.key==="ArrowLeft")}});
function skipnav(n){const v=vis();CUR=Math.max(0,Math.min(v.length-1,CUR+(n?1:-1)));OVR=null;draw()}
load();
</script></body></html>"""


def main():
    global A, TOKEN
    ap = argparse.ArgumentParser()
    ap.add_argument("--site", default="https://harav-levin.pages.dev")
    ap.add_argument("--port", type=int, default=8766)
    ap.add_argument("--plan", default="old_vs_site_plan.csv")
    ap.add_argument("--suggest", default="old_vs_site_hp_suggestions.csv")
    ap.add_argument("--posts", default="old_vs_site_posts.csv")
    ap.add_argument("--decisions", default="link_decisions.jsonl")
    ap.add_argument("--undo", default="link_undo.jsonl")
    ap.add_argument("--password-file", default="admin_password.txt")
    A = ap.parse_args()
    TOKEN = os.environ.get("ADMIN_PASSWORD") or ""
    if not TOKEN and os.path.exists(A.password_file):
        TOKEN = (open(A.password_file, encoding="utf-8").readline() or "").strip()
    TOKEN = TOKEN or getpass.getpass("סיסמת מנהל האתר: ")
    print("טוען מהאתר…")
    load_site()
    load_posts()
    load_decisions()
    build_items()
    print(f"{len(S['items'])} פריטים. פתח בדפדפן: http://localhost:{A.port}   (עצירה: Ctrl+C)")
    class Quiet(ThreadingHTTPServer):
        def handle_error(self, request, client_address):          # ביטול חיבור על ידי הדפדפן אינו תקלה: לא מדפיסים traceback
            import sys as _s
            if not isinstance(_s.exc_info()[1], (ConnectionError, OSError)):
                super().handle_error(request, client_address)
    Quiet(("127.0.0.1", A.port), H).serve_forever()


if __name__ == "__main__":
    main()
