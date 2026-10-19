# -*- coding: utf-8 -*-
"""
האם פספסנו שטרות באתר הישן? קריאה בלבד: לא משנה, לא מוחק ולא כותב לשום מאגר.

סורק תיקיות (ואת תוכן קבצי zip / tar בתוכן) ומחפש קבצי PDF שאינם במאגר המסמכים שלנו (לפי חתימת תוכן, לא לפי שם קובץ),
ומסמן מה מהם נראה כמו היתר עיסקא (לפי הטקסט שבקובץ). אפשר גם לתת קובצי sql של גיבוי וורדפרס: מוצאים בהם קישורים לקבצי PDF שאינם ב-attachments.csv.

    python find_missed_pdfs.py --roots "C:\\localwp\\Local Sites\\iska" "D:\\גיבויים"
    python find_missed_pdfs.py --roots . --sql backup.sql

קלט:   text_index\\permit_text.db (המסמכים שכבר במאגר), attachments.csv (אופציונלי, לבדיקת ה-sql)
פלט:   text_index\\פספסנו_pdf.csv, text_index\\גיבויים_שנמצאו.csv, text_index\\פספסנו_קישורי_sql.csv
"""
import argparse
import csv
import hashlib
import io
import os
import re
import sqlite3
import sys
import tarfile
import zipfile

try:
    import pymupdf as fitz
except ImportError:
    import fitz

KEYS = ("היתר עיסקא", "היתר עסקא", "היתר עסקה", "היתר עיסקה", "היתר עיסקא פרטי")
ARCH = (".zip", ".tar", ".tgz", ".gz", ".sql", ".wpress", ".7z", ".rar")
SKIP_DIRS = {"text_index", ".git", "node_modules", "__pycache__"}


def permit_like(data):
    """מחזיר: 'היתר' אם הטקסט שבקובץ (גם בסדר אותיות הפוך) מכיל ביטוי של היתר עיסקא; 'סרוק' אם אין בו שכבת טקסט; אחרת 'אחר'."""
    try:
        doc = fitz.open(stream=data, filetype="pdf")
    except Exception:  # noqa: BLE001
        return "פגום"
    text = ""
    for i in range(min(len(doc), 4)):
        try:
            text += " " + doc[i].get_text()
        except Exception:  # noqa: BLE001
            pass
    doc.close()
    t = re.sub(r"\s+", " ", text)
    if len(t.strip()) < 40:
        return "סרוק"
    low = t.replace("'", "").replace('"', "")
    for k in KEYS:
        if k in low or k[::-1] in low:
            return "היתר"
    return "אחר"


def known_hashes(path):
    if not os.path.exists(path):
        print(f"אין {path}: הרץ קודם run_step2.py. בלי זה כל קובץ ייחשב חסר.")
        return set()
    db = sqlite3.connect("file:" + os.path.abspath(path).replace("\\", "/") + "?mode=ro", uri=True, timeout=30)
    try:
        return {r[0] for r in db.execute("SELECT sha FROM docs")}
    finally:
        db.close()


