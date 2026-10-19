# -*- coding: utf-8 -*-
"""
השוואה בין האתר הישן לבין האתר החדש: קריאה בלבד, לא משנה שום דבר באתר.

מקור הישן: old_links.csv (מ-old_site_links.py): כל פוסט ישן (חברה + כללי / פרטי) והקובץ שהוא מקשר אליו, עם חתימת תוכן.
מקור החדש: האתר החי (מסמכים, שיוכים לחברות, והסלוטים הפרטי / כללי) לפי חתימת תוכן (לא לפי שם קובץ).

    python old_vs_site.py                      (סיסמת מנהל: משתנה ADMIN_PASSWORD, או admin_password.txt, או תישאל)

פלט:
  old_vs_site_posts.csv       שורה לכל פוסט ישן: מה מצבו אצלנו ומה צריך לעשות
  old_vs_site_businesses.csv  שורה לכל חברה אצלנו שדורשת היתר: האם חסר, והאם יש לה פוסט ישן שאפשר לקשר
  old_vs_site_plan.csv        רשימת הפעולות שאפשר לבצע אוטומטית (קישור מסמך קיים לחברה / לסלוט), לבדיקה לפני ביצוע
  old_vs_site_summary.txt     סיכום
"""
import argparse
import collections
import csv
import difflib
import getpass
import json
import os
import re
import ssl
import sys
import urllib.error
import urllib.request

STRICT = [True]
SLOT_OF = {"כללי": "general", "פרטי": "private"}
SLOT_HE = {"general": "כללי", "private": "פרטי"}


def ssl_context():
    ctx = ssl.create_default_context()
    if not STRICT[0] and hasattr(ssl, "VERIFY_X509_STRICT"):
        ctx.verify_flags &= ~ssl.VERIFY_X509_STRICT
    return ctx


def call(site, token, path):
    req = urllib.request.Request(site.rstrip("/") + "/api" + path, headers={"User-Agent": "Mozilla/5.0 (permit-compare)", **({"Authorization": "Bearer " + token} if token else {})})
    for _ in range(2):
        try:
            with urllib.request.urlopen(req, timeout=180, context=ssl_context()) as r:
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.URLError as e:
            if STRICT[0] and isinstance(e.reason, ssl.SSLCertVerificationError) and "key usage" in str(e.reason):
                STRICT[0] = False
                continue
            raise


