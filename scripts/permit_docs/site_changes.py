# -*- coding: utf-8 -*-
"""
אילו שינויים ידניים נעשו באתר (בעבר ובהווה): קריאה בלבד, לא משנה כלום.
האתר לא שומר היסטוריה, ולכן המצב הנוכחי מושווה ל"בסיס": מה שהיה אמור להיות לפי הפוסטים באתר הישן (חברה לפי כותרת הפוסט)
והחלטות הבדיקה המקומיות. כל הבדל הוא שינוי ידני: שיוך שנוסף, שיוך שהוסר, סיווג שונה, "לא קשור", הערה, חברה שאינה במאגר, אג"ח, "אחר".

  python site_changes.py

פלט: שינויים_באתר.csv + סיכום בחלון. עמודת "מתי": אם עדכון המסמך האחרון באתר נעשה בדקה שבה עודכנו עשרות מסמכים (הרצת סקריפט, לא שינוי ידני) - "לא ידוע (הרצת סקריפט)".
"""
import argparse
import collections
import csv
import getpass
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import match_pdfs as m  # noqa: E402
from coverage_report import file_hashes  # noqa: E402
from import_to_site import call  # noqa: E402

TL = {"general": "כללי", "private": "רק פרטי", "both": "פרטי", "unknown": "לא ידוע", "other": "לא קשור / לא היתר"}
ORIG_TYPE = {"g": "general", "p": "both", "gp": "both"}      # רשימת הפרטי באתר הישן = "פרטי" (מכסה גם כללי)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--site", default="https://harav-levin.pages.dev")
    ap.add_argument("--decisions", default="החלטות_בדיקה.csv")
    ap.add_argument("--businesses", default="businesses.json")
    ap.add_argument("--attachments", default="attachments.csv")
    ap.add_argument("--uploads", default=os.path.join("wp-content", "uploads"))
    ap.add_argument("--hash-cache", default="hashes_cache.json")
    ap.add_argument("--password-file", default="admin_password.txt")
    ap.add_argument("--out", default="שינויים_באתר.csv")
    ap.add_argument("--bulk", type=int, default=12, help="דקה שבה עודכנו לפחות כך מסמכים נחשבת הרצת סקריפט, לא שינוי ידני")
    a = ap.parse_args()

    biz = json.load(open(a.businesses, encoding="utf-8"))
    by_id = {b["id"]: b for b in biz}
    name_of = lambda i: (by_id.get(i, {}).get("registrar_name") or by_id.get(i, {}).get("permit_name") or i)  # noqa: E731
    hashes = file_hashes(a.attachments, a.uploads, a.hash_cache)
    local = collections.defaultdict(set)
    for r in (m.read_csv(a.decisions) if os.path.exists(a.decisions) else []):
        sha = hashes.get(r.get("attachment_id"))
        for i in [x.strip() for x in ((r.get("company_ids") or "") + ";" + (r.get("company_id") or "")).split(";") if x.strip()]:
            if sha and i in by_id:
                local[sha].add(i)

    token = os.environ.get("ADMIN_PASSWORD") or ""
    if not token and os.path.exists(a.password_file):
        with open(a.password_file, encoding="utf-8-sig") as f:
            token = (f.readline() or "").strip()
    token = token or getpass.getpass("סיסמת מנהל האתר: ")
    docs = call(a.site, token, "/permit-docs")["docs"]
    ext = {x["id"]: x for x in call(a.site, token, "/permit-ext").get("companies", [])}

    minute = collections.Counter(str(d.get("updated_at") or "")[:16] for d in docs)
    def when(d):
        u = str(d.get("updated_at") or "")
        return "לא ידוע (הרצת סקריפט)" if minute[u[:16]] >= a.bulk else u
    rows, cnt, tp, notes = [], collections.Counter(), collections.Counter(), collections.Counter()
    def add(d, kind, detail):
        cnt[kind] += 1
        rows.append([d.get("original_name", ""), d["id"], kind, detail, when(d)])

    for d in docs:
        try:
            it = json.loads(d.get("intel") or "{}")
        except ValueError:
            it = {}
        base = set(it.get("tb") or []) | local.get(d.get("sha256"), set())
        have = set(d.get("business_ids") or [])
        label = lambda ids: "; ".join(sorted(name_of(i) for i in ids))  # noqa: E731
        explained = {x["b"]: ", ".join(x.get("w") or []) for x in (it.get("s") or []) if any(k in " ".join(x.get("w") or []) for k in ("ח.פ.", "שם החברה", "זיהוי לפי תוכן"))}
        extra = have - base
        if extra & set(explained):
            add(d, "שיוך שנוסף, מוסבר לפי תוכן המסמך (ח.פ. / שם בתוך המסמך)", "; ".join(f"{name_of(i)} ({explained[i]})" for i in sorted(extra & set(explained))))
        if extra - set(explained):
            add(d, "שיוך שנוסף ידנית (בלי הסבר מתוכן המסמך)", label(extra - set(explained)))
        if base - have and (it.get("o") in ("g", "p", "gp") or local.get(d.get("sha256"))):
            add(d, "שיוך מהפוסט / מהבדיקה המקומית שלא קיים באתר (הוסר או לא נקלט)", label(base - have))
        if d.get("doc_type") == "other":
            add(d, "סומן 'לא קשור / לא היתר'", d.get("note") or "")
        o = it.get("o")
        if o in ORIG_TYPE and d.get("doc_type") not in (ORIG_TYPE[o], "both", "other") and d.get("doc_type") != "unknown":
            tp[(o, d.get("doc_type"))] += 1
            add(d, "סיווג שונה מהרשימה שבה הופיע", f"היה ברשימת {'הכללי' if o == 'g' else 'הפרטי'}, מסווג כעת: {TL.get(d.get('doc_type'), d.get('doc_type'))}")
        if d.get("note") and d.get("doc_type") != "other":
            notes[str(d["note"])[:14]] += 1
            add(d, "הערה", str(d["note"])[:150])
        if d.get("ext_ids"):
            add(d, "משויך לחברה שאינה במאגר", "; ".join(ext[i]["name"] for i in d["ext_ids"] if i in ext))
        # ---- סתירות פנימיות באתר (בין שינויים שונים) ----
        slots = d.get("slots") or {}
        if d.get("doc_type") == "other" and (have or d.get("ext_ids") or any(slots.values())):
            add(d, "סתירה: סומן 'לא קשור' אבל משויך לחברה", label(have) or "חברה שאינה במאגר")
        for bid, sl in slots.items():
            vis = (by_id.get(bid) or {}).get("visibility") or ""
            parts = [x for x in str(sl).split(",") if x]
            if "private" in parts and vis == "":
                add(d, "סתירה: הת\"ע פרטי לחברה שרשומה 'רק כללי'", name_of(bid))
            if "general" in parts and vis == "רק פרטי":
                add(d, "סתירה: הת\"ע כללי לחברה שרשומה 'רק פרטי'", name_of(bid))
            if "private" in parts and d.get("doc_type") == "general":
                add(d, "סתירה: סלוט פרטי למסמך שמסווג 'כללי'", name_of(bid))
            if "general" in parts and d.get("doc_type") == "private":
                add(d, "סתירה: סלוט כללי למסמך שמסווג 'רק פרטי'", name_of(bid))
        if d.get("bonds"):
            add(d, 'משויך לאג"ח', "; ".join((x.get("symbol") or x.get("name") or "") for x in d["bonds"]))
        if d.get("specials"):
            add(d, "סיווג 'אחר'", "; ".join(f"{name_of(b)}: {(v or {}).get('title', '')}" for b, v in d["specials"].items()))
    with open(a.out, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(["קובץ", "מזהה באתר", "סוג שינוי", "פירוט", "מתי"])
        w.writerows(sorted(rows, key=lambda r: (r[2], r[0])))
    print(f"מסמכים באתר: {len(docs)}")
    for k, v in cnt.most_common():
        print(f"  {k}: {v}")
    print("סיווג שונה מהרשימה (מקור ← סיווג נוכחי): " + ", ".join(f"{'כללי' if k[0] == 'g' else 'פרטי'}←{TL.get(k[1], k[1])}: {v}" for k, v in tp.most_common(6)))
    print("תחילת ההערות השכיחות: " + " | ".join(f"{k.strip()} ({v})" for k, v in notes.most_common(6)))
    print(f"נכתב: {a.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
