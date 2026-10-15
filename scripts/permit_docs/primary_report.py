# -*- coding: utf-8 -*-
"""
בדיקה בלבד (לא משנה כלום): מה יהיה מצב החברות אם נותנים עדיפות ל"מסמך ראשי" - הקובץ שהופיע באתר הישן בפוסט של החברה עצמה (שם הפוסט = שם החברה).
מסמך שהגיע לחברה רק לפי ח.פ. / שם בטקסט / שיוך ידני נחשב "משני": לא דורש טיפול כל עוד יש ראשי ברור.
  python primary_report.py          -> סיכום בחלון + מצב_חברות_ראשי.csv
קלט: האתר (מסמכים וחברות), סופי_מאוחד.csv (פוסט ושם הפוסט לכל קובץ)
"""
import argparse
import collections
import csv
import getpass
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from import_to_site import call, rd  # noqa: E402

NEED = {"": ("general",), "פרטי": ("general", "private"), "רק פרטי": ("private",)}
HE = {"general": "כללי", "private": "פרטי"}
INACTIVE = ("מחוקה", "נגרעה", "מחוסלת", "בפרוק")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--site", default="https://harav-levin.pages.dev")
    ap.add_argument("--final", default="סופי_מאוחד.csv")
    ap.add_argument("--password-file", default="admin_password.txt")
    ap.add_argument("--out", default="מצב_חברות_ראשי.csv")
    a = ap.parse_args()
    token = os.environ.get("ADMIN_PASSWORD") or ""
    if not token and os.path.exists(a.password_file):
        with open(a.password_file, encoding="utf-8-sig") as f:
            token = (f.readline() or "").strip()
    token = token or getpass.getpass("סיסמת מנהל האתר: ")
    biz = call(a.site, token, "/businesses")
    docs = call(a.site, token, "/permit-docs")["docs"]
    # (קובץ, חברה) שהם ראשיים: הפוסט שלו באתר הישן נושא את שם החברה
    prim = collections.defaultdict(set)
    for r in rd(a.final):
        if r.get("business_id") and r.get("title_business") and not r.get("title_differs"):
            prim[r["business_id"]].add(r["attachment_id"])
    by = collections.defaultdict(list)
    for d in docs:
        ids = set((d.get("source_ref") or "").replace("wp:", "").split(","))
        for b in d.get("business_ids") or []:
            by[b].append((d, bool(ids & prim.get(b, set()))))
    rows, cnt = [], collections.Counter()
    for b in biz:
        if (b.get("entity_type") or "company") != "company":
            continue
        need = NEED.get((b.get("visibility") or "").strip(), ("general",))
        st = b.get("registry_status") or ""
        ds = [(d, p) for d, p in by.get(b["id"], []) if d["doc_type"] != "other"]
        problems, miss = [], []
        for t in need:
            cov = [(d, p) for d, p in ds if d["doc_type"] in (t, "both")]
            pr = [d for d, p in cov if p]
            if not cov:
                miss.append(HE[t])
            elif len(pr) > 1:
                problems.append(f"כמה ראשיים ({HE[t]})")
            elif not pr and len(cov) > 1:
                problems.append(f"אין ראשי, כמה משניים ({HE[t]})")
        if any(x in st for x in INACTIVE):
            status = "לא פעילה ברשם"
        elif miss and not ds:
            status = "חסר: אין אף מסמך"
        elif miss:
            unk = any(d["doc_type"] == "unknown" for d, p in ds)
            status = ("חסר סיווג: " if unk else "חסר: ") + " + ".join(miss)
        elif problems:
            status = "לסידור: " + ", ".join(problems)
        else:
            nprim = sum(1 for d, p in ds if p)
            status = "תקין (ראשי ברור)" if nprim else "תקין (מסמך יחיד לכל סוג, ללא ראשי)"
        extra = sum(1 for d, p in ds if not p)
        cnt[("לסידור: " + ("כמה ראשיים" if any(x.startswith("כמה") for x in problems) else "אין ראשי, כמה משניים")) if status.startswith("לסידור") else status] += 1
        rows.append([b.get("registrar_name") or b.get("permit_name") or "", b.get("chp_number") or "", "כללי+פרטי" if len(need) == 2 else HE[need[0]], st, status, len(ds), extra,
                     " | ".join(f"{d['original_name']} ({ {'general': 'כללי', 'private': 'פרטי', 'both': 'כללי+פרטי', 'unknown': 'לא ידוע'}.get(d['doc_type'], d['doc_type']) }{', ראשי' if p else ''})" for d, p in ds)])
    rows.sort(key=lambda r: (r[4].startswith("תקין"), r[4], r[0]))
    with open(a.out, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(["company", "chp", "required", "registry_status", "status", "docs_count", "secondary_docs", "docs"])
        w.writerows(rows)
    print(f"{len(rows)} חברות:")
    for k, v in cnt.most_common():
        print(f"  {k}: {v}")
    print(f"פירוט: {a.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
