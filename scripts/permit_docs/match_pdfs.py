# -*- coding: utf-8 -*-
"""
שיוך מסמכי היתר עסקה (PDF מוורדפרס) לחברות לפי ח.פ.  - רץ על המחשב שלך, על הקבצים המקומיים.

קלט:
  --uploads   תיקיית uploads של האתר (מהגיבוי), למשל  C:\\localwp\\Local Sites\\iska\\app\\public\\wp-content\\uploads
  --attachments  attachments.csv  (מ-wp post list: ID,post_title,post_parent,guid)
  --posts     posts.csv (אופציונלי: ID,post_title,post_type,post_status) - שם הפוסט שאליו משויך הקובץ
  --businesses  קובץ JSON של העסקים (ברירת מחדל: נטען מ-https://harav-levin.pages.dev/api/businesses)
  --out       קובץ הפלט (CSV, נפתח באקסל)
  --limit N   לבדיקה: רק N הקבצים הראשונים

שיטה (כל שיטה מאמתת את השנייה):
  1. מוציאים טקסט מה-PDF ומחפשים מספרים בני 9 ספרות עם ספרת ביקורת תקינה (כמו בטופס ההוספה).
  2. בודקים אם המספר קיים בעסקים שלנו, ואם שם העסק מופיע בטקסט / דומה לשם הפוסט.
  3. רמת ודאות:  ודאי / סביר / לבדיקה ידנית  (+ סיבה), כדי שתעבור ידנית רק על הקטן.
קובץ בלי טקסט (סרוק) מסומן "סרוק - דורש OCR".
"""
import argparse
import csv
import difflib
import json
import os
import re
import subprocess
import sys
import urllib.request

API = "https://harav-levin.pages.dev/api/businesses"


def check_digit_ok(n):
    n = n.zfill(9)
    if len(n) != 9:
        return False
    s = 0
    for i, ch in enumerate(n):
        v = int(ch) * (2 if i % 2 else 1)
        s += v - 9 if v > 9 else v
    return s % 10 == 0


