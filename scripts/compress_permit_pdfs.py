"""
יצירת גרסה קלה (דחוסה) של קובצי היתר העסקה ב-R2 (הדלי harav-levin-permits), לצפייה מהירה בשטר.
המקור לא נוגע בכלל: הגרסה הקלה נשמרת בנפרד ב-docs-lite/<אותו שם>, ו-/api/permit-docs-public/:id מגיש אותה לצפייה
(ואת המקור להורדה, ?dl=1). אין החלפה, אין גיבוי ואין שינוי ב-D1 - מחיקת docs-lite/ מחזירה את המצב הקודם.

לכל מסמך גדול (permit_docs.size > MIN_BYTES) שאין לו עדיין גרסה קלה:
  1. מורידים את המקור, דוחסים עם Ghostscript (תמונות עד 150dpi, שחור-לבן 300dpi; שכבת הטקסט נשמרת)
  2. בודקים: אותו מספר עמודים, שכבת הטקסט לא נפגעה, והקובץ קטן ב-MIN_GAIN לפחות
  3. (רק ב-apply) מעלים ל-docs-lite/. מסמך שהדחיסה לא עזרה לו מסומן docs-lite/<שם>.skip ומדולג בהמשך.
מצב ברירת מחדל: dry-run - מדווח חיסכון צפוי בלי לשנות כלום. שגיאת הרשאה (403) עוצרת מיד.

שימוש: python compress_permit_pdfs.py [--apply] [--limit N] [--min-bytes B] [--min-gain 0.15]
דורש: wrangler, ghostscript, poppler-utils, ומשתני סביבה CLOUDFLARE_API_TOKEN (D1 + R2 Edit) + CLOUDFLARE_ACCOUNT_ID.
"""
import argparse, json, os, re, shutil, subprocess, sys, tempfile

BUCKET = "harav-levin-permits"
DB = "business-registry-db"
KEY_RE = re.compile(r"^[A-Za-z0-9._/-]+$")
ID_RE = re.compile(r"^[A-Za-z0-9_-]+$")


def log(*a):
    print(*a, flush=True)


def sh(cmd, check=True, timeout=240, **kw):
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, **kw)
    except subprocess.TimeoutExpired:
        raise RuntimeError(f"timeout {timeout}s: {' '.join(cmd[:6])}")
    if check and r.returncode != 0:
        raise RuntimeError(f"{' '.join(cmd[:6])} -> {r.returncode}: {(r.stderr or r.stdout)[-400:]}")
    return r


def wr(*args, check=True):
    return sh(["wrangler", *args], check=check, timeout=240)


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
        r = wr("r2", "object", "get", f"{BUCKET}/{key}", "--file", tmp, "--remote", check=False)
        if r.returncode == 0: return True
        err = (r.stderr or "") + (r.stdout or "")
        if re.search(r"403|Authentication error|Forbidden|Unauthorized", err):
            sys.exit("שגיאת הרשאה מול R2 - לטוקן חסרה ההרשאה Workers R2 Storage - Edit")
        return False          # לא קיים
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
        f"-sOutputFile={dst}", src], timeout=600)


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
    log(f"{len(rows)} מסמכים מעל {a.min_bytes} בייט")
    done = tot_before = tot_after = 0
    lines = []
    for r in rows:
        if a.limit and done >= a.limit: break
        id_, key, size = str(r["id"]), str(r["file_key"]), int(r["size"] or 0)
        if not ID_RE.match(id_) or not KEY_RE.match(key) or ".." in key:
            log(f"דילוג על מפתח לא תקין: {id_}"); continue
        lite = key.replace("docs/", "docs-lite/", 1) if key.startswith("docs/") else "docs-lite/" + key
        log(f"{id_}: בודק אם כבר טופל")
        if r2_exists(f"{lite}.skip") or r2_exists(lite):
            continue
        with tempfile.TemporaryDirectory() as td:
            src, dst = os.path.join(td, "o.pdf"), os.path.join(td, "c.pdf")
            try:
                log(f"{id_}: {size} בייט - מוריד")
                r2_get(key, src)
                log(f"{id_}: דוחס")
                compress(src, dst)
                ok, why = verify(src, dst, a.min_gain)
            except Exception as e:
                ok, why = False, f"error: {e}"
                log(f"{id_}: {why}"); lines.append(f"| {id_} | {size} | - | נכשל |"); continue
            done += 1
            if not ok:
                log(f"{id_}: ללא גרסה קלה ({why})")
                lines.append(f"| {id_} | {size} | - | ללא גרסה קלה: {why} |")
                if a.apply:
                    put_marker(td, f"{lite}.skip")
                continue
            new = os.path.getsize(dst)
            tot_before += size; tot_after += new
            log(f"{id_}: {size} -> {new} ({100 - 100 * new // size}% חיסכון)")
            lines.append(f"| {id_} | {size} | {new} | {'הועלתה גרסה קלה' if a.apply else 'dry-run'} |")
            if a.apply:
                r2_put(lite, dst)
    saved = tot_before - tot_after
    summary = f"## דחיסת PDF ({'הועלו' if a.apply else 'dry-run - לא שונה כלום'})\n\n" \
              f"עובדו {done}, חיסכון {saved/1e6:.1f}MB מתוך {tot_before/1e6:.1f}MB\n\n" \
              "| מסמך | לפני | אחרי | סטטוס |\n|---|---|---|---|\n" + "\n".join(lines) + "\n"
    log(summary)
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf-8").write(summary)


if __name__ == "__main__":
    main()
