# -*- coding: utf-8 -*-
"""
טעינת כל קובצי ההיתר הקיימים למאגר המסמכים החדש באתר (נראה רק בדף הניהול admin_test.html). רץ על המחשב המקומי.
  קלט (מהתיקייה הנוכחית): מיפוי_קבצים.csv (master_map.py), סופי_מאוחד.csv, החלטות_בדיקה.csv, מועמדים_לחברות_חסרות.csv (לא חובה),
        businesses.json, attachments.csv, wp-content\\uploads
  מה נטען: מסמך אחד לכל תוכן ייחודי (קבצים זהים מאוחדים: כל החברות והסיווגים שלהם נצברים), עם:
        חברות משויכות (לפי הבדיקה המקומית וההחלטות שלך), סיווג כללי/פרטי/כללי+פרטי (לפי מיקום באתר הישן ונוסח המסמך),
        הערות (כולל מסמך משותף / כמה מסמכים בקובץ והצעת פיצול), כותרת הפוסט הישן, והצעות שיוך לקבצים שאין להם חברה.
        קבצים שסימנת "לא קשור" נטענים כסוג "לא קשור" בלי שיוך.
  ברירת מחדל: דוח בלבד (שום דבר לא נשלח). להעלאה בפועל: --go. אפשר להפסיק ולהמשיך: מסמך שכבר קיים באתר מדולג.
  נדרשת סיסמת מנהל האתר (ההעלאה מוגנת, ואי אפשר לבטל את זה): משתנה הסביבה ADMIN_PASSWORD, או קובץ admin_password.txt בתיקייה, או הקלדה.
    python import_to_site.py                      (דוח)
    python import_to_site.py --go --limit 20      (ניסיון על 20 מסמכים)
    python import_to_site.py --go                 (הכול)
"""
import argparse
import base64
import collections
import csv
import getpass
import json
import os
import re
import ssl
import sys
import time
import urllib.error
import urllib.request
import uuid

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import match_pdfs as m  # noqa: E402
from coverage_report import file_hashes  # noqa: E402

UNRELATED = re.compile(r"לא קשור|סוג מסמך אחר|למחוק מהמאגר")
TYPE_OF = {"כללי": "general", "פרטי": "private"}


def rd(path):
    return m.read_csv(path) if path and os.path.exists(path) else []