def norm(s):
    s = (s or "").lower()
    s = re.sub(r"[\"'׳״`()\-–_,.:/\\]", " ", s)
    s = re.sub(r"\b(בעמ|בע מ|בע)\b", " ", s)
    s = re.sub(r"בע\s*מ", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def title_core(t):
    """שם פוסט -> שם החברה: מוריד סיומות של סדרת אג"ח ('אג"ח א'', 'לאג"ח בלבד', 'לאג"ח פרטי בלבד')."""
    t = re.sub(r"\s+ל?אג[\"״]?ח\s+(פרטי\s+|כללי\s+)?בלבד\s*$", "", t or "")
    t = re.sub(r"\s+אג[\"״]?ח\s+\S{1,3}\s*$", "", t)
    return t.strip()


def title_variants(t):
    """כמה קריאות אפשריות של שם הפוסט: בלי קידומת 'רישום להיתר עיסקא', לפני/אחרי 'על שם', ותוכן סוגריים."""
    base = title_core(t)
    base = re.sub(r"^\s*(רישום\s+)?(ל?היתר\s+עי?סקא)\s*(פרטי|כללי)?\s*", "", base)
    base = re.sub(r"\s*\((ע[\"״]ר|נוסח[^)]*)\)\s*", " ", base).strip()
    out = [base]
    m = re.split(r"\s+על שם\s+", base, maxsplit=1)
    if len(m) == 2:
        out += [m[0], m[1]]
    out += re.findall(r"\(([^)]{4,})\)", base)
    nop = re.sub(r"\([^)]*\)", " ", base).strip()
    if nop and nop != base:
        out.append(nop)
    seen, res = set(), []
    for v in out:
        v = re.sub(r"^\s*על שם\s+", "", v).strip()
        if v and norm(v) not in seen:
            seen.add(norm(v)); res.append(v)
    return res


def _ratio(a, b, cut=0.8):
    sm = difflib.SequenceMatcher(None, a, b)
    if sm.real_quick_ratio() < cut or sm.quick_ratio() < cut:
        return 0.0
    return sm.ratio()


def sim(title, name):
    """דמיון בין שם פוסט לשם עסק: המקסימום מבין הקריאות האפשריות; הכלה מלאה של מילים (2+) נחשבת 0.9."""
    nb = norm(name)
    if not nb:
        return 0.0
    best = 0.0
    nbt = set(nb.split())
    for v in title_variants(title):
        nv = norm(v)
        if not nv:
            continue
        best = max(best, _ratio(nv, nb))
        vt = nv.split()
        if len(vt) >= 2 and set(vt) <= nbt:
            best = max(best, 0.9)
    return best


def pdf_text(path):
    try:
        out = subprocess.run(["pdftotext", "-layout", path, "-"], capture_output=True, timeout=60)
        if out.returncode == 0 and out.stdout.strip():
            return out.stdout.decode("utf-8", "replace")
    except (OSError, subprocess.TimeoutExpired):
        pass
    try:
        from pypdf import PdfReader
        r = PdfReader(path)
        return "\n".join((p.extract_text() or "") for p in r.pages[:30])
    except Exception:  # noqa: BLE001
        return ""


def load_businesses(path):
    if path:
        return json.load(open(path, encoding="utf-8"))
    with urllib.request.urlopen(urllib.request.Request(API, headers={"User-Agent": "Mozilla/5.0"}), timeout=60) as r:
        return json.loads(r.read())


def read_csv(path):
    with open(path, encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def local_path(uploads, guid):
    m = re.search(r"wp-content/uploads/(.+)$", guid or "")
    return os.path.join(uploads, *m.group(1).split("/")) if m else ""


_RANK_CACHE = {}


def classify(text, title, by_hp, names):
    """-> (hp, business, confidence, reason, candidates)"""
    cands = []
    for m in re.finditer(r"(?<!\d)(\d{8,9})(?!\d)", text.replace(",", "")):
        n = m.group(1).zfill(9)
        if check_digit_ok(n) and n not in cands:
            cands.append(n)
    in_db = [h for h in cands if h in by_hp]
    ntext = norm(text)
    scored = []
    for h in in_db:
        for b in by_hp[h][:1]:
            nm = [norm(b.get("registrar_name")), norm(b.get("permit_name"))]
            in_text = any(x and len(x) >= 4 and (x in ntext or x[::-1] in ntext) for x in nm)      # גם טקסט שנקרא הפוך (RTL)
            scored.append((h, b, in_text, max(sim(title, b.get("registrar_name")), sim(title, b.get("permit_name")))))
    good = [s for s in scored if s[2] or s[3] >= 0.6]
    if len(good) == 1:
        h, b, in_text, t = good[0]
        return h, b, "ודאי", ("השם מופיע במסמך" if in_text else f"דמיון לשם הפוסט {t:.2f}") + " + ח.פ. תקין במסמך", cands
    if len(good) > 1:
        return "", None, "לבדיקה ידנית", "כמה חברות מתאימות: " + ", ".join(s[0] for s in good), cands
    if len(scored) == 1:
        h, b, _, t = scored[0]
        return h, b, "סביר", f"ח.פ. תקין במסמך אך השם לא תואם (דמיון {t:.2f})", cands
    if len(scored) > 1:
        return "", None, "לבדיקה ידנית", "כמה ח.פ. של עסקים שלנו במסמך: " + ", ".join(s[0] for s in scored), cands
    key = (title, id(names))
    if key not in _RANK_CACHE:
        _RANK_CACHE[key] = sorted(((sim(title, nm), nm, b) for nm, b in names), key=lambda x: -x[0])[:5]
    ranked = _RANK_CACHE[key]
    best = ranked[0] if ranked else (0, "", None)
    others = {id(x[2]) for x in ranked[1:] if x[0] >= best[0] - 0.03 and x[2] is not best[2]}      # עסק אחר עם שם כמעט זהה = עמימות
    if best[0] >= 0.97 and not others:
        b = best[2]
        return (re.sub(r"\D", "", b.get("chp_number") or "")), b, "ודאי (לפי שם)", f"שם הפוסט זהה לשם החברה (דמיון {best[0]:.2f}), ללא חברה אחרת דומה", cands
    if best[0] >= 0.97 and others:
        return "", None, "לבדיקה ידנית", f"כמה עסקים עם שם כמעט זהה לשם הפוסט ({best[1]})", cands
    if best[0] >= 0.85:
        b = best[2]
        return (re.sub(r"\D", "", b.get("chp_number") or "")), b, "סביר", f"לפי שם הפוסט בלבד (דמיון {best[0]:.2f})", cands
    if cands:
        return "", None, "לבדיקה ידנית", "ח.פ. תקין במסמך שאינו בעסקים שלנו (ייתכן שהחברה חסרה במאגר): " + ", ".join(cands[:4]), cands
    return "", None, "לבדיקה ידנית", "לא נמצא ח.פ. תקין במסמך ולא נמצאה התאמה לפי שם", cands


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--uploads", required=True)
    ap.add_argument("--attachments", required=True)
    ap.add_argument("--posts")
    ap.add_argument("--businesses")
    ap.add_argument("--out", default="permit_docs_matches.csv")
    ap.add_argument("--limit", type=int, default=0)
    a = ap.parse_args()

    biz = load_businesses(a.businesses)
    by_hp = {}
    for b in biz:
        d = re.sub(r"\D", "", b.get("chp_number") or "").lstrip("0")
        if d:
            by_hp.setdefault(d.zfill(9), []).append(b)
    names = [(n, b) for b in biz for n in {(b.get("registrar_name") or "").strip(), (b.get("permit_name") or "").strip()} if n]
    posts = {r["ID"]: r for r in read_csv(a.posts)} if a.posts else {}
    atts = read_csv(a.attachments)
    if a.limit:
        atts = atts[:a.limit]

    cols = ["attachment_id", "file", "post_title", "confidence", "reason", "hp", "business_id", "business_name", "hp_candidates", "text_chars", "post_type", "post_status"]
    stats = {}
    with open(a.out, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(cols)
        for i, r in enumerate(atts, 1):
            path = local_path(a.uploads, r.get("guid"))
            title = (posts.get(r.get("post_parent", ""), {}).get("post_title") or r.get("post_title") or "").strip()
            if not path or not os.path.exists(path):
                row = ["", "הקובץ לא נמצא בתיקייה", "", ""]
                conf, reason, hp, b, cands, chars = "לבדיקה ידנית", "הקובץ לא נמצא בתיקיית uploads", "", None, [], 0
            else:
                text = pdf_text(path)
                chars = len(text.strip())
                if chars < 15:
                    conf, reason, hp, b, cands = "לבדיקה ידנית", "סרוק - דורש OCR (אין טקסט בקובץ)", "", None, []
                    hp0, b0, c0, r0, _ = classify("", title, by_hp, names)       # לפחות ניסיון לפי שם הפוסט
                    if c0 in ("סביר", "ודאי (לפי שם)"):
                        hp, b, conf, reason = hp0, b0, c0, "סרוק; " + r0
                else:
                    hp, b, conf, reason, cands = classify(text, title, by_hp, names)
            stats[conf] = stats.get(conf, 0) + 1
            w.writerow([r.get("ID"), os.path.basename(path) if path else r.get("guid"), title, conf, reason, hp,
                        (b or {}).get("id", ""), ((b or {}).get("registrar_name") or (b or {}).get("permit_name") or ""), " ".join(cands[:6]), chars,
                        posts.get(r.get("post_parent", ""), {}).get("post_type", ""), posts.get(r.get("post_parent", ""), {}).get("post_status", "")])
            if i % 50 == 0:
                print(f"{i}/{len(atts)}", stats, flush=True)
    # כותרות אמיתיות (לא קודים כמו SD / ER) שלא נמצאה להן חברה: מועמדות להוספה למאגר
    miss = {}
    with open(a.out, encoding="utf-8-sig", newline="") as f:
        for r in csv.DictReader(f):
            t = r["post_title"].strip()
            if r["confidence"] == "לבדיקה ידנית" and not re.fullmatch(r"[A-Za-z]{1,6}", t):
                miss.setdefault(t, []).append(r["file"])
    mp = os.path.splitext(a.out)[0] + "_חסרים_במאגר.csv"
    with open(mp, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(["post_title", "files", "example_file"])
        for t, fl in sorted(miss.items()):
            w.writerow([t, len(fl), fl[0]])
    print("סיום:", stats, "->", a.out, "|", len(miss), "כותרות ללא חברה ->", mp)


if __name__ == "__main__":
    sys.exit(main())
