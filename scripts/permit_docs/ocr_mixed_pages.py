# -*- coding: utf-8 -*-
"""
OCR רק לעמודים סרוקים בתוך מסמכים שיש להם שכבת טקסט בחלק מהעמודים (מסמכים "מעורבים": למשל עמודים 1-2 טקסט, 3-4 סריקה).
ה-OCR הרגיל מדלג על מסמכים כאלה, ולכן משפט מפתח שנמצא בעמוד הסרוק לא נקרא.

  python ocr_mixed_pages.py [--final סופי_מאוחד.csv] [--attachments attachments.csv] [--uploads wp-content\\uploads] [--workers 2]

פלט: ocr_text_pg\\<מזהה>.txt (רק העמודים הסרוקים של כל מסמך). ניתן להפסיק ולהמשיך. אחר כך: python build_cases.py (קורא את התיקייה אוטומטית).
"""
import argparse
import os
import sys
from multiprocessing import Pool

try:
    import pymupdf as fitz
except ImportError:
    import fitz

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import match_pdfs as m  # noqa: E402
from ocr_pdfs import TESS_DEFAULT, ocr_page  # noqa: E402

MAX_PAGES = 12
MIN_CHARS = 30


def work(job):
    aid, path, out_dir, tesseract, dpi = job
    dest = os.path.join(out_dir, f"{aid}.txt")
    if os.path.exists(dest):
        return aid, "קיים"
    try:
        doc = fitz.open(path)
        pages = [i for i in range(min(len(doc), MAX_PAGES)) if len((doc[i].get_text() or "").strip()) < MIN_CHARS]
        has_text = any(len((doc[i].get_text() or "").strip()) >= MIN_CHARS for i in range(min(len(doc), MAX_PAGES)))
        if not pages or not has_text:      # אין עמודים סרוקים, או שהמסמך כולו סרוק (כבר נקרא ב-OCR הרגיל)
            doc.close()
            open(dest, "w", encoding="utf-8").close()
            return aid, "דולג"
        text = "\n".join(ocr_page(doc, i, tesseract, dpi) for i in pages)
        doc.close()
    except Exception as e:  # noqa: BLE001
        return aid, f"נכשל: {e}"
    with open(dest, "w", encoding="utf-8") as f:
        f.write(text)
    return aid, "נקרא"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--final", default="סופי_מאוחד.csv")
    ap.add_argument("--attachments", default="attachments.csv")
    ap.add_argument("--uploads", default=os.path.join("wp-content", "uploads"))
    ap.add_argument("--out-dir", default="ocr_text_pg")
    ap.add_argument("--tesseract", default=TESS_DEFAULT if os.name == "nt" else "tesseract")
    ap.add_argument("--dpi", type=int, default=200)
    ap.add_argument("--workers", type=int, default=2)
    a = ap.parse_args()
    os.makedirs(a.out_dir, exist_ok=True)
    guid = {r["ID"]: r.get("guid", "") for r in m.read_csv(a.attachments)}
    jobs, seen = [], set()
    for r in m.read_csv(a.final):
        aid = r["attachment_id"]
        if aid in seen:
            continue
        seen.add(aid)
        p = m.local_path(a.uploads, guid.get(aid, ""))
        if p and os.path.exists(p):
            jobs.append((aid, p, a.out_dir, a.tesseract, a.dpi))
    print(f"בודק {len(jobs)} מסמכים (OCR רק לעמודים סרוקים במסמכים מעורבים)")
    done = 0
    with Pool(a.workers) as pool:
        for aid, st in pool.imap_unordered(work, jobs, chunksize=4):
            done += 1
            if st.startswith("נקרא") or st.startswith("נכשל"):
                print(f"  {aid}: {st}", flush=True)
            if done % 200 == 0:
                print(f"  {done}/{len(jobs)}", flush=True)
    print("הסתיים. עכשיו: python build_cases.py")


if __name__ == "__main__":
    main()