def walk_files(roots):
    for root in roots:
        for dp, dn, fn in os.walk(root):
            dn[:] = [d for d in dn if d not in SKIP_DIRS]
            for f in fn:
                yield os.path.join(dp, f)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--roots", nargs="+", required=True, help="תיקיות לסריקה (כולל תיקיות הגיבוי)")
    ap.add_argument("--sql", nargs="*", default=[], help="קובצי sql של גיבוי וורדפרס, לחיפוש קישורי PDF")
    ap.add_argument("--db", default=os.path.join("text_index", "permit_text.db"))
    ap.add_argument("--attachments", default="attachments.csv")
    ap.add_argument("--out", default="text_index")
    ap.add_argument("--max-archive-mb", type=int, default=3000, help="לא פותח ארכיבים גדולים מזה (מגה-בייט)")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    known = known_hashes(a.db)
    print(f"במאגר שלנו: {len(known)} מסמכים")
    seen, rows, archives, scanned = set(), [], [], 0

    def check(name, data, where):
        nonlocal scanned
        scanned += 1
        sha = hashlib.sha256(data).hexdigest()
        if sha in known or sha in seen:
            return
        seen.add(sha)
        rows.append([permit_like(data), where, name, len(data), sha[:12]])

    for path in walk_files(a.roots):
        low = path.lower()
        try:
            size = os.path.getsize(path)
        except OSError:
            continue
        if low.endswith(".pdf"):
            try:
                check(os.path.basename(path), open(path, "rb").read(), path)
            except OSError:
                pass
        elif low.endswith(ARCH):
            archives.append([path, size // 1048576])
            if size > a.max_archive_mb * 1048576:
                continue
            try:
                if low.endswith(".zip") and zipfile.is_zipfile(path):
                    with zipfile.ZipFile(path) as z:
                        for zi in z.infolist():
                            if zi.filename.lower().endswith(".pdf"):
                                check(os.path.basename(zi.filename), z.read(zi), path + " :: " + zi.filename)
                elif low.endswith((".tar", ".tgz", ".gz")) and tarfile.is_tarfile(path):
                    with tarfile.open(path) as t:
                        for m in t:
                            if m.isfile() and m.name.lower().endswith(".pdf"):
                                check(os.path.basename(m.name), t.extractfile(m).read(), path + " :: " + m.name)
            except Exception as e:  # noqa: BLE001
                print(f"  לא נקרא: {path} ({e})")
        if scanned and scanned % 200 == 0:
            print(f"  נסרקו {scanned} קבצי PDF, חסרים אצלנו: {len(rows)}", flush=True)

    order = {"היתר": 0, "סרוק": 1, "אחר": 2, "פגום": 3}
    rows.sort(key=lambda r: (order.get(r[0], 9), r[2]))
    with open(os.path.join(a.out, "פספסנו_pdf.csv"), "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(["נראה כמו", "מיקום", "שם קובץ", "גודל", "חתימה"])
        w.writerows(rows)
    with open(os.path.join(a.out, "גיבויים_שנמצאו.csv"), "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(["קובץ", "גודל (MB)"])
        w.writerows(archives)

    # קישורים לקבצי PDF בתוך גיבוי sql שאינם ב-attachments.csv
    have = set()
    if os.path.exists(a.attachments):
        for r in csv.DictReader(open(a.attachments, encoding="utf-8-sig")):
            g = r.get("guid", "")
            if g:
                have.add(os.path.basename(g).lower())
    urls = {}
    pat = re.compile(r"wp-content/uploads/[^\s\"'<>\\)]+?\.pdf", re.I)
    for sp in a.sql:
        with open(sp, "r", encoding="utf-8", errors="replace") as f:
            for line in f:
                for m in pat.findall(line.replace("\\/", "/")):
                    urls.setdefault(m, sp)
    miss = [[u, sp] for u, sp in sorted(urls.items()) if os.path.basename(u).lower() not in have]
    if a.sql:
        with open(os.path.join(a.out, "פספסנו_קישורי_sql.csv"), "w", encoding="utf-8-sig", newline="") as f:
            w = csv.writer(f)
            w.writerow(["קישור", "נמצא בגיבוי"])
            w.writerows(miss)
    c = {k: sum(1 for r in rows if r[0] == k) for k in order}
    print(f"\nנסרקו {scanned} קבצי PDF. חסרים אצלנו: {len(rows)} (נראים כהיתר: {c['היתר']}, סרוקים בלי טקסט: {c['סרוק']}, אחרים: {c['אחר']}, פגומים: {c['פגום']})")
    print(f"ארכיבים / גיבויים שנמצאו: {len(archives)}")
    if a.sql:
        print(f"קישורי PDF בגיבוי ה-sql שאינם ב-attachments.csv: {len(miss)} מתוך {len(urls)}")
    print(f"נכתב: {a.out}\\פספסנו_pdf.csv, {a.out}\\גיבויים_שנמצאו.csv" + (f", {a.out}\\פספסנו_קישורי_sql.csv" if a.sql else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
