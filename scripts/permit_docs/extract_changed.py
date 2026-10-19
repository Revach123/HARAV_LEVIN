# -*- coding: utf-8 -*-
"""
מחלץ לתיקייה אחת (new_docs) את הגרסאות שבגיבוי של קבצים שהוחלפו באתר החי (הרשימה מ-compare_paths.py), בשם <קובץ>-backup.pdf.
קריאה בלבד מהגיבוי; כותב רק לתיקייה החדשה.

    python extract_changed.py            # ברירת מחדל: text_index\\הבדלי_נתיבים.csv, wp-content\\updraft, התיקייה new_docs
"""
import argparse
import csv
import os
import sys
import zipfile


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", default=os.path.join("text_index", "הבדלי_נתיבים.csv"))
    ap.add_argument("--updraft", default=os.path.join("wp-content", "updraft"))
    ap.add_argument("--out", default="new_docs")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    n = 0
    for r in csv.DictReader(open(a.csv, encoding="utf-8-sig")):
        rel, arc = r["נתיב"], r["ארכיב"]
        with zipfile.ZipFile(os.path.join(a.updraft, arc)) as z:
            name = next((x for x in z.namelist() if x.replace("\\", "/").endswith("uploads/" + rel)), None)
            if not name:
                print(f"לא נמצא בארכיב: {rel}"); continue
            base = os.path.splitext(os.path.basename(rel))[0]
            out = os.path.join(a.out, f"{base}-backup.pdf")
            open(out, "wb").write(z.read(name))
            print(f"{rel} -> {out}"); n += 1
    print(f"חולצו {n} קבצים לתיקייה {os.path.abspath(a.out)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
