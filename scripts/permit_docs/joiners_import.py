# -*- coding: utf-8 -*-
"""
ייבוא רשימת המצטרפים (joiners.csv מ-joiners_export.py) וקובצי אישור ההצטרפות (PDF) ל-D1 ול-R2. רץ במחשב שלך בלבד.

אבטחה:
  * כל הפרטים האישיים (שם, טלפון, דוא"ל, ת.ז., IP, החברות שנבחרו, שדות נוספים) מוצפנים כאן, במחשב שלך, ב-AES-256-GCM, לפני שהם יוצאים ל-D1.
    ב-D1 נשמרים רק מזהים, תאריכים ו-HMAC של ת.ז. (לאיתור כפילויות). המפתח לא נשמר ב-D1 ולא בגיט: הקובץ joiners_private\\key.b64 + משתנה הסביבה JOINERS_KEY באתר.
    **לשמור גיבוי של key.b64 במקום בטוח: בלעדיו אי אפשר לפענח את הרשימה.**
  * קובצי ה-PDF עולים לדלי R2 פרטי נפרד, בשם לפי תוכן (forms/<מספר טופס>/<sha256>.pdf), בלי שם אדם בשם הקובץ.

שימוש (מתיקיית האתר):
    pip install cryptography
    python joiners_import.py keygen                  # פעם אחת: יוצר מפתח
    python joiners_import.py prepare                 # מכין קובצי SQL (d1_joiners\\) ורשימת קבצים להעלאה
    d1_joiners\\run_all.cmd                          # מייבא ל-D1 (אחרי שהרצת את migrations\\0017_joiners.sql)
    python joiners_import.py upload                  # מעלה את ה-PDF ל-R2 (אחרי npx wrangler r2 bucket create harav-levin-joiners)
הרצה חוזרת בטוחה: INSERT OR REPLACE, סימוני התקדמות, והעלאה ממשיכה מאיפה שנעצרה.
"""
import argparse
import base64
import collections
import csv
import glob
import hashlib
import hmac
import json
import os
import re
import subprocess
import sys
import tempfile
import zipfile
from concurrent.futures import ThreadPoolExecutor

PRIV = "joiners_private"
FORM_DIRS = ("91", "118")          # 91 = הצטרפות, 118 = ביטול


def digits(x):
    return re.sub(r"\D", "", x or "")


def key_path():
    return os.path.join(PRIV, "key.b64")


def load_key():
    if not os.path.exists(key_path()):
        sys.exit("אין מפתח. הרץ קודם: python joiners_import.py keygen")
    k = base64.b64decode(open(key_path(), "r").read().strip())
    if len(k) != 32:
        sys.exit("המפתח אינו תקין (צריך 32 בתים)")
    return k


def keygen():
    os.makedirs(PRIV, exist_ok=True)
    if os.path.exists(key_path()):
        print(f"כבר קיים מפתח: {key_path()} (לא נוצר חדש, כדי לא לאבד גישה לנתונים קיימים)")
    else:
        open(key_path(), "w").write(base64.b64encode(os.urandom(32)).decode())
        print(f"נוצר מפתח: {key_path()}")
    print("""
חשוב:
  1. לשמור גיבוי של joiners_private\\key.b64 במקום בטוח (למשל כונן חיצוני). בלעדיו לא ניתן לפענח את הרשימה, והוא לא יישמר באף מקום אחר.
  2. להגדיר את אותו מפתח באתר, כדי שמסך הניהול יוכל לפענח: ב-Cloudflare, Workers & Pages, הפרויקט של האתר, Settings, Variables and Secrets,
     להוסיף Secret בשם JOINERS_KEY עם התוכן של הקובץ (שורה אחת). אל תדביק את המפתח בשום שיחה או מייל.""")


# ───────── הצפנה (תואמת ל-functions/api/_shared/joiners-crypto.js) ─────────
def encrypt(key, row_id, payload):
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    nonce = os.urandom(12)
    ct = AESGCM(key).encrypt(nonce, json.dumps(payload, ensure_ascii=False).encode("utf-8"), str(row_id).encode("utf-8"))
    return base64.b64encode(nonce + ct).decode()


def q(x):
    return "'" + str(x if x is not None else "").replace("\x00", "").replace("'", "''") + "'"


def sid(primary):
    return hashlib.sha1(primary.encode()).hexdigest()[:16]


def primary_key(m):
    parts = [x.strip() for x in (m or "").split("|") if x.strip()]
    pick = [x for x in parts if x.startswith("cfdb7:")] or parts
    return pick[0] if pick else ""


