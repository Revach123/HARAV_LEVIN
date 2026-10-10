# -*- coding: utf-8 -*-
"""חד-פעמי: מה datawise (Securities Basic) מחזיר. כותב reports/datawise_probe.json"""
import datetime, json, os, urllib.request, urllib.error
KEY = "OpB1TDhiRrF5kbQtjx75Qgcm6Csh31to"
H = {"accept": "application/json", "accept-language": "he-IL", "apikey": KEY, "User-Agent": "Mozilla/5.0"}
def get(path):
    try:
        with urllib.request.urlopen(urllib.request.Request("https://datawise.tase.co.il" + path, headers=H), timeout=40) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, e.read()[:200].decode("utf-8", "replace")
out = {"now_utc": datetime.datetime.utcnow().isoformat() + "Z"}
days = {}
for d in range(0, 6):
    dt = datetime.date.today() - datetime.timedelta(days=d)
    st, js = get(f"/v1/basic-securities/trade-securities-list/{dt:%Y/%m/%d}")
    res = (js or {}).get("tradeSecuritiesList", {}).get("result", []) if isinstance(js, dict) else []
    days[str(dt)] = {"status": st, "count": len(res)}
    if res and "sample" not in out:
        bonds = [s for s in res if str(s.get("securityFullTypeCode", ""))[:2] in ("03", "05", "11", "36")]
        out["sample_day"] = str(dt); out["sample_bond"] = bonds[0] if bonds else res[0]
        out["all_keys"] = sorted({k for s in res for k in s})
out["days"] = days
# other basic endpoints named by the SDK
for p in ["/v1/basic-securities/securities-types", "/v1/basic-securities/companies-list", "/v1/basic-securities/trading-code-list",
          "/v1/basic-securities/delisted-securities-list/" + datetime.date.today().strftime("%Y/%m"),
          "/v1/basic-securities/illiquid-maintenance-suspension-list"]:
    st, js = get(p)
    out.setdefault("endpoints", {})[p] = {"status": st, "keys": list(js.keys()) if isinstance(js, dict) else str(js)[:100]}
os.makedirs("reports", exist_ok=True)
json.dump(out, open("reports/datawise_probe.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print(json.dumps(out, ensure_ascii=False)[:2500])
