# -*- coding: utf-8 -*-
"""
מספר עמודים ותאריכים לכל מסמך באתר שעוד אין לו (לפי הקבצים המקומיים), ושמירה באתר. הדף בניהול ממלא את אותם נתונים לבד כשמסמך נפתח; הכלי הזה ממלא את כולם בבת אחת.
  python doc_meta.py            -> סיכום בלבד
  python doc_meta.py --go       -> שומר באתר
תאריכים: לועזיים (dd/mm/yyyy, dd.mm.yy, yyyy-mm-dd) מעמודים 1, 2 והאחרונים (טקסט הקובץ, ואם יש - גם טקסט ה-OCR ב-ocr_text), בטווח 1990 עד שנה הבאה.
לפני ההרצה: מיגרציה 0010 ב-D1.
"""
import argparse
import datetime
import getpass
import json
import os
import re
import sys

try:
    import pymupdf as fitz
except ImportError:
    import fitz

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import match_pdfs as m  # noqa: E402
from coverage_report import file_hashes  # noqa: E402
from import_to_site import call, rd  # noqa: E402

D1 = re.compile(r"(?<!\d)(\d{1,2})[./\-](\d{1,2})[./\-](\d{4}|\d{2})(?!\d)")
D2 = re.compile(r"(?<!\d)(\d{4})[./\-](\d{1,2})[./\-](\d{1,2})(?!\d)")


def dates_of(text):
    now = datetime.date.today().year
    out = set()

    def add(y, mo, d):
        y, mo, d = int(y), int(mo), int(d)
        if y < 100:
            y += 2000
        if 1990 <= y <= now + 1 and 1 <= mo <= 12 and 1 <= d <= 31:
            out.add(f"{y}-{mo:02d}-{d:02d}")
    for x in D1.finditer(text):
        add(x.group(3), x.group(2), x.group(1))
    for x in D2.finditer(text):
        add(x.group(1), x.group(2), x.group(3))
        add(x.group(1)[::-1], x.group(2)[::-1], x.group(3)[::-1])          # טקסט עברי שחולץ הפוך
    return sorted(out, reverse=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--site", default="https://harav-levin.pages.dev")
    ap.add_argument("--attachments", default="attachments.csv")
    ap.add_argument("--uploads", default=os.path.join("wp-content", "uploads"))
    ap.add_argument("--hash-cache", default="hashes_cache.json")
    ap.add_argument("--ocr-dirs", default="ocr_text,ocr_text_p2")
    ap.add_argument("--password-file", default="admin_password.txt")
    ap.add_argument("--go", action="store_true")
    ap.add_argument("--limit", type=int, default=0)
    a = ap.parse_args()
    token = os.environ.get("ADMIN_PASSWORD") or ""
    if not token and os.path.exists(a.password_file):
        with open(a.password_file, encoding="utf-8-sig") as f:
            token = (f.readline() or "").strip()
    token = token or getpass.getpass("סיסמת מנהל האתר: ")
    docs = [d for d in call(a.site, token, "/permit-docs")["docs"] if not d.get("pages")]
    guid = {r["ID"]: r.get("guid", "") for r in rd(a.attachments)}
    by_sha = {}
    for aid, sha in file_hashes(a.attachments, a.uploads, a.hash_cache).items():
        p = m.local_path(a.uploads, guid.get(aid, ""))
        if p and os.path.exists(p):
            by_sha.setdefault(sha, (aid, p))
    todo = [(d, by_sha[d["sha256"]]) for d in docs if d["sha256"] in by_sha]
    print(f"{len(docs)} מסמכים באתר בלי מספר עמודים; לכולם יש קובץ מקומי: {len(todo)}")
    if a.limit:
        todo = todo[:a.limit]
    if not a.go:
        print("לשמירה: python doc_meta.py --go")
        return 0
    ok = fail = withdate = 0
    for n, (d, (aid, path)) in enumerate(todo, 1):
        try:
            pdf = fitz.open(path)
            total = len(pdf)
            text = "\n".join(pdf[i].get_text() or "" for i in sorted({0, 1, total - 2, total - 1}) if 0 <= i < total)
            for od in a.ocr_dirs.split(","):
                op = os.path.join(od.strip(), f"{aid}.txt")
                if os.path.exists(op):
                    text += "\n" + open(op, encoding="utf-8").read()
            pdf.close()
            ds = dates_of(text)
            call(a.site, token, "/permit-docs/" + d["id"], json.dumps({"pages": total, "doc_dates": ds}).encode("utf-8"), "application/json", method="PUT")
            ok += 1
            withdate += 1 if ds else 0
        except Exception as e:  # noqa: BLE001
            fail += 1
            print(f"  נכשל {d.get('original_name')}: {e}")
        if n % 50 == 0 or n == len(todo):
            print(f"  {n}/{len(todo)} (הצליחו {ok}, מהם עם תאריך {withdate}, נכשלו {fail})", flush=True)
    return 0 if not fail else 2


if __name__ == "__main__":
    sys.exit(main())
