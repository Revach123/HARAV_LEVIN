# -*- coding: utf-8 -*-
"""
מעלה לאתר כל מסמך PDF מהגיבויים ומהאתר הישן שעדיין לא באתר (לפי חתימת תוכן), כמסמכים לא משויכים,
כך שאם בסוף נשארים מסמכים בלי שיוך - הכל כבר נמצא באתר ואפשר לשייך מהדשבורד ("שטרות שמחכים לשיוך").

    python upload_all_to_site.py                 הרצה יבשה: מדפיס כמה מסמכים חסרים ומה יועלה
    python upload_all_to_site.py --go            העלאה בפועל (אפשר להפסיק ולהמשיך: מסמך שכבר באתר מדולג)
    python upload_all_to_site.py --roots "wp-content\\uploads" "C:\\...\\BACKUP_harav_levin" --links old_links.csv --go

מה נסרק: תיקיות וקובצי zip של uploads (גם בתוך zip). לא מועלים:
  * אישורי הצטרפות בתיקיות ממוספרות (91, 101...): אלה נתונים אישיים של מצטרפים, לא מסמכי היתר, והם נשמרים בנפרד ובהצפנה
  * תצוגות מקדימות / טפסים של תוסף הטפסים (preview-*, document-pdf*) וקבצי תוספים / ערכות נושא
כל מסמך חדש מועלה בלי שיוך, עם הערה מאיפה בא, וכותרת הפוסט הישן (אם ידוע, מ-old_links.csv).
סיסמת מנהל: ADMIN_PASSWORD / admin_password.txt / תישאל. לא מוחק ולא משנה מסמך קיים.
"""
import argparse
import base64
import csv
import getpass
import hashlib
import json
import os
import re
import ssl
import time
import urllib.error
import urllib.request
import zipfile

STRICT = [True]
SKIP_NAME = re.compile(r"(document-pdf|preview-\d+|preview-)", re.I)
FORM_DIR = re.compile(r"^(?!20\d\d/)\d+/")


def ctx():
    c = ssl.create_default_context()
    if not STRICT[0] and hasattr(ssl, "VERIFY_X509_STRICT"):
        c.verify_flags &= ~ssl.VERIFY_X509_STRICT
    return c


