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
    try:
        hp_rows = call(a.site, token, "/permit-text?hints=1").get("hp") or []
    except Exception as e:  # noqa: BLE001
        print("אזהרה: אין נתוני ח.פ. מהאתר (", e, ") - ההשוואה תרוץ בלי ראיות ח.פ.")
        hp_rows = []
    hp_by_doc, docs_by_hp = collections.defaultdict(set), collections.defaultdict(set)
    for r_ in hp_rows:
        h_ = str(r_.get("hp") or "").zfill(9)
        hp_by_doc[r_["id"]].add(h_)
        docs_by_hp[h_].add(r_["id"])
    print(f"ח.פ. שנמצאו במסמכים: {len(hp_rows)} שורות, ב-{len(hp_by_doc)} מסמכים")
    by_sha = {}
    for d in docs:
        by_sha.setdefault((d.get("sha256") or "")[:12], []).append(d)
    bmap = {b["id"]: b for b in biz}
    bhp = {b["id"]: re.sub(r"\D", "", str(b.get("chp_number") or "")).zfill(9) for b in biz if re.sub(r"\D", "", str(b.get("chp_number") or ""))}
    biz_by_hp = collections.defaultdict(list)
    for i_, h_ in bhp.items():
        biz_by_hp[h_].append(i_)

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
    need_import = set()
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
            need_import.add(sha)
            out.append(row + ["המסמך לא באתר שלנו", "לייבא"]); cnt[(typ, "המסמך לא באתר שלנו")] += 1
            continue
        if not cands and d:          # השם לא מתאים לאף חברה: ח.פ. שנמצא בתוך המסמך מזהה חברה אחת בדיוק (ושמה דומה במעט לכותרת)
            byhp = [i for h_ in hp_by_doc.get(d["id"], ()) for i in biz_by_hp.get(h_, ())]
            if len(set(byhp)) == 1 and max(score(norm(title), bmap[byhp[0]].get("permit_name")), score(norm(title), bmap[byhp[0]].get("registrar_name"))) >= 0.35:
                cands, how = [byhp[0]], "לפי ח.פ. במסמך"
                row[6], row[7] = how, bname(byhp[0])
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
        hps = hp_by_doc.get(d["id"], set())
        mine = bhp.get(b, "")
        linked_here = b in (d.get("business_ids") or [])
        ev = []
        if how == "מדויק":
            ev.append("שם זהה")
        elif how == "דרך המסמך":
            ev.append("שם דומה לחברה שהמסמך כבר משויך אליה")
        elif how == "לפי ח.פ. במסמך":
            ev.append("ח.פ. במסמך")
        if linked_here:
            ev.append("המסמך כבר משויך לחברה")
        if mine and mine in hps:
            ev.append("ח.פ. החברה נמצא בטקסט המסמך")
        mismatch = bool(mine and hps and mine not in hps)
        if mismatch:
            ev.append("אזהרה: במסמך ח.פ. אחר (" + ", ".join(sorted(hps)[:3]) + ")")
        clean = not any(x[3] for x in lst) and len(shas) == 1
        if not clean or how not in ("מדויק", "דרך המסמך", "לפי ח.פ. במסמך") or mismatch:
            conf = "נמוכה"
        elif mine and mine in hps and how in ("מדויק", "לפי ח.פ. במסמך"):
            conf = "גבוהה מאוד"
        elif linked_here or how == "דרך המסמך":
            conf = "גבוהה"
        else:
            conf = "בינונית"          # שם זהה, אבל המסמך לא משויך לחברה ואין ח.פ. שמאשר: לבדיקה
        if len(shas) > 1:
            res, act = "כמה מסמכים שונים לאותו סלוט", "לבדוק ידנית"
        elif have and have["id"] == d["id"]:
            res, act = "תקין", ""
        elif have:
            res, act = f"בסלוט כבר מסמך אחר ({have.get('original_name') or have['id']})", "לבדוק ידנית"
        else:
            res, act = ("משויך לחברה אבל לא מקושר לסלוט" if linked_here else "המסמך באתר אבל לא משויך לחברה"), ("לקשר לסלוט" if linked_here else "לשייך ולקשר לסלוט")
            plan.append([d["id"], b, bname(b), t, "קישור לסלוט" if linked_here else "שיוך וקישור לסלוט", conf, how, row0[3], row0[8], ", ".join(bname(i) for i in (d.get("business_ids") or [])) or "ללא שיוך", mine or "", ", ".join(sorted(hps)[:4]), "; ".join(ev), f"{'לקשר' if linked_here else 'לשייך ולקשר'} את \"{d.get('original_name') or d['id']}\" כהת\"ע {SLOT_HE[t]} של {bname(b)}"])
        for x in lst:
            cnt[(x[0][0], res.split(" (")[0] + ("" if conf in ("גבוהה", "גבוהה מאוד") or res == "תקין" else f" [ביטחון: {conf}]"))] += 1
            out.append(x[0] + [res, act])
    with open("old_vs_site_import.csv", "w", encoding="utf-8-sig", newline="") as f:          # מסמכים שהאתר הישן מקשר אליהם ואינם אצלנו (חתימה): להעלאה
        w = csv.writer(f)
        w.writerow(["חתימה"])
        w.writerows([[x] for x in sorted(need_import)])
    with open("old_vs_site_posts.csv", "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(["סוג", "post_id", "סטטוס", "כותרת (חברה בישן)", "קובץ", "חתימה", "התאמת שם", "חברה אצלנו", "הערה מהחילוץ", "מצב", "מה לעשות"])
        w.writerows(out)
    with open("old_vs_site_plan.csv", "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(["doc_id", "business_id", "חברה", "סלוט", "פעולה", "ביטחון", "התאמת שם", "כותרת בישן", "הערה מהחילוץ", "משויך כרגע", "ח.פ. החברה", "ח.פ. במסמך", "ראיות", "מה יקרה"])
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
                st = "אפשר לקשר: ביטחון " + plan_slots[(b["id"], t)]
            elif (b["id"], t) in outcome:
                st = "יש פוסט ישן אבל דורש בדיקה ידנית"
            else:
                st = "אין פוסט ישן תואם לחברה (באמת חסר, או שהשם שונה)"
            bc[st] += 1
            brow.append([bname(b["id"]), vis, SLOT_HE[t], st])
    sug = []
    for b in biz:
        vis = b.get("visibility") or ""
        need = {"private": vis in ("פרטי", "רק פרטי"), "general": vis != "רק פרטי"}
        hp_ = bhp.get(b["id"], "")
        for t in ("private", "general"):
            if not need[t] or t in slot_have[b["id"]] or (b["id"], t) in outcome or not hp_:
                continue
            for did in sorted(docs_by_hp.get(hp_, ())):
                d = next((x for x in docs if x["id"] == did), None)
                if not d or d.get("doc_type") == "other" or b["id"] in (d.get("business_ids") or []) and (d.get("slots") or {}).get(b["id"]):
                    continue
                fit = d.get("doc_type") in (t, "both", "unknown")
                sug.append([bname(b["id"]), SLOT_HE[t], d.get("original_name") or d["id"], d.get("doc_type"), "כן" if fit else "לא", "משויך" if b["id"] in (d.get("business_ids") or []) else "לא משויך", ", ".join(bname(i) for i in (d.get("business_ids") or [])) or "ללא שיוך", d["id"], b["id"]])
    with open("old_vs_site_hp_suggestions.csv", "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(["חברה", "סלוט שחסר", "מסמך שנמצא בו ח.פ. החברה", "סיווג המסמך", "מתאים לסלוט", "שיוך לחברה", "משויך כרגע", "doc_id", "business_id"])
        w.writerows(sug)
    with open("old_vs_site_businesses.csv", "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(["חברה", "רישום", "סלוט שחסר", "מצב"])
        w.writerows(sorted(brow))

    lines = ["== פוסטים ישנים לפי מצב =="]
    for (t, v), n in sorted(cnt.items()):
        lines.append(f"{t}: {v}: {n}")
    lines += ["", "== סלוטים חסרים אצלנו (חברה + פרטי / כללי) =="]
    lines += [f"{k}: {n}" for k, n in bc.most_common()]
    byc = collections.Counter(p[5] for p in plan)
    lines += ["", "פעולות מוצעות לפי ביטחון: " + ", ".join(f"{k}: {v}" for k, v in sorted(byc.items())) + " (old_vs_site_plan.csv)"]
    lines += [f"מסמכים של הישן שאינם באתר שלנו (להעלאה): {len(need_import)} (old_vs_site_import.csv)"]
    lines += [f"מסמכים שנמצא בהם ח.פ. של חברה שחסר לה סלוט ואין לה פוסט ישן: {len(sug)} שורות (old_vs_site_hp_suggestions.csv)"]
    txt = "\n".join(lines)
    print("\n" + txt)
    open("old_vs_site_summary.txt", "w", encoding="utf-8").write(txt)


if __name__ == "__main__":
    main()
