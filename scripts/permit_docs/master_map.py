# -*- coding: utf-8 -*-
"""
מיפוי מלא של מסמכי ההיתר (קריאה בלבד: לא משייך, לא כותב למאגר ולא משנה קבצים).
  פלט:
    מיפוי_קבצים.csv   - שורה לכל קובץ: מיקום וסוג, חברות משויכות, סוג הקובץ (יחיד / מסמך משותף / כמה מסמכים בקובץ / משולב),
                         נוסח (רק פרטי / משולב), קבוצת קבצים זהים ובאילו רשימות הם מופיעים, הצעת פיצול, ודגלים מההחלטות שלך
    מיפוי_חברות.csv   - שורה לכל חברה: כמה קבצים וכמה מסמכים שונים בתוכן בכל סוג ("כמה מסמכים לאותה חברה" = סימן שאלה)
    הצעות_פיצול.csv  - שורה לכל קטע מוצע בקובץ שמיועד לפיצול: טווח עמודים, ח.פ.-ים והחברות
  הצעת הפיצול נגזרת ממיקום ה-ח.פ.-ים בעמודים (hp_layout.csv): מסמך חדש מתחיל בעמוד שבו מופיע ח.פ. שאין לו חפיפה עם הקטע הקודם;
  עמודים בלי ח.פ. שייכים לקטע שלפניהם. זו הצעה בלבד - יש לאמת מול הקובץ.
    python master_map.py
"""
import argparse
import collections
import csv
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import match_pdfs as m  # noqa: E402
from coverage_report import file_hashes, hps_of  # noqa: E402
from parse_decisions import parse as parse_note  # noqa: E402

VIS = {"": "רק כללי", "פרטי": "יש גם פרטי", "רק פרטי": "רק פרטי"}
NEED = {"רק כללי": ("כללי",), "יש גם פרטי": ("כללי", "פרטי"), "רק פרטי": ("פרטי",)}


def parse_by_page(s):
    """'עמוד 1: 513.., 514.. | עמוד 4: 520..' -> {1: [...], 4: [...]}"""
    out = {}
    for part in (s or "").split("|"):
        mm = re.match(r"\s*עמוד\s+(\d+):\s*(.*)", part)
        if mm:
            out[int(mm.group(1))] = [h.strip() for h in mm.group(2).split(",") if h.strip()]
    return out


