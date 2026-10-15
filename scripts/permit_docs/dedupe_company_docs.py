# -*- coding: utf-8 -*-
"""
בדיקת כפילויות בין מסמכים שונים של אותה חברה (קבצים זהים בייט-בייט כבר מאוחדים; כאן נבדקים מסמכים שונים בקובץ אבל דומים בתוכן:
סריקה חוזרת, גרסה כפולה, מסמך שמכיל את חברו). רץ על המחשב המקומי.
  קלט: מיפוי_קבצים.csv, attachments.csv, wp-content\\uploads, ocr_text\\ (טקסט שכבר נקרא), businesses.json
  שלב 1 (דוח, ברירת מחדל):  python dedupe_company_docs.py
        כותב כפילויות_לחברות.csv: לכל זוג מסמכים של אותה חברה - דמיון בתוכן, איזה כדאי להשאיר, ועמודה action
        (מולאה "הסר" אוטומטית כשכל העמודים זהים / הטקסט כמעט זהה, או כשמסמך כלול במסמך אחר והטקסט מאשר (90%+); ראיה חזותית בלבד או חלקית - לבדיקתכם; בשאר השורות ריקה: להחלטתך - כתוב "הסר" כדי להסיר את remove_file)
  שלב 2 (ביצוע):           python dedupe_company_docs.py --apply כפילויות_לחברות.csv [--site ...]
        לכל שורה עם action=הסר: אם המסמך המוסר משויך רק לחברה הזו - נמחק לגמרי; אם הוא משותף לחברות נוספות - רק מבוטל שיוכו מהחברה הזו.
        דורש סיסמת מנהל (ADMIN_PASSWORD או admin_password.txt). בלי --apply שום דבר לא משתנה.
"""
import argparse
import collections
import csv
import itertools
import json
import os
import re
import sys
import urllib.error

try:
    import pymupdf as fitz
except ImportError:
    import fitz

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import match_pdfs as m  # noqa: E402
from coverage_report import file_hashes  # noqa: E402

MAX_PAGES = 60   # כמה עמודים לכל מסמך נבדקים
HAM = 20         # עמודים סרוקים נחשבים זהים אם בטביעת האצבע החזותית (256 סיביות) נבדלים עד כמה סיביות
AUTO = 0.90      # דמיון (Jaccard על רצפי 3 מילים) שממנו מוצעת הסרה אוטומטית
SHOW = 0.55      # מתחת לזה לא מדווחים
CONTAIN = 0.90   # מסמך אחד מכיל את השני (גרסה חלקית)


def words(text):
    t = re.sub(r"[^א-ת0-9a-zA-Z]+", " ", (text or "").lower())
    return t.split()


def shingles(ws, n=3):
    return {" ".join(ws[i:i + n]) for i in range(max(0, len(ws) - n + 1))}


def page_sigs(path):
    """חתימה לכל עמוד: קבוצת רצפי מילים (עמוד עם טקסט) או טביעת אצבע חזותית 16x16 (עמוד סרוק בלי טקסט). מאפשר לזהות מסמכים עם עמודים זהים ועמוד נוסף."""
    sigs = []
    try:
        doc = fitz.open(path)
        for i in range(min(len(doc), MAX_PAGES)):
            pg = doc[i]
            ws = words(pg.get_text() or "")
            if len(ws) >= 15:
                sigs.append(("t", shingles(ws)))
                continue
            r = pg.rect
            pix = pg.get_pixmap(matrix=fitz.Matrix(16 / max(1, r.width), 16 / max(1, r.height)), colorspace=fitz.csGRAY)
            px = list(pix.samples)[:256]
            mean = sum(px) / max(1, len(px))
            sigs.append(("v", int("".join("1" if v > mean else "0" for v in px), 2)))
        doc.close()
    except Exception:  # noqa: BLE001
        return []
    return sigs


def same_page(a, b):
    if a[0] != b[0]:
        return False
    if a[0] == "t":
        inter = len(a[1] & b[1])
        return inter / max(1, len(a[1] | b[1])) >= 0.8
    return bin(a[1] ^ b[1]).count("1") <= HAM