def call(site, token, path, body=None):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(site.rstrip("/") + "/api" + path, data=data, method="POST" if data else "GET",
                                 headers={"User-Agent": "Mozilla/5.0 (permit-upload)", "Content-Type": "application/json", "Authorization": "Bearer " + token})
    last = None
    for attempt in range(5):
        try:
            with urllib.request.urlopen(req, timeout=300, context=ctx()) as r:
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            if e.code == 409:
                return json.loads(e.read().decode("utf-8") or "{}")
            raise
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
    ap.add_argument("--roots", nargs="*", default=[os.path.join("wp-content", "uploads")])
    ap.add_argument("--links", default="old_links.csv", help="old_links.csv (לכותרות הפוסטים הישנים בהערה; לא חובה)")
    ap.add_argument("--go", action="store_true")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--password-file", default="admin_password.txt")
    a = ap.parse_args()
    token = os.environ.get("ADMIN_PASSWORD") or ""
    if not token and os.path.exists(a.password_file):
        token = (open(a.password_file, encoding="utf-8").readline() or "").strip()
    token = token or getpass.getpass("סיסמת מנהל האתר: ")

    titles = {}
    if os.path.exists(a.links):
        for r in csv.reader(open(a.links, encoding="utf-8-sig")):
            if len(r) > 7 and r[7] and r[0] in ("כללי", "פרטי"):
                titles.setdefault(r[7].lower(), set()).add(f"{r[0]}: {r[5]}")
    print("סורק את התיקיות והארכיבים…")
    entries = []          # (relpath, src, inner)
    for root in a.roots:
        for dp, _, fn in os.walk(root):
            low = dp.lower().replace("\\", "/")
            for f in fn:
                fp = os.path.join(dp, f)
                if f.lower().endswith(".zip"):
                    zl = f.lower()
                    if "uploads" not in zl or any(x in zl for x in ("plugins", "themes", "others")):
                        continue
                    try:
                        with zipfile.ZipFile(fp) as z:
                            for zi in z.infolist():
                                if not zi.is_dir() and zi.filename.lower().endswith(".pdf"):
                                    n = zi.filename.replace("\\", "/")
                                    rel = n[n.lower().rfind("uploads/") + 8:] if "uploads/" in n.lower() else n
                                    entries.append((rel, fp, zi.filename))
                    except Exception as e:  # noqa: BLE001
                        print("  zip לא נקרא:", fp, e)
                elif f.lower().endswith(".pdf") and "/uploads" in "/" + low:
                    rel = os.path.join(dp, f).replace("\\", "/")
                    rel = rel[rel.lower().rfind("uploads/") + 8:] if "uploads/" in rel.lower() else f
                    entries.append((rel, fp, fp))
    keep = []
    n_form = n_prev = 0
    for rel, src, inner in entries:
        if FORM_DIR.match(rel):
            n_form += 1
            continue
        if SKIP_NAME.search(os.path.basename(rel)):
            n_prev += 1
            continue
        keep.append((rel, src, inner))
    print(f"נמצאו {len(entries)} קובצי PDF; מדולגים: אישורי הצטרפות {n_form}, תצוגות מקדימות / טפסים {n_prev}; נשארו {len(keep)}")

    have = {(d.get("sha256") or "") for d in call(a.site, token, "/permit-docs")["docs"]}
    print(f"באתר כבר: {len(have)} מסמכים. מחשב חתימות לקבצים…")
    by_sha = {}
    for i, (rel, src, inner) in enumerate(keep, 1):
        try:
            data = open(src, "rb").read() if src == inner else zipfile.ZipFile(src).read(inner)
        except Exception:  # noqa: BLE001
            continue
        if data[:5] != b"%PDF-":
            continue
        sh = hashlib.sha256(data).hexdigest()
        if sh in have:
            continue
        e = by_sha.setdefault(sh, {"rels": [], "src": src, "inner": inner})
        e["rels"].append(rel)
        if i % 500 == 0:
            print(f"  נבדקו {i}/{len(keep)}; חסרים באתר עד כה: {len(by_sha)}", flush=True)
    print(f"\nחסרים באתר: {len(by_sha)} מסמכים ייחודיים" + ("" if a.go else "  (הרצה יבשה: הוסף --go להעלאה)"))
    up = bad = 0
    for sh, e in sorted(by_sha.items(), key=lambda x: x[1]["rels"][0]):
        if a.limit and up >= a.limit:
            break
        rel = e["rels"][0]
        why = sorted({t for r in e["rels"] for t in titles.get(r.lower(), ())})
        print(f"  {'מעלה' if a.go else 'יועלה'}: {rel}" + (f"  ({'; '.join(why)[:80]})" if why else ""))
        if not a.go:
            up += 1
            continue
        try:
            data = open(e["src"], "rb").read() if e["src"] == e["inner"] else zipfile.ZipFile(e["src"]).read(e["inner"])
            call(a.site, token, "/permit-docs", {"file_b64": base64.b64encode(data).decode(), "name": os.path.basename(rel), "doc_type": "unknown", "business_ids": [],
                                                  "note": ("מהאתר הישן: " + " | ".join(e["rels"]))[:400], "source": "old_site", "source_ref": rel[:200],
                                                  "source_title": ("; ".join(why))[:300]})
            up += 1
        except Exception as ex:  # noqa: BLE001
            print("    נכשל:", ex)
            bad += 1
    print(f"\n{'הועלו' if a.go else 'היו מועלים'}: {up}; נכשלו: {bad}")


if __name__ == "__main__":
    main()
