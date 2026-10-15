# -*- coding: utf-8 -*-
"""
דשבורד בדיקה ידנית של היתרי עיסקא (מקומי, קריאה בלבד מול האתר והמאגר).
  מציג רק קבצים שסומנו "לבדיקה ידנית" (needs_review = כן) ב-סופי_מאוחד.csv.
  למעלה השאלה עם כפתורי בחירה מהירה, למטה קובץ ה-PDF, ולמטה כפתור "הבא".
  התשובות נשמרות רק בקובץ מקומי: החלטות_בדיקה.csv  (לא נכתב כלום למאגר ולא לאתר, ולא משייכים כלום).
  הנתונים נקראים מחדש מהקבצים בכל רענון - אפשר להריץ שוב את run_all ולרענן בלי לאבד תשובות.

הרצה מתיקיית האתר:  python review_server.py     ואז לפתוח  http://localhost:8765
"""
import argparse
import csv
import json
import os
import re
import sys
import hashlib
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

HERE = os.path.dirname(os.path.abspath(__file__))
LOCK = threading.Lock()
A = None
DEC_COLS = ["attachment_id", "file", "type_answer", "company_id", "company_name", "company_ids", "company_names", "company_special", "note", "same_as", "time"]
HASHES = {}          # attachment_id -> sha256 של הקובץ (נבנה ברקע; קבצים זהים מקבלים אותה תשובה)
HASH_STATE = {"done": 0, "total": 0}


