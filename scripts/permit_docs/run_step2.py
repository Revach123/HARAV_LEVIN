# -*- coding: utf-8 -*-
"""
הרצת שלב 2 (מאגר טקסט + חותמות וכתב יד) בפקודה אחת. מריצים מתיקיית האתר (wp-content\\uploads נמצאת בה), כמו שאר הסקריפטים.

  python run_step2.py --check          בדיקת התקנה בלבד (Python, חבילות, Tesseract + עברית, הקבצים הדרושים)
  python run_step2.py --test           ניסיון על 20 מסמכים (מומלץ קודם)
  python run_step2.py                  הרצה מלאה (שעות; אפשר להפסיק ב-Ctrl+C ולהמשיך: מה שכבר נקרא לא נקרא שוב)
  python run_step2.py --text-only      רק מאגר הטקסט (בלי חותמות / כתב יד)
  python run_step2.py --ink-only       רק חותמות / כתב יד (אחרי שמאגר הטקסט קיים)

אפשרויות: --workers 2 (מספר תהליכים; כדאי 2-4), --only-bottom (בחותמות: רק החצי התחתון של כל עמוד).
"""
import argparse
import importlib
import os
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
TESS_WIN = r"C:\Program Files\Tesseract-OCR\tesseract.exe"
NEED = {"pymupdf": "pymupdf", "cv2": "opencv-python-headless", "numpy": "numpy"}
FILES = ["build_text_index.py", "ink_ocr.py", "search_text.py", "match_pdfs.py", "coverage_report.py", "ocr_pdfs.py", "import_to_site.py"]
INPUTS = ["סופי_מאוחד.csv", "attachments.csv", "businesses.json", os.path.join("wp-content", "uploads")]


def check():
    ok = True
    print(f"Python {sys.version.split()[0]}")
    for mod, pkg in NEED.items():
        try:
            importlib.import_module(mod)
            print(f"  ✓ {pkg}")
        except ImportError:
            ok = False
            print(f"  ✗ חסר {pkg}  ->  pip install {pkg}")
    tess = shutil.which("tesseract") or (TESS_WIN if os.path.exists(TESS_WIN) else "")
    if not tess:
        ok = False
        print("  ✗ Tesseract לא נמצא (התקן Tesseract-OCR עם שפה עברית)")
    else:
        langs = subprocess.run([tess, "--list-langs"], capture_output=True, text=True).stdout
        print(f"  ✓ Tesseract: {tess}")
        if "heb" not in langs:
            ok = False
            print("  ✗ חסרה שפה עברית ב-Tesseract (heb.traineddata)")
    for f in FILES:
        if not os.path.exists(os.path.join(HERE, f)) and not os.path.exists(f):
            ok = False
            print(f"  ✗ חסר הקובץ {f}")
    for f in INPUTS:
        if os.path.exists(f):
            print(f"  ✓ {f}")
        else:
            ok = False
            print(f"  ✗ לא נמצא {f} (מריצים מתיקיית האתר)")
    print("הכול תקין" if ok else "יש לתקן את מה שמסומן ✗")
    return ok


def run(script, args):
    path = os.path.join(HERE, script)
    if not os.path.exists(path):
        path = script
    print(f"\n=== {script} {' '.join(args)} ===", flush=True)
    return subprocess.call([sys.executable, path] + args)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--test", action="store_true")
    ap.add_argument("--text-only", action="store_true")
    ap.add_argument("--ink-only", action="store_true")
    ap.add_argument("--workers", default="2")
    ap.add_argument("--only-bottom", action="store_true")
    ap.add_argument("--extra", default="", help="תיקייה של קבצי PDF חדשים: מריץ טקסט + חותמות/כתב יד רק עליהם")
    ap.add_argument("--full-pass", action="store_true", help="סבב שני וארוך: כתב יד על כל העמוד לכל המסמכים")
    a = ap.parse_args()
    if a.check:
        return 0 if check() else 1
    if not check():
        return 1
    lim = ["--limit", "20"] if a.test else []
    if a.extra:
        lim += ["--extra", a.extra]
    if a.full_pass:
        return run("ink_ocr.py", ["--workers", a.workers, "--full-pass"] + lim)
    rc = 0
    if not a.ink_only:
        rc = run("build_text_index.py", ["--workers", a.workers] + lim)
    if rc == 0 and not a.text_only:
        rc = run("ink_ocr.py", ["--workers", a.workers] + lim + (["--only-bottom"] if a.only_bottom or a.test else []))
    if rc == 0:
        print("\nהסתיים. תוצאות בתיקייה text_index:  permit_text.db (חיפוש: python search_text.py \"ביטוי\"),  סיכום.csv,  ink_סיכום.csv + תמונות ב-ink\\")
    return rc


if __name__ == "__main__":
    sys.exit(main())
