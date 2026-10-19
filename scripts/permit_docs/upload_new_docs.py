# -*- coding: utf-8 -*-
"""
מעלה לאתר את קובצי ה-PDF החדשים שחולצו מהגיבוי (תיקיית new_files מ-old_site_links.py --extract) כמסמכים לא משויכים,
כדי שיופיעו בדשבורד ("שטרות שמחכים לשיוך") ויוצעו לחברות לפי ח.פ. ושם. קובץ שכבר באתר (לפי חתימת תוכן) מדולג.

    python upload_new_docs.py                 הרצה יבשה: מדפיס מה יועלה
    python upload_new_docs.py --go            העלאה בפועל
    python upload_new_docs.py --dir new_files --list old_new_files.csv --go

סיסמת מנהל: ADMIN_PASSWORD / admin_password.txt / תישאל. לא מוחק ולא משנה שום מסמך קיים.
"""
import argparse
import base64
import csv
import getpass
import hashlib
import json
import os
import ssl
import urllib.error
import urllib.request

STRICT = [True]


def ssl_context():
    ctx = ssl.create_default_context()
    if not STRICT[0] and hasattr(ssl, "VERIFY_X509_STRICT"):
        ctx.verify_flags &= ~ssl.VERIFY_X509_STRICT
    return ctx


def call(site, token, path, body=None):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(site.rstrip("/") + "/api" + path, data=data, method="POST" if data else "GET",
                                 headers={"User-Agent": "Mozilla/5.0 (permit-upload)", "Content-Type": "application/json", "Authorization": "Bearer " + token})
    for _ in range(2):
        try:
            with urllib.request.urlopen(req, timeout=300, context=ssl_context()) as r:
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            if e.code == 409:
                return json.loads(e.read().decode("utf-8") or "{}")
            raise
        except urllib.error.URLError as e:
            if STRICT[0] and isinstance(e.reason, ssl.SSLCertVerificationError) and "key usage" in str(e.reason):
                STRICT[0] = False
                continue
            raise


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--site", default="https://harav-levin.pages.dev")
    ap.add_argument("--dir", default="new_files")
    ap.add_argument("--list", default="old_new_files.csv")
    ap.add_argument("--go", action="store_true")
    ap.add_argument("--password-file", default="admin_password.txt")
    a = ap.parse_args()
    token = os.environ.get("ADMIN_PASSWORD") or ""
    if not token and os.path.exists(a.password_file):
        token = (open(a.password_file, encoding="utf-8").readline() or "").strip()
    token = token or getpass.getpass("סיסמת מנהל האתר: ")
    why = {}
    if os.path.exists(a.list):
        for r in csv.DictReader(open(a.list, encoding="utf-8-sig")):
            why[r["קובץ"]] = r["מקושר מ"]
    files = sorted(f for f in os.listdir(a.dir) if f.lower().endswith(".pdf"))
    print(f"קבצים בתיקייה: {len(files)}" + ("" if a.go else "  (הרצה יבשה: הוסף --go להעלאה)"))
    up = skip = bad = 0
    for fn in files:
        data = open(os.path.join(a.dir, fn), "rb").read()
        sha = hashlib.sha256(data).hexdigest()
        try:
            ex = call(a.site, token, "/permit-docs?sha=" + sha)
        except Exception as e:  # noqa: BLE001
            print("  שגיאה בבדיקה:", fn, e); bad += 1; continue
        if ex.get("exists"):
            skip += 1
            continue
        name = fn.split("__", 1)[-1]
        print("  " + ("מעלה: " if a.go else "יועלה: ") + name + "  (" + why.get(fn, "") + ")")
        if a.go:
            try:
                call(a.site, token, "/permit-docs", {"file_b64": base64.b64encode(data).decode(), "name": name, "doc_type": "unknown", "business_ids": [], "note": ("מהאתר הישן: " + why.get(fn, ""))[:400]})
                up += 1
            except Exception as e:  # noqa: BLE001
                print("  נכשל:", fn, e); bad += 1
        else:
            up += 1
    print(f"{'הועלו' if a.go else 'היו מועלים'}: {up}; כבר באתר: {skip}; שגיאות: {bad}")


if __name__ == "__main__":
    main()
