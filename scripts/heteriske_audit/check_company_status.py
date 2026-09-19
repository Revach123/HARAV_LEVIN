#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
scripts/heteriske_audit/check_company_status.py

לכל עסק ב-heteriske.com שקיבל ח.פ. (resolve_chp.py) - בודק מול הרשם
הרשמי (data.gov.il, דרך /api/lookup?number= של האתר הזה - לא מוגבל קצב)
האם הח.פ. באמת קיים, ואם כן - מה הסטטוס שלו (פעילה/מחוקה/מבוטלת/בפירוק
וכו'). עונה על: "האם יש חברות עם ח.פ. שלא באמת קיימות?"

  - found: false          -> הח.פ. לא קיים בכלל ברשם (חברה/שותפות/עמותה) -
                              ההתאמה שלנו כנראה שגויה, או שזה חפ ישן/שגוי.
  - status מכיל "מחוק"/"מבוטל"/"פירוק"/"מפורק"/"חיסול" -> הישות קיימת
                              ברשם אבל כבר לא פעילה - "לא קיימת בפועל"
                              גם אם טכנית עדיין רשומה.
  - אחרת                  -> פעילה, תקין.

קלט:
    out/heteriske_businesses_with_chp.json   (פלט של resolve_chp.py)

הרצה:
    python scripts/heteriske_audit/check_company_status.py

פלט (בתיקיית out/ ליד הסקריפט):
    out/heteriske_company_status_report.json/csv
"""

import csv
import json
import re
import time
from pathlib import Path

import requests

LOOKUP_URL = "https://harav-levin.pages.dev/api/lookup"
LOOKUP_DELAY_SEC = 0.4

OUT_DIR = Path(__file__).resolve().parent / "out"
IN_FILE = OUT_DIR / "heteriske_businesses_with_chp.json"

DEFUNCT_RE = re.compile(r"מחוק|נמחק|מבוטל|פירוק|מפורק|מחוסל|חוסל|חיסול")


def lookup_status(chp, session, retries=2):
    for attempt in range(retries + 1):
        try:
            resp = session.get(LOOKUP_URL, params={"number": chp}, timeout=20)
            resp.raise_for_status()
            return resp.json()
        except Exception as e:
            if attempt == retries:
                return {"error": f"{type(e).__name__}: {e}"}
            time.sleep(1.0)


def main():
    with open(IN_FILE, encoding="utf-8") as f:
        businesses = json.load(f)

    to_check = [b for b in businesses if b.get("chp_number")]
    print(f"{len(to_check)} עסקים עם ח.פ. שנפתר - בודקים מול הרשם...")

    session = requests.Session()
    rows = []
    n_not_found = 0
    n_defunct = 0
    n_active = 0

    for i, b in enumerate(to_check, 1):
        chp = b["chp_number"]
        result = lookup_status(chp, session)

        entry = {
            "heteriske_code": b["code"],
            "heteriske_name": b["name"],
            "chp_number": chp,
            "chp_match_name": b.get("chp_match_name"),
            "chp_confidence": b.get("chp_confidence"),
        }

        if result.get("error"):
            entry["registry_status"] = "שגיאת שליפה"
            entry["error"] = result["error"]
        elif not result.get("found"):
            entry["registry_status"] = "לא נמצא ברשם - ח.פ. לא קיים בפועל"
            n_not_found += 1
        else:
            status = result.get("status", "")
            entry["registry_official_name"] = result.get("name")
            entry["registry_entity_type"] = result.get("entityType")
            entry["registry_biz_type"] = result.get("bizType")
            entry["registry_status_raw"] = status
            if DEFUNCT_RE.search(status or ""):
                entry["registry_status"] = f"לא פעילה בפועל ({status})"
                n_defunct += 1
            else:
                entry["registry_status"] = "פעילה"
                n_active += 1

        rows.append(entry)
        if i % 50 == 0:
            print(f"  [{i}/{len(to_check)}] פעילות: {n_active}, לא פעילות: {n_defunct}, "
                  f"לא נמצאו: {n_not_found}")
        time.sleep(LOOKUP_DELAY_SEC)

    print(f"\n=== סיכום ===")
    print(f"פעילות (תקין):                 {n_active}")
    print(f"לא פעילות בפועל (מחוקה/מבוטלת/בפירוק): {n_defunct}")
    print(f"לא נמצאות ברשם כלל:            {n_not_found}")

    out_json = OUT_DIR / "heteriske_company_status_report.json"
    out_csv = OUT_DIR / "heteriske_company_status_report.csv"

    with open(out_json, "w", encoding="utf-8") as f:
        json.dump(rows, f, ensure_ascii=False, indent=2)

    fields = ["heteriske_code", "heteriske_name", "chp_number", "chp_match_name",
              "chp_confidence", "registry_status", "registry_official_name",
              "registry_entity_type", "registry_biz_type", "registry_status_raw", "error"]
    with open(out_csv, "w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        for row in rows:
            writer.writerow({k: row.get(k, "") for k in fields})

    print(f"\nנכתבו: {out_json}, {out_csv}")

    problems = [r for r in rows if r["registry_status"] != "פעילה" and "שגיא" not in r["registry_status"]]
    if problems:
        print(f"\n=== {len(problems)} עסקים עם בעיה (לא פעילים/לא נמצאו) ===")
        for r in problems:
            print(f"  [{r['heteriske_code']}] '{r['heteriske_name']}' (ח.פ. {r['chp_number']}) "
                  f"-> {r['registry_status']}")


if __name__ == "__main__":
    main()
