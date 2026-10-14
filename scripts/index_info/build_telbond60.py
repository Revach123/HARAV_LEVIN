# -*- coding: utf-8 -*-
"""
הרכב מדד תל בונד 60 (שתי הגרסאות: צמודות 709, שקלי 765) -> חברות מנפיקות לפי ח.פ.
נשאב ישירות מהבורסה (api.tase.co.il) ומ-datawise (גשר מזהה חברה -> ח.פ.), בלי תלות ב-revach.
פלט: data/index_coverage/telbond60.json  - לשימוש תיבת "כיסוי מדד" בדף הניהול.
שגיאה בשאיבה = יציאה בקוד שגיאה בלי לדרוס את הקובץ הקיים.
"""
import datetime
import json
import os
import re
import sys
import time
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, "data", "index_coverage", "telbond60.json")
BASE = "https://api.tase.co.il"
DATAWISE = "https://datawise.tase.co.il/v1"
INDICES = {"709": "תל בונד 60 צמודות", "765": "תל בונד 60 שקלי"}
PAGE_SIZE = 30
HDR = {"accept": "application/json, text/plain, */*", "accept-language": "he-IL",
       "content-type": "application/json;charset=UTF-8", "origin": "https://market.tase.co.il",
       "referer": "https://market.tase.co.il/", "user-agent": "Mozilla/5.0"}


def _datawise_key():
    key = os.environ.get("TASE_DATAWISE_KEY")
    if key:
        return key
    for name in ("sync-tase.js", "debug-tase.js"):       # אותו מפתח שכבר בקוד הפרויקט (כמו ב-bonds_list)
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


def fetch_components(index_id):
    items, page, total, last = [], 1, None, {}
    while True:
        last = _req(f"{BASE}/api/index/components",
                    {"dType": 1, "TotalRec": 1, "pageNum": page, "oId": str(index_id), "lang": "0"})
        batch = last.get("Items") or []
        items += batch
        total = total or last.get("TotalRec")
        if not batch or len(batch) < PAGE_SIZE or (total and len(items) >= total) or page > 50:
            break
        page += 1
        time.sleep(0.25)
    if total and len(items) != total:
        raise RuntimeError(f"מדד {index_id}: נשאבו {len(items)} מתוך {total}")
    return items, (last.get("TradeDate") or "").strip()


def fetch_bridge():
    """issuerId (CompanyId בבורסה) -> ח.פ. + שם מלא"""
    res = _req(f"{DATAWISE}/basic-securities/companies-list",
               headers={"accept": "application/json", "accept-language": "he-IL", "apikey": _datawise_key()})["companiesList"]["result"]
    out = {}
    for c in res:
        if c.get("issuerId") is not None:
            hp = re.sub(r"\D", "", str(c.get("corporateId") or "")).lstrip("0")
            out[str(c["issuerId"])] = {"hp": hp, "name": (c.get("companyFullName") or c.get("companyName") or "").strip()}
    return out


def build(components_by_index, bridge, trade_dates):
    companies, securities = {}, []
    for iid, items in components_by_index.items():
        for x in items:
            w = x.get("Weight")
            securities.append({"index": iid, "securityNumber": str(x.get("SecurityNumber") or "").strip(),
                               "name": (x.get("ShortName") or "").strip(), "weight": float(w) if w is not None else 0.0,
                               "hp": bridge.get(str(x.get("CompanyId")), {}).get("hp", "")})
            cid = str(x.get("CompanyId")) if x.get("CompanyId") is not None else ""
            br = bridge.get(cid, {})
            hp = br.get("hp", "")
            key = hp or "n:" + (x.get("ShortName") or "").strip()
            c = companies.setdefault(key, {"hp": hp, "name": br.get("name") or (x.get("ShortName") or "").strip(), "indices": []})
            if iid not in c["indices"]:
                c["indices"].append(iid)
    return {"updated": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
            "tradeDate": max(trade_dates.values()) if trade_dates else "",
            "indices": {i: {"name": INDICES[i], "securities": len(components_by_index[i])} for i in components_by_index},
            "securities": securities,      # כל נייר במדד: מספר נייר + משקל (לחישוב כיסוי לפי משקל ולפי מספר האג"ח)
            "companies": sorted(companies.values(), key=lambda c: c["name"])}


def main():
    comps, dates = {}, {}
    for iid in INDICES:
        comps[iid], dates[iid] = fetch_components(iid)
        print(f"מדד {iid}: {len(comps[iid])} ניירות")
    bridge = fetch_bridge()
    data = build(comps, bridge, dates)
    if not data["companies"]:
        raise RuntimeError("לא נמצאו חברות - לא דורס את הקובץ")
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    print(f"נכתב {OUT}: {len(data['companies'])} חברות מנפיקות")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # noqa: BLE001
        print("ERROR:", e, file=sys.stderr)
        sys.exit(1)
