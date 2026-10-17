# -*- coding: utf-8 -*-
"""
שלב 1, 2 ו-4: בניית רשימת המסמכים מהאתר הישן, סריקת טעויות, ומאגר המסמכים הנוספים עם הצעות שיוך (קריאה בלבד; לא משנה כלום באתר בלי --go).
  python build_cases.py            -> ארבעה קבצי CSV + סיכום בחלון
  python build_cases.py --go       -> גם שומר באתר (לכל מסמך: מקור, שם הפוסט, ממצאים והצעות שיוך), כדי שהדשבורד יציג אותם. דורש מיגרציה 0011.

קלט (מהתיקייה הנוכחית): סופי_מאוחד.csv, החלטות_בדיקה.csv (השיוך הידני שלך), businesses.json, attachments.csv, wp-content\\uploads, ocr_text\\

פלט:
  1) אתר_ישן_מסמכים.csv  - כל המסמכים משני המאגרים (כללי + פרטי): מקור, שם הפוסט, והחברה לפי שם הפוסט
  2) בדיקת_מסמכים.csv    - טעויות אפשריות: ח.פ. לא תואם / ספרת ביקורת שגויה / שם שונה / חסר משפט מפתח בהיתר פרטי / בלי טקסט
  3) מסמכים_נוספים.csv   - מסמכים שלא היו באף אחד משני המאגרים, עם הצעות שיוך (שיוך ידני שלך + ח.פ. + שמות בתוך המסמך)
  4) hp_ocr_טעויות.csv   - (נכלל בבדיקה) מספרי ח.פ. שנראים כטעות הקלדה של ח.פ. החברה
"""
import argparse
import collections
import csv
import getpass
import json
import os
import re
import sys

try:
    import pymupdf as fitz
except ImportError:
    import fitz

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import match_pdfs as m  # noqa: E402
from coverage_report import file_hashes  # noqa: E402
from import_to_site import call  # noqa: E402

ORIGIN = {"main_ducuments": "g", "privet_ducuments": "p", "company": "p"}
ORIGIN_HE = {"g": "כללי", "p": "פרטי", "gp": "כללי + פרטי", "x": "נוסף"}
FLAG_HE = {
    "hp_missing": "ח.פ. החברה לא מופיע במסמך",
    "hp_typo": "ח.פ. שנראה כטעות הקלדה של ח.פ. החברה",
    "hp_bad": "מספר ח.פ. עם ספרת ביקורת שגויה",
    "name_differs": "שם הפוסט שונה משם החברה במסמך",
    "status": "זיהוי החברה לא חד-משמעי",
    "no_private_phrase": "בהיתר פרטי חסר משפט מפתח של נוסח פרטי",
    "no_text": "אין טקסט קריא במסמך",
}


def rd(path):
    return m.read_csv(path) if path and os.path.exists(path) else []


def hp_ok(n):
    return len(n) == 9 and m.check_digit_ok(n)


def hamming(a, b):
    return sum(x != y for x, y in zip(a, b)) if len(a) == len(b) else 99


