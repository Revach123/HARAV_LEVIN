# -*- coding: utf-8 -*-
"""
בדיקה של מסמך בודד: האם נקרא ממנו טקסט, כמה בכל עמוד, והאם נמצא בו משפט מפתח פרטי.
  python check_phrase.py קובץ.pdf [תיקיית_OCR ...]
אפשר גם קובץ טקסט (.txt). אם לא נמצא טקסט בעמוד מסוים, כנראה זה עמוד סרוק: צריך OCR.
"""
import os
import re
import sys

try:
    import pymupdf as fitz
except ImportError:
    import fitz

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from private_wording import phrase_kind  # noqa: E402


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return
    path = sys.argv[1]
    texts = []
    if path.lower().endswith(".pdf"):
        pdf = fitz.open(path)
        print(f"עמודים במסמך: {len(pdf)}")
        for i, pg in enumerate(pdf):
            t = pg.get_text() or ""
            texts.append(t)
            print(f"  עמוד {i + 1}: {len(t.strip())} תווים" + ("  <- אין שכבת טקסט (עמוד סרוק?)" if len(t.strip()) < 30 else ""))
        pdf.close()
    else:
        texts.append(open(path, encoding="utf-8").read())
    for od in sys.argv[2:]:
        for fn in os.listdir(od):
            if os.path.splitext(fn)[0] in os.path.basename(path):
                t = open(os.path.join(od, fn), encoding="utf-8").read()
                texts.append(t)
                print(f"OCR {od}\\{fn}: {len(t.strip())} תווים")
    full = "\n".join(texts)
    print(f"סה\"כ טקסט: {len(full.strip())} תווים")
    k = phrase_kind(full)
    print("משפט מפתח:", k or "לא נמצא")
    for m in list(re.finditer(r"מאשרת|מאשרים|המעוניין|העוניין", full))[:6]:
        print("  ...", full[max(0, m.start() - 60): m.end() + 80].replace("\n", " "))


if __name__ == "__main__":
    main()
