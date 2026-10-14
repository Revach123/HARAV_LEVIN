# -*- coding: utf-8 -*-
"""
קבצים שלא משויכים לפוסט (post_type ריק): מחפש באילו עמודים / פוסטים באתר הם מקושרים (לפי שם הקובץ בתוכן),
כדי לקבוע את המיקום שלהם (כללי / פרטי / חברה) ואת שם החברה לפי הפוסט המקשר.

קלט:  קובץ התוצאות (כל_הקבצים4.csv)  +  posts_content.csv (wp post list ... --fields=ID,post_title,post_type,post_content)
פלט:  CSV: לכל קובץ ללא פוסט - הפוסטים שמקשרים אליו (כותרת וסוג).
"""
import argparse
import csv
import re
import sys

csv.field_size_limit(min(sys.maxsize, 2**31 - 1))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--results", required=True)
    ap.add_argument("--content", required=True)
    ap.add_argument("--out", default="unattached_locations.csv")
    a = ap.parse_args()

    with open(a.results, encoding="utf-8-sig", newline="") as f:
        rows = [r for r in csv.DictReader(f) if not r.get("post_type")]
    with open(a.content, encoding="utf-8-sig", newline="") as f:
        posts = list(csv.DictReader(f))
    for p in posts:
        p["_c"] = (p.get("post_content") or "").lower()

    found = 0
    with open(a.out, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(["attachment_id", "file", "post_title_of_file", "confidence", "business_name", "linked_in_count", "linked_in (type: title)"])
        for r in rows:
            name = r["file"].lower()
            hits = [p for p in posts if name in p["_c"]]
            if hits:
                found += 1
            w.writerow([r["attachment_id"], r["file"], r["post_title"], r["confidence"], r["business_name"], len(hits),
                        " | ".join(f"{p['post_type']}: {p['post_title']}" for p in hits[:4])])
    print(f"{len(rows)} קבצים ללא פוסט, מהם {found} נמצא להם פוסט מקשר -> {a.out}")


if __name__ == "__main__":
    main()
