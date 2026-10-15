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
  נדרשת סיסמת מנהל האתר: משתנה הסביבה ADMIN_PASSWORD, או הקלדה בשורת הפקודה.
    python import_to_site.py                      (דוח)
    python import_to_site.py --go --limit 20      (ניסיון על 20 מסמכים)
    python import_to_site.py --go                 (הכול)
"""
import argparse
import collections
import getpass
import json
import os
import re
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
                     "ref": "wp:" + ",".join(ids), "suggest": suggest})
    return docs, missing


def multipart(fields, fname, data):
    b = "----" + uuid.uuid4().hex
    out = []
    for k, v in fields.items():
        out.append(f'--{b}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode("utf-8"))
    out.append(f'--{b}\r\nContent-Disposition: form-data; name="file"; filename="{fname}"\r\nContent-Type: application/pdf\r\n\r\n'.encode("utf-8") + data + b"\r\n")
    out.append(f"--{b}--\r\n".encode())
    return b"".join(out), "multipart/form-data; boundary=" + b


def call(site, token, path, data=None, ctype=None, method=None):
    req = urllib.request.Request(site.rstrip("/") + "/api" + path, data=data, method=method or ("POST" if data else "GET"),
                                 headers={"Authorization": "Bearer " + token, **({"Content-Type": ctype} if ctype else {})})
    with urllib.request.urlopen(req, timeout=180) as r:
        return json.loads(r.read().decode("utf-8"))


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
    ap.add_argument("--go", action="store_true", help="להעלות בפועל (בלי זה: דוח בלבד)")
    ap.add_argument("--limit", type=int, default=0)
    a = ap.parse_args()

    docs, missing = build(a)
    c = collections.Counter(d["doc_type"] for d in docs)
    print(f"{len(docs)} מסמכים ייחודיים (לפי תוכן) | סוגים: {dict(c)}")
    print(f"  עם חברה משויכת: {sum(1 for d in docs if d['companies'])} | בלי שיוך: {sum(1 for d in docs if not d['companies'] and d['doc_type'] != 'other')} (מהם עם הצעות שיוך: {sum(1 for d in docs if d['suggest'])}) | לא קשור: {c.get('other', 0)}")
    if missing:
        print(f"  {len(missing)} שורות במיפוי בלי קובץ מקומי: {', '.join(missing[:15])}{'...' if len(missing) > 15 else ''}")
    if not a.go:
        print("דוח בלבד. להעלאה: python import_to_site.py --go   (אפשר קודם --go --limit 20)")
        return 0
    token = os.environ.get("ADMIN_PASSWORD") or getpass.getpass("סיסמת מנהל האתר: ")
    try:
        have = {d["sha256"] for d in call(a.site, token, "/permit-docs")["docs"]}
    except urllib.error.HTTPError as e:
        print("גישה נדחתה או שגיאה:", e.code, e.read().decode("utf-8", "replace")[:200])
        return 1
    todo = [d for d in docs if d["sha"] not in have]
    if a.limit:
        todo = todo[:a.limit]
    print(f"{len(have)} מסמכים כבר באתר; מעלה {len(todo)}...")
    ok = fail = 0
    for n, d in enumerate(todo, 1):
        with open(d["path"], "rb") as f:
            data = f.read()
        body, ct = multipart({"doc_type": d["doc_type"], "business_ids": json.dumps(d["companies"]), "note": d["note"], "source": "import",
                              "source_ref": d["ref"], "source_title": d["title"], "suggest": json.dumps(d["suggest"], ensure_ascii=False) if d["suggest"] else ""},
                             d["name"], data)
        for attempt in range(4):
            try:
                call(a.site, token, "/permit-docs", body, ct)
                ok += 1
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
    print(f"סיום: הועלו {ok}, נכשלו {fail}. ניתן להריץ שוב: מה שהועלה מדולג.")
    return 0 if not fail else 2


if __name__ == "__main__":
    sys.exit(main())
