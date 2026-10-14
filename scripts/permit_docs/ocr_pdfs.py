# -*- coding: utf-8 -*-
"""
OCR בעברית לקבצי PDF סרוקים (תמונות בלבד) שלא זוהו בשלב הראשון - רץ על המחשב שלך.

קלט:  קובץ התוצאות של match_pdfs.py (למשל כל_הקבצים4.csv), תיקיית uploads, ורשימת העסקים (businesses.json).
פלט:  קובץ CSV חדש עם הזיהוי מחדש (לפי הטקסט שנקרא מהסריקה: ח.פ. עם ספרת ביקורת תקינה + שם העסק),
      ותיקייה ocr_text עם הטקסט שנקרא מכל קובץ (לבדיקה ידנית).
שימוש:
  python ocr_pdfs.py --results כל_הקבצים4.csv --uploads "<uploads>" --businesses businesses.json --out ocr_תוצאות.csv [--limit 20]
דורש:  pip install pymupdf   +   Tesseract עם שפה עברית (ראה הוראות בשיחה).
"""
import argparse
import csv
import os
import re
import subprocess
import sys
import tempfile

try:
    import pymupdf as fitz  # PyMuPDF
except ImportError:
    import fitz

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import match_pdfs as m  # noqa: E402

TESS_DEFAULT = r"C:\Program Files\Tesseract-OCR\tesseract.exe"


def ocr_pdf(path, tesseract, pages, dpi):
    texts = []
    doc = fitz.open(path)
    for i in range(min(pages, len(doc))):
        pix = doc[i].get_pixmap(dpi=dpi)
        with tempfile.TemporaryDirectory() as td:
            png = os.path.join(td, "p.png")
            pix.save(png)
            out = subprocess.run([tesseract, png, "stdout", "-l", "heb+eng", "--psm", "6"], capture_output=True, timeout=180)
            texts.append(out.stdout.decode("utf-8", "replace"))
    doc.close()
    return "\n".join(texts)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--results", required=True)
    ap.add_argument("--uploads", required=True)
    ap.add_argument("--businesses", required=True)
    ap.add_argument("--out", default="ocr_תוצאות.csv")
    ap.add_argument("--tesseract", default=TESS_DEFAULT if os.name == "nt" else "tesseract")
    ap.add_argument("--pages", type=int, default=2, help="כמה עמודים ראשונים לקרוא מכל קובץ")
    ap.add_argument("--dpi", type=int, default=200)
    ap.add_argument("--statuses", default="לבדיקה ידנית,סביר", help="אילו קבצים לעבד (לפי הסטטוס בתוצאות הקודמות)")
    ap.add_argument("--limit", type=int, default=0)
    a = ap.parse_args()

    biz = m.load_businesses(a.businesses)
    by_hp = {}
    for b in biz:
        d = re.sub(r"\D", "", b.get("chp_number") or "").lstrip("0")
        if d:
            by_hp.setdefault(d.zfill(9), []).append(b)
    names = [(n, b) for b in biz for n in {(b.get("registrar_name") or "").strip(), (b.get("permit_name") or "").strip()} if n]

    index = {}
    for d, _, files in os.walk(a.uploads):
        for f in files:
            if f.lower().endswith(".pdf"):
                index.setdefault(f, os.path.join(d, f))

    statuses = {s.strip() for s in a.statuses.split(",")}
    rows = [r for r in m.read_csv(a.results) if r["confidence"] in statuses and int(r.get("text_chars") or 0) < 15]
    if a.limit:
        rows = rows[:a.limit]
    os.makedirs("ocr_text", exist_ok=True)

    cols = ["attachment_id", "file", "post_title", "old_confidence", "confidence", "reason", "hp", "business_id", "business_name", "hp_candidates", "ocr_chars", "post_type"]
    stats = {}
    with open(a.out, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(cols)
        for i, r in enumerate(rows, 1):
            path = index.get(r["file"], "")
            title = r["post_title"]
            if not path:
                conf, reason, hp, b, cands, text = "לבדיקה ידנית", "הקובץ לא נמצא", "", None, [], ""
            else:
                try:
                    text = ocr_pdf(path, a.tesseract, a.pages, a.dpi)
                except Exception as e:  # noqa: BLE001
                    text = ""
                    print("OCR נכשל:", r["file"], e, file=sys.stderr)
                with open(os.path.join("ocr_text", f"{r['attachment_id']}.txt"), "w", encoding="utf-8") as tf:
                    tf.write(text)
                if len(text.strip()) < 15:
                    conf, reason, hp, b, cands = "לבדיקה ידנית", "OCR לא קרא טקסט", "", None, []
                else:
                    hp, b, conf, reason, cands = m.classify(text, title, by_hp, names)
                    reason = "OCR; " + reason
            stats[conf] = stats.get(conf, 0) + 1
            w.writerow([r["attachment_id"], r["file"], title, r["confidence"], conf, reason, hp, (b or {}).get("id", ""),
                        ((b or {}).get("registrar_name") or (b or {}).get("permit_name") or ""), " ".join(cands[:6]), len(text.strip()), r.get("post_type", "")])
            if i % 10 == 0:
                print(f"{i}/{len(rows)}", stats, flush=True)
    print("סיום:", stats, "->", a.out)


if __name__ == "__main__":
    sys.exit(main())
