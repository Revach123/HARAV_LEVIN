# -*- coding: utf-8 -*-
"""
שווי שוק כולל של האג"ח הקונצרניות בבורסה (כולל המירות וני"ע מסחריים), לפי מספר נייר.
המקור: api.tase.co.il (securitiesmarketdata, cl1=2 = אג"ח; MarketValue באלפי ש"ח) + סיווג סוג הנייר מ-datawise
(אותו סיווג coarse_type כמו ברשימת האג"ח). אג"ח ממשלתיות ומק"מ לא נכללות.
פלט: data/index_coverage/bonds_market.json  - לחישוב "כמה אחוז מכלל האג"ח הקונצרניות (לפי שווי)" בדף הניהול.
שגיאה / נתונים חלקיים = יציאה בקוד שגיאה בלי לדרוס את הקובץ הקיים.
"""
import datetime
import json
import os
import re
import sys
import time
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "scripts", "bonds_list"))
from classify import coarse_type  # noqa: E402

OUT = os.path.join(ROOT, "data", "index_coverage", "bonds_market.json")
CORPORATE = {"אג\"ח קונצרני", "אג\"ח להמרה"}
MIN_BONDS = 300
HDR = {"accept": "application/json, text/plain, */*", "accept-language": "he-IL",
       "content-type": "application/json;charset=UTF-8", "origin": "https://market.tase.co.il",
       "referer": "https://market.tase.co.il/", "user-agent": "Mozilla/5.0"}


def _key():
    key = os.environ.get("TASE_DATAWISE_KEY")
    if key:
        return key
    for name in ("sync-tase.js", "debug-tase.js"):
        try:
            with open(os.path.join(ROOT, "functions", "api", name), encoding="utf-8") as fh:
                m = re.search(r'TASE_KEY\s*=\s*"([^"]+)"', fh.read())
        except OSError:
            continue
        if m:
            return m.group(1)
    return ""


def _req(url, body=None, headers=None, retries=3):
    data = json.dumps(body).encode() if body is not None else None
    last = None
    for a in range(retries):
        try:
            req = urllib.request.Request(url, data=data, headers=headers or HDR, method="POST" if body is not None else "GET")
            with urllib.request.urlopen(req, timeout=40) as r:
                return json.loads(r.read())
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(2 * (a + 1))
    raise RuntimeError(f"{url}: {last}")


def corporate_ids():
    h = {"accept": "application/json", "accept-language": "he-IL", "apikey": _key(), "user-agent": "Mozilla/5.0"}
    base = "https://datawise.tase.co.il/v1/basic-securities"
    types = {str(r["securityFullTypeCode"]): r.get("securityTypeDesc") or ""
             for r in _req(base + "/securities-types", headers=h)["securitiesTypes"]["result"]}
    for d in range(8):
        dt = datetime.date.today() - datetime.timedelta(days=d)
        rows = (_req(f"{base}/trade-securities-list/{dt:%Y/%m/%d}", headers=h).get("tradeSecuritiesList") or {}).get("result") or []
        if rows:
            return {str(int(r["securityId"])) for r in rows
                    if coarse_type(types.get(str(r.get("securityFullTypeCode")), "")) in CORPORATE}, str(dt)
    raise RuntimeError("datawise: אין רשימת ניירות")


def market_values():
    out, page, total = {}, 1, None
    while True:
        res = _req("https://api.tase.co.il/api/security/securitiesmarketdata",
                   {"dType": 1, "TotalRec": 1, "pageNum": page, "cl1": "2", "lang": "0"})
        items = res.get("Items") or []
        total = total or res.get("TotalRec")
        for it in items:
            try:
                out[str(int(it["Id"]))] = float(it.get("MarketValue") or 0)
            except (KeyError, TypeError, ValueError):
                continue
        if not items or (total and len(out) >= total) or page > 80:
            break
        page += 1
        time.sleep(0.2)
    return out


def main():
    ids, dt = corporate_ids()
    mv = market_values()
    values = {i: mv[i] for i in ids if i in mv and mv[i] > 0}
    if len(values) < MIN_BONDS:
        raise RuntimeError(f"נתונים חלקיים ({len(values)} אג\"ח עם שווי) - לא דורס את הקובץ")
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump({"updated": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
                   "tradeDate": dt, "unit": "אלפי ש\"ח", "count": len(values),
                   "totalValue": round(sum(values.values()), 1), "values": values}, f, ensure_ascii=False)
    print(f"נכתב {OUT}: {len(values)} אג\"ח קונצרניות, שווי כולל {sum(values.values()):,.0f} אלפי ש\"ח")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # noqa: BLE001
        print("ERROR:", e, file=sys.stderr)
        sys.exit(1)
