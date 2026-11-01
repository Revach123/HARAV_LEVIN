#!/usr/bin/env python3
"""
בונה את רשימות הערים והרחובות לשלוחת ההצטרפות הטלפונית (ivr-join.js, בחירת עיר / רחוב בהקשת אותיות).

מקור: data.gov.il, מאגר "רחובות בישראל" (רשות האוכלוסין), שבו לכל רחוב: סמל יישוב, שם יישוב, סמל רחוב, שם רחוב.
פלט (קבצים סטטיים של האתר):
  data/ivr-addr/cities.json            [[סמל, שם], ...] לפי סדר האלף-בית
  data/ivr-addr/streets/<סמל>.json     [שם, ...] הרחובות ביישוב ([] = יישוב בלי רחובות, למשל מושב שהרחוב היחיד בו הוא שם היישוב)

הרצה: python scripts/ivr_addr/build_addr.py  (workflow ‏ivr-addr-data)
"""
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

API = "https://data.gov.il/api/3/action"
STREETS_RESOURCE = os.environ.get("STREETS_RESOURCE", "9ad3862c-8391-4b2f-84a4-2d4c68625f4b")
OUT = os.path.join(os.path.dirname(__file__), "..", "..", "data", "ivr-addr")
PAGE = 10000


def get(url):
    last = None
    for attempt in range(5):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0", "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=90) as r:
                text = r.read().decode("utf-8", "replace")
            if text.lstrip().startswith("<"):
                raise RuntimeError("HTML response (blocked?)")
            return json.loads(text)
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(3 * (attempt + 1))
    raise RuntimeError(f"failed: {url}: {last}")


def find_resource():
    """המשאב לפי המזהה הידוע; אם השתנה - חיפוש מאגר בשם "רחובות"."""
    try:
        get(f"{API}/datastore_search?resource_id={STREETS_RESOURCE}&limit=1")
        return STREETS_RESOURCE
    except RuntimeError as e:
        print(f"known resource failed ({e}); searching", file=sys.stderr)
    res = get(f"{API}/package_search?q={urllib.parse.quote('רחובות')}&rows=20")
    for pkg in res["result"]["results"]:
        for r in pkg.get("resources", []):
            if r.get("datastore_active") and "רחוב" in (pkg.get("title", "") + r.get("name", "")):
                print(f"using {pkg.get('title')} / {r.get('name')} ({r['id']})", file=sys.stderr)
                return r["id"]
    raise RuntimeError("streets resource not found")


def pick(fields, *must, avoid=()):
    for f in fields:
        if all(m in f for m in must) and not any(a in f for a in avoid):
            return f
    return None


def clean(s):
    s = re.sub(r"\s+", " ", str(s or "")).strip()
    return s.strip(" -")


def main():
    rid = find_resource()
    first = get(f"{API}/datastore_search?resource_id={rid}&limit=1")["result"]
    fields = [f["id"] for f in first["fields"]]
    print("fields:", fields, "total:", first.get("total"), file=sys.stderr)
    f_cc = pick(fields, "סמל", "ישוב") or pick(fields, "city", "code")
    f_cn = pick(fields, "שם", "ישוב", avoid=("לועזי", "eng")) or pick(fields, "city", "name")
    f_sc = pick(fields, "סמל", "רחוב") or pick(fields, "street", "code")
    f_sn = pick(fields, "שם", "רחוב", avoid=("לועזי", "eng")) or pick(fields, "street", "name")
    if not all([f_cc, f_cn, f_sn]):
        raise RuntimeError(f"unexpected fields: {fields}")

    rows, offset = [], 0
    while True:
        page = get(f"{API}/datastore_search?resource_id={rid}&limit={PAGE}&offset={offset}")["result"]["records"]
        rows += page
        offset += len(page)
        if len(page) < PAGE:
            break
    print(f"rows: {len(rows)}", file=sys.stderr)
    if len(rows) < 20000:
        raise RuntimeError(f"too few rows ({len(rows)}) - not overwriting")

    cities, streets = {}, {}
    for r in rows:
        code = str(r.get(f_cc) or "").strip()
        if not code.isdigit():
            continue
        code = str(int(code))
        cname = clean(r.get(f_cn))
        if not cname:
            continue
        cities[code] = cname
        sname = clean(r.get(f_sn))
        streets.setdefault(code, set())
        if sname and sname != cname:          # "רחוב" בשם היישוב = יישוב בלי רחובות
            streets[code].add(sname)

    os.makedirs(os.path.join(OUT, "streets"), exist_ok=True)
    for old in os.listdir(os.path.join(OUT, "streets")):
        if old.endswith(".json") and old[:-5] not in cities:
            os.remove(os.path.join(OUT, "streets", old))
    city_list = sorted(([c, n] for c, n in cities.items()), key=lambda x: x[1])
    with open(os.path.join(OUT, "cities.json"), "w", encoding="utf-8") as fh:
        json.dump(city_list, fh, ensure_ascii=False, separators=(",", ":"))
    for code, names in streets.items():
        with open(os.path.join(OUT, "streets", f"{code}.json"), "w", encoding="utf-8") as fh:
            json.dump(sorted(names), fh, ensure_ascii=False, separators=(",", ":"))
    print(f"cities: {len(city_list)}, streets: {sum(len(s) for s in streets.values())}, "
          f"without streets: {sum(1 for s in streets.values() if not s)}", file=sys.stderr)
    for probe in ("ירושלים", "בני ברק", "בית שמש", "אלעד"):
        c = next((x for x in city_list if x[1] == probe), None)
        print(f"  {probe}: {c and len(streets[c[0]])} streets", file=sys.stderr)


if __name__ == "__main__":
    main()
