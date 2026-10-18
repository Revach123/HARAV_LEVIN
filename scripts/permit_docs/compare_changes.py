# -*- coding: utf-8 -*-
"""
השוואה (קריאה בלבד, לא משנה כלום): החלטות שעשית בדשבורד המקומי (החלטות_בדיקה.csv) מול מה שרשום עכשיו באתר
(שיוכי חברות, הת"ע פרטי / כללי, "אחר", חברות שאינן במאגר, אישורים ושאלות מנהל).

  python compare_changes.py

פלט: השוואת_שינויים.csv, עם שורה לכל מסמך שיש בו הבדל, ובסוף סיכום בחלון:
  - "בהחלטה מקומית בלבד": החלטת בדיקה מקומית על חברה שהמסמך לא משויך אליה באתר (ייתכן ששיניתי בכוונה, או שלא נקלט)
  - "באתר בלבד": חברה משויכת באתר שלא הופיעה בהחלטה המקומית (שיוך חדש מהדשבורד באתר)
  - "מסמך שנמחק מהאתר" / "מסמך שהיה לא קשור בהחלטה המקומית אבל משויך באתר"
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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--site", default="https://harav-levin.pages.dev")
    ap.add_argument("--decisions", default="החלטות_בדיקה.csv")
    ap.add_argument("--businesses", default="businesses.json")
    ap.add_argument("--attachments", default="attachments.csv")
    ap.add_argument("--uploads", default=os.path.join("wp-content", "uploads"))
    ap.add_argument("--hash-cache", default="hashes_cache.json")
    ap.add_argument("--password-file", default="admin_password.txt")
    ap.add_argument("--out", default="השוואת_שינויים.csv")
    a = ap.parse_args()

    biz = json.load(open(a.businesses, encoding="utf-8"))
    by_id = {b["id"]: b for b in biz}
    name_of = lambda i: (by_id.get(i, {}).get("registrar_name") or by_id.get(i, {}).get("permit_name") or i)  # noqa: E731
    hashes = file_hashes(a.attachments, a.uploads, a.hash_cache)

    local = collections.defaultdict(lambda: {"cos": set(), "files": set(), "time": "", "rows": []})
    for r in (m.read_csv(a.decisions) if os.path.exists(a.decisions) else []):
        sha = hashes.get(r.get("attachment_id"))
        if not sha:
            continue
        ids = [x.strip() for x in ((r.get("company_ids") or "") + ";" + (r.get("company_id") or "")).split(";") if x.strip()]
        e = local[sha]
        e["cos"].update(i for i in ids if i in by_id)
        e["files"].add(r.get("file", ""))
        e["time"] = max(e["time"], r.get("time", "") or "")
        e["rows"].append(r)

    token = os.environ.get("ADMIN_PASSWORD") or ""
    if not token and os.path.exists(a.password_file):
        with open(a.password_file, encoding="utf-8-sig") as f:
            token = (f.readline() or "").strip()
    token = token or getpass.getpass("סיסמת מנהל האתר: ")
    docs = call(a.site, token, "/permit-docs")["docs"]
    ext = {x["id"]: x for x in call(a.site, token, "/permit-ext").get("companies", [])}
    try:
        rev = {x["key"]: x for x in call(a.site, token, "/permit-review").get("items", [])}
    except Exception:  # noqa: BLE001
        rev = {}
    site = {d["sha256"]: d for d in docs}

    rows, cnt = [], collections.Counter()
    for sha, e in local.items():
        d = site.get(sha)
        if not d:
            if e["cos"]:
                rows.append([sorted(e["files"])[0] if e["files"] else sha[:12], "", "מסמך שנמחק מהאתר", "; ".join(name_of(i) for i in e["cos"]), "", e["time"]])
                cnt["מסמך שנמחק מהאתר"] += 1
            continue
        site_cos = set(d.get("business_ids") or [])
        only_local, only_site = e["cos"] - site_cos, site_cos - e["cos"]
        status = []
        if d.get("doc_type") == "other":
            status.append("סומן באתר 'לא קשור / לא היתר'")
        if (d.get("specials") or {}):
            status.append("יש סיווג 'אחר' באתר")
        for key in (f"doc:{d['id']}",):
            if key in rev:
                status.append("באתר: " + ("שאלת מנהל" if rev[key]["status"] == "question" else "אושר"))
        label = lambda ids: "; ".join(name_of(i) for i in sorted(ids, key=name_of))  # noqa: E731
        if only_local:
            cnt["בהחלטה מקומית בלבד"] += 1
            rows.append([sorted(e["files"])[0] if e["files"] else d.get("original_name", ""), d["id"], "בהחלטה מקומית בלבד (לא משויך באתר)", label(only_local), label(site_cos), e["time"], " | ".join(status)])
        if only_site:
            cnt["באתר בלבד"] += 1
            rows.append([d.get("original_name", ""), d["id"], "באתר בלבד (לא בהחלטה המקומית)", label(only_site), label(e["cos"]), e["time"], " | ".join(status)])
        if not only_local and not only_site:
            cnt["זהה"] += 1
    with open(a.out, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(["קובץ", "מזהה באתר", "סוג הבדל", "חברות בהבדל", "חברות בצד השני", "זמן החלטה מקומית", "הערות מהאתר"])
        w.writerows(rows)
    print(f"החלטות מקומיות שנבדקו: {len(local)}")
    for k, v in cnt.most_common():
        print(f"  {k}: {v}")
    print(f"נכתב: {a.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
