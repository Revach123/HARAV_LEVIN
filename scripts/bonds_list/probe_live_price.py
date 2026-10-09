# -*- coding: utf-8 -*-
"""חד-פעמי: בדיקת היתכנות למחיר חי. כותב reports/live_price_probe.json"""
import concurrent.futures as cf, datetime, json, os, time, urllib.request, urllib.error
UA = "Mozilla/5.0"
KEY = "OpB1TDhiRrF5kbQtjx75Qgcm6Csh31to"
out = {"now_utc": datetime.datetime.utcnow().isoformat() + "Z", "tests": {}}

def call(url, data=None, headers=None, origin=None):
    h = {"User-Agent": UA, "Accept": "application/json"}
    if data is not None: h["Content-Type"] = "application/json;charset=UTF-8"
    if origin: h["Origin"] = origin
    h.update(headers or {})
    req = urllib.request.Request(url, data=json.dumps(data).encode() if data is not None else None, headers=h,
                                 method="POST" if data is not None else "GET")
    t = time.time()
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            body = r.read(); return {"status": r.status, "ms": int((time.time()-t)*1000), "headers": {k: v for k, v in r.getheaders() if k.lower().startswith(("access-control","cache","age","date","server","x-"))}, "body": body}
    except urllib.error.HTTPError as e:
        return {"status": e.code, "ms": int((time.time()-t)*1000), "headers": dict(e.headers), "body": e.read()[:300]}
    except Exception as e:
        return {"status": None, "error": str(e), "body": b""}

BULK = "https://api.tase.co.il/api/security/securitiesmarketdata"
def bulk(page, cl1="2", origin=None):
    return call(BULK, {"dType": 1, "TotalRec": 1, "pageNum": page, "cl1": cl1, "lang": "0"}, {"Referer": "https://market.tase.co.il/"}, origin)

r = bulk(1, origin="https://harav-levin.pages.dev")
d = json.loads(r["body"]) if r["status"] == 200 else {}
items = d.get("Items") or []
out["tests"]["bulk_page1"] = {"status": r["status"], "ms": r["ms"], "cors_headers": r["headers"], "TotalRec": d.get("TotalRec"),
    "items_in_page": len(items), "item_keys": sorted(items[0].keys()) if items else None, "sample_item": items[0] if items else None}
# CORS preflight
pf = call(BULK, None, {"Access-Control-Request-Method": "POST"}, origin="https://harav-levin.pages.dev")
out["tests"]["get_with_origin"] = {"status": pf["status"], "headers": pf["headers"]}

# speed: all pages of cl1=2 in parallel (6 workers)
total = int(d.get("TotalRec") or 0); ps = max(len(items), 1); pages = -(-total // ps) if total else 0
t = time.time(); got = 0
with cf.ThreadPoolExecutor(6) as ex:
    for rr in ex.map(lambda p: bulk(p), range(1, pages + 1)):
        if rr["status"] == 200: got += len(json.loads(rr["body"]).get("Items") or [])
out["tests"]["bulk_all_pages"] = {"pages": pages, "items_got": got, "seconds": round(time.time()-t, 1)}

# single security (live terms) + time-related fields
sid = items[0].get("Id") if items else None
if sid:
    s = call(f"https://api.tase.co.il/api/company/securitydata?securityId={int(sid)}&lang=0", None, {"Referer": "https://market.tase.co.il/"}, "https://harav-levin.pages.dev")
    sd = json.loads(s["body"]) if s["status"] == 200 else {}
    out["tests"]["securitydata"] = {"status": s["status"], "ms": s["ms"], "cors": s["headers"], "keys": sorted(sd.keys()),
        "time_like": {k: v for k, v in sd.items() if any(x in k.lower() for x in ("time", "date", "delay", "last", "rate", "price"))}}

# official datawise: which endpoints does our key allow?
cands = ["/v1/basic-securities/trade-securities-list/" + datetime.date.today().strftime("%Y/%m/%d"),
         "/v1/securities/trading/end-of-day/last", "/v1/securities/trading/intraday", "/v1/securities/market-data",
         "/v1/securities/trading/end-of-day/history/" + str(int(sid)) if sid else "/v1/securities",
         "/v1/bonds/bond-details/" + str(int(sid)) if sid else "/v1/bonds"]
dw = {}
for c in cands:
    x = call("https://datawise.tase.co.il" + c, None, {"accept-language": "he-IL", "apikey": KEY})
    dw[c] = {"status": x["status"], "body_head": (x["body"] or b"")[:160].decode("utf-8", "replace")}
out["tests"]["datawise"] = dw

os.makedirs("reports", exist_ok=True)
json.dump(out, open("reports/live_price_probe.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print(json.dumps(out, ensure_ascii=False)[:2500])
