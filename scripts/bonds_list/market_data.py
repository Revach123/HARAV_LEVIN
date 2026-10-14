# -*- coding: utf-8 -*-
"""
אג"ח שמופיעות בנתוני המסחר של הבורסה (market.tase.co.il > נתוני מסחר > אג"ח חברות) גם כשהן לא מופיעות בדף החברה במאיה
(למשל אביעד ריביות אג"ח א', 1248434). שליפה בלי סינון חברה: כל אג"ח החברות, עמוד אחרי עמוד.
  POST https://api.tase.co.il/api/security/securitiesmarketdata  {"dType":"1","cl1":"2","cl2":"0","TotalRec":..,"pageNum":..,"lang":"0"}
מהתשובה נלקחים רק מספרי הניירות; שאר הפרטים (חברה, סוג) מרשימת הניירות של datawise לפי מספר הנייר.
מבנה התשובה לא נבדק מול הבורסה מראש, ולכן הפענוח סלחני והדגימה נשמרת ב-market_data_sample.json.
"""
import json
import re
import urllib.request

URL = "https://api.tase.co.il/api/security/securitiesmarketdata"
HEADERS = {"accept": "application/json, text/plain, */*", "accept-language": "he-IL",
           "content-type": "application/json;charset=UTF-8", "origin": "https://market.tase.co.il",
           "referer": "https://market.tase.co.il/", "User-Agent": "Mozilla/5.0"}
MAX_PAGES = 80


def post(body, timeout=40, retries=3):
    last = None
    for _ in range(retries):
        try:
            req = urllib.request.Request(URL, data=json.dumps(body).encode(), headers=HEADERS, method="POST")
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read())
        except Exception as e:  # noqa: BLE001
            last = e
    raise RuntimeError(f"market data: {last}")


def _items(d):
    """הרשימה הגדולה ביותר של רשומות (dict) בתשובה, בכל עומק סביר."""
    best = []

    def walk(x, depth=0):
        nonlocal best
        if depth > 3:
            return
        if isinstance(x, list):
            if x and all(isinstance(i, dict) for i in x) and len(x) > len(best):
                best = x
        elif isinstance(x, dict):
            for v in x.values():
                walk(v, depth + 1)
    walk(d)
    return best


def _total(d):
    if isinstance(d, dict):
        for k, v in d.items():
            if re.search(r"total", k, re.I) and isinstance(v, int) and v > 0:
                return v
        for v in d.values():
            if isinstance(v, dict):
                t = _total(v)
                if t:
                    return t
    return 0


def security_id(item):
    """מספר נייר מרשומה: מפתח שנקרא Id / SecurityId / SecId וכד'; אחרת מפתח עם 'id' בשם (לא חברה/מנפיק) וערך של 5-9 ספרות."""
    for k in ("SecurityId", "Securityid", "SecId", "Id", "ID", "id", "securityId"):
        v = item.get(k)
        if isinstance(v, (int, str)) and str(v).isdigit() and 4 <= len(str(v)) <= 9:
            return int(v)
    for k, v in item.items():
        if re.search(r"id$", k, re.I) and not re.search(r"comp|issuer|corp|type|sector|branch", k, re.I) \
                and str(v).isdigit() and 5 <= len(str(v)) <= 9:
            return int(v)
    return None


def fetch_ids(post_fn=post):
    """-> (ids, sample). בלי סינון חברה. כשל = ([], {error})."""
    ids, sample, total, page = [], {}, 0, 1
    try:
        while page <= MAX_PAGES:
            d = post_fn({"dType": "1", "cl1": "2", "cl2": "0", "TotalRec": total or 1, "pageNum": page, "lang": "0"})
            items = _items(d)
            if page == 1:
                sample = {"keys": list(d) if isinstance(d, dict) else type(d).__name__, "first_items": items[:3],
                          "total_reported": _total(d), "page1_len": len(items)}
            if not items:
                break
            total = total or _total(d)
            got = [security_id(i) for i in items]
            new = [g for g in got if g and g not in ids]
            ids.extend(new)
            if not new or (total and len(ids) >= total):
                break
            page += 1
    except Exception as e:  # noqa: BLE001
        sample["error"] = str(e)
    sample["ids_found"] = len(ids)
    sample["pages"] = page
    return ids, sample


def fetch_items(post_fn=post):
    """כמו fetch_ids, אבל מחזיר {מספר נייר: רשומה} (לבדיקות והשוואת מקורות)."""
    items_by_id, total, page = {}, 0, 1
    while page <= MAX_PAGES:
        d = post_fn({"dType": "1", "cl1": "2", "cl2": "0", "TotalRec": total or 1, "pageNum": page, "lang": "0"})
        items = _items(d)
        if not items:
            break
        total = total or _total(d)
        new = 0
        for i in items:
            sid = security_id(i)
            if sid and sid not in items_by_id:
                items_by_id[sid] = i
                new += 1
        if not new or (total and len(items_by_id) >= total):
            break
        page += 1
    return items_by_id
