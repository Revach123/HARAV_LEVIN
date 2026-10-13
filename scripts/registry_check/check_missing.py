#!/usr/bin/env python3
"""בדיקה חד-פעמית (קריאה בלבד): החברות שמופיעות באקסל הישן ואינן במסד — האם הן קיימות ברשם הממשלתי (data.gov.il)?

קלט:  scripts/registry_check/missing_companies.csv  (name, chp, category, in_general_excel, in_private_excel, bond_status_excel)
פלט:  reports/registry_check/missing_companies_report.csv  (כותרות בעברית) + .json
לכל חברה: חיפוש לפי ח.פ. בשלושת המאגרים (חברות / שותפויות / עמותות); ואם אין ח.פ. או לא נמצאה — חיפוש לפי שם.
לא כותב ל-D1 ולא משנה שום דבר באתר.
"""
import csv
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..", "..")
SEARCH = "https://data.gov.il/api/3/action/datastore_search"
SOURCES = [
    {"kind": "חברה", "resource": "f004176c-b85f-4542-8901-7b3176f9a054", "id": "מספר חברה", "name": "שם חברה"},
    {"kind": "שותפות", "resource": "139aa193-fabb-4f6b-a71b-0bb40fd73eb2", "id": "מספר שותפות", "name": "שם שותפות"},
    {"kind": "עמותה", "resource": "be5b7935-3922-45d4-9638-08871b17ec95", "id": "מספר עמותה", "name": "שם עמותה בעברית"},
]
STATUS_HINTS = ("סטטוס", "מחוק", "פירוק", "מצב")


def get(params):
    url = SEARCH + "?" + urllib.parse.urlencode(params)
    last = None
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0", "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.loads(r.read().decode("utf-8", "replace")).get("result", {}).get("records", [])
        except urllib.error.HTTPError as e:
            last = e
            if e.code in (400, 404):
                break
        except Exception as e:  # noqa: BLE001
            last = e
        time.sleep(3 * (attempt + 1))
    print(f"WARNING: request failed: {last}", file=sys.stderr)
    return None


def status_of(rec):
    return "; ".join(f"{k}: {v}" for k, v in rec.items() if any(h in k for h in STATUS_HINTS) and v not in (None, ""))


def describe(src, rec, how):
    return {"found": "כן", "how": how, "kind": src["kind"], "registry_id": rec.get(src["id"]),
            "registry_name": (rec.get(src["name"]) or "").replace("~", '"'), "status": status_of(rec)}


def lookup(name, chp):
    if chp.isdigit():
        for src in SOURCES:
            recs = get({"resource_id": src["resource"], "filters": json.dumps({src["id"]: int(chp)}), "limit": 1})
            if recs:
                return [describe(src, recs[0], "לפי ח.פ.")], False
            if recs is None:
                return [], True
            time.sleep(0.4)
    hits, failed = [], False
    for src in SOURCES:
        recs = get({"resource_id": src["resource"], "q": json.dumps({src["name"]: name}, ensure_ascii=False), "limit": 3})
        if recs is None:
            failed = True
        for rec in recs or []:
            hits.append(describe(src, rec, "לפי שם (להשוות ידנית)"))
        time.sleep(0.4)
    return hits, failed


def main():
    with open(os.path.join(HERE, "missing_companies.csv"), encoding="utf-8-sig", newline="") as f:
        companies = list(csv.DictReader(f))
    out, rows = [], []
    for i, c in enumerate(companies, 1):
        hits, failed = lookup(c["name"].strip(), c["chp"].strip())
        print(f"[{i}/{len(companies)}] {c['name']} ({c['chp'] or 'ללא ח.פ.'}): {len(hits)} תוצאות{' (שגיאת רשת)' if failed else ''}")
        out.append({**c, "hits": hits, "network_error": failed})
        for h in hits or [{"found": "לא נמצא" if not failed else "שגיאת רשת", "how": "", "kind": "", "registry_id": "", "registry_name": "", "status": ""}]:
            rows.append([c["name"], c["chp"], c["category"], c["in_general_excel"], c["in_private_excel"], c["bond_status_excel"],
                         h["found"], h["how"], h["kind"], h["registry_id"], h["registry_name"], h["status"]])
    os.makedirs(os.path.join(ROOT, "reports", "registry_check"), exist_ok=True)
    base = os.path.join(ROOT, "reports", "registry_check", "missing_companies_report")
    with open(base + ".csv", "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(["שם באקסל הישן", "ח.פ.", "קטגוריה", "ברשימה הכללית באקסל", "ברשימה הפרטית באקסל", "אג\"ח באקסל",
                    "נמצא ברשם", "איך נמצא", "סוג", "מספר ברשם", "שם ברשם", "סטטוס ברשם"])
        w.writerows(rows)
    with open(base + ".json", "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print("נמצאו לפי ח.פ.:", sum(1 for o in out if o["hits"] and o["hits"][0]["how"] == "לפי ח.פ."), "מתוך", len(out))


if __name__ == "__main__":
    main()
