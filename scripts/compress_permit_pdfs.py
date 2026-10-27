"""
דחיסת קובצי היתר העסקה ב-R2 (הדלי harav-levin-permits) כדי שפתיחת שטר תהיה מהירה.

לכל מסמך גדול (permit_docs.size > MIN_BYTES):
  1. מורידים את הקובץ מ-R2, דוחסים עם Ghostscript (תמונות עד 150dpi, שחור-לבן 300dpi; שכבת הטקסט נשמרת)
  2. בודקים שהתוצאה תקינה: אותו מספר עמודים, שכבת הטקסט לא נפגעה, והקובץ קטן ב-MIN_GAIN לפחות
  3. (רק ב-apply) שומרים גיבוי של המקור ב-R2 תחת backup/<key>, ואז מחליפים את הקובץ באותו מפתח ומעדכנים permit_docs.size.
     המפתח וה-sha256 לא משתנים (הם משמשים לזיהוי כפילויות בהעלאה), לכן שום קישור לא נשבר.
המשך אוטומטי: מסמך שיש לו סימון backup/<key>.done (או .skip) מדולג. הגיבוי פרטי (בדלי, לא ב-git).
מצב ברירת מחדל: dry-run - מדווח חיסכון צפוי בלי לשנות כלום.

שימוש: python compress_permit_pdfs.py [--apply] [--limit N] [--min-bytes B] [--min-gain 0.15]
דורש: wrangler (npx), ghostscript, poppler-utils, ומשתני סביבה CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID.
"""
import argparse, json, os, re, shutil, subprocess, sys, tempfile

BUCKET = "harav-levin-permits"
DB = "business-registry-db"
KEY_RE = re.compile(r"^[A-Za-z0-9._/-]+$")
ID_RE = re.compile(r"^[A-Za-z0-9_-]+$")


def sh(cmd, check=True, **kw):
    r = subprocess.run(cmd, capture_output=True, text=True, **kw)
    if check and r.returncode != 0:
        raise RuntimeError(f"{' '.join(cmd[:6])} -> {r.returncode}: {(r.stderr or r.stdout)[-400:]}")
    return r


def wr(*args, check=True):
    return sh(["npx", "--yes", "wrangler@4", *args], check=check)


def d1(sql):
    out = wr("d1", "execute", DB, "--remote", "--json", "--command", sql).stdout
    data = json.loads(out)
    return (data[0] if isinstance(data, list) else data).get("results", [])


def r2_get(key, path):
    wr("r2", "object", "get", f"{BUCKET}/{key}", "--file", path, "--remote")


def r2_put(key, path):
    wr("r2", "object", "put", f"{BUCKET}/{key}", "--file", path, "--content-type", "application/pdf", "--remote")


def r2_exists(key):
    tmp = tempfile.mktemp()
    try:
        return wr("r2", "object", "get", f"{BUCKET}/{key}", "--file", tmp, "--remote", check=False).returncode == 0
    finally:
        if os.path.exists(tmp): os.remove(tmp)


def put_marker(td, key):
    p = os.path.join(td, "m")
    open(p, "w").write("1")
    wr("r2", "object", "put", f"{BUCKET}/{key}", "--file", p, "--content-type", "text/plain", "--remote")


def pages(path):
    m = re.search(r"^Pages:\s+(\d+)", sh(["pdfinfo", path]).stdout, re.M)
    return int(m.group(1)) if m else 0


def text_len(path):
    return len(re.sub(r"\s+", "", sh(["pdftotext", "-q", path, "-"], check=False).stdout))


def compress(src, dst):
    sh(["gs", "-q", "-dNOPAUSE", "-dBATCH", "-dSAFER", "-sDEVICE=pdfwrite", "-dCompatibilityLevel=1.5",
        "-dDownsampleColorImages=true", "-dColorImageResolution=150", "-dColorImageDownsampleThreshold=1.2",
        "-dDownsampleGrayImages=true", "-dGrayImageResolution=150", "-dGrayImageDownsampleThreshold=1.2",
        "-dDownsampleMonoImages=true", "-dMonoImageResolution=300", "-dMonoImageDownsampleThreshold=1.5",
        "-dAutoFilterColorImages=false", "-dColorImageFilter=/DCTEncode", "-dJPEGQ=65",
        "-dAutoFilterGrayImages=false", "-dGrayImageFilter=/DCTEncode",
        "-dDetectDuplicateImages=true", "-dCompressFonts=true", "-dSubsetFonts=true",
        f"-sOutputFile={dst}", src])


