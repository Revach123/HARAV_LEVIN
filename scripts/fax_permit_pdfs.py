"""
גרסה לפקס של שטרות ההיתר (docs-fax/<אותו שם> ב-R2): PDF שכל עמוד בו תמונה שחור-לבן (1-bit) בדחיסת פקס (CCITT G4), ברזולוציה 200x300 (כמו שהספק משדר).
הספק ממיר סריקה אפורה לנקודות ומקבל פקס מגורען; כשמקבלים ממנו שחור-לבן חד הוא לא צריך להמיר כלום.
המקור והגרסה הקלה לא נוגעים. שליחת הפקס (functions/api/_shared/ivr-fax.js) מעדיפה docs-fax/ אם קיים. מחיקת docs-fax/ מחזירה את המצב הקודם.

שימוש: python fax_permit_pdfs.py [--apply] [--limit N] [--new-days D] [--redo]
  --new-days D  רק מסמכים שהועלו ב-D הימים האחרונים ועוד אין להם גרסה לפקס (המעקב בטבלה permit_doc_fax ב-D1)
  בלי --new-days  כל המסמכים שאין להם docs-fax/ (בדיקה מול R2)
  ברירת מחדל dry-run (בלי העלאה). דורש wrangler, poppler-utils, pillow, numpy ו-CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID.
"""
import argparse, glob, os, re, subprocess, sys, tempfile
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from compress_permit_pdfs import d1, r2_get, r2_put, r2_exists, pages, log, sh, KEY_RE, ID_RE

DPI_X, DPI_Y, MAX_PAGES = 200, 300, 40          # הספק (שחקים) משדר ב-200x300: מייצרים בדיוק ברזולוציה הזו, בלי שהוא ישנה גודל


def binarize(g):
    from PIL import Image, ImageFilter          # נטענים רק כשבונים קובץ (שלב הספירה רץ לפני ההתקנה)
    import numpy as np
    """סף מקומי: פיקסל כהה בהרבה מהסביבה שלו (או כהה מאוד) = דיו. עובד גם על סריקות עם רקע לא אחיד."""
    a = np.asarray(g, dtype=np.float32)
    bg = np.asarray(g.filter(ImageFilter.BoxBlur(25)), dtype=np.float32)
    ink = (a < bg * 0.80) | (a < 90)
    return Image.fromarray(np.where(ink, 0, 255).astype(np.uint8)).convert("1")


def make_fax(src, dst, td):
    from PIL import Image
    n = pages(src)
    if not n or n > MAX_PAGES: raise RuntimeError(f"pages={n}")
    sh(["pdftoppm", "-rx", str(DPI_X), "-ry", str(DPI_Y), "-gray", "-png", src, os.path.join(td, "p")], timeout=600)
    files = sorted(glob.glob(os.path.join(td, "p-*.png")))
    if len(files) != n: raise RuntimeError(f"rendered {len(files)} of {n}")
    import io, img2pdf
    tiffs = []
    for f in files:
        buf = io.BytesIO()
        binarize(Image.open(f).convert("L")).save(buf, "TIFF", compression="group4")          # 1-bit CCITT G4: כמו פקס
        tiffs.append(buf.getvalue())
    with open(dst, "wb") as out:
        out.write(img2pdf.convert(tiffs, layout_fun=img2pdf.get_fixed_dpi_layout_fun((DPI_X, DPI_Y))))          # גודל העמוד כמו במקור
    if pages(dst) != n or open(dst, "rb").read(5) != b"%PDF-": raise RuntimeError("bad output")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--new-days", type=int, default=0)
    ap.add_argument("--count", action="store_true")
    ap.add_argument("--redo", action="store_true", help="מפיק מחדש גם מסמכים שכבר יש להם גרסת פקס (למשל אחרי שינוי רזולוציה)")
    a = ap.parse_args()
    if a.new_days:
        d1("CREATE TABLE IF NOT EXISTS permit_doc_fax (doc_id TEXT PRIMARY KEY, status TEXT, at TEXT DEFAULT (datetime('now')))")
        rows = d1(f"SELECT id, file_key FROM permit_docs WHERE created_at > datetime('now','-{int(a.new_days)} days') AND id NOT IN (SELECT doc_id FROM permit_doc_fax) ORDER BY created_at")
        if a.count:
            log(f"ממתינים לגרסת פקס: {len(rows)}")
            if os.environ.get("GITHUB_OUTPUT"): open(os.environ["GITHUB_OUTPUT"], "a").write(f"pending={len(rows)}\n")
            return
    else:
        rows = d1("SELECT id, file_key FROM permit_docs ORDER BY created_at DESC")
    log(f"{len(rows)} מסמכים לבדיקה")
    done = ok_n = 0
    for r in rows:
        if a.limit and done >= a.limit: break
        id_, key = str(r["id"]), str(r["file_key"])
        if not ID_RE.match(id_) or not KEY_RE.match(key) or ".." in key: continue
        fax = key.replace("docs/", "docs-fax/", 1) if key.startswith("docs/") else "docs-fax/" + key
        if not a.new_days and not a.redo and r2_exists(fax): continue
        done += 1
        with tempfile.TemporaryDirectory() as td:
            src, dst = os.path.join(td, "o.pdf"), os.path.join(td, "f.pdf")
            try:
                r2_get(key, src)
                make_fax(src, dst, td)
                log(f"{id_}: {os.path.getsize(src)} -> {os.path.getsize(dst)} בייט")
                if a.apply: r2_put(fax, dst)
                status = "done"; ok_n += 1
            except Exception as e:
                log(f"{id_}: נכשל ({e})"); status = "fail"
            if a.apply and a.new_days: d1(f"INSERT OR REPLACE INTO permit_doc_fax (doc_id, status) VALUES ('{id_}', '{status}')")
    log(f"הסתיים: {ok_n} מתוך {done} ({'הועלו' if a.apply else 'dry-run'})")


if __name__ == "__main__":
    main()