# ───────── קובצי ה-PDF: מהארכיבים של הגיבוי ומהתיקייה המקומית ─────────
def find_pdfs(updraft, uploads):
    out, seen = [], set()
    for zp in sorted(glob.glob(os.path.join(updraft, "*uploads*.zip"))):
        try:
            z = zipfile.ZipFile(zp)
        except Exception as e:  # noqa: BLE001
            print(f"לא נפתח: {zp} ({e})"); continue
        for zi in z.infolist():
            n = zi.filename.replace("\\", "/")
            m = re.search(r"sendpdfcf7_uploads/(\d+)/([^/]+\.pdf)$", n, re.I)
            if m and m.group(1) in FORM_DIRS and not re.match(r"(preview-|document-pdf)", m.group(2), re.I):
                data = z.read(zi)
                sha = hashlib.sha256(data).hexdigest()
                if sha not in seen:
                    seen.add(sha); out.append({"sha": sha, "name": m.group(2), "form": m.group(1), "size": len(data), "zip": zp, "entry": zi.filename})
    for f in FORM_DIRS:
        for p in glob.glob(os.path.join(uploads, "sendpdfcf7_uploads", f, "*.pdf")):
            if re.match(r"(preview-|document-pdf)", os.path.basename(p), re.I):
                continue
            data = open(p, "rb").read(); sha = hashlib.sha256(data).hexdigest()
            if sha not in seen:
                seen.add(sha); out.append({"sha": sha, "name": os.path.basename(p), "form": f, "size": len(data), "path": p})
    return out


def read_pdf(item):
    if "zip" in item:
        with zipfile.ZipFile(item["zip"]) as z:
            return z.read(item["entry"])
    return open(item["path"], "rb").read()


def r2_key(item):
    return f"forms/{item['form']}/{item['sha']}.pdf"


# ───────── prepare ─────────
def prepare(a):
    key = load_key()
    jr = list(csv.DictReader(open(os.path.join(PRIV, "joiners.csv"), encoding="utf-8-sig")))
    cr_path = os.path.join(PRIV, "joiners_cancels.csv")
    cr = list(csv.DictReader(open(cr_path, encoding="utf-8-sig"))) if os.path.exists(cr_path) else []
    files = find_pdfs(a.updraft, a.uploads)
    by_name = {}
    for it in files:
        by_name[re.sub(r"\.pdf$", "", it["name"], flags=re.I).lower()] = it
    stmts, with_file = [], 0
    for r in jr:
        pk = primary_key(r.get("מפתח"))
        if not pk:
            continue
        rid = sid(pk)
        nm = re.sub(r"\.pdf$", "", os.path.basename(r.get("קובץ אישור") or ""), flags=re.I).lower()
        f = by_name.get(nm)
        with_file += 1 if f else 0
        cancelled = (r.get("ביטל") or "").replace("כן,", "").strip()
        payload = {"first": r.get("שם פרטי", ""), "last": r.get("שם משפחה", ""), "phone": r.get("טלפון", ""), "email": r.get("דוא\"ל", ""), "id": r.get("תעודת זהות", ""),
                   "ip": r.get("כתובת IP", ""), "companies": r.get("חברות שנבחרו", ""), "all": r.get("כל החברות", ""), "pdf": r.get("קובץ אישור", ""), "extra": r.get("נוסף", ""), "src": r.get("מפתח", "")}
        ih = hmac.new(key, digits(r.get("תעודת זהות")).encode(), hashlib.sha256).hexdigest() if digits(r.get("תעודת זהות")) else ""
        stmts.append(f"INSERT OR REPLACE INTO joiners (id, submitted_at, cancelled_at, file_sha256, ident_hash, pii) VALUES ({q(rid)}, {q((r.get('תאריך') or '')[:19])}, {q(cancelled)}, {q(f['sha'] if f else '')}, {q(ih)}, {q(encrypt(key, rid, payload))});")
    for r in cr:
        pk = primary_key(r.get("מפתח"))
        if not pk:
            continue
        rid = sid("cancel:" + pk)
        payload = {"name": r.get("שם", ""), "phone": r.get("טלפון", ""), "email": r.get("דוא\"ל", ""), "src": r.get("מפתח", "")}
        stmts.append(f"INSERT OR REPLACE INTO joiner_cancels (id, requested_at, matched_joiners, pii) VALUES ({q(rid)}, {q((r.get('תאריך בקשה') or r.get('תאריך') or '')[:19])}, {q('כן' if r.get('הותאם למצטרף') else '')}, {q(encrypt(key, rid, payload))});")
    for it in files:
        stmts.append(f"INSERT OR REPLACE INTO joiner_files (sha256, original_name, r2_key, size) VALUES ({q(it['sha'])}, {q(it['name'])}, {q(r2_key(it))}, {it['size']});")
    os.makedirs(a.out, exist_ok=True)
    for fn in os.listdir(a.out):
        if fn.startswith(("part_", "done_")):
            os.remove(os.path.join(a.out, fn))
    parts, cur, size = [], [], 0
    for s in stmts:
        if size + len(s) > a.part_kb * 1024 and cur:
            parts.append("\n".join(cur) + "\n"); cur, size = [], 0
        cur.append(s); size += len(s) + 1
    if cur:
        parts.append("\n".join(cur) + "\n")
    for k, body in enumerate(parts, 1):
        open(os.path.join(a.out, f"part_{k:03d}.sql"), "w", encoding="utf-8", newline="\n").write(body)
    with open(os.path.join(a.out, "run_all.cmd"), "w", encoding="utf-8", newline="\r\n") as f:
        f.write("@echo off\nREM ייבוא רשימת המצטרפים ל-D1. כל קובץ שהושלם מסומן ומדולג בהרצה חוזרת; עוצר בשגיאה הראשונה.\n")
        for k in range(1, len(parts) + 1):
            f.write(f"if not exist {a.out}\\done_{k:03d}.txt (\n  echo === part_{k:03d} ===\n  call npx wrangler d1 execute business-registry-db --remote --yes --file={a.out}\\part_{k:03d}.sql\n  if errorlevel 1 exit /b 1\n  echo ok> {a.out}\\done_{k:03d}.txt\n)\n")
        f.write("echo done\n")
    json.dump([{k: v for k, v in it.items()} for it in files], open(os.path.join(PRIV, "files.json"), "w", encoding="utf-8"), ensure_ascii=False)
    print(f"מצטרפים: {len(jr)} (מהם עם קובץ אישור: {with_file}) | בקשות ביטול: {len(cr)} | קובצי PDF להעלאה: {len(files)} | קובצי SQL: {len(parts)} (תיקייה {a.out})")
    print(f"הבא: להריץ ב-D1 את migrations\\0017_joiners.sql; אחר כך {a.out}\\run_all.cmd; אחר כך: python joiners_import.py upload")
    return 0


