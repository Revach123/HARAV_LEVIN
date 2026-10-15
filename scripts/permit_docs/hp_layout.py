# -*- coding: utf-8 -*-
"""
מיקום ה-ח.פ. בתוך קובץ ההיתר, כדי להבדיל בין שני סוגי קבצים עם כמה חברות:
  "מסמך משותף"          - מסמך אחד לכמה חברות: ח.פ.-ים מופיעים קרוב זה לזה (אותו עמוד או עמודים סמוכים)
  "כמה מסמכים בקובץ"    - ח.פ.-ים בעמודים רחוקים זה מזה: כנראה מסמכים נפרדים שחוברו לקובץ אחד (מועמד לפיצול בעתיד)
  "משולב"                - גם וגם
  קלט:  סופי_מלא.csv (העמודות doc_hps_in_db / doc_hps_not_in_db) + attachments.csv + קובצי ה-PDF
  פלט:  hp_layout.csv  (attachment_id, file, pages, hps, hps_by_page, kind)
  נבדקים רק קבצים שנמצאו בהם לפחות שני ח.פ. תקינים שונים. עמוד בלי טקסט נקרא ב-OCR (Tesseract).
  אפשר להפעיל שוב: קבצים שכבר נבדקו נשמרים ב-hp_layout_cache.json.
"""
import argparse
import csv
import json
import os
import re
import sys
from multiprocessing import Pool

import fitz  # PyMuPDF

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import match_pdfs as m  # noqa: E402
import ocr_pdfs  # noqa: E402

NEAR = 1       # עמודים סמוכים (הפרש עד 1) נחשבים "קרוב"


def valid_hps(text):
    out = []
    for x in re.findall(r"(?<!\d)(\d{8,9})(?!\d)", text.replace(",", "")):
        h = x.zfill(9)
        if m.check_digit_ok(h) and h not in out:
            out.append(h)
    return out


def classify(by_page):
    """by_page = {עמוד: [ח.פ.-ים]} -> kind."""
    allh = {h for v in by_page.values() for h in v}
    if len(allh) < 2:
        return "יחיד"
    pages = sorted(p for p, v in by_page.items() if v)
    if pages[-1] - pages[0] <= NEAR:
        return "מסמך משותף"
    multi = any(len(v) >= 2 for v in by_page.values())
    return "משולב" if multi else "כמה מסמכים בקובץ"


def work(job):
    aid, path, tess, dpi, maxp = job
    try:
        doc = fitz.open(path)
        by_page = {}
        for i in range(min(len(doc), maxp)):
            t = doc[i].get_text() or ""
            if len(t.strip()) < 40:
                t = ocr_pdfs.ocr_page(doc, i, tess, dpi)
            h = valid_hps(t)
            if h:
                by_page[i + 1] = h
        n = len(doc)
        doc.close()
    except Exception as e:  # noqa: BLE001
        return aid, {"error": str(e)}
    return aid, {"pages": n, "by_page": {str(k): v for k, v in by_page.items()}, "kind": classify(by_page)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--final", default="סופי_מלא.csv")
    ap.add_argument("--attachments", default="attachments.csv")
    ap.add_argument("--uploads", default=os.path.join("wp-content", "uploads"))
    ap.add_argument("--out", default="hp_layout.csv")
    ap.add_argument("--cache", default="hp_layout_cache.json")
    ap.add_argument("--tesseract", default=ocr_pdfs.TESS_DEFAULT if os.name == "nt" else "tesseract")
    ap.add_argument("--dpi", type=int, default=150)
    ap.add_argument("--max-pages", type=int, default=40)
    ap.add_argument("--workers", type=int, default=2)
    a = ap.parse_args()

    guid = {r["ID"]: r.get("guid", "") for r in m.read_csv(a.attachments)}
    rows = m.read_csv(a.final)
    cand = []
    for r in rows:
        hs = set(re.findall(r"\d{8,9}", (r.get("doc_hps_in_db") or "") + " " + (r.get("doc_hps_not_in_db") or "")))
        if len(hs) >= 2:
            p = m.local_path(a.uploads, guid.get(r["attachment_id"], ""))
            if p and os.path.exists(p):
                cand.append((r["attachment_id"], r.get("file", ""), p))
    cache = {}
    if os.path.exists(a.cache):
        with open(a.cache, encoding="utf-8") as f:
            cache = json.load(f)
    todo = [(aid, p, a.tesseract, a.dpi, a.max_pages) for aid, _f, p in cand if aid not in cache]
    print(f"קבצים עם לפחות שני ח.פ.: {len(cand)} | לבדיקה: {len(todo)}")
    if todo:
        with Pool(a.workers) as pool:
            for n, (aid, res) in enumerate(pool.imap_unordered(work, todo), 1):
                cache[aid] = res
                if n % 10 == 0 or n == len(todo):
                    print(f"  {n}/{len(todo)}", flush=True)
                    with open(a.cache, "w", encoding="utf-8") as f:
                        json.dump(cache, f, ensure_ascii=False)
    with open(a.cache, "w", encoding="utf-8") as f:
        json.dump(cache, f, ensure_ascii=False)
    out = []
    for aid, fname, _p in cand:
        c = cache.get(aid) or {}
        if "kind" not in c:
            continue
        hps = sorted({h for v in c["by_page"].values() for h in v})
        by = " | ".join(f"עמוד {p}: {', '.join(v)}" for p, v in sorted(c["by_page"].items(), key=lambda x: int(x[0])))
        out.append([aid, fname, c["pages"], " ".join(hps), by, c["kind"]])
    with open(a.out, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(["attachment_id", "file", "pages", "hps", "hps_by_page", "kind"])
        w.writerows(out)
    import collections
    print("סיכום:", dict(collections.Counter(o[5] for o in out)), "->", a.out)


if __name__ == "__main__":
    sys.exit(main())
