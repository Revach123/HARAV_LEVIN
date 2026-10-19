# -*- coding: utf-8 -*-
"""
האם קובץ באותו נתיב בדיוק השתנה בין התיקייה המקומית לגיבוי? (קריאה בלבד)
לכל קובץ PDF בארכיבי ה-uploads של הגיבוי (updraft\\*uploads*.zip) מחפשים את הקובץ בנתיב זהה בתיקייה המקומית wp-content\\uploads,
ומשווים תוכן. הבדל = ייתכן שהקובץ הוחלף באתר החי אחרי שהועתקה התיקייה המקומית, ואז ייתכן שהמאגר שלנו מחזיק גרסה ישנה.
מדלג על טפסי ההצטרפות (sendpdfcf7_uploads) ועל קבצי preview / document-pdf.

    python compare_paths.py
פלט: text_index\\הבדלי_נתיבים.csv  (נתיב, גודל מקומי, גודל בגיבוי, תאריך בגיבוי, האם הקובץ המקומי במאגר שלנו)
"""
import argparse
import csv
import glob
import hashlib
import os
import re
import sqlite3
import sys
import zipfile

SKIP = re.compile(r"sendpdfcf7_uploads|(^|/)(preview-|document-pdf)", re.I)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--zips", default=os.path.join("wp-content", "updraft", "*uploads*.zip"))
    ap.add_argument("--uploads", default=os.path.join("wp-content", "uploads"))
    ap.add_argument("--db", default=os.path.join("text_index", "permit_text.db"))
    ap.add_argument("--out", default=os.path.join("text_index", "הבדלי_נתיבים.csv"))
    a = ap.parse_args()
    known = set()
    if os.path.exists(a.db):
        db = sqlite3.connect("file:" + os.path.abspath(a.db).replace("\\", "/") + "?mode=ro", uri=True, timeout=30)
        known = {r[0] for r in db.execute("SELECT sha FROM docs")}
        db.close()
    rows, same, zip_only, total = [], 0, 0, 0
    for zp in sorted(glob.glob(a.zips)):
        try:
            z = zipfile.ZipFile(zp)
        except Exception as e:  # noqa: BLE001
            print(f"לא נפתח: {zp} ({e})"); continue
        for zi in z.infolist():
            name = zi.filename.replace("\\", "/")
            if not name.lower().endswith(".pdf") or SKIP.search(name):
                continue
            total += 1
            rel = name.split("uploads/", 1)[-1] if "uploads/" in name else name
            local = os.path.join(a.uploads, *rel.split("/"))
            if not os.path.exists(local):
                zip_only += 1; continue
            ld, zd = open(local, "rb").read(), z.read(zi)
            if sha(ld) == sha(zd):
                same += 1; continue
            rows.append([rel, len(ld), len(zd), "%04d-%02d-%02d" % zi.date_time[:3], "כן" if sha(ld) in known else "לא", os.path.basename(zp)])
    rows.sort()
    with open(a.out, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(["נתיב", "גודל מקומי", "גודל בגיבוי", "תאריך בגיבוי", "המקומי במאגר שלנו", "ארכיב"])
        w.writerows(rows)
    print(f"נבדקו {total} קבצי PDF בארכיבים: זהים לנתיב המקומי {same}; שונים {len(rows)}; בגיבוי בלבד (אין באותו נתיב מקומית) {zip_only}")
    print(f"נכתב: {a.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