def page_relation(sa, sb):
    """-> (כיסוי A ב-B, כיסוי B ב-A, עמודי B שאין להם מקביל ב-A, עמודי A שאין להם מקביל ב-B)"""
    if not sa or not sb:
        return None
    ma = [any(same_page(p, q) for q in sb) for p in sa]
    mb = [any(same_page(q, p) for p in sa) for q in sb]
    return sum(ma) / len(sa), sum(mb) / len(sb), [i + 1 for i, v in enumerate(mb) if not v], [i + 1 for i, v in enumerate(ma) if not v]


def load_text(aid, path, ocr_dirs, text_chars):
    t = ""
    if path and os.path.exists(path) and int(text_chars or 0) >= 15:
        t += m.pdf_text(path)
    for od in ocr_dirs:
        op = os.path.join(od, f"{aid}.txt")
        if os.path.exists(op):
            t += "\n" + open(op, encoding="utf-8").read()
    return t


def build_report(a):
    biz = {b["id"]: b for b in json.load(open(a.businesses, encoding="utf-8"))}
    guid = {r["ID"]: r.get("guid", "") for r in m.read_csv(a.attachments)}
    hashes = file_hashes(a.attachments, a.uploads, a.hash_cache)
    final = {r["attachment_id"]: r for r in m.read_csv(a.final)} if os.path.exists(a.final) else {}
    ocr_dirs = [x.strip() for x in a.ocr_dir.split(",") if x.strip()]
    docs = {}                                              # sha -> {ids, path, type_set, companies}
    for r in m.read_csv(a.map):
        aid = r["attachment_id"]
        sha = hashes.get(aid)
        p = m.local_path(a.uploads, guid.get(aid, ""))
        if not sha or not p or not os.path.exists(p):
            continue
        d = docs.setdefault(sha, {"sha": sha, "ids": [], "path": p, "types": set(), "companies": set(), "name": r.get("file", "")})
        d["ids"].append(aid)
        if r["type"] in ("כללי", "פרטי"):
            d["types"].add(r["type"])
        d["companies"].update(c for c in (r.get("company_ids") or "").split(";") if c)
    per_co = collections.defaultdict(list)
    for d in docs.values():
        for c in d["companies"]:
            per_co[c].append(d)
    rows = []
    cache = {}
    for cid, ds in per_co.items():
        if len(ds) < 2 or cid not in biz:
            continue
        for d in ds:
            if d["sha"] not in cache:
                t = max((load_text(i, d["path"], ocr_dirs, final.get(i, {}).get("text_chars")) for i in d["ids"]), key=len, default="")
                ws = words(t)
                cache[d["sha"]] = {"len": len(ws), "sh": shingles(ws), "size": os.path.getsize(d["path"]), "pages": page_sigs(d["path"])}
        for x, y in itertools.combinations(ds, 2):
            A, B = cache[x["sha"]], cache[y["sha"]]
            rel = page_relation(A["pages"], B["pages"])
            jac = con = 0.0
            extra = ""
            if min(A["len"], B["len"]) >= 20:
                inter = len(A["sh"] & B["sh"])
                jac = inter / max(1, len(A["sh"] | B["sh"]))
                con = inter / max(1, min(len(A["sh"]), len(B["sh"])))
            if rel and rel[0] >= 0.95 and rel[1] >= 0.95:
                verdict = "זהים בכל העמודים"
                jac = max(jac, 1.0)
            elif rel and rel[0] >= 0.95 and len(B["pages"]) > len(A["pages"]):
                verdict = "הראשון כלול בשני (לשני עמודים נוספים)"
                extra = "עמודים נוספים בשני: " + ",".join(map(str, rel[2]))
            elif rel and rel[1] >= 0.95 and len(A["pages"]) > len(B["pages"]):
                verdict = "השני כלול בראשון (לראשון עמודים נוספים)"
                extra = "עמודים נוספים בראשון: " + ",".join(map(str, rel[3]))
            elif rel and max(rel[0], rel[1]) >= 0.6:
                verdict = "חופפים חלקית (%d%% מהעמודים)" % round(100 * max(rel[0], rel[1]))
                jac = max(jac, max(rel[0], rel[1]) * 0.9)
            elif min(A["len"], B["len"]) >= 20 and jac >= AUTO:
                verdict = "כמעט זהים (טקסט)"
            elif min(A["len"], B["len"]) >= 20 and con >= CONTAIN:
                verdict = "האחד מכיל את השני (טקסט)"
            elif min(A["len"], B["len"]) >= 20 and jac >= 0.8:
                verdict = "דומים (טקסט)"
            elif A["len"] < 20 and B["len"] < 20 and abs(A["size"] - B["size"]) <= 0.02 * max(A["size"], B["size"]):
                verdict = "בלי טקסט, גודל זהה (לבדיקה בעין)"
            else:
                continue
            # איזה להשאיר: יותר טקסט, אחר כך יותר חברות משויכות, אחר כך החדש (מזהה גבוה)
            def key(d):
                return (cache[d["sha"]]["len"], len(d["companies"]), max(int(i) for i in d["ids"] if i.isdigit()) if any(i.isdigit() for i in d["ids"]) else 0)
            if verdict.startswith("הראשון כלול"):
                keep, drop = y, x
            elif verdict.startswith("השני כלול"):
                keep, drop = x, y
            else:
                keep, drop = (x, y) if key(x) >= key(y) else (y, x)
            page_based = verdict.startswith(("זהים", "הראשון כלול", "השני כלול", "חופפים"))
            contained = verdict.startswith(("הראשון כלול", "השני כלול"))
            score = con if contained else jac                 # למסמך כלול באחר מודדים כמה מהקטן נמצא בגדול (containment), לא דמיון כולל
            evidence = "טקסט" if score >= 0.9 else ("טקסט חלקי" if score >= 0.6 else ("חזותי בלבד" if page_based else "טקסט"))
            # הסרה אוטומטית: זהים/כמעט זהים, או מסמך שכלול באחר - רק כשהטקסט מאשר (דמיון 90% ומעלה). ראיה חזותית בלבד או חלקית: לבדיקה שלכם.
            # כשסיווגי המסמכים שונים (כללי מול פרטי) המסמך שנשאר יהפוך ל"כללי+פרטי" בעת הביצוע.
            auto = "הסר" if verdict in ("זהים בכל העמודים", "כמעט זהים (טקסט)") or (contained and con >= 0.9) else ""
            union = keep["types"] | drop["types"]
            merged = "כללי+פרטי" if union == {"כללי", "פרטי"} else (next(iter(union)) if union else "לא ידוע")
            rows.append({"company": biz[cid].get("registrar_name") or biz[cid].get("permit_name") or "", "chp": biz[cid].get("chp_number", ""), "business_id": cid,
                         "verdict": verdict, "similarity": round(jac, 2), "containment": round(con, 2),
                         "keep_file": keep["name"], "keep_ids": " ".join(keep["ids"]), "keep_types": "+".join(sorted(keep["types"])) or "לא ידוע", "keep_words": cache[keep["sha"]]["len"],
                         "remove_file": drop["name"], "remove_ids": " ".join(drop["ids"]), "remove_types": "+".join(sorted(drop["types"])) or "לא ידוע", "remove_words": cache[drop["sha"]]["len"],
                         "evidence": evidence, "merged_type": merged, "keep_pages": len(cache[keep["sha"]]["pages"]), "remove_pages": len(cache[drop["sha"]]["pages"]), "note": extra,
                         "remove_shared_with": max(0, len(drop["companies"]) - 1), "action": auto, "remove_sha": drop["sha"], "keep_sha": keep["sha"]})
    rows.sort(key=lambda r: (-r["similarity"], r["company"]))
    return rows


