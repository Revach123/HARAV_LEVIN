# -*- coding: utf-8 -*-
"""
קבצי PDF שנמצאו בגיבוי / בתיקיות (פספסנו_pdf.csv) ואינם זהים בתוכן לקובץ שלנו, אבל אולי יש לנו קובץ עם אותו שם (הטקסט של הקבצים שלנו נלקח ממאגר הטקסט, לא נפתחים הקבצים עצמם):
האם זה אותו מסמך (רק נשמר אחרת), או מסמך שונה עם שם זהה? קריאה בלבד.

ההשוואה לפי טקסט: דמיון בין הטקסט של העמודים הראשונים, ומספרי ח.פ. שנמצאו בהם. בקובץ סרוק בלי שכבת טקסט נעשה OCR (עד 3 עמודים).

פסיקה לכל קובץ: "אותו מסמך" / "שונה (מסמך נוסף!)" / "לא ברור: לבדוק ידנית" / "אין אצלנו קובץ בשם הזה".
מדלג על קבצי תוספים וטפסי צור קשר (sendpdfcf7_uploads, document-pdf-*, preview-*, plugins).

    python compare_same_name.py
קלט: text_index\\פספסנו_pdf.csv, text_index\\permit_text.db
פלט: text_index\\השוואת_שמות.csv
"""
import argparse
import collections
import csv
import difflib
import io
import json
import os
import re
import sqlite3
import sys
import zipfile

try:
    import pymupdf as fitz
except ImportError:
    import fitz

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from build_text_index import fix_hebrew  # noqa: E402

SKIP = re.compile(r"sendpdfcf7_uploads|[/\\]plugins[/\\]|^document-pdf|^preview-", re.I)
SKIP_FORMS = re.compile(r"sendpdfcf7_uploads", re.I)


def norm(t):
    return re.sub(r"[\s\"'`״׳.,\-_:;()]+", "", t or "")


TESS = [None]
HP9 = re.compile(r"(?<!\d)(\d{9})(?!\d)")


def hps_of(t):
    """מספרי תאגיד (9 ספרות שמתחילות ב-5), גם אם הספרות הופיעו הפוכות בחילוץ הטקסט."""
    out = set()
    for x in HP9.findall(t):
        if x.startswith("5"):
            out.add(x)
        elif x[::-1].startswith("5"):
            out.add(x[::-1])
    return out


def ocr_page(page):
    """עמוד בלי שכבת טקסט: OCR ב-Tesseract (עברית + אנגלית)."""
    import subprocess
    import tempfile
    pix = page.get_pixmap(dpi=200, colorspace=fitz.csGRAY)
    with tempfile.TemporaryDirectory() as td:
        pth = os.path.join(td, "x.png")
        pix.save(pth)
        try:
            return subprocess.run([TESS[0], pth, "stdout", "-l", "heb+eng", "--psm", "6"], capture_output=True, timeout=120).stdout.decode("utf-8", "replace")
        except Exception:  # noqa: BLE001
            return ""


def read_candidate(loc):
    """הקובץ מהגיבוי: נתיב רגיל, או 'קובץ.zip :: נתיב בתוך הארכיב'."""
    if "::" in loc:
        zp, inner = [x.strip() for x in loc.split("::", 1)]
        with zipfile.ZipFile(zp) as z:
            return z.read(inner)
    return open(loc, "rb").read()


def cand_info(data):
    """(עמודים, טקסט מנורמל, האם נעשה OCR). שכבת טקסט אם יש; אחרת OCR של עד 3 עמודים."""
    doc = fitz.open(stream=data, filetype="pdf")
    n, text, used = len(doc), "", False
    for i in range(min(n, 6)):
        t = doc[i].get_text()
        if len(t.strip()) < 40 and i < 3:
            t, used = ocr_page(doc[i]), True
        text += " " + fix_hebrew(t)          # אותו תיקון סדר אותיות כמו במאגר הטקסט, כדי שההשוואה תהיה הוגנת
    doc.close()
    return n, norm(text), used


def known_info(db, sha):
    rows = [r for r in db.execute("SELECT page, text FROM pages WHERE sha = ? ORDER BY page", (sha,))]
    n = db.execute("SELECT pages FROM docs WHERE sha = ?", (sha,)).fetchone()
    return (n[0] if n else len(rows)), norm(" ".join(t or "" for _, t in rows[:6]))


