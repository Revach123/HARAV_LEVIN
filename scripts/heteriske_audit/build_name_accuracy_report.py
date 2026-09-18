#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
scripts/heteriske_audit/build_name_accuracy_report.py

לכל עסק ב-heteriske.com: האם השם שמוצג שם מדויק מול המאגר שלנו (לא מול
data.gov.il - מול הרשימה שבנינו, ר' resolve_chp.py)? נגזר ישירות מהפלט
של resolve_chp.py (heteriske_businesses_with_chp.json) - אין כאן קריאת
רשת נוספת, רק עיבוד מקומי של מה שכבר חושב:

  - chp_confidence == "exact"  -> השם ב-heteriske זהה (אחרי נרמול) לשם
                                   במאגר שלנו -> "מדויק"
  - chp_confidence == "fuzzy"  -> השם דומה אבל לא זהה למה שיש במאגר שלנו
                                   (chp_match_name) -> "קירוב - לבדוק"
  - אין chp_number בכלל        -> לא נפתר מול המאגר שלנו -> "לא ידוע"

מיועד למנהל האתר - חומר קונקרטי לאיפה משתמשים עלולים לטעות בין מה
שכתוב ב-heteriske לבין השם האמיתי במאגר שלנו.

קלט:
    out/heteriske_businesses_with_chp.json   (פלט של resolve_chp.py)

הרצה:
    python scripts/heteriske_audit/build_name_accuracy_report.py

פלט (בתיקיית out/ ליד הסקריפט):
    out/heteriske_name_accuracy_report.json/csv
"""

import csv
import json
from pathlib import Path

OUT_DIR = Path(__file__).resolve().parent / "out"
IN_FILE = OUT_DIR / "heteriske_businesses_with_chp.json"


def main():
    with open(IN_FILE, encoding="utf-8") as f:
        businesses = json.load(f)

    rows = []
    for b in businesses:
        chp = b.get("chp_number")
        confidence = b.get("chp_confidence")
        our_name = b.get("chp_match_name")
        if not chp:
            status = "לא ידוע - לא נפתר מול המאגר שלנו"
            accurate = None
        elif confidence == "exact":
            status = "מדויק"
            accurate = True
        else:  # fuzzy
            status = "קירוב - השם ב-heteriske שונה מהשם במאגר שלנו"
            accurate = False
        rows.append({
            "heteriske_code": b.get("code"),
            "heteriske_name": b.get("name"),
            "chp_number": chp,
            "our_name": our_name,
            "status": status,
            "name_accurate": accurate,
            "chp_verified": b.get("chp_verified"),
        })

    n_accurate = sum(1 for r in rows if r["name_accurate"] is True)
    n_approx = sum(1 for r in rows if r["name_accurate"] is False)
    n_unknown = sum(1 for r in rows if r["name_accurate"] is None)
    print(f"מדויק: {n_accurate} | קירוב (לבדוק): {n_approx} | לא ידוע: {n_unknown}")

    out_json = OUT_DIR / "heteriske_name_accuracy_report.json"
    out_csv = OUT_DIR / "heteriske_name_accuracy_report.csv"

    with open(out_json, "w", encoding="utf-8") as f:
        json.dump(rows, f, ensure_ascii=False, indent=2)

    fields = ["heteriske_code", "heteriske_name", "chp_number", "our_name",
              "status", "name_accurate", "chp_verified"]
    with open(out_csv, "w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        for row in rows:
            writer.writerow({k: row.get(k, "") for k in fields})

    print(f"נכתבו: {out_json}, {out_csv}")


if __name__ == "__main__":
    main()
