# -*- coding: utf-8 -*-
"""
סיכום מהכיוון של החברות: לכל חברה במאגר - כמה מסמכים כללי וכמה פרטי משויכים, ומה חסר לפי מה שרשום במאגר.
  * שיוך: החברה שזוהתה בקובץ (business_id), ח.פ. שנמצא בקובץ ושייך למאגר, ובחירות מהדשבורד (החלטות_בדיקה.csv)
  * סוג המסמך: לפי מיקום הקובץ באתר. קובץ בלי מיקום באתר נספר כ"ללא מיקום" ונבדק רק אם חסר לחברה מסמך מהסוג הנדרש
  * ח.פ.-ים שנמצאו במסמכים אבל אינם במאגר: רק מספרי תאגידים (מתחילים ב-5); תעודות זהות של יחידים מסוננות. סיכום נפרד, עם ספרת ביקורת, מספר קבצים ודוגמאות קבצים (לבדיקה בחיפוש באתר)
  קלט:  סופי_מאוחד.csv, businesses.json, החלטות_בדיקה.csv
  פלט:  כיסוי_חברות.csv, חפ_לא_במאגר.csv   (קריאה בלבד: לא משייך ולא כותב למאגר)
    python coverage_report.py
"""
import argparse
import collections
import csv
import hashlib
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import match_pdfs as m  # noqa: E402

VIS = {"": "רק כללי", "פרטי": "יש גם פרטי", "רק פרטי": "רק פרטי"}
NEED = {"רק כללי": ("כללי",), "יש גם פרטי": ("כללי", "פרטי"), "רק פרטי": ("פרטי",)}


def hps_of(text):
    return [x.zfill(9) for x in re.findall(r"(?<!\d)(\d{8,9})(?!\d)", text or "")]


def file_hashes(attachments_csv, uploads, cache_path):
    """sha256 לכל קובץ (עם מטמון משותף לדשבורד: hashes_cache.json), כדי לזהות אותו קובץ שמופיע גם ברשימת הכללי וגם ברשימת הפרטי."""
    cache = {}
    if os.path.exists(cache_path):
        try:
            cache = json.load(open(cache_path, encoding="utf-8"))
        except (OSError, ValueError):
            cache = {}
    out = {}
    for r in (m.read_csv(attachments_csv) if os.path.exists(attachments_csv) else []):
        aid = r.get("ID")
        p = m.local_path(uploads, r.get("guid", ""))
        if not p or not os.path.exists(p):
            continue
        st = os.stat(p)
        c = cache.get(aid)
        if c and c[0] == st.st_size and c[1] == int(st.st_mtime):
            out[aid] = c[2]
            continue
        h = hashlib.sha256()
        with open(p, "rb") as f:
            for chunk in iter(lambda: f.read(1 << 20), b""):
                h.update(chunk)
        out[aid] = h.hexdigest()
        cache[aid] = [st.st_size, int(st.st_mtime), out[aid]]
    try:
        json.dump(cache, open(cache_path, "w", encoding="utf-8"))
    except OSError:
        pass
    return out