def suggest_split(by_page, pages):
    """-> [(מעמוד, עד עמוד, [ח.פ.-ים])]. קטע חדש מתחיל בעמוד שבו ח.פ.-ים בלי חפיפה לקטע הקודם."""
    segs = []      # [start, set]
    for p in sorted(by_page):
        h = set(by_page[p])
        if not h:
            continue
        if not segs:
            segs.append([p, set(h)])
        elif segs[-1][1] & h or (segs[-1][1] <= h) or (h <= segs[-1][1]):
            segs[-1][1] |= h
        else:
            segs.append([p, set(h)])
    if segs:
        segs[0][0] = 1          # עמודים מוקדמים בלי ח.פ. שייכים לקטע הראשון
    out = []
    for i, (st, hs) in enumerate(segs):
        end = (segs[i + 1][0] - 1) if i + 1 < len(segs) else pages
        out.append((st, end, sorted(hs)))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--final", default="סופי_מאוחד.csv")
    ap.add_argument("--businesses", default="businesses.json")
    ap.add_argument("--decisions", default="החלטות_בדיקה.csv")
    ap.add_argument("--type-check", default="type_check.csv")
    ap.add_argument("--hp-layout", default="hp_layout.csv")
    ap.add_argument("--attachments", default="attachments.csv")
    ap.add_argument("--uploads", default=os.path.join("wp-content", "uploads"))
    ap.add_argument("--hash-cache", default="hashes_cache.json")
    ap.add_argument("--out-files", default="מיפוי_קבצים.csv")
    ap.add_argument("--out-companies", default="מיפוי_חברות.csv")
    ap.add_argument("--out-splits", default="הצעות_פיצול.csv")
    a = ap.parse_args()

    rd = lambda p: m.read_csv(p) if p and os.path.exists(p) else []  # noqa: E731
    biz = {b["id"]: b for b in json.load(open(a.businesses, encoding="utf-8"))}
    by_chp = {str(b.get("chp_number") or "").zfill(9): b["id"] for b in biz.values() if b.get("chp_number")}
    name_of = lambda bid: biz[bid].get("registrar_name") or biz[bid].get("permit_name") or ""  # noqa: E731
    dec = {r["attachment_id"]: r for r in rd(a.decisions)}
    tcheck = {r["attachment_id"]: r.get("text_check", "") for r in rd(a.type_check)}
    layout = {r["attachment_id"]: r for r in rd(a.hp_layout)}
    rows = rd(a.final)
    hashes = file_hashes(a.attachments, a.uploads, a.hash_cache)
    groups = collections.defaultdict(list)
    for aid, h in hashes.items():
        groups[h].append(aid)
    gid = {}
    for n, (h, ids) in enumerate(sorted(groups.items(), key=lambda x: min(x[1])), 1):
        if len(ids) > 1:
            for i in ids:
                gid[i] = f"כפילות-{n}"
    type_of = {}
    for r in rows:
        t0 = (dec.get(r["attachment_id"], {}).get("type_answer") or r.get("doc_type_clean") or r.get("doc_type") or "").rstrip("?")
        type_of[r["attachment_id"]] = t0 if t0 in ("כללי", "פרטי") else "ללא מיקום"

    files, splits = [], []
    per_co = collections.defaultdict(lambda: collections.defaultdict(list))        # bid -> type -> [aid]
    shared = collections.defaultdict(set)
    combined = collections.defaultdict(set)
    for r in rows:
        aid = r["attachment_id"]
        d = dec.get(aid, {})
        t = type_of[aid]
        ids = []
        for x in [r.get("business_id")] + [by_chp[h] for h in hps_of(r.get("doc_hps_in_db")) if h in by_chp] + \
                [i.strip() for i in (d.get("company_ids") or d.get("company_id") or "").split(";")]:
            if x and x in biz and x not in ids:
                ids.append(x)
        lay = layout.get(aid) or {}
        kind = lay.get("kind") or r.get("multi_kind") or ("יחיד" if len(ids) <= 1 else "")
        dup_ids = [x for x in groups.get(hashes.get(aid), []) if x != aid]
        dup_types = sorted({type_of.get(x, "") for x in dup_ids + [aid] if type_of.get(x) in ("כללי", "פרטי")})
        both_lists = len(dup_types) == 2
        sp_text = ""
        if kind in ("כמה מסמכים בקובץ", "משולב"):
            segs = suggest_split(parse_by_page(lay.get("hps_by_page")), int(lay.get("pages") or 0))
            if len(segs) > 1:
                sp_text = " | ".join(f"עמודים {s}-{e}: {', '.join(name_of(by_chp[h]) if h in by_chp else h for h in hs)}" for s, e, hs in segs)
                for n, (s, e, hs) in enumerate(segs, 1):
                    splits.append({"attachment_id": aid, "file": r.get("file", ""), "segment": n, "from_page": s, "to_page": e,
                                   "hps": " ".join(hs), "companies": "; ".join(name_of(by_chp[h]) if h in by_chp else "(לא במאגר)" for h in hs),
                                   "total_pages": lay.get("pages", "")})
        _hps, _types, flags = parse_note(d.get("note"), d.get("company_special"))
        files.append({"attachment_id": aid, "file": r.get("file", ""), "type": t, "location": r.get("post_type", ""),
                      "companies": "; ".join(name_of(i) for i in ids), "company_ids": ";".join(ids), "file_kind": kind,
                      "wording": tcheck.get(aid, ""), "duplicate_group": gid.get(aid, ""), "duplicates": " ".join(dup_ids),
                      "duplicate_types": "+".join(dup_types) if dup_ids else "", "same_file_in_both_lists": "כן" if both_lists else "",
                      "split_suggestion": sp_text, "decision_flags": ";".join(flags), "needs_review": r.get("needs_review", ""),
                      "review_reasons": r.get("review_reasons", "")})
        for i in ids:
            per_co[i][t].append(aid)
            if kind == "מסמך משותף":
                shared[i].add(aid)
            if tcheck.get(aid, "").startswith("נוסח משולב"):
                combined[i].add(aid)

    def distinct(ids):
        return len({hashes.get(x, x) for x in ids})

    comps = []
    for bid, b in biz.items():
        d = per_co.get(bid, {})
        vis = VIS.get(b.get("visibility") or "", b.get("visibility") or "")
        g, p, u = d.get("כללי", []), d.get("פרטי", []), d.get("ללא מיקום", [])
        q = [t for t, ids in (("כללי", g), ("פרטי", p)) if distinct(ids) > 1]
        comps.append({"company": name_of(bid), "chp": b.get("chp_number", ""), "registered": vis,
                      "general_files": len(g), "general_distinct": distinct(g), "private_files": len(p), "private_distinct": distinct(p),
                      "no_location_files": len(u), "several_different_docs": "+".join(q), "shared_files": " ".join(sorted(shared.get(bid, []))),
                      "combined_wording_files": " ".join(sorted(combined.get(bid, []))),
                      "missing": " + ".join(t for t in NEED.get(vis, ("כללי",)) if not d.get(t))})
    comps.sort(key=lambda x: (x["several_different_docs"] == "", x["company"]))

    def write(path, data, cols):
        with open(path, "w", encoding="utf-8-sig", newline="") as f:
            w = csv.DictWriter(f, fieldnames=cols)
            w.writeheader()
            w.writerows(data)

    write(a.out_files, files, list(files[0].keys()) if files else [])
    write(a.out_companies, comps, list(comps[0].keys()) if comps else [])
    write(a.out_splits, splits, ["attachment_id", "file", "segment", "from_page", "to_page", "total_pages", "hps", "companies"])
    kinds = collections.Counter(f["file_kind"] or "ללא סיווג" for f in files)
    print(f"{len(files)} קבצים -> {a.out_files}")
    print("  סוגי קבצים:", dict(kinds))
    print(f"  קבצים בקבוצות זהות: {sum(1 for f in files if f['duplicate_group'])} ב-{len(set(f['duplicate_group'] for f in files if f['duplicate_group']))} קבוצות; מהן באותו קובץ ברשימת כללי ופרטי: {sum(1 for f in files if f['same_file_in_both_lists'])}")
    print(f"{len(comps)} חברות -> {a.out_companies}; עם כמה מסמכים שונים לאותו סוג: {sum(1 for c in comps if c['several_different_docs'])}")
    print(f"{len({s['attachment_id'] for s in splits})} קבצים עם הצעת פיצול, {len(splits)} קטעים -> {a.out_splits}")


if __name__ == "__main__":
    sys.exit(main())
