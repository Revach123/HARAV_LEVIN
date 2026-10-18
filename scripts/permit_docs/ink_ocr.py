# -*- coding: utf-8 -*-
"""
שלב 2ב: חותמות וכתב יד בתוך השטרות - בעיקר מספרי ח.פ. ושמות חברות שמופיעים רק בחותמת או בכתב יד.
(משלים את build_text_index.py; מריצים אחריו, על אותם קבצים.)

איך זה עובד, לכל עמוד:
  1) חותמות וכתב עט צבעוני: מבודדים פיקסלים צבעוניים (כחול / סגול / אדום / ירוק) מהדיו השחור של הטקסט המודפס, מקבצים לכתמים,
     וקוראים כל כתם ב-OCR בכמה כיוונים. חותמת עגולה "נפתחת" לפס ישר לפני הקריאה (טקסט על קשת).
  2) כתב יד בדיו כהה בתוך עמוד מודפס: מורידים את המילים המודפסות (מהשכבה של ה-PDF, או מה-OCR בעמוד סרוק), ומה שנשאר
     (קווים של ספרות בגודל כתב יד) נקרא ב-OCR לספרות בלבד.
  3) מכל קריאה מוצאים מספרי תאגיד (9 ספרות שמתחילות ב-5): תקין (ספרת ביקורת), או "קרוב" (ספרה אחת שגויה שמתאימה לחברה במאגר), ושמות חברות.
  כל תוצאה נשמרת עם תמונת החיתוך (text_index\\ink\\...png), כדי שאפשר לאמת בעין. כתב יד אינו מזוהה בוודאות: כל מה שנמצא מסומן "לבדיקה".

  python ink_ocr.py [--limit 10] [--only-bottom] [--workers 2]
דרישות:  pip install opencv-python-headless numpy
פלט: text_index\\permit_ink.db (טבלאות ink_hits, ink_done; קובץ נפרד, אפשר להריץ במקביל ל-build_text_index.py) + text_index\\ink\\<sha>_p<N>_<K>.png + text_index\\ink_סיכום.csv
"""
import argparse
import collections
import csv
import json
import os
import re
import sqlite3
import subprocess
import sys
import tempfile
import time
from multiprocessing import Pool

import cv2
import numpy as np

try:
    import pymupdf as fitz
except ImportError:
    import fitz

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import match_pdfs as m  # noqa: E402
from build_text_index import hp_ok, NAME  # noqa: E402
from coverage_report import file_hashes  # noqa: E402
from ocr_pdfs import TESS_DEFAULT  # noqa: E402

DIGITS = re.compile(r"\d{8,10}")
TESS = [TESS_DEFAULT if os.name == "nt" else "tesseract"]
DEADLINE = [0.0]          # זמן סיום מותר לעמוד הנוכחי; אחריו כל קריאת OCR מחזירה ריק


def ocr(img, psm=6, digits=False, lang="heb+eng"):
    if time.time() > DEADLINE[0]:
        return ""
    with tempfile.TemporaryDirectory() as td:
        p = os.path.join(td, "x.png")
        cv2.imwrite(p, img)
        cmd = [TESS[0], p, "stdout", "-l", "eng" if digits else lang, "--psm", str(psm)]
        if digits:
            cmd += ["-c", "tessedit_char_whitelist=0123456789"]
        try:
            return subprocess.run(cmd, capture_output=True, timeout=max(5, min(30, DEADLINE[0] - time.time()))).stdout.decode("utf-8", "replace")
        except Exception:  # noqa: BLE001
            return ""


def render(page, dpi):
    pix = page.get_pixmap(dpi=dpi, colorspace=fitz.csRGB)
    return np.frombuffer(pix.samples, np.uint8).reshape(pix.h, pix.w, 3)[:, :, ::-1].copy()      # BGR


def printed_mask(page, shape, dpi):
    """אזורי הטקסט המודפס (מהשכבה של ה-PDF). בעמוד סרוק בלי שכבה: ריק (ואז כל הדיו הכהה נחשב מועמד, עם סינון גודל)."""
    mask = np.zeros(shape[:2], np.uint8)
    k = dpi / 72.0
    for x0, y0, x1, y1, *_ in page.get_text("words"):
        cv2.rectangle(mask, (int(x0 * k) - 4, int(y0 * k) - 4), (int(x1 * k) + 4, int(y1 * k) + 4), 255, -1)
    return mask