def is_company_hp(h):
    """מספר חברה/שותפות/עמותה מתחיל ב-5 (51, 52, 55, 56, 57, 58). מספרים אחרים עם ספרת ביקורת תקינה הם בדרך כלל תעודות זהות של יחידים - לא נשמרים ולא מסוכמים."""
    return h.startswith("5") and m.check_digit_ok(h)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--final", default="סופי_מאוחד.csv")
    ap.add_argument("--businesses", default="businesses.json")
    ap.add_argument("--decisions", default="החלטות_בדיקה.csv")
    ap.add_argument("--type-check", default="type_check.csv")
    ap.add_argument("--attachments", default="attachments.csv")
    ap.add_argument("--uploads", default=os.path.join("wp-content", "uploads"))
    ap.add_argument("--hash-cache", default="hashes_cache.json")
    ap.add_argument("--out", default="כיסוי_חברות.csv")
    ap.add_argument("--out-hps", default="חפ_לא_במאגר.csv")
    a = ap.parse_args()

    biz = {b["id"]: b for b in json.load(open(a.businesses, encoding="utf-8"))}
    by_chp = {str(b.get("chp_number") or "").zfill(9): b["id"] for b in biz.values() if b.get("chp_number")}
    dec = {r["attachment_id"]: r for r in m.read_csv(a.decisions)} if os.path.exists(a.decisions) else {}
    rows = m.read_csv(a.final)
    # מסמך שרשום בסוג אחד ונוסחו מצביע על הסוג השני: ייתכן שהוא מסמך משולב (כללי ופרטי ביחד)
    both = {}
    for r in (m.read_csv(a.type_check) if os.path.exists(a.type_check) else []):
        loc, tx = r.get("type_by_location"), r.get("text_check", "")
        if tx.startswith("נוסח משולב"):          # משפט המפתח של מסמך משולב: מכסה כללי ופרטי ביחד, בכל מיקום
            both[r["attachment_id"]] = "פרטי" if loc == "כללי" else "כללי"
        elif loc == "כללי" and (tx.startswith("יש נוסח פרטי") or tx.startswith("נוסח רק פרטי")):
            both[r["attachment_id"]] = "פרטי"        # רשום כללי, אבל נוסחו פרטי
        elif loc == "פרטי" and tx.startswith("אין נוסח פרטי"):
            both[r["attachment_id"]] = "כללי"        # רשום פרטי, אבל אין בו נוסח פרטי (כנראה נוסח כללי)
    # אותו קובץ בדיוק ברשימת הכללי וגם ברשימת הפרטי: מסמך אחד שמכסה את שני הסוגים
    hashes = file_hashes(a.attachments, a.uploads, a.hash_cache)
    by_hash = collections.defaultdict(list)
    for aid, h in hashes.items():
        by_hash[h].append(aid)
    type_of = {}
    for r in rows:
        t0 = (dec.get(r["attachment_id"], {}).get("type_answer") or r.get("doc_type_clean") or r.get("doc_type") or "").rstrip("?")
        if t0 in ("כללי", "פרטי"):
            type_of[r["attachment_id"]] = t0
    docs = collections.defaultdict(lambda: {"כללי": set(), "פרטי": set(), "ללא מיקום": set(), "אולי כללי": set(), "אולי פרטי": set()})
    same_file = collections.defaultdict(set)
    outside = collections.defaultdict(lambda: {"files": set(), "names": set()})
    for r in rows:
        aid = r["attachment_id"]
        d = dec.get(aid, {})
        t = (d.get("type_answer") or r.get("doc_type_clean") or r.get("doc_type") or "").rstrip("?")
        t = t if t in ("כללי", "פרטי") else "ללא מיקום"
        ids = set()
        if r.get("business_id"):
            ids.add(r["business_id"])
        for h in hps_of(r.get("doc_hps_in_db")):
            if h in by_chp:
                ids.add(by_chp[h])
        for x in (d.get("company_ids") or d.get("company_id") or "").split(";"):
            if x.strip() in biz:
                ids.add(x.strip())
        types = {t} if t in ("כללי", "פרטי") else set()
        for other in by_hash.get(hashes.get(aid), []):
            if other != aid and type_of.get(other) in ("כללי", "פרטי"):
                types.add(type_of[other])
        both_lists = len(types) == 2
        for bid in ids:
            for tt in (types or {t}):
                docs[bid][tt].add(aid)
            if both_lists:
                same_file[bid].add(aid)
            if aid in both:
                docs[bid]["אולי " + both[aid]].add(aid)
        for h in hps_of(r.get("doc_hps_not_in_db")):
            if not is_company_hp(h):
                continue
            outside[h]["files"].add(f"{aid}:{r.get('file', '')}")
    for d in dec.values():          # ח.פ.-ים שכתבת בהערות החלטות
        for h in hps_of(d.get("note")):
            if h not in by_chp and is_company_hp(h):
                outside[h]["files"].add(f"{d['attachment_id']}:{d.get('file', '')}")
                outside[h]["names"].add("מהערה בדשבורד")

    out = []
    for bid, b in biz.items():
        vis = VIS.get(b.get("visibility") or "", b.get("visibility") or "")
        need = NEED.get(vis, ("כללי",))
        d = docs.get(bid, {"כללי": set(), "פרטי": set(), "ללא מיקום": set(), "אולי כללי": set(), "אולי פרטי": set()})
        missing = [t for t in need if not d[t]]
        maybe = [t for t in missing if d["אולי " + t]]
        extra = [t for t in ("כללי", "פרטי") if d[t] and t not in need]
        if not missing and not extra:
            status = "מלא"
        elif missing and len(maybe) == len(missing):
            status = "חסר, אך ייתכן שמכוסה במסמך משולב"
        elif missing and d["ללא מיקום"]:
            status = "חסר, יש קבצים ללא מיקום לבדיקה"
        elif missing:
            status = "חסר"
        else:
            status = "יש מסמך מסוג שלא רשום במאגר"
        out.append({"company": b.get("registrar_name") or b.get("permit_name") or "", "chp": b.get("chp_number", ""), "registered": vis,
                    "general": len(d["כללי"]), "private": len(d["פרטי"]), "no_location": len(d["ללא מיקום"]),
                    "missing": " + ".join(missing), "same_file_in_both_lists": " ".join(sorted(same_file.get(bid, []))), "maybe_covered_by_combined_doc": " ".join(sorted(set().union(*[d["אולי " + t] for t in maybe]))) if maybe else "", "extra_type": " + ".join(extra), "status": status,
                    "files_no_location": " ".join(sorted(d["ללא מיקום"]) if missing else [])})
    order = {"חסר": 0, "חסר, אך ייתכן שמכוסה במסמך משולב": 0.5, "חסר, יש קבצים ללא מיקום לבדיקה": 1, "יש מסמך מסוג שלא רשום במאגר": 2, "מלא": 3}
    out.sort(key=lambda r: (order[r["status"]], r["company"]))
    with open(a.out, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(out[0].keys()))
        w.writeheader()
        w.writerows(out)
    cnt = collections.Counter(r["status"] for r in out)
    print(f"{len(out)} חברות -> {a.out}")
    for k in order:
        print(f"  {k}: {cnt.get(k, 0)}")
    miss_g = sum(1 for r in out if "כללי" in r["missing"])
    miss_p = sum(1 for r in out if "פרטי" in r["missing"])
    print(f"  חסר מסמך כללי: {miss_g} | חסר מסמך פרטי: {miss_p}")

    hp_rows = []
    for h, v in outside.items():
        ok = m.check_digit_ok(h)
        hp_rows.append({"chp": h, "check_digit_ok": "כן" if ok else "לא", "files_count": len(v["files"]),
                        "examples": " | ".join(sorted(v["files"])[:3]), "source": ";".join(sorted(v["names"]))})
    hp_rows.sort(key=lambda r: (r["check_digit_ok"] != "כן", -r["files_count"]))
    with open(a.out_hps, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["chp", "check_digit_ok", "files_count", "examples", "source"])
        w.writeheader()
        w.writerows(hp_rows)
    print(f"{len(hp_rows)} ח.פ.-ים במסמכים שאינם במאגר ({sum(1 for r in hp_rows if r['check_digit_ok'] == 'כן')} תקינים) -> {a.out_hps}")


if __name__ == "__main__":
    sys.exit(main())
