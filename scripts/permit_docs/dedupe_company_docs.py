# -*- coding: utf-8 -*-
"""
בדיקת כפילויות בין מסמכים שונים של אותה חברה (קבצים זהים בייט-בייט כבר מאוחדים; כאן נבדקים מסמכים שונים בקובץ אבל דומים בתוכן:
סריקה חוזרת, גרסה כפולה, מסמך שמכיל את חברו). רץ על המחשב המקומי.
  קלט: מיפוי_קבצים.csv, attachments.csv, wp-content\\uploads, ocr_text\\ (טקסט שכבר נקרא), businesses.json
  שלב 1 (דוח, ברירת מחדל):  python dedupe_company_docs.py
        כותב כפילויות_לחברות.csv: לכל זוג מסמכים של אותה חברה - דמיון בתוכן, איזה כדאי להשאיר, ועמודה action
        (מולאה "הסר" אוטומטית רק כשהדמיון גבוה מאוד, 90% ומעלה; בשאר השורות ריקה: להחלטתך - כתוב "הסר" כדי להסיר את remove_file)
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

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import match_pdfs as m  # noqa: E402
from coverage_report import file_hashes  # noqa: E402

AUTO = 0.90      # דמיון (Jaccard על רצפי 3 מילים) שממנו מוצעת הסרה אוטומטית
SHOW = 0.55      # מתחת לזה לא מדווחים
CONTAIN = 0.90   # מסמך אחד מכיל את השני (גרסה חלקית)


def words(text):
    t = re.sub(r"[^א-ת0-9a-zA-Z]+", " ", (text or "").lower())
    return t.split()


def shingles(ws, n=3):
    return {" ".join(ws[i:i + n]) for i in range(max(0, len(ws) - n + 1))}


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
                cache[d["sha"]] = {"len": len(ws), "sh": shingles(ws), "size": os.path.getsize(d["path"])}
        for x, y in itertools.combinations(ds, 2):
            A, B = cache[x["sha"]], cache[y["sha"]]
            if min(A["len"], B["len"]) >= 20:
                inter = len(A["sh"] & B["sh"])
                jac = inter / max(1, len(A["sh"] | B["sh"]))
                con = inter / max(1, min(len(A["sh"]), len(B["sh"])))
                if jac >= AUTO:
                    verdict = "כמעט זהים"
                elif con >= CONTAIN:
                    verdict = "האחד מכיל את השני"
                elif jac >= SHOW:
                    verdict = "דומים"
                else:
                    continue
            elif A["len"] < 20 and B["len"] < 20 and abs(A["size"] - B["size"]) <= 0.02 * max(A["size"], B["size"]):
                jac = con = 0.0
                verdict = "בלי טקסט, גודל זהה (לבדיקה בעין)"
            else:
                continue
            # איזה להשאיר: יותר טקסט, אחר כך יותר חברות משויכות, אחר כך החדש (מזהה גבוה)
            def key(d):
                return (cache[d["sha"]]["len"], len(d["companies"]), max(int(i) for i in d["ids"] if i.isdigit()) if any(i.isdigit() for i in d["ids"]) else 0)
            keep, drop = (x, y) if key(x) >= key(y) else (y, x)
            auto = "הסר" if verdict == "כמעט זהים" and jac >= AUTO and drop["types"] <= keep["types"] | set() else ""
            rows.append({"company": biz[cid].get("registrar_name") or biz[cid].get("permit_name") or "", "chp": biz[cid].get("chp_number", ""), "business_id": cid,
                         "verdict": verdict, "similarity": round(jac, 2), "containment": round(con, 2),
                         "keep_file": keep["name"], "keep_ids": " ".join(keep["ids"]), "keep_types": "+".join(sorted(keep["types"])) or "לא ידוע", "keep_words": cache[keep["sha"]]["len"],
                         "remove_file": drop["name"], "remove_ids": " ".join(drop["ids"]), "remove_types": "+".join(sorted(drop["types"])) or "לא ידוע", "remove_words": cache[drop["sha"]]["len"],
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
        try:
            if not others:
                call(a.site, token, "/permit-docs/" + doc["id"], method="DELETE")
                print(f"  נמחק: {r['remove_file']} ({r['company']})")
            else:
                call(a.site, token, "/permit-docs/" + doc["id"], json.dumps({"business_ids": others}).encode("utf-8"), "application/json", method="PUT")
                print(f"  בוטל שיוך: {r['remove_file']} מ-{r['company']} (נשאר משויך ל-{len(others)} חברות)")
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
    cols = ["company", "chp", "verdict", "similarity", "containment", "keep_file", "keep_ids", "keep_types", "keep_words",
            "remove_file", "remove_ids", "remove_types", "remove_words", "remove_shared_with", "action", "business_id", "remove_sha", "keep_sha"]
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
