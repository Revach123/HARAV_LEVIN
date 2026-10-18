# -*- coding: utf-8 -*-
"""
שלב 2: מאגר טקסט של כל השטרות (הרצה מקומית, חד-פעמית; אפשר להפסיק ולהמשיך).

לכל מסמך ייחודי (לפי sha256):
  - טקסט מכל העמודים: מה שיש בשכבת הטקסט של ה-PDF; לעמודים בלי טקסט - OCR (Tesseract, עברית ואנגלית). מסמך שכבר נקרא ב-OCR קודם
    (ocr_text / ocr_text_p2 / ocr_text_pg) משתמש בטקסט הקיים ולא נקרא שוב.
  - כל מספרי התאגיד התקינים (מתחילים ב-5, ספרת ביקורת תקינה), בלי הגבלת כמות, עם מספר הופעות ועמודים.
  - שמות חברות: כל ביטוי שמסתיים ב"בע"מ", וחמש השורות הראשונות של כל עמוד.
  - רמז לכתב יד / חתימה: עמודים עם הרבה קווים וקימורים (לא זיהוי כתב יד: סימון לבדיקה ידנית).

פלט (בתיקייה text_index\\):
  text\\<sha>.txt         טקסט כל המסמך, עם סימון "===== עמוד N =====" (טקסט עברי הפוך מתוקן אוטומטית)
  permit_text.db           SQLite: docs, pages, pages_fts (חיפוש מהיר), hps, names
  סיכום.csv                שורה לכל מסמך: עמודים, תווים, OCR, ח.פ. שנמצאו, רמז לכתב יד

  python build_text_index.py [--limit 20] [--workers 2] [--no-ocr]
חיפוש אחרי הבנייה:  python search_text.py "מסלול הלכה"
"""
import argparse
import collections
import csv
import json
import os
import re
import sqlite3
import sys
from multiprocessing import Pool

try:
    import pymupdf as fitz
except ImportError:
    import fitz

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import match_pdfs as m  # noqa: E402
from coverage_report import file_hashes  # noqa: E402
from ocr_pdfs import TESS_DEFAULT, ocr_page  # noqa: E402

HP = re.compile(r"(?<!\d)(5\d{8})(?!\d)")
NAME = re.compile(r"([א-ת][א-ת0-9'\"׳״.\-()/\s]{2,70}?\s*בע[\"״']?מ)")
COMMON = ["של", "את", "על", "היתר", "עיסקא", "החברה", "בעמ", "או", "עם", "כל", "הוא"]


def norm_fts(t):
    """נרמול לחיפוש: בלי גרשיים וגרשי מירכא, כך ש-בע"מ מתחפש כ-בעמ (ו"בע""מ" בשורת פקודה לא נשבר)."""
    return re.sub(r"[\"'׳״`]", "", t or "")


def ensure_fts(db):
    """אינדקס החיפוש: trigram (חיפוש בכל מקום בתוך מילה, כך שגם "ומסלול" נמצא כשמחפשים "מסלול") על טקסט בלי גרשיים. בונה מחדש מהטקסט השמור אם צריך."""
    db.execute("CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT)")
    cur = db.execute("SELECT v FROM meta WHERE k = 'fts_norm'").fetchone()
    if cur and cur[0] == "2":
        return
    has_pages = db.execute("SELECT 1 FROM sqlite_master WHERE name = 'pages'").fetchone()
    print("בונה מחדש את אינדקס החיפוש (פעם אחת)…")
    db.execute("DROP TABLE IF EXISTS pages_fts")
    db.execute("CREATE VIRTUAL TABLE pages_fts USING fts5(text, sha UNINDEXED, page UNINDEXED, tokenize='trigram')")
    if has_pages:
        rows = db.execute("SELECT sha, page, text FROM pages").fetchall()
        db.executemany("INSERT INTO pages_fts (text, sha, page) VALUES (?,?,?)", [(norm_fts(t), s, p) for s, p, t in rows])
    db.execute("INSERT OR REPLACE INTO meta VALUES ('fts_norm', '2')")
    db.commit()


def hp_ok(h):
    if not re.fullmatch(r"\d{9}", h):
        return False
    t = 0
    for i, ch in enumerate(h):
        v = int(ch) * (1 if i % 2 == 0 else 2)
        t += v - 9 if v > 9 else v
    return t % 10 == 0


