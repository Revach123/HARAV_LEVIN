# -*- coding: utf-8 -*-
"""
רשימת קבצים שסומנו בדשבורד "חסר במאגר" (החברה לא נמצאה): לבדיקה בחיפוש באתר ובחיפוש חברות, ולהוספה למאגר אם קיימת ופעילה.
קריאה בלבד. קלט: החלטות_בדיקה.csv, סופי_מאוחד.csv, businesses.json. פלט: חברות_חסרות_במאגר.csv
  לכל קובץ: מזהה, שם הקובץ, כותרת הפוסט, מיקום באתר, ההערה שכתבת, ח.פ.-ים של תאגידים שנמצאו בקובץ או בהערה (לא במאגר), ושמות שזוהו בטקסט.
  מספרים שאינם מספרי תאגיד (שאינם מתחילים ב-5) מסוננים: אלה בדרך כלל תעודות זהות של יחידים.
    python missing_companies_report.py
"""
import argparse
import csv
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import match_pdfs as m  # noqa: E402

PAT = re.compile(r"חסר במאגר|לא במאגר|לא נמצא במאגר|חסרה במאגר|לא מוכר")


def corp(text):
    return [h for h in dict.fromkeys(x.zfill(9) for x in re.findall(r"(?<!\d)(\d{8,9})(?!\d)", text or "")) if h[0] == "5" and m.check_digit_ok(h)]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--decisions", default="החלטות_בדיקה.csv")
    ap.add_argument("--final", default="סופי_מאוחד.csv")
    ap.add_argument("--businesses", default="businesses.json")
    ap.add_argument("--out", default="חברות_חסרות_במאגר.csv")
    a = ap.parse_args()
    chps = {str(b.get("chp_number") or "").zfill(9) for b in json.load(open(a.businesses, encoding="utf-8")) if b.get("chp_number")}
    final = {r["attachment_id"]: r for r in m.read_csv(a.final)}
    out = []
    for d in m.read_csv(a.decisions):
        if (d.get("company_ids") or d.get("company_id")) or not PAT.search(d.get("note") or ""):
            continue
        f = final.get(d["attachment_id"], {})
        hps = [h for h in dict.fromkeys(corp(d.get("note")) + corp(f.get("doc_hps_not_in_db"))) if h not in chps]
        out.append({"attachment_id": d["attachment_id"], "file": d.get("file", ""), "post_title": f.get("post_title", ""),
                    "location": f.get("post_type", "") or "ללא מיקום", "your_note": d.get("note", ""),
                    "corporate_numbers_not_in_db": " ".join(hps), "same_as": d.get("same_as", "")})
    out.sort(key=lambda r: (r["corporate_numbers_not_in_db"] == "", r["post_title"]))
    with open(a.out, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(out[0].keys()) if out else ["attachment_id"])
        w.writeheader()
        w.writerows(out)
    print(f"{len(out)} קבצים, מהם {sum(1 for r in out if r['corporate_numbers_not_in_db'])} עם מספר תאגיד -> {a.out}")


if __name__ == "__main__":
    sys.exit(main())