def build(a):
    biz = json.load(open(a.businesses, encoding="utf-8"))
    by_chp = {str(b.get("chp_number") or "").zfill(9): b["id"] for b in biz if b.get("chp_number")}
    names = []                                           # (שם מנורמל, מזהה עסק) לזיהוי שמות בטקסט
    for b in biz:
        for raw in (b.get("registrar_name"), b.get("permit_name")):
            for part in re.split(r"[;|\n/]+", raw or ""):
                n = " ".join(w for w in m.norm(part).split() if w not in ("בעמ", "בע", "מ"))
                if len(n) >= 6:
                    names.append((n, b["id"]))
    final = {r["attachment_id"]: r for r in rd(a.final)}
    dec = {r["attachment_id"]: r for r in rd(a.decisions)}
    cand = collections.defaultdict(list)
    for r in rd(a.candidates):
        b = by_chp.get(str(r.get("chp") or "").zfill(9))
        if b:
            cand[r.get("candidate_id")].append((b, r.get("evidence", "")))
    guid = {r["ID"]: r.get("guid", "") for r in rd(a.attachments)}
    hashes = file_hashes(a.attachments, a.uploads, a.hash_cache)

    groups = collections.defaultdict(list)               # sha -> שורות מיפוי
    missing = []
    for r in rd(a.map):
        aid = r["attachment_id"]
        p = m.local_path(a.uploads, guid.get(aid, ""))
        if not p or not os.path.exists(p) or aid not in hashes:
            missing.append(aid)
            continue
        r["_path"] = p
        groups[hashes[aid]].append(r)

    docs = []
    for sha, rows in groups.items():
        rows.sort(key=lambda r: int(r["attachment_id"]) if r["attachment_id"].isdigit() else 0)
        ids = [r["attachment_id"] for r in rows]
        types = {TYPE_OF[r["type"]] for r in rows if r["type"] in TYPE_OF}
        combined = any(r.get("combined_by_wording") == "כן" for r in rows)
        doc_type = "both" if combined or types == {"general", "private"} else (next(iter(types)) if types else "unknown")
        notes_user = [d for d in dict.fromkeys((dec.get(i, {}).get("note") or "").strip() for i in ids) if d]
        unrelated = any(UNRELATED.search(n) for n in notes_user)
        companies = [] if unrelated else list(dict.fromkeys(c for r in rows for c in (r.get("company_ids") or "").split(";") if c))
        if unrelated:
            doc_type = "other"
        personal = any(r.get("personal_wording") == "כן" for r in rows)
        tags = []
        kinds = {r.get("file_kind") for r in rows}
        if "מסמך משותף" in kinds:
            tags.append("מסמך משותף (כמה חברות)")
        if kinds & {"כמה מסמכים בקובץ", "משולב"}:
            sp = next((r["split_suggestion"] for r in rows if r.get("split_suggestion")), "")
            tags.append("כמה מסמכים בקובץ (לפיצול)" + (": " + sp if sp else ""))
        if len(rows) > 1:
            tags.append(f"אותו קובץ הופיע {len(rows)} פעמים באתר הישן")
        if notes_user:
            tags.append("הערת בדיקה: " + " | ".join(notes_user)[:400])
        titles = list(dict.fromkeys((final.get(i, {}).get("post_title") or "").strip() for i in ids))
        suggest = []
        if not companies and not unrelated:
            sc = {}
            for i in ids:
                f = final.get(i, {})
                tb = (f.get("title_business") or "").strip()
                if tb:
                    for n, bid in names:
                        if n == " ".join(w for w in m.norm(tb).split() if w not in ("בעמ", "בע", "מ")):
                            sc.setdefault(bid, [1, []])[1].append("לפי שם הפוסט")
                text = f.get("doc_name_matches") or ""
                ntext = m.norm(text)
                for n, bid in names:
                    if n in ntext:
                        sc.setdefault(bid, [2.5, []])[1].append("שם החברה נמצא בקובץ")
                for bid, ev in cand.get(i, []):
                    s, w = sc.setdefault(bid, [2.5, []])
                    sc[bid][0] = max(s, 3 if "ח.פ." in ev else 2.5)
                    w.append("חיפוש בטקסט: " + ev)
            suggest = [{"id": b, "s": v[0], "w": list(dict.fromkeys(v[1]))} for b, v in sorted(sc.items(), key=lambda x: -x[1][0])[:8]]
        docs.append({"sha": sha, "path": rows[0]["_path"], "name": rows[0].get("file") or os.path.basename(rows[0]["_path"]),
                     "doc_type": doc_type, "companies": companies, "note": " · ".join(tags), "title": " | ".join(t for t in titles if t)[:500],
                     "ref": "wp:" + ",".join(ids), "suggest": suggest, "personal": personal})
    return apply_dedupe(settle_personal(docs), a), missing


def settle_personal(docs):
    """מסמך עם הנוסח "אנו מאשרים בזאת, התקשרות אישית" (גם פרטי): משולב רק אם זה המסמך היחיד של החברה;
    אם לחברה יש מסמך אחר שמסווג כללי - הוא פרטי; אחרת נשאר הסיווג לפי המיקום. ההכרעה לפי הסיווג המקורי של המסמכים האחרים."""
    base = {d["sha"]: d["doc_type"] for d in docs}
    by_co = collections.defaultdict(list)
    for d in docs:
        if d["doc_type"] != "other":
            for c in d["companies"]:
                by_co[c].append(d["sha"])
    n = collections.Counter()
    for d in docs:
        if not d.get("personal") or not d["companies"] or d["doc_type"] == "other":
            continue
        others = [{s for s in by_co[c] if s != d["sha"]} for c in d["companies"]]
        if any(any(base[s] in ("general", "both") for s in o) for o in others):
            d["doc_type"] = "private"
            n["פרטי (יש מסמך כללי אחר)"] += 1
        elif not any(others):
            d["doc_type"] = "both"
            n["משולב (מסמך יחיד)"] += 1
        else:
            n["נשאר לפי המיקום"] += 1
    if n:
        print("  נוסח 'התקשרות אישית':", dict(n))
    return docs