def verify(src, dst, min_gain):
    """(ok, reason) - אחרי הדחיסה: אותו מספר עמודים, שכבת הטקסט נשמרה, וחיסכון מספיק."""
    a, b = os.path.getsize(src), os.path.getsize(dst)
    if open(dst, "rb").read(5) != b"%PDF-": return False, "output is not a PDF"
    pa, pb = pages(src), pages(dst)
    if not pa or pa != pb: return False, f"pages {pa} -> {pb}"
    ta, tb = text_len(src), text_len(dst)
    if ta > 200 and tb < ta * 0.9: return False, f"text layer shrank {ta} -> {tb}"
    if b > a * (1 - min_gain): return False, f"gain too small ({a} -> {b})"
    return True, ""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--limit", type=int, default=0, help="0 = הכל")
    ap.add_argument("--min-bytes", type=int, default=400_000)
    ap.add_argument("--min-gain", type=float, default=0.15)
    a = ap.parse_args()
    if not shutil.which("gs"): sys.exit("ghostscript (gs) לא מותקן")

    rows = d1(f"SELECT id, file_key, size FROM permit_docs WHERE size > {int(a.min_bytes)} ORDER BY size DESC")
    print(f"{len(rows)} מסמכים מעל {a.min_bytes} בייט")
    done = tot_before = tot_after = 0
    lines = []
    for r in rows:
        if a.limit and done >= a.limit: break
        id_, key, size = str(r["id"]), str(r["file_key"]), int(r["size"] or 0)
        if not ID_RE.match(id_) or not KEY_RE.match(key) or ".." in key:
            print(f"דילוג על מפתח לא תקין: {id_}"); continue
        if r2_exists(f"backup/{key}.done") or r2_exists(f"backup/{key}.skip"):          # סימונים קטנים (לא הגיבוי עצמו)
            continue
        with tempfile.TemporaryDirectory() as td:
            src, dst = os.path.join(td, "o.pdf"), os.path.join(td, "c.pdf")
            try:
                r2_get(key, src)
                compress(src, dst)
                ok, why = verify(src, dst, a.min_gain)
            except Exception as e:
                ok, why = False, f"error: {e}"
                print(f"{id_}: {why}"); lines.append(f"| {id_} | {size} | - | נכשל |"); continue
            done += 1
            if not ok:
                print(f"{id_}: לא מוחלף ({why})")
                lines.append(f"| {id_} | {size} | - | לא מוחלף: {why} |")
                if a.apply:
                    put_marker(td, f"backup/{key}.skip")
                continue
            new = os.path.getsize(dst)
            tot_before += size; tot_after += new
            print(f"{id_}: {size} -> {new} ({100 - 100 * new // size}% חיסכון)")
            lines.append(f"| {id_} | {size} | {new} | {'הוחלף' if a.apply else 'dry-run'} |")
            if a.apply:
                r2_put(f"backup/{key}", src)       # קודם גיבוי - רק אחריו מחליפים
                r2_put(key, dst)
                d1(f"UPDATE permit_docs SET size = {int(new)} WHERE id = '{id_}'")
                put_marker(td, f"backup/{key}.done")
    saved = tot_before - tot_after
    summary = f"## דחיסת PDF ({'הוחלפו' if a.apply else 'dry-run - לא שונה כלום'})\n\n" \
              f"עובדו {done}, חיסכון {saved/1e6:.1f}MB מתוך {tot_before/1e6:.1f}MB\n\n" \
              "| מסמך | לפני | אחרי | סטטוס |\n|---|---|---|---|\n" + "\n".join(lines) + "\n"
    print(summary)
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf-8").write(summary)


if __name__ == "__main__":
    main()
