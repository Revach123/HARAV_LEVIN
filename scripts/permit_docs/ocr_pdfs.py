# -*- coding: utf-8 -*-
"""
OCR בעברית לקבצי PDF סרוקים (תמונות בלבד) - רץ על המחשב שלך. מפיק רק טקסט (תיקיית ocr_text); ההצלבה והזיהוי ב-reconcile.py.
כל קובץ נקרא תמיד (לא רק מה שנכשל), כי לא סומכים על מקור אחד: שם הפוסט עלול להיות שגוי, ולכן מחלצים ח.פ. ושם גם מהקובץ.

  python ocr_pdfs.py --results כל_הקבצים4.csv --uploads "<uploads>" [--workers 4] [--limit 20]

* ניתן להפסיק ולהמשיך: קבצים שכבר נקראו (ocr_text\\<מזהה>.txt) מדולגים.
* קורא את העמוד הראשון; אם לא נמצא בו ח.פ. תקין - קורא גם את העמוד השני.
דורש:  pip install pymupdf   +   Tesseract עם שפה עברית.
"""
import argparse
import os
import re
import subprocess
import sys
import tempfile
from multiprocessing import Pool

try:
    import pymupdf as fitz
except ImportError:
    import fitz

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import match_pdfs as m  # noqa: E402

TESS_DEFAULT = r"C:\Program Files\Tesseract-OCR\tesseract.exe"


def has_valid_hp(text):
    return any(m.check_digit_ok(x.zfill(9)) for x in re.findall(r"(?<!\d)(\d{8,9})(?!\d)", text.replace(",", "")))


def ocr_page(doc, i, tesseract, dpi):
    pix = doc[i].get_pixmap(dpi=dpi)
    with tempfile.TemporaryDirectory() as td:
        png = os.path.join(td, "p.png")
        pix.save(png)
        out = subprocess.run([tesseract, png, "stdout", "-l", "heb+eng", "--psm", "6"], capture_output=True, timeout=240)
    return out.stdout.decode("utf-8", "replace")


def work(job):
    aid, path, out_dir, tesseract, dpi = job
    dest = os.path.join(out_dir, f"{aid}.txt")
    if os.path.exists(dest):
        return aid, "קיים"
    try:
        doc = fitz.open(path)
        text = ocr_page(doc, 0, tesseract, dpi)
        if len(doc) > 1 and not has_valid_hp(text):
            text += "\n" + ocr_page(doc, 1, tesseract, dpi)
        doc.close()
    except Exception as e:  # noqa: BLE001
        return aid, f"נכשל: {e}"
    with open(dest, "w", encoding="utf-8") as f:
        f.write(text)
    return aid, "נקרא"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--results", required=True)
    ap.add_argument("--attachments", required=True, help="attachments.csv (לזיהוי הקובץ המדויק לפי מזהה; יש קבצים בשם זהה בתיקיות שונות)")
    ap.add_argument("--uploads", required=True)
    ap.add_argument("--out-dir", default="ocr_text")
    ap.add_argument("--tesseract", default=TESS_DEFAULT if os.name == "nt" else "tesseract")
    ap.add_argument("--dpi", type=int, default=200)
    ap.add_argument("--workers", type=int, default=2)
    ap.add_argument("--limit", type=int, default=0)
    a = ap.parse_args()

    guid = {r["ID"]: r.get("guid", "") for r in m.read_csv(a.attachments)}
    path_of = {}
    for r in m.read_csv(a.results):
        p = m.local_path(a.uploads, guid.get(r["attachment_id"], ""))
        if p and os.path.exists(p):
            path_of[r["attachment_id"]] = p
    rows = [r for r in m.read_csv(a.results) if int(r.get("text_chars") or 0) < 200 and r["attachment_id"] in path_of]
    if a.limit:
        rows = rows[:a.limit]
    os.makedirs(a.out_dir, exist_ok=True)
    jobs = [(r["attachment_id"], path_of[r["attachment_id"]], a.out_dir, a.tesseract, a.dpi) for r in rows]
    stats = {}
    with Pool(a.workers) as pool:
        for i, (aid, st) in enumerate(pool.imap_unordered(work, jobs), 1):
            k = st.split(":")[0]
            stats[k] = stats.get(k, 0) + 1
            if st.startswith("נכשל"):
                print(aid, st, file=sys.stderr)
            if i % 20 == 0:
                print(f"{i}/{len(jobs)}", stats, flush=True)
    print("סיום:", stats, "->", a.out_dir)


if __name__ == "__main__":
    sys.exit(main())