def extra_docs(a, plan):
    """כל קובץ PDF מקומי שאינו בתוכנית (לא במיפוי, או כפול שהוסר): מועלה כמסמך לא משויך, סיווג לא ידוע, לשיוך/מחיקה ישר באתר."""
    in_plan = {d["sha"] for d in plan}
    mapped = {r["attachment_id"] for r in rd(a.map)}
    attach = {r["ID"]: r for r in rd(a.attachments)}
    hashes = file_hashes(a.attachments, a.uploads, a.hash_cache)
    groups, skipped = collections.defaultdict(list), collections.Counter()
    for aid, sha in hashes.items():
        if sha in in_plan:
            continue
        r = attach.get(aid, {})
        p = m.local_path(a.uploads, r.get("guid", ""))
        if not p or not os.path.exists(p):
            continue
        if os.path.getsize(p) > 50 * 1024 * 1024:
            skipped["גדול מ-50MB"] += 1
            continue
        with open(p, "rb") as f:
            if f.read(5) != b"%PDF-":
                skipped["לא PDF"] += 1
                continue
        groups[sha].append((aid, r, p))
    out = []
    for sha, rows in groups.items():
        rows.sort(key=lambda x: int(x[0]) if x[0].isdigit() else 0)
        ids = [x[0] for x in rows]
        inmap = any(i in mapped for i in ids)
        titles = list(dict.fromkeys((x[1].get("post_title") or "").strip() for x in rows))
        note = ("כפול שהוסר מהמיפוי (דומה למסמך אחר של החברה)" if inmap else "קובץ שלא במיפוי") + (f" · אותו קובץ הופיע {len(rows)} פעמים" if len(rows) > 1 else "")
        out.append({"sha": sha, "path": rows[0][2], "name": os.path.basename(rows[0][2]), "doc_type": "unknown", "companies": [], "note": note,
                    "title": " | ".join(t for t in titles if t)[:500], "ref": "wp:" + ",".join(ids), "suggest": []})
    print(f"  קבצים נוספים לא משויכים: {len(out)} ({sum(1 for d in out if d['note'].startswith('כפול'))} כפולים שהוסרו, {sum(1 for d in out if d['note'].startswith('קובץ'))} שלא במיפוי)" + (f" | דולגו: {dict(skipped)}" if skipped else ""))
    return out


def apply_dedupe(docs, a):
    """כפילויות שאושרו (כפילויות_לחברות.csv, עמודה action=הסר): לא מעלים שוב מסמך שהוסר כפול. אם הוא משויך גם לחברות אחרות - רק מוסרת ממנו החברה הכפולה.
    המסמך שנשאר מקבל את איחוד הסיווגים (כללי+פרטי)."""
    if a.dedupe and not os.path.exists(a.dedupe) and not a.no_dedupe:
        # אין דוח כפילויות: מריצים את הבדיקה כאן (פעם אחת), שומרים אותו, ובעקבותיו לא מעלים כפולים
        import dedupe_company_docs as dd
        print("  מריץ בדיקת כפילויות לפני ההעלאה (עשוי לקחת כמה דקות; הדוח נשמר ב-" + a.dedupe + ")...")
        rows = dd.build_report(a)
        dd.write_report(rows, a.dedupe)
        print(f"  {len(rows)} זוגות דומים, מהם {sum(1 for r in rows if r['action'] == 'הסר')} כפולים בטוחים שלא יועלו")
    if os.path.exists(a.removed_log) and not a.restore_removed:        # מסמכים שכבר נמחקו ככפולים בעבר: לא מעלים שוב (גם אם הדוח נוצר מחדש)
        gone = {r["sha"] for r in rd(a.removed_log)}
        n = len([d for d in docs if d["sha"] in gone])
        docs = [d for d in docs if d["sha"] not in gone]
        if n:
            print(f"  דילוג על {n} מסמכים שנמחקו ככפולים בעבר (לפי {a.removed_log}; להחזרתם: --restore-removed)")
    if not a.dedupe or not os.path.exists(a.dedupe):
        return docs
    by_sha = {d["sha"]: d for d in docs}
    pairs = [r for r in rd(a.dedupe) if (r.get("action") or "").strip() == "הסר" and r.get("remove_sha") in by_sha and r.get("keep_sha") in by_sha]
    TS = {"general": {"כללי"}, "private": {"פרטי"}, "both": {"כללי", "פרטי"}}
    drop_pairs = collections.defaultdict(set)
    for _ in range(3):                                      # כמה מעברים, בגלל שרשראות (א כלול בב, ב כלול בג)
        for r in pairs:
            k, d = by_sha[r["keep_sha"]], by_sha[r["remove_sha"]]
            u = TS.get(k["doc_type"], set()) | TS.get(d["doc_type"], set())
            if u:
                k["doc_type"] = "both" if len(u) == 2 else ("general" if u == {"כללי"} else "private")
    for r in pairs:
        drop_pairs[r["remove_sha"]].add(r["business_id"])
    out, skipped = [], 0
    for d in docs:
        rm = drop_pairs.get(d["sha"])
        if rm:
            left = [c for c in d["companies"] if c not in rm]
            if not left:
                skipped += 1
                continue
            d = {**d, "companies": left}
        out.append(d)
    print(f"  דילוג על {skipped} מסמכים שהוסרו ככפולים לפי {a.dedupe}")
    return out


