# -*- coding: utf-8 -*-
"""
השוואה בין האתר הישן לבין האתר החדש: קריאה בלבד, לא משנה שום דבר באתר.

מקור הישן: old_links.csv (מ-old_site_links.py): כל פוסט ישן (חברה + כללי / פרטי) והקובץ שהוא מקשר אליו, עם חתימת תוכן.
מקור החדש: האתר החי (מסמכים, שיוכים לחברות, והסלוטים הפרטי / כללי) לפי חתימת תוכן (לא לפי שם קובץ).

    python old_vs_site.py                      (סיסמת מנהל: משתנה ADMIN_PASSWORD, או admin_password.txt, או תישאל)

פלט:
  old_vs_site_posts.csv       שורה לכל פוסט ישן: מה מצבו אצלנו ומה צריך לעשות
  old_vs_site_businesses.csv  שורה לכל סלוט שחסר אצלנו (חברה + פרטי / כללי): למה חסר, והאם אפשר לקשר
  old_vs_site_plan.csv        רשימת הפעולות (קישור מסמך קיים לחברה / לסלוט) עם רמת ביטחון, לבדיקה לפני ביצוע (עם old_apply_plan.py)
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

    def score(t, name):          # דמיון בין כותרת הפוסט הישן לבין שם חברה: יחס רצף + הכלה של מילים
        n = norm(name)
        if not n or not t:
            return 0
        r = difflib.SequenceMatcher(None, t, n).ratio()
        tw, nw = set(t.split()), set(n.split())
        if tw and nw and (tw <= nw or nw <= tw):
            r = max(r, 0.8)
        return r

    def match(title, d):
        t = norm(title)
        if not t:
            return [], "אין"
        if t in names:
            return sorted(names[t]), "מדויק"
        if d and d.get("business_ids"):          # החברה שאליה המסמך כבר משויך אצלנו, ושמה דומה לכותרת הישנה
            sc = sorted(((max(score(t, bmap[i].get("permit_name")), score(t, bmap[i].get("registrar_name"))), i) for i in d["business_ids"] if i in bmap), reverse=True)
            if sc and sc[0][0] >= 0.62 and (len(sc) == 1 or sc[0][0] - sc[1][0] >= 0.12):
                return [sc[0][1]], "דרך המסמך"
        hit = difflib.get_close_matches(t, allnames, n=1, cutoff=0.86)
        if hit:
            return sorted(names[hit[0]]), "דומה"
        return [], "אין"

    def bname(i):
        b = bmap.get(i) or {}
        return (b.get("permit_name") or b.get("registrar_name") or i) + (f" ({b.get('chp_number')})" if b.get("chp_number") else "")

    slot_have = collections.defaultdict(dict)          # חברה -> סלוט -> המסמך שמקושר אליו כרגע
    for d in docs:
        if d.get("doc_type") == "other":
            continue
        for b_, sl in (d.get("slots") or {}).items():
            for t_ in sl.split(","):
                if t_:
                    slot_have[b_].setdefault(t_, d)

    out, cnt = [], collections.Counter()
    groups = collections.defaultdict(list)          # (חברה, סלוט) -> פוסטים ישנים
    unmatched = []
    for r in posts:
        typ, pid, status, title, path, sha = r[0], r[2], r[3], r[5], r[7], r[10]
        flag = r[13] if len(r) > 13 else ""
        site_docs = by_sha.get(sha, []) if sha else []
        d = site_docs[0] if site_docs else None
        cands, how = match(title, d)
        row = [typ, pid, status, title, path, sha, how, "; ".join(bname(c) for c in cands), flag]
        if not sha:
            out.append(row + ["הקובץ חסר בגיבוי", "לבקש מהמנהל"]); cnt[(typ, "הקובץ חסר בגיבוי")] += 1
            continue
        if not d:
            out.append(row + ["המסמך לא באתר שלנו", "לייבא"]); cnt[(typ, "המסמך לא באתר שלנו")] += 1
            continue
        if len(cands) != 1:
            why = "שם החברה לא נמצא" if not cands else "שם החברה תואם כמה חברות"
            linked = ", ".join(bname(i) for i in (d.get("business_ids") or [])) or "ללא שיוך"
            out.append(row + [f"{why} (המסמך משויך: {linked})", "לבדוק ידנית"]); cnt[(typ, why)] += 1
            continue
        groups[(cands[0], SLOT_OF[typ])].append((row, d, how, flag))

    plan, mrows = [], []
    for (b, t), lst in groups.items():
        shas = {x[0][5] for x in lst}
        row0, d, how, flag = lst[0]
        have = slot_have[b].get(t)
        conf = "גבוהה" if how in ("מדויק", "דרך המסמך") and not any(x[3] for x in lst) and len(shas) == 1 else "נמוכה"
        if len(shas) > 1:
            res, act = "כמה מסמכים שונים לאותו סלוט", "לבדוק ידנית"
        elif have and have["id"] == d["id"]:
            res, act = "תקין", ""
        elif have:
            res, act = f"בסלוט כבר מסמך אחר ({have.get('original_name') or have['id']})", "לבדוק ידנית"
        else:
            linked_here = b in (d.get("business_ids") or [])
            res, act = ("משויך לחברה אבל לא מקושר לסלוט" if linked_here else "המסמך באתר אבל לא משויך לחברה"), ("לקשר לסלוט" if linked_here else "לשייך ולקשר לסלוט")
            plan.append([d["id"], b, bname(b), t, "קישור לסלוט" if linked_here else "שיוך וקישור לסלוט", conf, how, row0[3], row0[8], ", ".join(bname(i) for i in (d.get("business_ids") or [])) or "ללא שיוך"])
        for x in lst:
            cnt[(x[0][0], res.split(" (")[0] + ("" if conf == "גבוהה" or res == "תקין" else " [ביטחון נמוך]"))] += 1
            out.append(x[0] + [res, act])
    with open("old_vs_site_posts.csv", "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(["סוג", "post_id", "סטטוס", "כותרת (חברה בישן)", "קובץ", "חתימה", "התאמת שם", "חברה אצלנו", "הערה מהחילוץ", "מצב", "מה לעשות"])
        w.writerows(out)
    with open("old_vs_site_plan.csv", "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(["doc_id", "business_id", "חברה", "סלוט", "פעולה", "ביטחון", "התאמת שם", "כותרת בישן", "הערה מהחילוץ", "משויך כרגע"])
        w.writerows(plan)

    # חברות שדורשות היתר: מה מצבן ולמה חסר
    bc, brow = collections.Counter(), []
    plan_slots = {(p[1], p[3]): p[5] for p in plan}
    outcome = {}
    for (b, t), lst in groups.items():
        outcome[(b, t)] = lst
    for b in biz:
        vis = b.get("visibility") or ""
        need = {"private": vis in ("פרטי", "רק פרטי"), "general": vis != "רק פרטי"}
        for t in ("private", "general"):
            if not need[t]:
                continue
            if t in slot_have[b["id"]]:
                bc["יש סלוט"] += 1
                continue
            if (b["id"], t) in plan_slots:
                st = "אפשר לקשר: " + ("ביטחון גבוה" if plan_slots[(b["id"], t)] == "גבוהה" else "ביטחון נמוך (לבדוק)")
            elif (b["id"], t) in outcome:
                st = "יש פוסט ישן אבל דורש בדיקה ידנית"
            else:
                st = "אין פוסט ישן תואם לחברה (באמת חסר, או שהשם שונה)"
            bc[st] += 1
            brow.append([bname(b["id"]), vis, SLOT_HE[t], st])
    with open("old_vs_site_businesses.csv", "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(["חברה", "רישום", "סלוט שחסר", "מצב"])
        w.writerows(sorted(brow))

    lines = ["== פוסטים ישנים לפי מצב =="]
    for (t, v), n in sorted(cnt.items()):
        lines.append(f"{t}: {v}: {n}")
    lines += ["", "== סלוטים חסרים אצלנו (חברה + פרטי / כללי) =="]
    lines += [f"{k}: {n}" for k, n in bc.most_common()]
    hi = sum(1 for p in plan if p[5] == "גבוהה")
    lines += ["", f"פעולות מוצעות: {len(plan)}, מהן בביטחון גבוה: {hi} (old_vs_site_plan.csv)"]
    txt = "\n".join(lines)
    print("\n" + txt)
    open("old_vs_site_summary.txt", "w", encoding="utf-8").write(txt)


if __name__ == "__main__":
    main()
