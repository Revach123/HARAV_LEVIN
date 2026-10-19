# -*- coding: utf-8 -*-
"""
מבצע את הקישורים מ-old_vs_site_plan.csv באתר (שיוך מסמך לחברה, וקישור לסלוט הפרטי / כללי).
ברירת מחדל: הרצה יבשה (רק מדפיס מה ישונה, לא כותב כלום). לביצוע אמיתי: --apply.

    python old_apply_plan.py --match exact --only link   הרצה יבשה: רק התאמת שם מדויקת, ורק קישור לסלוט של מסמך שכבר משויך לחברה (הכי בטוח)
    python old_apply_plan.py                       הרצה יבשה, רק ביטחון "גבוהה"
    python old_apply_plan.py --apply               ביצוע
    python old_apply_plan.py --apply --min low     כולל גם ביטחון נמוך (לא מומלץ בלי בדיקה ידנית של הרשימה)
    python old_apply_plan.py --undo old_apply_log.jsonl --apply     החזרת המצב כפי שהיה לפני הביצוע

כל ביצוע נשמר ב-old_apply_log.jsonl (שורה לכל מסמך, לפני הכתיבה) (המצב הקודם של כל מסמך שנגענו בו), כך שאפשר לבטל.
לא מוחק שום מסמך ולא מחליף מסמך שכבר מקושר לסלוט: קישור רק לסלוט שהוא פנוי אצל החברה.
"""
import argparse
import collections
import csv
import getpass
import json
import os
import ssl
import time
import urllib.error
import urllib.request

STRICT = [True]


def ssl_context():
    ctx = ssl.create_default_context()
    if not STRICT[0] and hasattr(ssl, "VERIFY_X509_STRICT"):
        ctx.verify_flags &= ~ssl.VERIFY_X509_STRICT
    return ctx


