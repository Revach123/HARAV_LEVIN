# -*- coding: utf-8 -*-
"""חד-פעמי: בדיקה ידנית של שינויי registry-refresh מול המקור. כותב reports/registry_refresh/spot_check.json"""
import json, os, random, re, sys, urllib.parse
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import refresh_businesses as r

rep = json.load(open(os.path.join(r.ROOT, "reports", "registry_refresh", "last_run.json"), encoding="utf-8"))
ch = rep["changes"]
random.seed(7)
name_over = [c for c in ch if c["field"] == "registrar_name" and (c["old"] or "").strip()]
flags = [c for c in ch if c["field"] == "tase_has_agch"]
name_fill = [c for c in ch if c["field"] == "registrar_name" and not (c["old"] or "").strip()]
type_fill = [c for c in ch if c["field"] == "biz_type"]
sample = {"name_overwrites": name_over, "flag_changes": flags,
          "name_fills_sample": random.sample(name_fill, 14), "biz_type_sample": random.sample(type_fill, 14)}

def raw_gov(chp):
    out = {}
    for src in r.SOURCES:
        q = urllib.parse.quote(json.dumps({src["id"]: int(chp)}))
        try:
            res = r.http_json(f"{r.GOV_SEARCH}?resource_id={src['resource']}&filters={q}&limit=1")
            recs = (res.get("result") or {}).get("records") or []
            if recs:
                out[src["kind"]] = {k: v for k, v in recs[0].items() if k != "_id"}
        except RuntimeError as e:
            out[src["kind"]] = {"error": str(e)[:80]}
    return out

# datawise: כל הניירות של החברה (כדי לבדוק את הדגל)
headers = {"accept": "application/json", "accept-language": "he-IL", "apikey": r.datawise_key()}
types = {str(t["securityFullTypeCode"]): t.get("securityTypeDesc") for t in
         r.http_json(f"{r.DATAWISE}/v1/basic-securities/securities-types", headers=headers)["securitiesTypes"]["result"]}
import datetime, time
rows, day = [], None
for d in range(8):
    dt = datetime.date.today() - datetime.timedelta(days=d)
    res = r.http_json(f"{r.DATAWISE}/v1/basic-securities/trade-securities-list/{dt:%Y/%m/%d}", headers=headers)
    rows = (res.get("tradeSecuritiesList") or {}).get("result") or []
    if rows:
        day = str(dt); break
by_corp = {}
for s in rows:
    by_corp.setdefault(str(s.get("corporateId") or "").strip(), []).append(
        {"id": s.get("securityId"), "name": s.get("securityName"), "code": s.get("securityFullTypeCode"),
         "type": types.get(str(s.get("securityFullTypeCode")))})

out = {"datawise_day": day}
for key, items in sample.items():
    lst = []
    for c in items:
        e = dict(c)
        if key == "flag_changes":
            e["datawise_securities"] = by_corp.get(str(c["chp"]).strip(), [])[:8]
        else:
            e["data_gov_il"] = raw_gov(str(c["chp"]).strip()) if str(c["chp"]).strip().isdigit() else {}
            time.sleep(0.3)
        lst.append(e)
    out[key] = lst
os.makedirs(os.path.join(r.ROOT, "reports", "registry_refresh"), exist_ok=True)
json.dump(out, open(os.path.join(r.ROOT, "reports", "registry_refresh", "spot_check.json"), "w", encoding="utf-8"),
          ensure_ascii=False, indent=1)
print("ok", {k: len(v) for k, v in out.items() if isinstance(v, list)})
