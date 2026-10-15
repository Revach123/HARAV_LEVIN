# -*- coding: utf-8 -*-
"""
מצב המסמכים לכל חברה, לפי מה שכבר באתר (קריאה בלבד): כמה חברות תקינות, כמה חסר להן מסמך, וכמה צריכות סידור ידני.
  python company_status.py            -> סיכום בחלון + מצב_חברות.csv
כלל: חברה שרשומה "כללי בלבד" דורשת מסמך כללי; "יש גם פרטי" דורשת כללי ופרטי. מסמך משולב (כללי+פרטי) מכסה את שניהם.
חברות שנמחקו / בפרוק / מחוסלות ברשם נספרות בנפרד (לא דורשות מסמך).
"""
import argparse
import collections
import csv
import getpass
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from import_to_site import call  # noqa: E402

NEED = {"": ("general",), "פרטי": ("general", "private"), "רק פרטי": ("private",)}
HE = {"general": "כללי", "private": "פרטי"}
INACTIVE = ("מחוקה", "נגרעה", "מחוסלת", "בפרוק")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--site", default="https://harav-levin.pages.dev")
    ap.add_argument("--password-file", default="admin_password.txt")
    ap.add_argument("--out", default="מצב_חברות.csv")
    a = ap.parse_args()
    token = os.environ.get("ADMIN_PASSWORD") or ""
    if not token and os.path.exists(a.password_file):
        with open(a.password_file, encoding="utf-8-sig") as f:
            token = (f.readline() or "").strip()
    token = token or getpass.getpass("סיסמת מנהל האתר: ")
    biz = call(a.site, token, "/businesses")
    docs = call(a.site, token, "/permit-docs")["docs"]
    by = collections.defaultdict(list)
    for d in docs:
        for b in d.get("business_ids") or []:
            by[b].append(d)
    rows, cnt = [], collections.Counter()
    for b in biz:
        if (b.get("entity_type") or "company") != "company":
            continue
        name = b.get("registrar_name") or b.get("permit_name") or ""
        vis = (b.get("visibility") or "").strip()
        need = NEED.get(vis, ("general",))
        st = b.get("registry_status") or ""
        ds = [d for d in by.get(b["id"], []) if d["doc_type"] != "other"]
        cover = {t: [d for d in ds if d["doc_type"] in (t, "both")] for t in ("general", "private")}
        unknown = [d for d in ds if d["doc_type"] == "unknown"]
        missing = [t for t in need if not cover[t]]
        multi = [t for t in need if len(cover[t]) > 1]
        if any(x in st for x in INACTIVE):
            status = "לא פעילה ברשם (לא דורשת)"
        elif not missing and not multi:
            status = "תקין"
        elif missing and not ds:
            status = "חסר: אין אף מסמך"
        elif missing and unknown:
            status = "חסר סיווג: יש מסמך ללא סיווג"
        elif missing:
            status = "חסר: " + " + ".join(HE[t] for t in missing)
        else:
            status = "כמה מסמכים לאותו סוג (לסידור)"
        cnt[status] += 1
        rows.append([name, b.get("chp_number") or "", "כללי+פרטי" if len(need) == 2 else HE[need[0]], st, status, len(ds),
                     " | ".join(f"{d['original_name']} ({ {'general':'כללי','private':'פרטי','both':'כללי+פרטי','unknown':'לא ידוע'}.get(d['doc_type'], d['doc_type']) })" for d in ds)])
    order = {"תקין": 9}
    rows.sort(key=lambda r: (order.get(r[4], 0), r[4], r[0]))
    with open(a.out, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(["company", "chp", "required", "registry_status", "status", "docs_count", "docs"])
        w.writerows(rows)
    print(f"{len(rows)} חברות:")
    for k, v in cnt.most_common():
        print(f"  {k}: {v}")
    print(f"פירוט: {a.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