def blobs(binary, kx, ky, min_w, min_h, max_w, max_h):
    """מקבץ פיקסלי דיו לכתמים (הרחבה אופקית לחיבור ספרות באותה שורה) ומחזיר תיבות."""
    dil = cv2.dilate(binary, cv2.getStructuringElement(cv2.MORPH_RECT, (kx, ky)))
    cnts, _ = cv2.findContours(dil, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    out = []
    for c in cnts:
        x, y, w, h = cv2.boundingRect(c)
        if min_w <= w <= max_w and min_h <= h <= max_h:
            out.append((x, y, w, h))
    return out


def unwrap(crop):
    """חותמת עגולה: פותח את הטבעת החיצונית לפס ישר (טקסט על קשת)."""
    h, w = crop.shape[:2]
    r = min(h, w) // 2
    polar = cv2.warpPolar(crop, (r, 720), (w / 2, h / 2), r, cv2.WARP_POLAR_LINEAR)
    strip = cv2.rotate(polar, cv2.ROTATE_90_COUNTERCLOCKWISE)[: int(r * 0.45), :]      # טבעת: חצי חיצוני של הרדיוס
    return cv2.resize(strip, None, fx=2.0, fy=2.0, interpolation=cv2.INTER_CUBIC)


def readings(img):
    """כל הקריאות האפשריות של חיתוך: כיוונים, ופס מפורש לחותמת עגולה. מחזיר רשימת מחרוזות."""
    outs = []
    for rot in (None, cv2.ROTATE_90_CLOCKWISE, cv2.ROTATE_180, cv2.ROTATE_90_COUNTERCLOCKWISE):
        v = img if rot is None else cv2.rotate(img, rot)
        outs.append(ocr(v, 6))
        outs.append(ocr(v, 11, digits=True))
    h, w = img.shape[:2]
    if 0.7 <= w / max(h, 1) <= 1.4 and min(h, w) > 160:
        strip = unwrap(img)
        for k in range(4):
            outs.append(ocr(np.roll(strip, k * strip.shape[1] // 4, axis=1), 6))
        outs.append(ocr(cv2.flip(strip, 1), 6))
    return outs


def rot(img, ang):
    h, w = img.shape[:2]
    M = cv2.getRotationMatrix2D((w / 2, h / 2), ang, 1.0)
    c, s_ = abs(M[0, 0]), abs(M[0, 1])
    nw, nh = int(h * s_ + w * c), int(h * c + w * s_)
    M[0, 2] += nw / 2 - w / 2
    M[1, 2] += nh / 2 - h / 2
    return cv2.warpAffine(img, M, (nw, nh), flags=cv2.INTER_CUBIC, borderValue=255 if img.ndim == 2 else (255, 255, 255))


def tilt_readings(iso):
    """חותמת מוטה: מיישרים לפי הזווית של הכתם הצבעוני, ובודקים גם זוויות קטנות קבועות."""
    outs = []
    inv = cv2.bitwise_not(iso)
    cnts, _ = cv2.findContours(inv, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    angs = [-30, -20, -10, 10, 20, 30]
    if cnts:
        pts = np.vstack(cnts)
        (_, _), (rw, rh), a = cv2.minAreaRect(pts)
        a = a if rw >= rh else a - 90
        if abs(a) > 3:
            angs.insert(0, a)
    for ang in angs:
        v = rot(iso, ang)
        outs.append(ocr(v, 6))
        outs.append(ocr(v, 11))
        big = cv2.erode(cv2.resize(v, None, fx=2.0, fy=2.0, interpolation=cv2.INTER_CUBIC), np.ones((2, 2), np.uint8))   # קו דק של חותמת: מעבים ומגדילים
        outs.append(ocr(big, 6))
        outs.append(ocr(big, 11, digits=True))
    return outs


def gray_tilts(crop):
    """חותמת מוטה על טקסט: קריאת ספרות מהתמונה המקורית (לא מהמסכה, שמפרקת קווים), בהגדלה ובזוויות עדינות."""
    g = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY) if crop.ndim == 3 else crop
    big = cv2.resize(g, None, fx=2.0, fy=2.0, interpolation=cv2.INTER_CUBIC)
    outs = []
    for ang in (0, -5, 5, -10, 10, -15, 15, -20, 20, -3, 3, -8, 8):
        outs.append(ocr(rot(big, ang) if ang else big, 11, digits=True))
    return outs


def tsv_mask(gray, a_dpi):
    """עמוד סרוק (בלי שכבת טקסט): אזורי המילים המודפסות לפי OCR, כדי שלא יסומנו כ"כתב יד"."""
    mask = np.zeros(gray.shape[:2], np.uint8)
    with tempfile.TemporaryDirectory() as td:
        p = os.path.join(td, "x.png")
        cv2.imwrite(p, gray)
        try:
            out = subprocess.run([TESS[0], p, "stdout", "-l", "heb+eng", "--psm", "6", "tsv"], capture_output=True, timeout=max(5, min(60, DEADLINE[0] - time.time()))).stdout.decode("utf-8", "replace")
        except Exception:  # noqa: BLE001
            return mask
    for ln in out.split("\n")[1:]:
        f = ln.split("\t")
        if len(f) >= 12 and f[0] == "5":
            try:
                x, y, w, h, conf = int(f[6]), int(f[7]), int(f[8]), int(f[9]), float(f[10])
            except ValueError:
                continue
            if conf >= 55 and len(f[11].strip()) >= 2 and not re.fullmatch(r"[\d.\-/]+", f[11].strip()):
                cv2.rectangle(mask, (x - 4, y - 4), (x + w + 4, y + h + 4), 255, -1)
    return mask


def near_valid(d, chps):
    """תקין, או ספרה אחת שגויה שמתאימה לח.פ. של חברה במאגר (טעות OCR אופיינית)."""
    if hp_ok(d):
        return "תקין", d
    if len(d) == 9:
        for i in range(9):
            for dg in "0123456789":
                c = d[:i] + dg + d[i + 1:]
                if c != d and c in chps and hp_ok(c):
                    return "קרוב", c
    return "", ""


def page_hits(sha, page, pno, a, chps, outdir):
    t0 = time.time()
    DEADLINE[0] = t0 + a.page_seconds
    img = render(page, a.dpi)
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    H = img.shape[0]
    hits, k = [], 0

    def add(kind, crop, stages, box):
        nonlocal k
        found = []
        for t in (t for stage in stages for t in stage()):
            t2 = t.replace(",", "").replace(" ", "")
            for d in dict.fromkeys(DIGITS.findall(t2)):
                for cand in ([d] if len(d) == 9 else [d[:9], d[-9:]]):
                    if not cand.startswith("5"):
                        continue
                    st, fixed = near_valid(cand, chps)
                    if st:
                        found.append((fixed, st, cand))
            if any(f[1] == "תקין" for f in found):          # נמצא ח.פ. תקין: אין צורך בעוד קריאות של אותו כתם
                break
            for mm in NAME.finditer(t):
                nm = re.sub(r"\s+", " ", mm.group(1)).strip()
                if len(nm) > 6:
                    found.append((nm, "שם", nm))
        if not found:
            return
        k += 1
        name = f"{sha[:12]}_p{pno}_{k}.png"
        cv2.imwrite(os.path.join(outdir, name), crop)
        for val, st, raw in dict.fromkeys(found):
            hits.append((sha, pno, val, st, kind, raw, name, 1 if (st != "שם" and val in chps) else 0))

    # 1) חותמות / עט צבעוני
    color = ((hsv[:, :, 1] > 70) & (hsv[:, :, 2] > 40)).astype(np.uint8) * 255
    color = cv2.morphologyEx(color, cv2.MORPH_OPEN, np.ones((2, 2), np.uint8))
    for (x, y, w, h) in sorted(blobs(color, 35, 25, 90, 40, 1500, 1200), key=lambda b: -b[3]):      # כתמים עבים (חותמות) קודם
        if a.only_bottom and y < H * 0.5:
            continue
        pad = 12
        crop = img[max(0, y - pad): y + h + pad, max(0, x - pad): x + w + pad]
        mask = color[max(0, y - pad): y + h + pad, max(0, x - pad): x + w + pad]
        iso = cv2.bitwise_not(mask)             # דיו צבעוני בלבד, שחור על לבן: בלי הטקסט המודפס שמתחת
        if time.time() > DEADLINE[0]:
            print(f"    {sha[:12]} עמוד {pno}: חרג מזמן העמוד ({a.page_seconds} שניות), ממשיך לעמוד הבא", flush=True)
            return hits
        if h < 80:          # כתם דק: שורת טקסט בסריקה צבעונית (לא חותמת), קריאת ספרות אחת מספיקה
            stages = [lambda: [ocr(iso, 7, digits=True)]]
        else:
            stages = [lambda: readings(iso), lambda: gray_tilts(crop), lambda: tilt_readings(iso), lambda: readings(cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY))]
        add("חותמת / עט צבעוני", crop, stages, (x, y, w, h))
    # 2) כתב יד בדיו כהה, מחוץ לטקסט המודפס
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    ink = (gray < 150).astype(np.uint8) * 255
    pm = printed_mask(page, img.shape, a.dpi)
    if not pm.any():          # עמוד סרוק: המילים המודפסות לפי OCR (ספרות בודדות לא נחשבות מודפסות, כדי שמספר בכתב יד לא ייעלם)
        pm = tsv_mask(gray, a.dpi)
    if pm.any():
        ink = cv2.bitwise_and(ink, cv2.bitwise_not(cv2.dilate(pm, np.ones((5, 5), np.uint8))))
        for (x, y, w, h) in blobs(ink, 50, 12, 110, 28, 900, 160):
            if a.only_bottom and y < H * 0.5:
                continue
            crop = gray[max(0, y - 10): y + h + 10, max(0, x - 10): x + w + 10]
            if time.time() - t0 > a.page_seconds:
                break
            add("כתב יד / דיו כהה", crop, [lambda: [ocr(crop, 7, digits=True), ocr(crop, 7)]], (x, y, w, h))
    return hits


def work(job):
    sha, path, a, chps, outdir = job
    TESS[0] = a.tesseract          # ב-Windows כל תהליך נטען מחדש: מעבירים את נתיב Tesseract גם אליו
    hits = []
    try:
        doc = fitz.open(path)
        for i in range(min(len(doc), a.max_pages)):
            hits += page_hits(sha, doc[i], i + 1, a, chps, outdir)
            print(f"    {sha[:12]} עמוד {i + 1}/{min(len(doc), a.max_pages)} נבדק", flush=True)
        doc.close()
    except Exception as e:  # noqa: BLE001
        return sha, hits, str(e)
    best = {}
    for h in sorted(hits, key=lambda h: h[3] != "תקין"):          # אותו ערך באותו עמוד: מופע אחד; "תקין" קודם ל"קרוב"
        best.setdefault((h[1], h[2]), h)
    uniq = list(best.values())
    return sha, uniq, ""


def doc_files(out):
    """שמות הקבצים לכל מסמך, מקריאה בלבד ממאגר הטקסט (ייתכן שהוא בבנייה במקביל: אם נעול, משתמשים בקוד המסמך)."""
    path = os.path.join(out, "permit_text.db")
    if not os.path.exists(path):
        return {}
    try:
        t = sqlite3.connect("file:" + os.path.abspath(path).replace("\\", "/") + "?mode=ro", uri=True, timeout=5)
        try:
            return dict(t.execute("SELECT sha, files FROM docs"))
        finally:
            t.close()
    except sqlite3.Error:
        return {}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--final", default="סופי_מאוחד.csv")
    ap.add_argument("--attachments", default="attachments.csv")
    ap.add_argument("--uploads", default=os.path.join("wp-content", "uploads"))
    ap.add_argument("--hash-cache", default="hashes_cache.json")
    ap.add_argument("--businesses", default="businesses.json")
    ap.add_argument("--out", default="text_index")
    ap.add_argument("--dpi", type=int, default=250)
    ap.add_argument("--workers", type=int, default=2)
    ap.add_argument("--max-pages", type=int, default=12)
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--only-bottom", action="store_true", help="רק החצי התחתון של כל עמוד (שם בדרך כלל החותמת)")
    ap.add_argument("--only", default="", help="רק מסמכים ששם הקובץ שלהם מכיל את הטקסט (למשל AASDFD); בודק מחדש גם אם כבר נבדקו")
    ap.add_argument("--page-seconds", type=int, default=90, help="מקסימום זמן בדיקה לעמוד")
    ap.add_argument("--tesseract", default=TESS[0])
    a = ap.parse_args()
    TESS[0] = a.tesseract
    outdir = os.path.join(a.out, "ink")
    os.makedirs(outdir, exist_ok=True)
    hashes = file_hashes(a.attachments, a.uploads, a.hash_cache)
    guid = {r["ID"]: r.get("guid", "") for r in m.read_csv(a.attachments)}
    docs = collections.OrderedDict()
    for r in m.read_csv(a.final):
        sha = hashes.get(r["attachment_id"])
        p = m.local_path(a.uploads, guid.get(r["attachment_id"], ""))
        if sha and p and os.path.exists(p):
            docs.setdefault(sha, p)
    chps = {str(b.get("chp_number") or "").zfill(9) for b in json.load(open(a.businesses, encoding="utf-8")) if b.get("chp_number")} if os.path.exists(a.businesses) else set()
    db = sqlite3.connect(os.path.join(a.out, "permit_ink.db"), timeout=60)
    db.execute("CREATE TABLE IF NOT EXISTS ink_hits (sha TEXT, page INT, value TEXT, status TEXT, kind TEXT, raw TEXT, crop TEXT, in_db INT)")
    db.execute("CREATE TABLE IF NOT EXISTS ink_done (sha TEXT PRIMARY KEY)")
    done = {r[0] for r in db.execute("SELECT sha FROM ink_done")}
    if a.only:
        files = doc_files(a.out)
        want = {sha for sha, pth in docs.items() if a.only.lower() in (files.get(sha, "") + " " + os.path.basename(pth)).lower()}
        for sha in want:
            db.execute("DELETE FROM ink_hits WHERE sha=?", (sha,))
        done -= want
        docs = collections.OrderedDict((sha, p) for sha, p in docs.items() if sha in want)
    jobs = [(sha, p, a, chps, outdir) for sha, p in docs.items() if sha not in done]
    if a.limit:
        jobs = jobs[:a.limit]
    print(f"מסמכים: {len(docs)} | כבר נבדקו: {len(done)} | לבדיקה עכשיו: {len(jobs)}", flush=True)
    total = 0
    with Pool(a.workers) as pool:
        for n, (sha, hits, err) in enumerate(pool.imap_unordered(work, jobs), 1):
            if err:
                print(f"  {sha[:12]}: {err}")
            db.executemany("INSERT INTO ink_hits VALUES (?,?,?,?,?,?,?,?)", hits)
            db.execute("INSERT OR REPLACE INTO ink_done VALUES (?)", (sha,))
            total += len(hits)
            if n % 10 == 0:
                db.commit()
                print(f"  {n}/{len(jobs)} (נמצאו {total})", flush=True)
    db.commit()
    files = doc_files(a.out)
    with open(os.path.join(a.out, "ink_סיכום.csv"), "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(["קבצים", "עמוד", "ערך", "סטטוס", "סוג", "נקרא כ", "תמונה", "במאגר"])
        for sha, pg, val, st, kind, raw, crop, ind in db.execute("SELECT * FROM ink_hits ORDER BY sha, page"):
            w.writerow([files.get(sha, sha[:12]), pg, val, st, kind, raw, crop, "כן" if ind else ""])
    print(f"נמצאו {total} מופעים. נכתב: {a.out}\\ink_סיכום.csv ותמונות ב-{outdir}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
