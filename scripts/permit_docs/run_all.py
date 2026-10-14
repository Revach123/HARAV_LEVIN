# -*- coding: utf-8 -*-
"""
ריצה מלאה ומקיפה אחת, בלי השגחה (מתאים להשארה ללילה). הכול ממשיך מאיפה שעצר אם מפסיקים ומריצים שוב.

  cd "C:\\localwp\\Local Sites\\iska\\app\\public"
  python run_all.py

שלבים:
  0. עדכון הסקריפטים מ-GitHub ורשימת העסקים (businesses.json) העדכנית
  1. OCR עמוד ראשון לכל הקבצים הסרוקים                      -> ocr_text
  2. OCR עמודים 2-8 לכל הקבצים הסרוקים (כל סוגי התוכן)      -> ocr_text_p2
  3. הצלבה: שם פוסט + ח.פ. בקובץ + שם בקובץ                -> סופי_מלא.csv
  4. איתור קבצים לא משויכים לפי קישורים בתוכן האתר          -> מיקום_לא_משויכים.csv  (אם יש posts_content.csv)
  5. נוסח "פרטי / פרטני" ובדיקת סיווג כללי/פרטי לפי הטקסט   -> private_wording.csv, type_check.csv
  6. דוח מאוחד לכל קובץ ולכל עסק                            -> סופי_מאוחד.csv, סיכום_עסקים.csv
יומן מלא: run_all_log.txt.   בסיום נכתב הקובץ הושלם.txt.
המחשב לא נכנס לשינה בזמן הריצה (בלי לשנות הגדרות).
"""
import argparse
import datetime
import glob
import os
import shutil
import subprocess
import sys
import time

BASE = "https://raw.githubusercontent.com/Revach123/HARAV_LEVIN/main/scripts/permit_docs/"
SCRIPTS = ["match_pdfs.py", "ocr_pdfs.py", "reconcile.py", "locate_unattached.py", "private_wording.py", "final_report.py"]
API = "https://harav-levin.pages.dev/api/businesses"
LOG = "run_all_log.txt"


def log(msg):
    line = f"[{datetime.datetime.now():%H:%M:%S}] {msg}"
    print(line, flush=True)
    with open(LOG, "a", encoding="utf-8") as f:
        f.write(line + "\n")


def keep_awake(on):
    if os.name != "nt":
        return
    try:
        import ctypes
        ctypes.windll.kernel32.SetThreadExecutionState(0x80000000 | 0x00000001 if on else 0x80000000)   # ES_CONTINUOUS | ES_SYSTEM_REQUIRED
    except Exception:  # noqa: BLE001
        pass


def run(name, args, must=False):
    t0 = time.time()
    log(f"== {name} ==")
    with open(LOG, "a", encoding="utf-8") as f:
        p = subprocess.Popen([sys.executable] + args, stdout=f, stderr=subprocess.STDOUT)
        rc = p.wait()
    mins = (time.time() - t0) / 60
    log(f"   {name}: {'הסתיים' if rc == 0 else f'נכשל (קוד {rc})'} אחרי {mins:.1f} דקות")
    if rc != 0 and must:
        log("עוצר: שלב חיוני נכשל. ראה את run_all_log.txt")
        sys.exit(1)
    return rc == 0


def curl(url, dest):
    r = subprocess.run(["curl", "-L", "-s", "-S", "-o", dest + ".tmp", url], capture_output=True)
    if r.returncode == 0 and os.path.getsize(dest + ".tmp") > 500:
        shutil.move(dest + ".tmp", dest)
        return True
    if os.path.exists(dest + ".tmp"):
        os.remove(dest + ".tmp")
    return False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--results", default="")
    ap.add_argument("--uploads", default=os.path.join("wp-content", "uploads"))
    ap.add_argument("--tesseract", default=r"C:\Program Files\Tesseract-OCR\tesseract.exe" if os.name == "nt" else "tesseract")
    ap.add_argument("--pages-to", type=int, default=8)
    ap.add_argument("--no-update", action="store_true", help="לא להוריד סקריפטים ורשימת עסקים חדשים")
    a = ap.parse_args()

    here = os.path.dirname(os.path.abspath(__file__))
    os.chdir(here)
    log("=" * 60)
    log("התחלת ריצה מלאה")
    if not os.path.exists(a.tesseract) and shutil.which("tesseract") is None:
        log(f"Tesseract לא נמצא ב-{a.tesseract}. התקן אותו (עם עברית) או ציין --tesseract. עוצר.")
        sys.exit(1)
    results = a.results
    if not results:
        cand = sorted(glob.glob("כל_הקבצים*.csv"), key=os.path.getmtime)
        cand = [c for c in cand if "חסרים" not in c]
        if not cand:
            log("לא נמצא קובץ תוצאות (כל_הקבצים*.csv). עוצר.")
            sys.exit(1)
        results = cand[-1]
    log(f"קובץ תוצאות: {results}")
    keep_awake(True)
    t_all = time.time()
    try:
        if not a.no_update:
            log("== עדכון סקריפטים ורשימת עסקים ==")
            ok = sum(curl(f"{BASE}{s}?nocache={int(time.time())}", s) for s in SCRIPTS)
            log(f"   סקריפטים שעודכנו: {ok}/{len(SCRIPTS)}")
            log("   businesses.json: " + ("עודכן" if curl(API, "businesses.json") else "לא עודכן (משתמש בקיים)"))
        if not os.path.exists("businesses.json") or not os.path.exists("attachments.csv"):
            log("חסר businesses.json או attachments.csv. עוצר.")
            sys.exit(1)
        w, up, ts = str(a.workers), a.uploads, a.tesseract
        common = ["--results", results, "--attachments", "attachments.csv", "--uploads", up]

        run("OCR עמוד ראשון", ["ocr_pdfs.py"] + common + ["--tesseract", ts, "--workers", w])
        run(f"OCR עמודים 2-{a.pages_to}", ["ocr_pdfs.py"] + common + ["--tesseract", ts, "--workers", w, "--pages-range", f"2-{a.pages_to}", "--out-dir", "ocr_text_p2"])
        dirs = "ocr_text,ocr_text_p2"
        run("הצלבה (שם פוסט + ח.פ. + שם בקובץ)", ["reconcile.py"] + common + ["--businesses", "businesses.json", "--ocr-dir", dirs, "--out", "סופי_מלא.csv"], must=True)
        if os.path.exists("posts_content.csv"):
            run("קבצים לא משויכים", ["locate_unattached.py", "--results", results, "--content", "posts_content.csv", "--out", "מיקום_לא_משויכים.csv"])
        else:
            log("   דילוג על 'קבצים לא משויכים': אין posts_content.csv")
        run("נוסח פרטי / פרטני", ["private_wording.py"] + common + ["--ocr-dir", dirs])
        run("דוח מאוחד", ["final_report.py", "--businesses", "businesses.json"])
    finally:
        keep_awake(False)
    mins = (time.time() - t_all) / 60
    log(f"סיום כל השלבים אחרי {mins:.0f} דקות")
    with open("הושלם.txt", "w", encoding="utf-8") as f:
        f.write(f"הריצה הסתיימה {datetime.datetime.now():%Y-%m-%d %H:%M}\nקבצי הפלט: סופי_מאוחד.csv, סיכום_עסקים.csv, סופי_מלא.csv, type_check.csv, private_wording.csv\n")


if __name__ == "__main__":
    main()