def score(t):
    w = re.sub(r"[\"'׳״]", "", t).split()
    return sum(1 for x in w if x in COMMON)


def fix_hebrew(t):
    """טקסט עברי שחולץ מ-PDF בסדר חזותי (מילים או אותיות הפוכות): בוחר את הגרסה עם הכי הרבה מילים נפוצות."""
    rw = lambda s: " ".join(reversed(s.split(" ")))          # noqa: E731
    rl = lambda s: " ".join(x[::-1] for x in s.split(" "))   # noqa: E731
    cands = [t, rw(t), rl(t), rw(rl(t))]
    best = max(cands, key=score)
    return best if score(best) > score(t) else t


def hw_hint(page):
    """רמז לכתב יד / חתימה: הרבה קימורים וקווים וקטוריים בעמוד."""
    try:
        d = page.get_drawings()
    except Exception:  # noqa: BLE001
        return 0
    return sum(1 for x in d for it in x.get("items", []) if it and it[0] in ("c", "l"))


def work(job):
    sha, aids, path, ocr_dirs, tess, dpi, max_pages, do_ocr = job
    pages, ocr_used, hints = [], False, []
    try:
        doc = fitz.open(path)
    except Exception as e:  # noqa: BLE001
        return sha, aids, None, f"נכשל: {e}"
    n = len(doc)
    old = ""
    for od in ocr_dirs:
        for aid in aids:
            p = os.path.join(od, f"{aid}.txt")
            if os.path.exists(p):
                try:
                    old += "\n" + open(p, encoding="utf-8").read()
                except OSError:
                    pass
    for i in range(min(n, max_pages)):
        pg = doc[i]
        t = (pg.get_text() or "").strip()
        hints.append(hw_hint(pg))
        if len(t) < 30:
            if not old.strip() and do_ocr:
                try:
                    t = (ocr_page(doc, i, tess, dpi) or "").strip()
                    ocr_used = True
                except Exception:  # noqa: BLE001
                    t = ""
        pages.append(t)
    doc.close()
    if old.strip():
        pages.append("[OCR קיים]\n" + old.strip())
        ocr_used = True
    return sha, aids, {"pages": pages, "ocr": ocr_used, "n": n, "hints": hints}, ""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--final", default="סופי_מאוחד.csv")
    ap.add_argument("--attachments", default="attachments.csv")
    ap.add_argument("--uploads", default=os.path.join("wp-content", "uploads"))
    ap.add_argument("--hash-cache", default="hashes_cache.json")
    ap.add_argument("--businesses", default="businesses.json")
    ap.add_argument("--ocr-dirs", default="ocr_text,ocr_text_p2,ocr_text_pg")
    ap.add_argument("--out", default="text_index")
    ap.add_argument("--tesseract", default=TESS_DEFAULT if os.name == "nt" else "tesseract")
    ap.add_argument("--dpi", type=int, default=200)
    ap.add_argument("--workers", type=int, default=2)
    ap.add_argument("--max-pages", type=int, default=40)
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--no-ocr", action="store_true", help="בלי OCR חדש (רק שכבת טקסט ו-OCR שכבר קיים)")
    a = ap.parse_args()

    os.makedirs(os.path.join(a.out, "text"), exist_ok=True)
    hashes = file_hashes(a.attachments, a.uploads, a.hash_cache)
    guid = {r["ID"]: r.get("guid", "") for r in m.read_csv(a.attachments)}
    docs = collections.OrderedDict()
    for r in m.read_csv(a.final):
        aid = r["attachment_id"]
        sha = hashes.get(aid)
        if not sha:
            continue
        p = m.local_path(a.uploads, guid.get(aid, ""))
        d = docs.setdefault(sha, {"aids": [], "path": None, "files": set()})
        d["aids"].append(aid)
        d["files"].add(r.get("file", ""))
        d["path"] = d["path"] or (p if p and os.path.exists(p) else None)
    chps = set()
    if os.path.exists(a.businesses):
        chps = {str(b.get("chp_number") or "").zfill(9) for b in json.load(open(a.businesses, encoding="utf-8")) if b.get("chp_number")}

    db = sqlite3.connect(os.path.join(a.out, "permit_text.db"))
    db.executescript("""
      CREATE TABLE IF NOT EXISTS docs (sha TEXT PRIMARY KEY, files TEXT, pages INT, chars INT, ocr INT, handwriting_pages TEXT);
      CREATE TABLE IF NOT EXISTS pages (sha TEXT, page INT, text TEXT);
      CREATE TABLE IF NOT EXISTS hps (sha TEXT, hp TEXT, n INT, pages TEXT, in_db INT);
      CREATE TABLE IF NOT EXISTS names (sha TEXT, name TEXT, src TEXT);
      CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
    """)
    ensure_fts(db)
    done = {r[0] for r in db.execute("SELECT sha FROM docs")}
    jobs = [(sha, d["aids"], d["path"], [x.strip() for x in a.ocr_dirs.split(",")], a.tesseract, a.dpi, a.max_pages, not a.no_ocr)
            for sha, d in docs.items() if d["path"] and sha not in done]
    if a.limit:
        jobs = jobs[:a.limit]
    print(f"מסמכים ייחודיים: {len(docs)} | כבר במאגר: {len(done)} | לעיבוד עכשיו: {len(jobs)}", flush=True)
    rows = []
    with Pool(a.workers) as pool:
        for n, (sha, aids, res, err) in enumerate(pool.imap_unordered(work, jobs, chunksize=2), 1):
            if err or res is None:
                print(f"  {sha[:12]}: {err}")
                continue
            pages = [fix_hebrew(t) for t in res["pages"]]
            full = "\n".join(f"===== עמוד {i + 1} =====\n{t}" for i, t in enumerate(pages))
            with open(os.path.join(a.out, "text", sha + ".txt"), "w", encoding="utf-8") as f:
                f.write(full)
            hp_pages = collections.defaultdict(lambda: [0, set()])
            names = []
            for i, t in enumerate(pages, 1):
                db.execute("INSERT INTO pages VALUES (?,?,?)", (sha, i, t))
                db.execute("INSERT INTO pages_fts (text, sha, page) VALUES (?,?,?)", (norm_fts(t), sha, i))
                for h in dict.fromkeys(HP.findall(t.replace(",", ""))):
                    if hp_ok(h):
                        hp_pages[h][0] += len(re.findall(r"(?<!\d)" + h + r"(?!\d)", t))
                        hp_pages[h][1].add(i)
                for mm in NAME.finditer(t):
                    names.append((sha, re.sub(r"\s+", " ", mm.group(1)).strip(), "בע\"מ"))
                for ln in [x.strip() for x in t.split("\n") if x.strip()][:5]:
                    names.append((sha, ln[:80], f"שורה ראשונה, עמוד {i}"))
            for h, (c, pg) in hp_pages.items():
                db.execute("INSERT INTO hps VALUES (?,?,?,?,?)", (sha, h, c, ",".join(map(str, sorted(pg))), 1 if h in chps else 0))
            db.executemany("INSERT INTO names VALUES (?,?,?)", list(dict.fromkeys(names)))
            hw = [i + 1 for i, v in enumerate(res["hints"]) if v > 400]
            chars = sum(len(t) for t in pages)
            db.execute("INSERT OR REPLACE INTO docs VALUES (?,?,?,?,?,?)", (sha, " | ".join(sorted(docs[sha]["files"])), res["n"], chars, int(res["ocr"]), ",".join(map(str, hw))))
            if n % 25 == 0:
                db.commit()
                print(f"  {n}/{len(jobs)}", flush=True)
    db.commit()
    with open(os.path.join(a.out, "סיכום.csv"), "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(["sha", "קבצים", "עמודים", "תווים", "OCR", "ח.פ. שנמצאו", "ח.פ. שאינם במאגר", "עמודים עם רמז לכתב יד"])
        for sha, files, pg, ch, ocr, hw in db.execute("SELECT sha, files, pages, chars, ocr, handwriting_pages FROM docs"):
            h = [r for r in db.execute("SELECT hp, in_db FROM hps WHERE sha = ?", (sha,))]
            w.writerow([sha[:12], files, pg, ch, "כן" if ocr else "", " ".join(x[0] for x in h), " ".join(x[0] for x in h if not x[1]), hw])
    t = db.execute("SELECT COUNT(*), SUM(chars), SUM(ocr) FROM docs").fetchone()
    print(f"במאגר: {t[0]} מסמכים, {t[1] or 0:,} תווים, {t[2] or 0} עם OCR. נכתב: {a.out}\\permit_text.db, {a.out}\\סיכום.csv")
    return 0


if __name__ == "__main__":
    sys.exit(main())
