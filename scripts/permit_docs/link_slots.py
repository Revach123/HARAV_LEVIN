# -*- coding: utf-8 -*-
"""
קישור אוטומטי של מסמך לרשימה (כללי / פרטי) של כל חברה, לפי הרישום שלה ולפי האתר הישן:
  * חברה שרשומה "כללי" דורשת מסמך כללי; "יש גם פרטי" דורשת גם מסמך פרטי; "רק פרטי" דורשת פרטי.
  * נבחר המסמך הראשי: זה שהופיע בפוסט של החברה ברשימה המתאימה באתר הישן (כללי / פרטי). מסמך משולב מתאים לשתי הרשימות.
  * אין מסמך ראשי אבל יש מסמך יחיד שמתאים לסוג: הוא נבחר. כמה ראשיים / כמה מסמכים בלי ראשי: לא קובעים (נשאר לבדיקה ידנית בחלון "ניהול מסמכים").
  * חברה שכבר יש לה מסמך מקושר לרשימה (למשל בחירה ידנית): לא משנים.
    python link_slots.py             -> סיכום בלבד
    python link_slots.py --go        -> מקשר בפועל (דורש שמיגרציה 0007 כבר הורצה ב-D1)
"""
import argparse
import collections
import getpass
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from import_to_site import call, rd  # noqa: E402

LOC = {"main_ducuments": ("general",), "privet_ducuments": ("private",)}
HE = {"general": "כללי", "private": "פרטי"}
INACTIVE = ("מחוקה", "נגרעה", "מחוסלת", "בפרוק")


def need_of(b):
    v = (b.get("visibility") or "").strip()
    return ("private",) if v == "רק פרטי" else (("general", "private") if v == "פרטי" else ("general",))


def plan(biz, docs, final):
    prim = collections.defaultdict(lambda: collections.defaultdict(set))
    for r in final:
        if r.get("business_id") and r.get("title_business") and not r.get("title_differs"):
            for t in LOC.get(r.get("post_type"), ("general", "private")):
                prim[r["business_id"]][t].add(r["attachment_id"])
    by = collections.defaultdict(list)
    for d in docs:
        ids = set((d.get("source_ref") or "").replace("wp:", "").split(","))
        for b in d.get("business_ids") or []:
            by[b].append((d, ids))
    choice = collections.defaultdict(lambda: collections.defaultdict(list))        # doc_id -> חברה -> רשימות
    stat = collections.Counter()
    for b in biz:
        if (b.get("entity_type") or "company") != "company":
            continue
        if any(x in (b.get("registry_status") or "") for x in INACTIVE):
            stat["לא פעילה ברשם: דולגה"] += 1
            continue
        ds = [(d, ids) for d, ids in by.get(b["id"], []) if d["doc_type"] != "other"]
        for t in need_of(b):
            if any(t in (d.get("slots") or {}).get(b["id"], "").split(",") for d, _ in ds):
                stat["כבר מקושר (לא משנים)"] += 1
                continue
            cov = [(d, ids) for d, ids in ds if d["doc_type"] in (t, "both")]
            pr = [d for d, ids in cov if b["id"] in prim and ids & prim[b["id"]][t]]
            if len(pr) == 1:
                pick, why = pr[0], "ראשי"
            elif not pr and len(cov) == 1:
                pick, why = cov[0][0], "מסמך יחיד"
            else:
                stat["לא נקבע: " + ("אין מסמך מתאים" if not cov else "כמה ראשיים" if pr else "אין ראשי וכמה מסמכים")] += 1
                continue
            choice[pick["id"]][b["id"]].append(t)
            stat[f"קושר ({why}) {HE[t]}"] += 1
    return choice, stat


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--site", default="https://harav-levin.pages.dev")
    ap.add_argument("--final", default="סופי_מאוחד.csv")
    ap.add_argument("--password-file", default="admin_password.txt")
    ap.add_argument("--go", action="store_true")
    a = ap.parse_args()
    token = os.environ.get("ADMIN_PASSWORD") or ""
    if not token and os.path.exists(a.password_file):
        with open(a.password_file, encoding="utf-8-sig") as f:
            token = (f.readline() or "").strip()
    token = token or getpass.getpass("סיסמת מנהל האתר: ")
    biz = call(a.site, token, "/businesses")
    docs = call(a.site, token, "/permit-docs")["docs"]
    choice, stat = plan(biz, docs, rd(a.final))
    for k, v in sorted(stat.items()):
        print(f"  {k}: {v}")
    n = sum(len(c) for c in choice.values())
    print(f"{n} קישורים ב-{len(choice)} מסמכים")
    if not a.go:
        print("לקישור בפועל: python link_slots.py --go")
        return 0
    ok = fail = 0
    for i, (doc_id, comp) in enumerate(choice.items(), 1):
        d = next(x for x in docs if x["id"] == doc_id)
        slots = {b: sorted(set(ts) | set(((d.get("slots") or {}).get(b) or "").split(",")) - {""}) for b, ts in comp.items()}
        try:
            call(a.site, token, "/permit-docs/" + doc_id, json.dumps({"slots": slots}).encode("utf-8"), "application/json", method="PUT")
            ok += 1
        except Exception as e:  # noqa: BLE001
            fail += 1
            print(f"  נכשל {d.get('original_name')}: {e}")
        if i % 50 == 0 or i == len(choice):
            print(f"  {i}/{len(choice)} (הצליחו {ok}, נכשלו {fail})", flush=True)
    return 0 if not fail else 2


if __name__ == "__main__":
    sys.exit(main())
