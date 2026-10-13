#!/usr/bin/env python3
"""בדיקה חד-פעמית וידנית (קריאה בלבד): למה אירועי חברה של Maya מחזירים HTTP 400 בבקשה של enrich.py?
מנסה כמה צורות של גוף הבקשה לחברה אחת ומדפיס סטטוס + תחילת התשובה (כולל גוף שגיאת 400)."""
import datetime
import json
import sys
import urllib.error
import urllib.request

URL = "https://maya.tase.co.il/api/v1/corporate-actions/events"
FMT = "%Y-%m-%dT%H:%M:%S.000Z"
now = datetime.datetime.now(datetime.timezone.utc)
iso = lambda d: d.strftime(FMT)  # noqa: E731
Y = lambda n: datetime.timedelta(days=365 * n)  # noqa: E731


def post(body, extra_headers=None):
    h = {"User-Agent": "Mozilla/5.0", "Accept": "application/json, text/plain, */*", "Accept-Language": "he-IL",
         "Content-Type": "application/json"}
    h.update(extra_headers or {})
    req = urllib.request.Request(URL, data=json.dumps(body).encode(), headers=h, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            txt = r.read().decode("utf-8", "replace")
            data = json.loads(txt)
            return r.status, (f"list[{len(data)}] " + txt[:260]) if isinstance(data, list) else txt[:300]
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")[:400]
    except Exception as e:  # noqa: BLE001
        return "ERR", str(e)[:300]


companies = [int(x) for x in (sys.argv[1:] or ["121", "208"])]
for cid in companies:
    base = {"pageSize": 30, "pageNumber": 1, "companyId": cid}
    variants = {
        "A revach-style (6y back, +30y)": {**base, "fromDate": iso(now - Y(6)), "toDate": iso(now + Y(30))},
        "B 1y back, +1y": {**base, "fromDate": iso(now - Y(1)), "toDate": iso(now + Y(1))},
        "C 6y back, today": {**base, "fromDate": iso(now - Y(6)), "toDate": iso(now)},
        "D no dates": dict(base),
        "E 6y back, +5y": {**base, "fromDate": iso(now - Y(6)), "toDate": iso(now + Y(5))},
        "F 2y back, +10y": {**base, "fromDate": iso(now - Y(2)), "toDate": iso(now + Y(10))},
        "G revach-style + Referer": {**base, "fromDate": iso(now - Y(6)), "toDate": iso(now + Y(30))},
    }
    for name, body in variants.items():
        extra = {"Referer": "https://maya.tase.co.il/he/corporate-actions"} if name.startswith("G") else None
        st, txt = post(body, extra)
        print(f"company {cid} | {name}: {st} | {txt}", flush=True)
