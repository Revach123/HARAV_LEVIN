# -*- coding: utf-8 -*-
"""
לכל סלוט שחסר ("אין פוסט ישן תואם") מחפש בכל גיבוי האתר הישן: כל סוגי הפוסטים והסטטוסים (גם טיוטות, פסולת, גרסאות),
כותרות וקבצים מצורפים, ושדות meta - לפי שם החברה (חלקי / בשינוי כתיב) ולפי ח.פ.
קריאה בלבד. פלט: find_in_backup.csv (מועמדים לכל חברה) + find_in_backup_summary.txt

    python find_in_backup.py "C:\\...\\backup_..._-db.gz" --missing old_vs_site_businesses.csv
"""
import argparse
import csv
import gzip
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from old_site_probe import columns, inserts  # noqa: E402

STOP = set("בעמ בע״מ חברה חברת קבוצת קבוצה ישראל ישראלית ע״ר עמותה לימיטד אינק בעם חלצ ניהול החזקות אחזקות השקעות הנפקות גיוסי הון".split())
QUOTES = re.compile(r"[\"'`״׳\u200f\u200e]")


def norm(s):
    s = QUOTES.sub("", s or "").lower()
    return re.sub(r"[^\w\s]", " ", s, flags=re.U)


def name_tokens(label):
    base = re.sub(r"\(\s*\d{5,10}\s*\)", " ", label)            # ח.פ. בסוגריים
    base = re.sub(r"\([^)]*\)", " ", base) if False else base
    toks = [t for t in norm(base).split() if len(t) >= 2 and t not in STOP]
    return toks


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("db")
    ap.add_argument("--missing", default="old_vs_site_businesses.csv")
    ap.add_argument("--out", default="find_in_backup.csv")
    a = ap.parse_args()
    sql = gzip.open(a.db, "rt", encoding="utf-8", errors="replace").read()
    pc, mc = columns(sql, "wp_posts"), columns(sql, "wp_postmeta")
    ix = {k: pc.index(k) for k in ("ID", "post_title", "post_name", "post_type", "post_status", "post_content", "post_parent") if k in pc}
    posts = {}
    for r in inserts(sql, "wp_posts"):
        posts[r[ix["ID"]]] = {k: r[i] for k, i in ix.items()}
    mi = {k: mc.index(k) for k in ("post_id", "meta_key", "meta_value")}
    meta = {}
    for r in inserts(sql, "wp_postmeta"):
        v = r[mi["meta_value"]] or ""
        if len(v) < 3000 and not r[mi["meta_key"]].startswith("_oembed"):
            meta.setdefault(r[mi["post_id"]], []).append(v)
    docs = []                                                       # (pid, type, status, title, haystack-normalized, raw-digits-text)
    for pid, p in posts.items():
        title = p.get("post_title") or ""
        raw = " ".join([title, p.get("post_name") or "", p.get("post_content") or ""] + meta.get(pid, []))
        docs.append((pid, p["post_type"], p["post_status"], title, set(norm(" ".join([title, p.get("post_name") or ""] + meta.get(pid, []))).split()), raw))
    print(f"נטענו {len(docs)} פוסטים", file=sys.stderr)

    rows = [r for r in csv.DictReader(open(a.missing, encoding="utf-8-sig")) if "אין פוסט ישן" in r["מצב"] or "דורש בדיקה" in r["מצב"]]
    seen, out, found, notfound = set(), [], 0, []
    for r in rows:
        label = r["חברה"]
        if label in seen:
            continue
        seen.add(label)
        m = re.search(r"\((\d{5,10})\)\s*$", label)
        hp = m.group(1) if m else ""
        toks = name_tokens(label)
        cands = []
        for pid, typ, st, title, tokset, raw in docs:
            sc, why = 0.0, []
            if toks:
                hit = sum(1 for t in toks if t in tokset)
                f = hit / len(toks)
                if f >= 0.6 and hit >= min(2, len(toks)):
                    sc, why = f, ["שם"]
            if hp and re.search(r"(?<!\d)" + hp + r"(?!\d)", raw):
                sc, why = max(sc, 1.0) + 0.5, why + ["ח.פ."]
            if sc:
                files = " | ".join(sorted(set(re.findall(r"[^\s\"'<>]+\.pdf", raw, re.I)))[:3])
                cands.append((sc, pid, typ, st, title, "+".join(why), files))
        cands.sort(key=lambda c: (-c[0], c[2] == "revision"))
        if cands:
            found += 1
        else:
            notfound.append(label)
        for sc, pid, typ, st, title, why, files in cands[:6]:
            out.append({"חברה": label, "ח.פ.": hp, "מצב": r["מצב"], "ציון": round(sc, 2), "מזהה פוסט": pid, "סוג פוסט": typ, "סטטוס": st,
                        "כותרת": title, "נמצא לפי": why, "קבצי PDF בפוסט": files})
    with open(a.out, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["חברה", "ח.פ.", "מצב", "ציון", "מזהה פוסט", "סוג פוסט", "סטטוס", "כותרת", "נמצא לפי", "קבצי PDF בפוסט"])
        w.writeheader()
        w.writerows(out)
    lines = [f"חברות שנבדקו: {len(seen)}", f"נמצאו מועמדים בגיבוי: {found}", f"לא נמצא כלום בגיבוי (שם / ח.פ.): {len(notfound)}", "", "== לא נמצא כלום =="] + notfound
    open("find_in_backup_summary.txt", "w", encoding="utf-8").write("\n".join(lines))
    print("\n".join(lines[:4]))


if __name__ == "__main__":
    main()