# ───────── upload ─────────
def upload(a):
    files = json.load(open(os.path.join(PRIV, "files.json"), encoding="utf-8"))
    sp = os.path.join(PRIV, "uploaded.json")
    done = set(json.load(open(sp, encoding="utf-8"))) if os.path.exists(sp) else set()
    todo = [it for it in files if r2_key(it) not in done]
    if a.limit:
        todo = todo[:a.limit]
    print(f"להעלאה: {len(todo)} מתוך {len(files)} (כבר הועלו: {len(done)})", flush=True)
    failed, n = [], [0]

    def one(it):
        with tempfile.TemporaryDirectory() as td:
            tmp = os.path.join(td, "f.pdf")
            open(tmp, "wb").write(read_pdf(it))
            cmd = f'{a.wrangler} r2 object put {a.bucket}/{r2_key(it)} --file "{tmp}" --content-type application/pdf --remote'
            for _ in range(3):
                r = subprocess.run(cmd, shell=True, capture_output=True, encoding="utf-8", errors="replace")          # בלי זה, ב-Windows הפלט של wrangler (UTF-8) מפוענח כ-cp1255 והסקריפט נופל
                if r.returncode == 0:
                    return it, ""
            return it, ((r.stderr or "") + (r.stdout or ""))[-300:]
    with ThreadPoolExecutor(a.workers) as ex:
        for it, err in ex.map(one, todo):
            n[0] += 1
            if err:
                failed.append((it["name"], err)); print(f"  נכשל: {it['name']}: {err.strip()[:200]}", flush=True)
            else:
                done.add(r2_key(it))
            if n[0] % 25 == 0:
                json.dump(sorted(done), open(sp, "w", encoding="utf-8")); print(f"  {n[0]}/{len(todo)}", flush=True)
    json.dump(sorted(done), open(sp, "w", encoding="utf-8"))
    print(f"הסתיים: הועלו {len(todo) - len(failed)}, נכשלו {len(failed)}" + (" (הרץ שוב כדי לנסות את הנכשלים)" if failed else ""))
    return 1 if failed else 0


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("keygen")
    p = sub.add_parser("prepare")
    p.add_argument("--updraft", default=os.path.join("wp-content", "updraft"))
    p.add_argument("--uploads", default=os.path.join("wp-content", "uploads"))
    p.add_argument("--out", default="d1_joiners")
    p.add_argument("--part-kb", type=int, default=900)
    u = sub.add_parser("upload")
    u.add_argument("--bucket", default="harav-levin-joiners")
    u.add_argument("--wrangler", default="npx wrangler")
    u.add_argument("--workers", type=int, default=3)
    u.add_argument("--limit", type=int, default=0)
    a = ap.parse_args()
    if a.cmd == "keygen":
        keygen(); return 0
    return prepare(a) if a.cmd == "prepare" else upload(a)


if __name__ == "__main__":
    sys.exit(main())