def norm(x):
    x = str(x or "").lower()
    x = re.sub(r"[-–]\s*(כללי|פרטי)\s*$", " ", x)
    x = re.sub(r"[\"'`״׳.,()\-–_/]", " ", x)
    x = re.sub(r"(^|\s)(בע\s*מ|בעמ|ltd|inc)(?=\s|$)", " ", x)
    return re.sub(r"\s+", " ", x).strip()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--site", default="https://harav-levin.pages.dev")
    ap.add_argument("--links", default="old_links.csv")
    ap.add_argument("--password-file", default="admin_password.txt")
    ap.add_argument("--status", default="publish", help="סטטוס הפוסטים הישנים לבדיקה (publish / draft / trash; ברירת מחדל: פורסמו)")
    a = ap.parse_args()
    token = os.environ.get("ADMIN_PASSWORD") or ""
    if not token and os.path.exists(a.password_file):
        with open(a.password_file, encoding="utf-8") as f:
            token = (f.readline() or "").strip()
    token = token or getpass.getpass("סיסמת מנהל האתר: ")

    rows = list(csv.reader(open(a.links, encoding="utf-8-sig")))
    H, R = rows[0], rows[1:]
    posts = [r for r in R if r[7] and r[0] in ("כללי", "פרטי") and r[3] in a.status.split(",")]
    print(f"פוסטים ישנים לבדיקה: {len(posts)}")
    docs = call(a.site, token, "/permit-docs")["docs"]
    biz = call(a.site, token, "/businesses")
    biz = biz if isinstance(biz, list) else biz.get("businesses", [])
    print(f"באתר: {len(docs)} מסמכים, {len(biz)} חברות")
    by_sha = {}
    for d in docs:
        by_sha.setdefault((d.get("sha256") or "")[:12], []).append(d)
    bmap = {b["id"]: b for b in biz}

    # אינדקס שמות חברות
    names = collections.defaultdict(set)
    for b in biz:
        for n in (b.get("permit_name"), b.get("registrar_name")):
            if norm(n):
                names[norm(n)].add(b["id"])
    allnames = list(names)

    def match(title):
        t = norm(title)
        if not t:
            return [], "אין"
        if t in names:
            return sorted(names[t]), "מדויק"
        hit = difflib.get_close_matches(t, allnames, n=3, cutoff=0.86)
        if hit:
            return sorted({i for h in hit[:1] for i in names[h]}), "דומה"
        return [], "אין"

    def bname(i):
        b = bmap.get(i) or {}
        return (b.get("permit_name") or b.get("registrar_name") or i) + (f" ({b.get('chp_number')})" if b.get("chp_number") else "")

    out, plan, cnt = [], [], collections.Counter()
    old_for_biz = collections.defaultdict(list)          # חברה -> פוסטים ישנים שתואמו אליה
    for r in posts:
        typ, pid, status, title, path, sha = r[0], r[2], r[3], r[5], r[7], r[10]
        slot = SLOT_OF[typ]
        cands, how = match(title)
        for c in cands:
            old_for_biz[c].append((typ, title, sha, path))
        site_docs = by_sha.get(sha, []) if sha else []
        if not sha:
            verdict, action = "הקובץ חסר בגיבוי", "לבקש את הקובץ מהמנהל"
        elif not site_docs:
            verdict, action = "המסמך לא באתר שלנו", "לייבא"
        else:
            d = site_docs[0]
            linked = ", ".join(bname(i) for i in (d.get("business_ids") or [])) or "ללא שיוך"
            if not cands:
                verdict, action = f"המסמך באתר ({linked}); החברה '{title}' לא נמצאה ברשימה שלנו", "לבדוק שם החברה / להוסיף חברה"
            elif len(cands) > 1:
                verdict, action = f"שם החברה תואם כמה חברות ({', '.join(bname(c) for c in cands)})", "לבחור ידנית"
            else:
                b = cands[0]
                have = (d.get("slots") or {}).get(b, "")
                if b not in (d.get("business_ids") or []):
                    verdict, action = f"המסמך באתר ({linked}) אבל לא משויך לחברה", "לשייך ולקשר לסלוט"
                    plan.append([d["id"], b, bname(b), slot, "שיוך וקישור לסלוט", typ, title, how, linked])
                elif slot in have.split(","):
                    verdict, action = "תקין", ""
                elif have:
                    verdict, action = f"משויך אבל מקושר לסלוט {have}", "לבדוק"
                else:
                    verdict, action = "משויך לחברה אבל לא מקושר לסלוט", "לקשר לסלוט"
                    plan.append([d["id"], b, bname(b), slot, "קישור לסלוט", typ, title, how, linked])
        cnt[(typ, verdict.split(" (")[0].split(";")[0])] += 1
        out.append([typ, pid, status, title, path, sha, how, "; ".join(bname(c) for c in cands), verdict, action, r[13] if len(r) > 13 else ""])
    with open("old_vs_site_posts.csv", "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(["סוג", "post_id", "סטטוס", "כותרת (חברה בישן)", "קובץ", "חתימה", "התאמת שם", "חברה אצלנו", "מצב", "מה לעשות", "הערה מהחילוץ"])
        w.writerows(out)
    with open("old_vs_site_plan.csv", "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(["doc_id", "business_id", "חברה", "סלוט", "פעולה", "סוג בישן", "כותרת בישן", "התאמת שם", "משויך כרגע"])
        w.writerows(plan)

    # חברות שדורשות היתר
    brow, bc = [], collections.Counter()
    slot_have = collections.defaultdict(dict)
    for d in docs:
        if d.get("doc_type") == "other":
            continue
        for b, sl in (d.get("slots") or {}).items():
            for t in sl.split(","):
                if t:
                    slot_have[b].setdefault(t, d)
    plan_slots = {(p[1], p[3]) for p in plan}
    for b in biz:
        vis = b.get("visibility") or ""
        need = {"private": vis in ("פרטי", "רק פרטי"), "general": vis != "רק פרטי"}
        for t in ("private", "general"):
            if not need[t]:
                continue
            if t in slot_have[b["id"]]:
                bc["יש סלוט"] += 1
                continue
            olds = [o for o in old_for_biz.get(b["id"], []) if SLOT_OF[o[0]] == t]
            if (b["id"], t) in plan_slots:
                st = "אפשר לקשר אוטומטית (מסמך קיים)"
            elif olds and any(o[2] and by_sha.get(o[2]) for o in olds):
                st = "יש פוסט ישן והמסמך באתר, צריך בדיקה ידנית"
            elif olds and any(o[2] for o in olds):
                st = "יש פוסט ישן, המסמך לא באתר: לייבא"
            elif olds:
                st = "יש פוסט ישן, הקובץ חסר בגיבוי"
            else:
                st = "אין פוסט ישן תואם: באמת חסר (או שם שונה)"
            bc[st] += 1
            brow.append([bname(b["id"]), vis, SLOT_HE[t], st, "; ".join(o[1] for o in olds[:3]), "; ".join(o[3] for o in olds[:2])])
    with open("old_vs_site_businesses.csv", "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(["חברה", "רישום", "סלוט שחסר", "מצב", "פוסט ישן", "קובץ ישן"])
        w.writerows(sorted(brow))

    lines = ["== פוסטים ישנים לפי מצב =="]
    for (t, v), n in sorted(cnt.items()):
        lines.append(f"{t}: {v}: {n}")
    lines += ["", "== סלוטים חסרים אצלנו (חברה + פרטי / כללי) =="]
    lines += [f"{k}: {n}" for k, n in bc.most_common()]
    lines += ["", f"פעולות אוטומטיות מוצעות: {len(plan)} (old_vs_site_plan.csv)"]
    txt = "\n".join(lines)
    print("\n" + txt)
    open("old_vs_site_summary.txt", "w", encoding="utf-8").write(txt)


if __name__ == "__main__":
    main()