def compare(c, k):
    """c, k = (עמודים, טקסט מנורמל); מחזיר (פסיקה, פירוט)."""
    if len(c[1]) < 80 or len(k[1]) < 80:
        return "לא ברור", f"אין מספיק טקסט להשוואה ({len(c[1])} / {len(k[1])} תווים)"
    r = difflib.SequenceMatcher(None, c[1][:3000], k[1][:3000], autojunk=False).ratio()
    hc, hk = hps_of(c[1]), hps_of(k[1])
    pg = f"עמודים: {c[0]} מול {k[0]}"
    if hc and hk and not (hc & hk):
        return "שונה", f"ח.פ. שונים ({', '.join(sorted(hc)[:2])} מול {', '.join(sorted(hk)[:2])}), דמיון טקסט {r:.0%}, {pg}"
    if r >= 0.93 and c[0] == k[0]:
        return "אותו מסמך", f"דמיון טקסט {r:.0%}, {pg}"
    if r < 0.75:
        return "שונה", f"דמיון טקסט {r:.0%}, {pg}"
    return "לא ברור", f"דמיון טקסט {r:.0%}, {pg}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--missed", default=os.path.join("text_index", "פספסנו_pdf.csv"))
    ap.add_argument("--db", default=os.path.join("text_index", "permit_text.db"))
    ap.add_argument("--final", default="סופי_מאוחד.csv")
    ap.add_argument("--attachments", default="attachments.csv")
    ap.add_argument("--uploads", default=os.path.join("wp-content", "uploads"))
    ap.add_argument("--hash-cache", default="hashes_cache.json")
    ap.add_argument("--out", default=os.path.join("text_index", "השוואת_שמות.csv"))
    ap.add_argument("--keep-names", action="store_true", help="לא לדלג על document-pdf-* / preview-* / plugins (מדלג רק על טפסי ההצטרפות sendpdfcf7_uploads)")
    ap.add_argument("--extract", default="", help="תיקייה: לשמור בה העתק של כל קובץ שהפסיקה שלו אינה 'אותו מסמך', ולהדפיס לכל אחד ח.פ. ושורה ראשונה")
    a = ap.parse_args()
    from ocr_pdfs import TESS_DEFAULT
    TESS[0] = TESS_DEFAULT if os.name == "nt" else "tesseract"

    db = sqlite3.connect("file:" + os.path.abspath(a.db).replace("\\", "/") + "?mode=ro", uri=True, timeout=30)
    byname = collections.defaultdict(set)
    fnames = {}
    for sha, files in db.execute("SELECT sha, files FROM docs"):
        fnames[sha] = str(files or "")
        for nm in str(files or "").split("|"):
            byname[nm.strip().lower()].add(sha)
    byhp = collections.defaultdict(set)          # ח.פ. -> מסמכים שלנו שמכילים אותו (גם מסמך בשם אחר)
    try:
        for sha, hp in db.execute("SELECT sha, hp FROM hps"):
            byhp[hp].add(sha)
    except sqlite3.OperationalError:
        pass
    skip = SKIP_FORMS if a.keep_names else SKIP
    rows = [r for r in csv.DictReader(open(a.missed, encoding="utf-8-sig"))
            if not skip.search(r["מיקום"].split("::")[-1].strip()) and not skip.search(r["שם קובץ"])]
    print(f"קבצים להשוואה: {len(rows)}")
    cache, out = {}, []
    for r in rows:
        nm = r["שם קובץ"].strip().lower()
        shas = sorted(byname.get(nm, ()))
        by_name_only = bool(shas)
        try:
            ci = cand_info(read_candidate(r["מיקום"]))
        except Exception as e:  # noqa: BLE001
            out.append([r["שם קובץ"], r["מיקום"], "לא נקרא", str(e), ""]); continue
        for hp in hps_of(ci[1]):
            for sh in sorted(byhp.get(hp, ())):
                if sh not in shas:
                    shas.append(sh)
        shas = shas[:12]
        if not shas:
            out.append([r["שם קובץ"], r["מיקום"], "אין אצלנו קובץ בשם הזה או עם אותו ח.פ.", f"{ci[0]} עמודים", ""]); continue
        best = None
        for s in shas:
            try:
                if s not in cache:
                    cache[s] = known_info(db, s)
                v, d = compare(ci, cache[s])
            except Exception as e:  # noqa: BLE001
                continue
            rank = {"אותו מסמך": 0, "לא ברור": 1, "שונה": 2}[v]
            if best is None or rank < best[0]:
                best = (rank, v, d, s)
        if best:
            out.append([r["שם קובץ"], r["מיקום"], best[1], best[2], (fnames.get(best[3], "") or best[3][:12])])
        else:
            out.append([r["שם קובץ"], r["מיקום"], "לא נקרא", "הקובץ שלנו לא נפתח", ""])
    db.close()
    if a.extract:
        os.makedirs(a.extract, exist_ok=True)
        for i, x in enumerate(r for r in out if r[2] != "אותו מסמך"):
            try:
                data = read_candidate(x[1])
                fn = os.path.join(a.extract, f"{i + 1:02d}_{x[0]}")
                open(fn, "wb").write(data)
                ci = cand_info(data)
                first = re.sub(r"\s+", " ", " ".join(fix_hebrew(pg.get_text()) for pg in fitz.open(stream=data, filetype="pdf"))[:300]).strip()
                print(f"{fn}: {x[2]} | ח.פ.: {', '.join(sorted(hps_of(ci[1]))) or '—'} | {first[:120]}")
            except Exception as e:  # noqa: BLE001
                print(f"{x[0]}: לא חולץ ({e})")
    order = {"שונה": 0, "אין אצלנו קובץ בשם הזה או עם אותו ח.פ.": 1, "לא ברור": 2, "לא נקרא": 3, "אותו מסמך": 4}
    out.sort(key=lambda x: (order.get(x[2], 9), x[0]))
    with open(a.out, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(["שם קובץ", "מיקום", "פסיקה", "פירוט", "הקובץ שלנו"])
        w.writerows(out)
    c = collections.Counter(x[2] for x in out)
    print("סיכום:", dict(c))
    print(f"נכתב: {a.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