def read_csv(path):
    if not os.path.exists(path):
        return []
    with open(path, encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def mtime(*paths):
    return max([os.path.getmtime(p) for p in paths if os.path.exists(p)] or [0])


def load_businesses():
    if not os.path.exists(A.businesses):
        return []
    with open(A.businesses, encoding="utf-8") as f:
        data = json.load(f)
    docs = {}
    for r in read_csv(A.final):
        d = docs.setdefault(r.get("business_id"), {"general": 0, "private": 0, "unknown": 0})
        t = (r.get("doc_type_clean") or r.get("doc_type") or "").rstrip("?")
        d["general" if t == "כללי" else "private" if t == "פרטי" else "unknown"] += 1
    vis = {"": "רק כללי", "פרטי": "יש גם פרטי", "רק פרטי": "רק פרטי"}
    out = []
    for b in data:
        v = b.get("visibility") or ""
        out.append({"id": b.get("id"), "name": b.get("registrar_name") or b.get("permit_name") or "",
                    "registrar_name": b.get("registrar_name") or "",
                    "permit_name": b.get("permit_name") or "", "chp": str(b.get("chp_number") or ""),
                    "visibility": vis.get(v, v), "entity_type": b.get("entity_type") or "",
                    "category": b.get("category") or "", "region": b.get("region") or "",
                    "notes": b.get("notes") or "", "agch": b.get("agch_approved") or "",
                    "docs": docs.get(b.get("id"), {"general": 0, "private": 0, "unknown": 0})})
    return out


def build_items_unassigned():
    """תור "חסר שיוך לחברה": כל קובץ שלא שויך לאף חברה (אין business_id ואין ח.פ. בקובץ שנמצא במאגר). בלי שאלת כללי/פרטי - זה השלב הבא.
    מועמדות: החברה לפי שם הפוסט, ח.פ. בקובץ, שמות חברות שנמצאו בטקסט, ומועמדים_לחברות_חסרות.csv (חיפוש בטקסט לפי חברה שחסר לה מסמך)."""
    rows = read_csv(A.final)
    biz = load_businesses()
    by_id = {b["id"]: b for b in biz}
    by_chp = {b["chp"].zfill(9): b for b in biz if b["chp"]}
    by_name = {}
    for b in biz:
        for raw in (b["name"], b["permit_name"]):       # שם ברשם ו"שם בהיתר עיסקא" (אפשר כמה שמות, מופרדים ב- ; | / או שורה)
            for n in re.split(r"[;|\n/]+", raw or ""):
                if len(n.strip()) >= 4:
                    by_name.setdefault(n.strip(), b)
    from_missing = {}
    for r in read_csv(A.candidates):
        b = by_chp.get(str(r.get("chp") or "").zfill(9))
        if b:
            from_missing.setdefault(r.get("candidate_id"), []).append((b, r.get("evidence", "")))
    items = []
    for r in rows:
        if r.get("business_id"):
            continue
        hps = re.findall(r"\d{8,9}", r.get("doc_hps_in_db") or "")
        if any(h.zfill(9) in by_chp for h in hps):
            continue
        cands, seen = [], set()

        def add(b, why):
            if b and b["id"] not in seen:
                seen.add(b["id"])
                cands.append({"id": b["id"], "name": b["name"], "chp": b["chp"], "why": why})
        tb = (r.get("title_business") or "").strip()
        if tb:
            add(by_name.get(tb), "לפי שם הפוסט")
        matches = r.get("doc_name_matches") or ""
        for n, b in by_name.items():
            if n in matches:
                add(b, "שם החברה נמצא בקובץ")
        for b, ev in from_missing.get(r["attachment_id"], []):
            add(b, "חיפוש לחברה חסרה: " + ev)
        items.append({
            "aid": r["attachment_id"], "file": r.get("file", ""), "reasons": ["אין שיוך לחברה (" + (r.get("status") or "לא זוהה") + ")"],
            "ask_type": False, "ask_company": True,
            "doc_type": r.get("doc_type_clean") or r.get("doc_type") or "", "text_check": "", "status": r.get("status", ""),
            "post_title": r.get("post_title", ""), "note": r.get("note", ""),
            "doc_name_matches": matches, "doc_hps_not_in_db": r.get("doc_hps_not_in_db", ""),
            "linked_in": r.get("linked_in", ""), "multi_kind": r.get("multi_kind", ""), "hp_pages": r.get("hp_pages", ""),
            "cands": cands, "dups": dups_of(r["attachment_id"]),
        })
    items.sort(key=lambda i: (-len(i["cands"]), i["file"]))
    return items


def build_items():
    if A.queue == "unassigned":
        return build_items_unassigned()
    rows = read_csv(A.final)
    biz = load_businesses()
    by_id = {b["id"]: b for b in biz}
    by_chp = {b["chp"]: b for b in biz if b["chp"]}
    by_name = {}
    for b in biz:
        for n in (b["name"], b["permit_name"]):
            if n:
                by_name.setdefault(n.strip(), b)
    items = []
    for r in rows:
        if r.get("needs_review") != "כן":
            continue
        cands, seen = [], set()

        def add(b, why):
            if b and b["id"] not in seen:
                seen.add(b["id"])
                cands.append({"id": b["id"], "name": b["name"], "chp": b["chp"], "why": why})
        add(by_id.get(r.get("business_id")), "החברה שזוהתה")
        tb = (r.get("title_business") or "").strip()
        if tb:
            add(by_name.get(tb), "לפי שם הפוסט")
        for hp in re.findall(r"\d{8,9}", r.get("doc_hps_in_db") or ""):
            add(by_chp.get(hp), "ח.פ. בתוך הקובץ")
        # סיווג כללי/פרטי נקבע לפי מיקום הקובץ באתר (בלי שאלה): סיבת "המיקום והנוסח לא מסכימים" לא מייצרת שאלה
        # שיוך לחברה במקור יחיד (למשל שם הפוסט) ושם פוסט שונה כשיש ח.פ. מאומת: נחשבים מאומתים. בבדיקה של 26 קבצים כאלה, ב-26 מהם
        # הבחירה הידנית הייתה זהה לשיוך שזוהה. נשאלות רק סתירה, לא זוהה, וקובץ בלי מיקום באתר (כדי לקבוע כללי/פרטי).
        TRUSTED = ("שיוך לחברה במקור יחיד", "שם הפוסט שונה מהחברה בקובץ")
        reasons = [x.strip() for x in (r.get("review_reasons") or "").split("|")
                   if x.strip() and "כללי/פרטי" not in x and not any(x.strip().startswith(t) for t in TRUSTED)]
        if not reasons:
            continue
        ask_type = any("אין מיקום" in x for x in reasons)
        ask_company = any(x.startswith("שיוך לחברה") or "שם הפוסט שונה" in x for x in reasons)
        items.append({
            "aid": r["attachment_id"], "file": r.get("file", ""), "reasons": reasons,
            "ask_type": ask_type, "ask_company": ask_company,
            "doc_type": r.get("doc_type_clean") or r.get("doc_type") or "",
            "text_check": r.get("text_check", ""), "status": r.get("status", ""),
            "post_title": r.get("post_title", ""), "note": r.get("note", ""),
            "doc_name_matches": r.get("doc_name_matches", ""), "doc_hps_not_in_db": r.get("doc_hps_not_in_db", ""),
            "linked_in": r.get("linked_in", ""), "multi_kind": r.get("multi_kind", ""), "hp_pages": r.get("hp_pages", ""), "cands": cands, "dups": dups_of(r["attachment_id"]),
        })
    return items


def decisions():
    return {r["attachment_id"]: r for r in read_csv(A.decisions)}


def save_decision(d):
    with LOCK:
        cur = decisions()
        from datetime import datetime
        d["time"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        cur[d["attachment_id"]] = {k: d.get(k, "") for k in DEC_COLS}
        if d.get("apply_dups"):       # קבצים זהים (אותו תוכן בדיוק) מקבלים את אותה תשובה
            files = {r.get("ID"): os.path.basename(r.get("guid") or "") for r in read_csv(A.attachments)}
            for other in dups_of(d["attachment_id"]):
                cur[other] = {**{k: d.get(k, "") for k in DEC_COLS}, "attachment_id": other, "file": files.get(other, ""),
                              "same_as": d["attachment_id"], "time": d["time"]}
        tmp = A.decisions + ".tmp"
        with open(tmp, "w", encoding="utf-8-sig", newline="") as f:
            w = csv.DictWriter(f, fieldnames=DEC_COLS)
            w.writeheader()
            w.writerows(cur.values())
        os.replace(tmp, A.decisions)


def build_hashes():
    """sha256 לכל קובץ PDF (ברקע, עם מטמון בקובץ hashes_cache.json): כדי לזהות קבצים זהים."""
    cache_path = os.path.join(os.path.dirname(os.path.abspath(A.decisions)) or ".", "hashes_cache.json")
    cache = {}
    if os.path.exists(cache_path):
        try:
            with open(cache_path, encoding="utf-8") as f:
                cache = json.load(f)
        except (OSError, ValueError):
            cache = {}
    rows = [r for r in read_csv(A.attachments) if (r.get("guid") or "").lower().endswith(".pdf")]
    HASH_STATE["total"] = len(rows)
    for r in rows:
        aid = r.get("ID")
        m = re.search(r"wp-content/uploads/(.+)$", r.get("guid") or "")
        p = os.path.join(A.uploads, *m.group(1).split("/")) if m else ""
        HASH_STATE["done"] += 1
        if not p or not os.path.exists(p):
            continue
        st = os.stat(p)
        c = cache.get(aid)
        if c and c[0] == st.st_size and c[1] == int(st.st_mtime):
            HASHES[aid] = c[2]
            continue
        h = hashlib.sha256()
        with open(p, "rb") as f:
            for chunk in iter(lambda: f.read(1 << 20), b""):
                h.update(chunk)
        HASHES[aid] = h.hexdigest()
        cache[aid] = [st.st_size, int(st.st_mtime), HASHES[aid]]
    try:
        with open(cache_path, "w", encoding="utf-8") as f:
            json.dump(cache, f)
    except OSError:
        pass


def dups_of(aid):
    h = HASHES.get(aid)
    return [a for a, x in HASHES.items() if h and x == h and a != aid]


def pdf_path(aid):
    for r in read_csv(A.attachments):
        if r.get("ID") == aid:
            m = re.search(r"wp-content/uploads/(.+)$", r.get("guid") or "")
            if m:
                p = os.path.join(A.uploads, *m.group(1).split("/"))
                return p if os.path.exists(p) else None
    return None


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def send(self, code, body, ctype="application/json; charset=utf-8", extra=None):
        if isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        u = urlparse(self.path)
        if u.path in ("/", "/index.html"):
            with open(os.path.join(HERE, "review.html"), encoding="utf-8") as f:
                return self.send(200, f.read(), "text/html; charset=utf-8")
        if u.path == "/api/items":
            return self.send(200, json.dumps({"mtime": mtime(A.final, A.businesses), "items": build_items(),
                                              "decisions": decisions(), "hashes": dict(HASH_STATE)}, ensure_ascii=False))
        if u.path == "/api/mtime":
            return self.send(200, json.dumps({"mtime": mtime(A.final, A.businesses)}))
        if u.path == "/api/businesses":
            return self.send(200, json.dumps(load_businesses(), ensure_ascii=False))
        if u.path == "/pdf":
            aid = parse_qs(u.query).get("id", [""])[0]
            p = pdf_path(aid)
            if not p:
                return self.send(404, "הקובץ לא נמצא בתיקיית ההעלאות", "text/plain; charset=utf-8")
            with open(p, "rb") as f:
                return self.send(200, f.read(), "application/pdf", {"Content-Disposition": "inline"})
        self.send(404, "not found", "text/plain")

    def do_POST(self):
        if urlparse(self.path).path == "/api/answer":
            n = int(self.headers.get("Content-Length") or 0)
            d = json.loads(self.rfile.read(n).decode("utf-8"))
            if not d.get("attachment_id"):
                return self.send(400, "{}")
            save_decision(d)
            return self.send(200, '{"ok":true}')
        self.send(404, "{}")


def main():
    global A
    ap = argparse.ArgumentParser()
    ap.add_argument("--final", default="סופי_מאוחד.csv")
    ap.add_argument("--businesses", default="businesses.json")
    ap.add_argument("--attachments", default="attachments.csv")
    ap.add_argument("--uploads", default=os.path.join("wp-content", "uploads"))
    ap.add_argument("--decisions", default="החלטות_בדיקה.csv")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--queue", choices=["unassigned", "review"], default="unassigned",
                    help="unassigned = רק קבצים שלא שויכו לאף חברה (ברירת מחדל); review = כל הקבצים שסומנו לבדיקה ידנית")
    ap.add_argument("--candidates", default="מועמדים_לחברות_חסרות.csv")
    A = ap.parse_args()
    threading.Thread(target=build_hashes, daemon=True).start()
    srv = ThreadingHTTPServer(("127.0.0.1", A.port), H)
    print(f"הדשבורד פועל: http://localhost:{A.port}   (לעצירה: Ctrl+C)")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    sys.exit(main())