def call(site, token, path, body=None, method=None):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(site.rstrip("/") + "/api" + path, data=data, method=method or ("PUT" if data else "GET"),
                                 headers={"User-Agent": "Mozilla/5.0 (permit-apply)", "Content-Type": "application/json", **({"Authorization": "Bearer " + token} if token else {})})
    last = None
    for attempt in range(5):          # חיבור איטי / פסק זמן: מנסים שוב (הפעולה אידמפוטנטית: אותו קישור שוב לא משנה כלום)
        try:
            with urllib.request.urlopen(req, timeout=90, context=ssl_context()) as r:
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.URLError as e:
            last = e
            if STRICT[0] and isinstance(e.reason, ssl.SSLCertVerificationError) and "key usage" in str(e.reason):
                STRICT[0] = False
                continue
        except (TimeoutError, OSError) as e:
            last = e
        time.sleep(2 * (attempt + 1))
    raise last


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--site", default="https://harav-levin.pages.dev")
    ap.add_argument("--plan", default="old_vs_site_plan.csv")
    ap.add_argument("--min", default="high", choices=["veryhigh", "high", "mid", "low"], help="רמת ביטחון מינימלית: veryhigh = גבוהה מאוד (שם + ח.פ. במסמך), high = גבוהה ומעלה (ברירת מחדל), mid = בינונית ומעלה, low = הכל")
    ap.add_argument("--match", default="all", choices=["exact", "all"], help="exact = רק התאמת שם מדויקת (בלי 'דרך המסמך' ובלי 'דומה')")
    ap.add_argument("--only", default="all", choices=["link", "all"], help="link = רק קישור לסלוט של מסמך שכבר משויך לחברה (בלי לשייך מסמך לחברה חדשה)")
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--undo", default="")
    ap.add_argument("--log", default="old_apply_log.jsonl")
    ap.add_argument("--password-file", default="admin_password.txt")
    a = ap.parse_args()
    token = os.environ.get("ADMIN_PASSWORD") or ""
    if not token and os.path.exists(a.password_file):
        token = (open(a.password_file, encoding="utf-8").readline() or "").strip()
    token = token or getpass.getpass("סיסמת מנהל האתר: ")

    if a.undo:
        txt = open(a.undo, encoding="utf-8").read().strip()
        log = json.loads(txt) if txt.startswith("[") else [json.loads(x) for x in txt.splitlines() if x.strip()]
        log.reverse()          # מהאחרון לראשון
        print(f"החזרה: {len(log)} מסמכים" + ("" if a.apply else " (הרצה יבשה: הוסף --apply)"))
        for e in log:
            if a.apply:
                call(a.site, token, "/permit-docs/" + e["id"], {"business_ids": e["business_ids"], "slots": {b: s.split(",") if s else [] for b, s in e["slots"].items()}})
            print("  הוחזר", e["id"])
        return

    rows = list(csv.DictReader(open(a.plan, encoding="utf-8-sig")))
    order = ["נמוכה", "בינונית", "גבוהה", "גבוהה מאוד"]
    want = set(order[{"low": 0, "mid": 1, "high": 2, "veryhigh": 3}[a.min]:])
    rows = [r for r in rows if r["ביטחון"] in want]
    if a.match == "exact":
        rows = [r for r in rows if r["התאמת שם"] == "מדויק"]
    if a.only == "link":
        rows = [r for r in rows if r["פעולה"] == "קישור לסלוט"]
    by_doc = collections.defaultdict(list)
    for r in rows:
        by_doc[r["doc_id"]].append(r)
    print(f"פעולות: {len(rows)} על {len(by_doc)} מסמכים" + ("" if a.apply else "  (הרצה יבשה: לא נכתב כלום; הוסף --apply לביצוע)"))
    log, done, skipped = [], 0, 0
    # סלוט תפוס אצל חברה: לא מחליפים
    docs = call(a.site, token, "/permit-docs")["docs"]
    cur = {d["id"]: d for d in docs}
    taken = collections.defaultdict(dict)
    for d in docs:
        if d.get("doc_type") == "other":
            continue
        for b, sl in (d.get("slots") or {}).items():
            for t in sl.split(","):
                if t:
                    taken[b][t] = d["id"]
    for doc_id, items in by_doc.items():
        d = cur.get(doc_id)
        if not d:
            print("  מסמך לא נמצא:", doc_id); skipped += 1; continue
        ids = list(d.get("business_ids") or [])
        slots = {b: (s or "") for b, s in (d.get("slots") or {}).items()}
        new_slots = {}
        for r in items:
            b, t = r["business_id"], r["סלוט"]
            if taken[b].get(t) == doc_id:
                continue          # כבר מקושר (למשל מהרצה קודמת שנקטעה)
            if taken[b].get(t) and taken[b][t] != doc_id:
                print(f"  דילוג: אצל {r['חברה']} הסלוט {t} כבר תפוס במסמך אחר"); skipped += 1; continue
            if b not in ids:
                ids.append(b)
            have = [x for x in (new_slots.get(b) or slots.get(b, "").split(",")) if x]
            if t not in have:
                have.append(t)
            new_slots[b] = have
            taken[b][t] = doc_id
        if not new_slots:
            continue
        entry = {"id": doc_id, "business_ids": d.get("business_ids") or [], "slots": slots}
        log.append(entry)
        if a.apply:          # נשמר לפני הכתיבה, כדי שגם אם נקטע באמצע אפשר לבטל
            with open(a.log, "a", encoding="utf-8") as lf:
                lf.write(json.dumps(entry, ensure_ascii=False) + "\n")
        for b, have in new_slots.items():
            print(f"  {doc_id}: {next(x['חברה'] for x in items if x['business_id'] == b)} -> {','.join(have)}")
        if a.apply:
            call(a.site, token, "/permit-docs/" + doc_id, {"business_ids": ids, "slots": new_slots})
        done += len(new_slots)
    if a.apply and log:
        print(f"הלוג נשמר ב-{a.log} (לביטול: python old_apply_plan.py --undo {a.log} --apply)")
    print(f"{'בוצעו' if a.apply else 'היו מבוצעים'}: {done} קישורים; דולגו: {skipped}")


if __name__ == "__main__":
    main()