def audit_site(docs, existing, a):
    """ביקורת: מה באתר מול מה שאמור להיות לפי קבצי המחשב והדוח הנוכחי (בלי קשר להיסטוריית ההרצות). לא משנה כלום."""
    exp = {d["sha"]: d for d in docs}
    site = {d["sha256"]: d for d in existing}
    rows = []
    for sha, d in exp.items():
        if sha not in site:
            rows.append(["חסר באתר (יועלה בהעלאה הבאה)", d["name"], d["ref"], d["doc_type"], "", "; ".join(d["companies"])[:80], d["note"][:80]])
        elif site[sha]["doc_type"] != d["doc_type"] and site[sha].get("source") == "import":
            rows.append(["סיווג שונה (באתר מול צפוי)", d["name"], d["ref"], d["doc_type"], site[sha]["doc_type"], "", ""])
    for sha, x in site.items():
        if sha not in exp and x.get("source") == "import":
            rows.append(["באתר אבל לא צפוי (כפול שסומן להסרה, או קובץ שאינו במיפוי)", x.get("original_name", ""), x.get("source_ref", ""), "", x["doc_type"], "", (x.get("note") or "")[:80]])
    with open(a.audit_out, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(["status", "file", "source_ref", "expected_type", "site_type", "companies", "note"])
        w.writerows(rows)
    c = collections.Counter(r[0].split(" (")[0] for r in rows)
    print(f"באתר {len(site)} מסמכים | צפויים לפי המחשב והדוח: {len(exp)}")
    for k, v in c.items():
        print(f"  {k}: {v}")
    if not rows:
        print("  הכול תואם.")
    print(f"פירוט: {a.audit_out}")
    return 0


def sync_types(docs, existing, a, token):
    """מיישר את הסיווג באתר לצפוי לפי קבצי המחשב והדוח הנוכחי. נוגע רק במסמכים שהועלו בייבוא ורק בשדה הסיווג. בלי --go: רק מציג.
    הגנה: לא מבצע שינוי שגורם לחברה לאבד כיסוי קיים (למשל היתר פרטי יחיד שהופך לכללי), ולא משנה מסמך שמקושר לרשימה (כללי / פרטי) לסוג שלא מכסה אותה."""
    COV = {"general": {"general"}, "private": {"private"}, "both": {"general", "private"}}
    cov = collections.defaultdict(collections.Counter)                   # חברה -> סוג -> כמה מסמכים מכסים אותו כרגע
    for x in existing:
        for b in x.get("business_ids") or []:
            for t in COV.get(x["doc_type"], ()):
                cov[b][t] += 1
    exp = {d["sha"]: d for d in docs}
    cand = [(x, exp[x["sha256"]]) for x in existing if x.get("source") == "import" and x["sha256"] in exp and x["doc_type"] != exp[x["sha256"]]["doc_type"]]
    todo, blocked = [], []
    for x, d in cand:
        old, new = COV.get(x["doc_type"], set()), COV.get(d["doc_type"], set())
        lost = old - new
        why = []
        for b in x.get("business_ids") or []:
            for t in lost:
                if cov[b][t] <= 1:
                    why.append("החברה תאבד כיסוי " + {"general": "כללי", "private": "פרטי"}[t])
                if t in str((x.get("slots") or {}).get(b, "")).split(","):
                    why.append("המסמך מקושר לרשימת " + {"general": "הכללי", "private": "הפרטי"}[t])
        if why:
            blocked.append((x, d, sorted(set(why))))
            continue
        for b in x.get("business_ids") or []:
            for t in lost:
                cov[b][t] -= 1
            for t in new - old:
                cov[b][t] += 1
        todo.append((x, d))
    for x, d in todo:
        print(f"  {d['name']} ({d['ref']}): {x['doc_type']} -> {d['doc_type']}")
    for x, d, why in blocked:
        print(f"  דולג: {d['name']} ({d['ref']}): {x['doc_type']} -> {d['doc_type']}  [{'; '.join(why)}]")
    print(f"{len(todo)} מסמכים ישתנו; {len(blocked)} דולגו כדי לא לדרוס כיסוי קיים (היתר פרטי / כללי או קישור לרשימה).")
    if not a.go:
        print("ליישור בפועל: python import_to_site.py --sync-types --go")
        return 0
    ok = 0
    for x, d in todo:
        try:
            call(a.site, token, "/permit-docs/" + x["id"], json.dumps({"doc_type": d["doc_type"]}).encode("utf-8"), "application/json", method="PUT")
            ok += 1
        except Exception as e:  # noqa: BLE001
            print(f"  נכשל {d['name']} ({d['ref']}): {e}")
    print(f"עודכנו {ok} מתוך {len(todo)}.")
    return 0


def multipart(fields, fname, data):
    b = "----" + uuid.uuid4().hex
    out = []
    for k, v in fields.items():
        out.append(f'--{b}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode("utf-8"))
    out.append(f'--{b}\r\nContent-Disposition: form-data; name="file"; filename="{fname}"\r\nContent-Type: application/pdf\r\n\r\n'.encode("utf-8") + data + b"\r\n")
    out.append(f"--{b}--\r\n".encode())
    return b"".join(out), "multipart/form-data; boundary=" + b


STRICT = [True]


def ssl_context():
    ctx = ssl.create_default_context()           # אימות התעודה נשאר מלא; רק הבדיקה הקפדנית-מדי של סיומות בתעודת ה-CA (Python 3.13) מוקלת בפולבק
    if not STRICT[0] and hasattr(ssl, "VERIFY_X509_STRICT"):
        ctx.verify_flags &= ~ssl.VERIFY_X509_STRICT
    return ctx


def call(site, token, path, data=None, ctype=None, method=None):
    req = urllib.request.Request(site.rstrip("/") + "/api" + path, data=data, method=method or ("POST" if data else "GET"),
                                 headers={"User-Agent": "Mozilla/5.0 (permit-import)",      # Cloudflare חוסם את ה-User-Agent הרגיל של Python (שגיאה 1010)
                                          **({"Authorization": "Bearer " + token} if token else {}), **({"Content-Type": ctype} if ctype else {})})
    for _ in range(2):
        try:
            with urllib.request.urlopen(req, timeout=180, context=ssl_context()) as r:
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.URLError as e:
            # תעודת CA בלי סיומת key usage (נפוץ עם אנטי-וירוס/פרוקסי מקומי) נדחית ב-Python 3.13: מנסים שוב בלי הבדיקה הקפדנית הזו, עם אימות תעודה מלא
            if STRICT[0] and isinstance(e.reason, ssl.SSLCertVerificationError) and "key usage" in str(e.reason):
                STRICT[0] = False
                print("הערה: תעודת CA במחשב חסרה סיומת key usage; ממשיך עם אימות תעודה מלא, בלי הבדיקה הקפדנית הזו.")
                continue
            raise


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--site", default="https://harav-levin.pages.dev")
    ap.add_argument("--map", default="מיפוי_קבצים.csv")
    ap.add_argument("--final", default="סופי_מאוחד.csv")
    ap.add_argument("--decisions", default="החלטות_בדיקה.csv")
    ap.add_argument("--candidates", default="מועמדים_לחברות_חסרות.csv")
    ap.add_argument("--businesses", default="businesses.json")
    ap.add_argument("--attachments", default="attachments.csv")
    ap.add_argument("--uploads", default=os.path.join("wp-content", "uploads"))
    ap.add_argument("--hash-cache", default="hashes_cache.json")
    ap.add_argument("--password-file", default="admin_password.txt", help="קובץ טקסט עם סיסמת המנהל בשורה הראשונה (אם אין משתנה ADMIN_PASSWORD)")
    ap.add_argument("--dedupe", default="כפילויות_לחברות.csv", help="דוח הכפילויות שאושר (כפילויות_לחברות.csv): מסמכים שסומנו הסר לא יועלו שוב")
    ap.add_argument("--removed-log", default="dedupe_removed.csv")
    ap.add_argument("--restore-removed", action="store_true", help="להעלות גם מסמכים שנמחקו ככפולים בעבר (לפי היומן)")
    ap.add_argument("--audit", action="store_true", help="ביקורת בלבד: מה חסר באתר / מיותר / בסיווג שונה, לפי קבצי המחשב והדוח הנוכחי (לא משנה כלום)")
    ap.add_argument("--sync-types", action="store_true", help="יישור הסיווג באתר לצפוי (רק מסמכים שהועלו בייבוא). בלי --go: רק מציג מה ישתנה")
    ap.add_argument("--upload-rest", action="store_true", help="כל שאר קובצי ה-PDF שאינם בתוכנית: הצגה, ועם --go העלאה כמסמכים לא משויכים (סיווג לא ידוע)")
    ap.add_argument("--audit-out", default="ביקורת_אתר.csv")
    ap.add_argument("--no-dedupe", action="store_true", help="בלי בדיקת כפילויות לפני ההעלאה")
    ap.add_argument("--ocr-dir", default="ocr_text")
    ap.add_argument("--replace-altered", action="store_true", help="להחליף מסמכים שהועלו קודם עם תוכן שונה מהמקור (נמחק הישן ומועלה התקין)")
    ap.add_argument("--go", action="store_true", help="להעלות בפועל (בלי זה: דוח בלבד)")
    ap.add_argument("--limit", type=int, default=0)
    a = ap.parse_args()

    if a.audit:
        a.restore_removed = True                         # ביקורת: מתעלמים מהיסטוריית המחיקות; רק קבצי המחשב והדוח הנוכחי קובעים מה אמור להיות באתר
    docs, missing = build(a)
    if a.upload_rest:
        docs = extra_docs(a, docs)
    c = collections.Counter(d["doc_type"] for d in docs)
    print(f"{len(docs)} מסמכים ייחודיים (לפי תוכן) | סוגים: {dict(c)}")
    print(f"  עם חברה משויכת: {sum(1 for d in docs if d['companies'])} | בלי שיוך: {sum(1 for d in docs if not d['companies'] and d['doc_type'] != 'other')} (מהם עם הצעות שיוך: {sum(1 for d in docs if d['suggest'])}) | לא קשור: {c.get('other', 0)}")
    if missing:
        print(f"  {len(missing)} שורות במיפוי בלי קובץ מקומי: {', '.join(missing[:15])}{'...' if len(missing) > 15 else ''}")
    if not a.go and not a.audit and not a.sync_types:
        print("דוח בלבד. להעלאה: python import_to_site.py " + ("--upload-rest " if a.upload_rest else "") + "--go   (אפשר קודם --go --limit 20)")
        return 0
    token = os.environ.get("ADMIN_PASSWORD") or ""
    if not token and os.path.exists(a.password_file):       # קובץ מקומי עם הסיסמה בשורה הראשונה: אין צורך להקליד בכל הרצה
        with open(a.password_file, encoding="utf-8-sig") as f:
            token = (f.readline() or "").strip()
    token = token or getpass.getpass("סיסמת מנהל האתר: ")
    try:
        existing = call(a.site, token, "/permit-docs")["docs"]
    except urllib.error.HTTPError as e:
        print("גישה נדחתה או שגיאה:", e.code, e.read().decode("utf-8", "replace")[:200])
        return 1
    if a.audit:
        return audit_site(docs, existing, a)
    if a.sync_types:
        return sync_types(docs, existing, a, token)
    have = {d["sha256"] for d in existing}
    by_ref = {d["source_ref"]: d for d in existing if d.get("source") == "import" and d.get("source_ref")}
    todo = [d for d in docs if d["sha"] not in have]
    altered = [d for d in todo if d["ref"] in by_ref]            # קיים באתר מאותו מקור אבל עם תוכן שונה: נשמר משובש בהעלאה קודמת (סינון תוכן)
    if altered and not a.replace_altered:
        print(f"  {len(altered)} מסמכים כבר באתר אבל עם תוכן שונה מהמקור (כנראה נשתנו בהעלאה קודמת). להחלפתם: --replace-altered")
        todo = [d for d in todo if d["ref"] not in by_ref]
    if a.limit:
        todo = todo[:a.limit]
    print(f"{len(have)} מסמכים כבר באתר; מעלה {len(todo)}...")
    ok = fail = 0
    changed = []
    for n, d in enumerate(todo, 1):
        with open(d["path"], "rb") as f:
            data = f.read()
        if d["ref"] in by_ref and a.replace_altered:                      # מחיקת הגרסה המשובשת הישנה לפני העלאת התקינה
            try:
                call(a.site, token, "/permit-docs/" + by_ref[d["ref"]]["id"], method="DELETE")
            except Exception as e:  # noqa: BLE001
                print(f"  לא ניתן למחוק את הישן ({d['ref']}): {e}")
        # העלאה כ-JSON (base64): ברשת עם סינון תוכן (נטפרי) קובץ PDF בגוף הבקשה עלול להשתנות בדרך
        body = json.dumps({"file_b64": base64.b64encode(data).decode("ascii"), "name": d["name"], "doc_type": d["doc_type"], "business_ids": d["companies"],
                           "note": d["note"], "source": "import", "source_ref": d["ref"], "source_title": d["title"],
                           "suggest": json.dumps(d["suggest"], ensure_ascii=False) if d["suggest"] else ""}).encode("utf-8")
        ct = "application/json"
        for attempt in range(4):
            try:
                res = call(a.site, token, "/permit-docs", body, ct)
                ok += 1
                if (res.get("doc") or {}).get("sha256") not in (None, d["sha"]):     # השרת קיבל קובץ שונה מהמקור (סינון תוכן ברשת משנה את הקובץ בדרך)
                    changed.append(d["ref"])
                    print(f"  אזהרה: {d['name']} ({d['ref']}) נשמר שונה מהקובץ המקומי")
                break
            except urllib.error.HTTPError as e:
                msg = e.read().decode("utf-8", "replace")[:150]
                if e.code == 409:                 # כבר קיים (ריצה קודמת)
                    ok += 1
                    break
                if e.code < 500 and e.code != 429:
                    fail += 1
                    print(f"  נכשל {d['name']} ({d['ref']}): {e.code} {msg}")
                    break
                time.sleep(3 * (attempt + 1))
            except Exception as e:  # noqa: BLE001
                if attempt == 3:
                    fail += 1
                    print(f"  נכשל {d['name']} ({d['ref']}): {e}")
                time.sleep(3 * (attempt + 1))
        if n % 25 == 0 or n == len(todo):
            print(f"  {n}/{len(todo)} (הצליחו {ok}, נכשלו {fail})", flush=True)
    if changed:
        print(f"  {len(changed)} מסמכים נשמרו שונים מהמקור (כנראה סינון תוכן ברשת): {', '.join(changed[:20])}")
    print(f"סיום: הועלו {ok}, נכשלו {fail}. ניתן להריץ שוב: מה שהועלה מדולג.")
    return 0 if not fail else 2


if __name__ == "__main__":
    sys.exit(main())