def apply_plan(a):
    from import_to_site import call
    token = os.environ.get("ADMIN_PASSWORD") or ""
    if not token and os.path.exists(a.password_file):
        token = (open(a.password_file, encoding="utf-8-sig").readline() or "").strip()
    existing = call(a.site, token, "/permit-docs")["docs"]
    by_sha = {d["sha256"]: d for d in existing}
    done = skipped = 0
    for r in m.read_csv(a.apply):
        if (r.get("action") or "").strip() != "הסר":
            continue
        doc = by_sha.get(r["remove_sha"])
        if not doc:
            print(f"  לא נמצא באתר: {r['remove_file']} ({r['remove_ids']}) - מדלג")
            skipped += 1
            continue
        bid = r["business_id"]
        others = [b for b in doc["business_ids"] if b != bid]
        keepdoc = by_sha.get(r.get("keep_sha", ""))
        try:
            if not others:
                call(a.site, token, "/permit-docs/" + doc["id"], method="DELETE")
                print(f"  נמחק: {r['remove_file']} ({r['company']})")
            else:
                call(a.site, token, "/permit-docs/" + doc["id"], json.dumps({"business_ids": others}).encode("utf-8"), "application/json", method="PUT")
                print(f"  בוטל שיוך: {r['remove_file']} מ-{r['company']} (נשאר משויך ל-{len(others)} חברות)")
            if keepdoc:             # המסמך שנשאר מכסה גם את הסיווג של המוסר (כללי + פרטי = שניהם)
                kt = {"general": {"כללי"}, "private": {"פרטי"}, "both": {"כללי", "פרטי"}}.get(keepdoc["doc_type"], set())
                dt = {"general": {"כללי"}, "private": {"פרטי"}, "both": {"כללי", "פרטי"}}.get(doc["doc_type"], set())
                u = kt | dt
                new_type = "both" if u == {"כללי", "פרטי"} else ("general" if u == {"כללי"} else ("private" if u == {"פרטי"} else ""))
                if new_type and new_type != keepdoc["doc_type"]:
                    call(a.site, token, "/permit-docs/" + keepdoc["id"], json.dumps({"doc_type": new_type}).encode("utf-8"), "application/json", method="PUT")
                    keepdoc["doc_type"] = new_type
                    print(f"    סיווג המסמך שנשאר ({r['keep_file']}): {new_type}")
            done += 1
        except urllib.error.HTTPError as e:
            print(f"  נכשל {r['remove_file']}: {e.code}")
            skipped += 1
    print(f"סיום: בוצעו {done}, דולגו {skipped}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--map", default="מיפוי_קבצים.csv")
    ap.add_argument("--final", default="סופי_מאוחד.csv")
    ap.add_argument("--businesses", default="businesses.json")
    ap.add_argument("--attachments", default="attachments.csv")
    ap.add_argument("--uploads", default=os.path.join("wp-content", "uploads"))
    ap.add_argument("--ocr-dir", default="ocr_text")
    ap.add_argument("--hash-cache", default="hashes_cache.json")
    ap.add_argument("--out", default="כפילויות_לחברות.csv")
    ap.add_argument("--apply", default="", help="קובץ דוח ערוך לביצוע")
    ap.add_argument("--site", default="https://harav-levin.pages.dev")
    ap.add_argument("--password-file", default="admin_password.txt")
    a = ap.parse_args()
    if a.apply:
        return apply_plan(a)
    rows = build_report(a)
    cols = ["company", "chp", "verdict", "evidence", "similarity", "containment", "merged_type", "keep_file", "keep_ids", "keep_types", "keep_words", "keep_pages",
            "remove_file", "remove_ids", "remove_types", "remove_words", "remove_pages", "note", "remove_shared_with", "action", "business_id", "remove_sha", "keep_sha"]
    with open(a.out, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        w.writerows(rows)
    c = collections.Counter(r["verdict"] for r in rows)
    print(f"{len(rows)} זוגות מסמכים דומים אצל {len({r['business_id'] for r in rows})} חברות -> {a.out}")
    print("  לפי סוג:", dict(c), "| מסומנים להסרה אוטומטית:", sum(1 for r in rows if r["action"] == "הסר"))
    print("בדקו את הדוח; בשורות שבהן אתם מסכימים כתבו בעמודה action: הסר. לביצוע: python dedupe_company_docs.py --apply " + a.out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
