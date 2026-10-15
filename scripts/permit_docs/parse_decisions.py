# -*- coding: utf-8 -*-
"""
קורא את החלטות_בדיקה.csv ומפיק ממנו החלטות מובנות מההערות החופשיות (קריאה בלבד, לא משייך ולא כותב למאגר):
  * ח.פ.-ים שנכתבו בהערה: נבדקים בספרת ביקורת, ומותאמים לעסקים ב-businesses.json
  * "כללי + פרטי" / "גם ... וגם" -> שני סוגים לאותו קובץ
  * "לפיצול" / "שני מסמכים" -> סימון פיצול עתידי
  * "לא קיימת" / "לא קיים" / "ישן" / "הפוך" -> דגלים
  פלט: החלטות_מפורשות.csv  (+ רשימת ח.פ. שאינם תקינים או שאינם במאגר, לבדיקה)
    python parse_decisions.py --decisions החלטות_בדיקה.csv --businesses businesses.json
"""
import argparse
import csv
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import match_pdfs as m  # noqa: E402

FLAGS = [("לפיצול", "לפיצול"), ("שני מסמכים", "לפיצול"), ("שתי מסמכים", "לפיצול"), ("כולל שני", "לפיצול"),
         ("לא קיימת", "חברה לא קיימת"), ("לא קיים", "חברה לא קיימת"), ("כנראה לא קיימת", "חברה לא קיימת"),
         ("מסמך ישן", "מסמך ישן"), ("הפוך", "מסמך הפוך"), ("שם ישן", "שם ישן בהיתר")]


def parse(note, special):
    text = f"{note or ''} {special or ''}"
    hps = []
    for x in re.findall(r"(?<!\d)(\d{8,9})(?!\d)", text.replace("-", " ")):
        h = x.zfill(9)
        if h not in hps:
            hps.append(h)
    types = []
    if re.search(r"כללי\s*\+\s*פרטי|פרטי\s*\+\s*כללי|גם.*וגם", text):
        types = ["כללי", "פרטי"]
    flags = []
    for key, flag in FLAGS:
        if key in text and flag not in flags:
            flags.append(flag)
    if "מסמך קבוצתי" in (special or ""):
        flags.append("מסמך משותף")
    return hps, types, flags


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--decisions", default="החלטות_בדיקה.csv")
    ap.add_argument("--businesses", default="businesses.json")
    ap.add_argument("--out", default="החלטות_מפורשות.csv")
    a = ap.parse_args()
    by_chp = {}
    if os.path.exists(a.businesses):
        for b in json.load(open(a.businesses, encoding="utf-8")):
            if b.get("chp_number"):
                by_chp[str(b["chp_number"]).zfill(9)] = b
    rows, problems = [], []
    for d in m.read_csv(a.decisions):
        hps, types, flags = parse(d.get("note"), d.get("company_special"))
        if not (hps or types or flags):
            continue
        good = [h for h in hps if m.check_digit_ok(h)]
        bad = [h for h in hps if not m.check_digit_ok(h)]
        known = [h for h in good if h in by_chp]
        unknown = [h for h in good if h not in by_chp]
        for h in bad:
            problems.append(f"{d['attachment_id']} ({d.get('file','')}): {h} - ספרת ביקורת שגויה, כנראה שגיאת הקלדה")
        for h in unknown:
            problems.append(f"{d['attachment_id']} ({d.get('file','')}): {h} - תקין אבל לא נמצא בטבלת העסקים")
        rows.append({"attachment_id": d["attachment_id"], "file": d.get("file", ""), "hps_valid_in_db": " ".join(known),
                     "hps_valid_not_in_db": " ".join(unknown), "hps_invalid": " ".join(bad),
                     "types": ";".join(types), "flags": ";".join(flags), "note": d.get("note", "")})
    with open(a.out, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["attachment_id", "file", "hps_valid_in_db", "hps_valid_not_in_db", "hps_invalid", "types", "flags", "note"])
        w.writeheader()
        w.writerows(rows)
    print(f"{len(rows)} החלטות מובנות -> {a.out}")
    for p in problems:
        print("  לבדיקה:", p)


if __name__ == "__main__":
    sys.exit(main())