def doc_text(aid, path, ocr_dirs):
    t = ""
    for od in ocr_dirs:
        p = os.path.join(od, f"{aid}.txt")
        if os.path.exists(p):
            try:
                t += "\n" + open(p, encoding="utf-8").read()
            except OSError:
                pass
    if len(t.strip()) < 80 and path and os.path.exists(path):
        try:
            pdf = fitz.open(path)
            t += "\n".join(pdf[i].get_text() or "" for i in range(min(len(pdf), 12)))
            pdf.close()
        except Exception:  # noqa: BLE001
            pass
    return t


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--site", default="https://harav-levin.pages.dev")
    ap.add_argument("--final", default="סופי_מאוחד.csv")
    ap.add_argument("--decisions", default="החלטות_בדיקה.csv")
    ap.add_argument("--businesses", default="businesses.json")
    ap.add_argument("--attachments", default="attachments.csv")
    ap.add_argument("--uploads", default=os.path.join("wp-content", "uploads"))
    ap.add_argument("--hash-cache", default="hashes_cache.json")
    ap.add_argument("--ocr-dirs", default="ocr_text,ocr_text_p2")
    ap.add_argument("--password-file", default="admin_password.txt")
    ap.add_argument("--go", action="store_true")
    a = ap.parse_args()

    biz = json.load(open(a.businesses, encoding="utf-8"))
    by_id = {b["id"]: b for b in biz}
    name_of = lambda i: (by_id.get(i, {}).get("registrar_name") or by_id.get(i, {}).get("permit_name") or "")  # noqa: E731
    by_chp = {str(b.get("chp_number") or "").zfill(9): b["id"] for b in biz if b.get("chp_number")}
    names = collections.defaultdict(set)
    for b in biz:
        for raw in (b.get("registrar_name"), b.get("permit_name")):
            for part in re.split(r"[;|\n/]+", raw or ""):
                n = m.norm(part)
                if n:
                    names[n].add(b["id"])
    one = lambda n: next(iter(names[n])) if len(names.get(n, ())) == 1 else None  # noqa: E731
    guid = {r["ID"]: r.get("guid", "") for r in rd(a.attachments)}
    hashes = file_hashes(a.attachments, a.uploads, a.hash_cache)
    manual = {}
    for r in rd(a.decisions):
        ids = [x.strip() for x in ((r.get("company_ids") or "") + ";" + (r.get("company_id") or "")).split(";") if x.strip() in by_id]
        if ids:
            manual[r["attachment_id"]] = list(dict.fromkeys(ids))
    ocr_dirs = [x.strip() for x in a.ocr_dirs.split(",")]
    rows = rd(a.final)
    docs = collections.OrderedDict()                  # sha -> מידע מצטבר
    for r in rows:
        aid = r["attachment_id"]
        sha = hashes.get(aid)
        if not sha:
            continue
        d = docs.setdefault(sha, {"sha": sha, "aids": [], "files": [], "origins": set(), "titles": [], "tbids": [], "flags": {}, "sug": {}, "manual": [], "path": None})
        d["aids"].append(aid)
        d["files"].append(r.get("file", ""))
        org = ORIGIN.get(r.get("post_type"), "x")
        d["origins"].add(org)
        if org != "x" and r.get("post_title"):
            d["titles"].append(r["post_title"])
        p = m.local_path(a.uploads, guid.get(aid, ""))
        d["path"] = d["path"] or (p if p and os.path.exists(p) else None)
        tb = one(m.norm(r.get("title_business") or "")) if r.get("title_business") else None
        if tb and org != "x" and tb not in d["tbids"]:
            d["tbids"].append(tb)
        sug = d["sug"]

        def add(bid, score, why):
            if not bid or bid not in by_id:
                return
            e = sug.setdefault(bid, [0.0, []])
            e[0] = max(e[0], score) + (0.4 if e[1] else 0)
            if why not in e[1]:
                e[1].append(why)
        for bid in manual.get(aid, []):
            add(bid, 6, "שיוך ידני שלך")
            if bid not in d["manual"]:
                d["manual"].append(bid)
        if tb:
            add(tb, 3.5, "שם הפוסט: " + (r.get("post_title") or ""))
        hps_in = [x for x in (r.get("doc_hps_in_db") or "").split() if x]
        for h in hps_in:
            add(by_chp.get(h.zfill(9)), 4, "ח.פ. " + h + " במסמך")
        for nm in (r.get("doc_name_matches") or "").split("|"):
            n = m.norm(nm)
            if n:
                add(one(n), 2.5, "שם החברה במסמך")
        src = r.get("sources") or ""
        if r.get("business_id") and ("H" in src or "N" in src):
            add(r["business_id"], 2, "זיהוי לפי תוכן המסמך")
        # ---- ממצאים ----
        fl = d["flags"]

        def flag(code, detail=""):
            fl.setdefault(code, [])
            if detail and detail not in fl[code]:
                fl[code].append(detail)
        tchp = str(by_id[tb].get("chp_number") or "").zfill(9) if tb and by_id[tb].get("chp_number") else ""
        hps_out = [x for x in (r.get("doc_hps_not_in_db") or "").split() if x]
        if org != "x" and tchp and (hps_in or hps_out) and tchp not in [h.zfill(9) for h in hps_in]:
            flag("hp_missing", "ח.פ. החברה " + tchp + "; במסמך: " + " ".join(hps_in + hps_out))
        if r.get("title_differs") == "כן":
            flag("name_differs", f"פוסט: {r.get('post_title')} | במסמך: {r.get('business_name')}")
        if r.get("status") in ("סתירה", "לא זוהה") and org != "x":
            flag("status", r.get("status") + (" · " + r["review_reasons"][:120] if r.get("review_reasons") else ""))
        tc = r.get("text_check") or ""
        if org == "p" and "אין נוסח פרטי" in tc:
            flag("no_private_phrase", "מיקום: רשימת הפרטי")
        try:
            tchars = int(r.get("text_chars") or 0)
        except ValueError:
            tchars = 0
        if r.get("text_source") == "אין" or tchars < 80:
            flag("no_text")
    # ---- בדיקת מספרי ח.פ. בטקסט: ספרת ביקורת שגויה / דומה לח.פ. של החברה ----
    for n, d in enumerate(docs.values(), 1):
        tchps = [str(by_id[b].get("chp_number") or "").zfill(9) for b in d["tbids"] if by_id[b].get("chp_number")]
        if d["origins"] - {"x"} and tchps:
            text = doc_text(d["aids"][0], d["path"], ocr_dirs)
            for h in dict.fromkeys(re.findall(r"(?<!\d)(5\d{8})(?!\d)", text.replace(",", ""))):
                if hp_ok(h):
                    continue
                near = [c for c in tchps if hamming(h, c) <= 2]
                if near:
                    d["flags"].setdefault("hp_typo", []).append(f"במסמך {h}, ח.פ. החברה {near[0]}")
                else:
                    d["flags"].setdefault("hp_bad", []).append(h)
        if n % 300 == 0:
            print(f"  נסרקו {n}/{len(docs)}", flush=True)
    # ---- פלט ----
    def origin_of(d):
        o = d["origins"] - {"x"}
        return "x" if not o else ("gp" if o == {"g", "p"} else next(iter(o)))
    out1, out2, out3, intel = [], [], [], {}
    for sha, d in docs.items():
        o = origin_of(d)
        sug = sorted(([b, round(v[0], 1), v[1]] for b, v in d["sug"].items()), key=lambda x: -x[1])[:8]
        titles = list(dict.fromkeys(d["titles"]))
        intel[sha] = {"o": o, "t": titles[:3], "tb": d["tbids"][:4], "f": [{"c": c, "d": "; ".join(v)[:200]} for c, v in d["flags"].items()],
                      "s": [{"b": b, "s": s_, "w": w[:3]} for b, s_, w in sug[:6]], "m": d["manual"][:6]}
        files = " | ".join(dict.fromkeys(d["files"]))
        if o != "x":
            out1.append([sha[:12], files, " ".join(d["aids"]), ORIGIN_HE[o], " | ".join(titles), " | ".join(name_of(b) for b in d["tbids"]),
                         " | ".join(str(by_id[b].get("chp_number") or "") for b in d["tbids"]), len(d["aids"]), len(d["flags"])])
            for c, v in d["flags"].items():
                out2.append([sha[:12], files, ORIGIN_HE[o], " | ".join(name_of(b) for b in d["tbids"]) or " | ".join(titles), FLAG_HE[c], "; ".join(v)[:300]])
        else:
            out3.append([sha[:12], files, " ".join(d["aids"]), " | ".join(f"{name_of(b)} ({s_}: {', '.join(w)})" for b, s_, w in sug[:4]) or "אין הצעה", "כן" if d["manual"] else ""])

    def w(path, head, data):
        with open(path, "w", encoding="utf-8-sig", newline="") as f:
            cw = csv.writer(f)
            cw.writerow(head)
            cw.writerows(data)
    w("אתר_ישן_מסמכים.csv", ["sha", "files", "attachment_ids", "origin", "post_titles", "company_by_title", "chp", "copies", "flags"], out1)
    w("בדיקת_מסמכים.csv", ["sha", "files", "origin", "company", "finding", "detail"], out2)
    w("מסמכים_נוספים.csv", ["sha", "files", "attachment_ids", "suggestions", "manual_assignment"], out3)
    cnt = collections.Counter(r[4] for r in out2)
    print(f"מסמכים ייחודיים: {len(docs)} | מהאתר הישן (כללי / פרטי): {len(out1)} | נוספים: {len(out3)} (מהם עם הצעת שיוך: {sum(1 for r in out3 if r[3] != 'אין הצעה')}, עם שיוך ידני: {sum(1 for r in out3 if r[4])})")
    print(f"מסמכים משני המאגרים: {sum(1 for r in out1 if r[3] == 'כללי + פרטי')} | רק כללי: {sum(1 for r in out1 if r[3] == 'כללי')} | רק פרטי: {sum(1 for r in out1 if r[3] == 'פרטי')}")
    print(f"מסמכים בלי חברה לפי שם הפוסט: {sum(1 for r in out1 if not r[5])}")
    for k, v in cnt.most_common():
        print(f"  ממצא: {k}: {v}")
    print("נכתבו: אתר_ישן_מסמכים.csv, בדיקת_מסמכים.csv, מסמכים_נוספים.csv")
    if not a.go:
        print("לשמירה באתר (לדשבורד): python build_cases.py --go")
        return 0
    token = os.environ.get("ADMIN_PASSWORD") or ""
    if not token and os.path.exists(a.password_file):
        with open(a.password_file, encoding="utf-8-sig") as f:
            token = (f.readline() or "").strip()
    token = token or getpass.getpass("סיסמת מנהל האתר: ")
    site = {x["sha256"]: x["id"] for x in call(a.site, token, "/permit-docs")["docs"]}
    ok = fail = miss = 0
    for n, (sha, it) in enumerate(intel.items(), 1):
        did = site.get(sha)
        if not did:
            miss += 1
            continue
        try:
            call(a.site, token, "/permit-docs/" + did, json.dumps({"intel": it}, ensure_ascii=False).encode("utf-8"), "application/json", method="PUT")
            ok += 1
        except Exception as e:  # noqa: BLE001
            fail += 1
            print(f"  נכשל {sha[:12]}: {e}")
        if n % 100 == 0:
            print(f"  {n}/{len(intel)} (נשמרו {ok}, נכשלו {fail}, לא באתר {miss})", flush=True)
    print(f"נשמרו {ok}; לא נמצאו באתר {miss}; נכשלו {fail}")
    return 0 if not fail else 2


if __name__ == "__main__":
    sys.exit(main())
