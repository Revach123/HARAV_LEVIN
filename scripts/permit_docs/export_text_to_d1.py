# -*- coding: utf-8 -*-
"""
מכין קובצי SQL לייבוא תוצאות המיפוי המלא (טקסט, ח.פ., שמות, חותמות וכתב יד) ל-D1, לחיפוש מסמך ולהצעות שיוך. קריאה בלבד מהמאגרים המקומיים:
אין כאן שום כתיבה לאתר; רק קבצים בתיקייה d1_import שאתה מריץ בעצמך (הוראות בסוף ההרצה).

בנוי להוספה קלה: נשמר קובץ מצב (d1_import\\state.json); בהרצה הבאה מיוצאים רק מסמכים חדשים או שהתוצאות שלהם השתנו
(למשל אחרי סבב כתב היד המלא או אחרי --extra), ובקובץ שלהם יש גם מחיקה של השורות הישנות. --all מייצא הכל מחדש.

    python export_text_to_d1.py              # רק מה שחדש / השתנה
    python export_text_to_d1.py --all
דרישות מראש: מיגרציות 0015 ו-0016 הורצו ב-D1 (migrations\\0015_permit_text.sql, 0016_permit_text_fts.sql).
פלט: d1_import\\part_001.sql, part_002.sql, ... ו-run_all.cmd
"""
import argparse
import hashlib
import json
import os
import sqlite3
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_text_index import norm_fts  # noqa: E402

CHUNK = 20000          # תווים; D1 מגביל אורך פקודה ל-100KB (בבתים, ובעברית אות = 2 בתים), לכן עמוד ארוך מתפצל לנתחים בלי לאבד טקסט


def q(x):
    return "'" + str(x if x is not None else "").replace("\x00", "").replace("'", "''") + "'"


def ro(path):
    return sqlite3.connect("file:" + os.path.abspath(path).replace("\\", "/") + "?mode=ro", uri=True, timeout=60)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--text-db", default=os.path.join("text_index", "permit_text.db"))
    ap.add_argument("--ink-db", default=os.path.join("text_index", "permit_ink.db"))
    ap.add_argument("--out", default="d1_import")
    ap.add_argument("--all", action="store_true", help="לייצא את כל המסמכים מחדש")
    ap.add_argument("--skip-imported", default="", help="קובץ JSON עם ה-sha256 שכבר ב-D1 (פלט של wrangler d1 execute --json), כדי לא לייבא אותם שוב")
    ap.add_argument("--part-kb", type=int, default=3000, help="גודל מקסימלי לכל קובץ SQL")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    sp = os.path.join(a.out, "state.json")
    state = {} if a.all or not os.path.exists(sp) else json.load(open(sp, encoding="utf-8"))
    skip = set()
    if a.skip_imported:
        raw = open(a.skip_imported, encoding="utf-8-sig", errors="replace").read()
        try:
            data = json.loads(raw[raw.index("["): raw.rindex("]") + 1])
            skip = {r["sha256"] for blk in data for r in blk.get("results", [])}
        except (ValueError, KeyError) as e:
            print(f"קובץ ה-JSON אינו תקין ({e})"); return 1
        print(f"מדלגים על {len(skip)} מסמכים שכבר ב-D1")
    for fn in os.listdir(a.out):          # קבצי ייבוא וסימונים ישנים: מתחילים רשימה חדשה
        if fn.startswith(("part_", "done_")):
            os.remove(os.path.join(a.out, fn))
    t = ro(a.text_db)
    ink = {}
    if os.path.exists(a.ink_db):
        i = ro(a.ink_db)
        for sha, page, val, st, kind, raw, crop, ind in i.execute("SELECT sha, page, value, status, kind, raw, crop, in_db FROM ink_hits"):
            ink.setdefault(sha, []).append((page, val, st, "stamp" if kind.startswith("חותמת") else "hand"))
        i.close()
    docs = {r[0]: r for r in t.execute("SELECT sha, pages, chars, ocr FROM docs")}
    todo, parts, cur, cur_n, rows_n = [], [], [], 0, 0

    def flush():
        nonlocal cur, cur_n
        if cur:
            parts.append("\n".join(cur) + "\n"); cur, cur_n = [], 0
    for sha, (_, pages, chars, ocr) in docs.items():
        hits = sorted(ink.get(sha, []))
        fp = hashlib.md5(f"{pages}|{chars}|{ocr}|{hits}".encode()).hexdigest()
        if state.get(sha) == fp or sha in skip:
            continue
        block = []
        if sha in state:          # כבר יובא פעם: מוחקים את הישן לפני הכנסה מחדש
            for tb in ("permit_doc_text", "permit_doc_page", "permit_doc_hp", "permit_doc_name", "permit_doc_fts"):
                block.append(f"DELETE FROM {tb} WHERE sha256 = {q(sha)};")
        block.append(f"INSERT INTO permit_doc_text (sha256, pages, chars, ocr) VALUES ({q(sha)}, {pages or 0}, {chars or 0}, {ocr or 0});")
        for page, text in t.execute("SELECT page, text FROM pages WHERE sha = ? ORDER BY page", (sha,)):
            text = (text or "").replace("\x00", "")
            if not text.strip():
                continue
            pieces = [text[k:k + CHUNK] for k in range(0, len(text), CHUNK)]
            for k, piece in enumerate(pieces):
                if k == 0:
                    block.append(f"INSERT OR REPLACE INTO permit_doc_page (sha256, page, text) VALUES ({q(sha)}, {page}, {q(piece)});")
                else:          # המשך אותו עמוד (עמוד ארוך מתפצל כדי לעמוד במגבלת אורך הפקודה)
                    block.append(f"UPDATE permit_doc_page SET text = text || {q(piece)} WHERE sha256 = {q(sha)} AND page = {page};")
                block.append(f"INSERT INTO permit_doc_fts (text, sha256, page) VALUES ({q(norm_fts(piece))}, {q(sha)}, {page});")
        for hp, n, pg in t.execute("SELECT hp, n, pages FROM hps WHERE sha = ?", (sha,)):
            block.append(f"INSERT OR REPLACE INTO permit_doc_hp (sha256, hp, n, pages, src, status) VALUES ({q(sha)}, {q(hp)}, {n or 1}, {q(pg)}, 'text', '');")
        for name, src in dict.fromkeys(t.execute("SELECT name, src FROM names WHERE sha = ?", (sha,))):
            if name and len(name) <= 120:
                block.append(f"INSERT OR IGNORE INTO permit_doc_name (sha256, name, src) VALUES ({q(sha)}, {q(name)}, 'text');")
        for page, val, st, src in hits:
            if st == "שם":
                block.append(f"INSERT OR IGNORE INTO permit_doc_name (sha256, name, src) VALUES ({q(sha)}, {q(val)}, {q(src)});")
            else:
                block.append(f"INSERT OR REPLACE INTO permit_doc_hp (sha256, hp, n, pages, src, status) VALUES ({q(sha)}, {q(val)}, 1, {q(str(page))}, {q(src)}, {q(st)});")
        text_block = "\n".join(block)
        if cur_n + len(text_block) > a.part_kb * 1024:
            flush()
        cur.append(text_block); cur_n += len(text_block); rows_n += len(block)
        todo.append((sha, fp))
    t.close()
    flush()
    for k, body in enumerate(parts, 1):
        with open(os.path.join(a.out, f"part_{k:03d}.sql"), "w", encoding="utf-8", newline="\n") as f:
            f.write(body)
    with open(os.path.join(a.out, "run_all.cmd"), "w", encoding="utf-8", newline="\r\n") as f:
        f.write("@echo off\nREM הרצת קובצי הייבוא ל-D1 לפי הסדר. כל קובץ שהושלם מסומן (done_NNN.txt) ובהרצה חוזרת מדלגים עליו; עוצר בשגיאה הראשונה.\n")
        for k in range(1, len(parts) + 1):
            f.write(f"if not exist {a.out}\\done_{k:03d}.txt (\n  echo === part_{k:03d} ===\n  call npx wrangler d1 execute business-registry-db --remote --yes --file={a.out}\\part_{k:03d}.sql\n  if errorlevel 1 exit /b 1\n  echo ok> {a.out}\\done_{k:03d}.txt\n)\n")
        f.write("echo הסתיים\n")
    for sha, fp in todo:
        state[sha] = fp
    # המצב נשמר רק בקובץ נפרד, והוא יתעדכן בפועל רק אחרי שתאשר שהייבוא הצליח (--commit)
    json.dump(state, open(os.path.join(a.out, "state.pending.json"), "w", encoding="utf-8"))
    print(f"מסמכים לייבוא: {len(todo)} מתוך {len(docs)} | קובצי SQL: {len(parts)} | שורות: {rows_n}")
    print(f"נכתב בתיקייה {a.out}. להרצה: {a.out}\\run_all.cmd  (או כל קובץ part בנפרד: npx wrangler d1 execute business-registry-db --remote --file=...)")
    print(f"אחרי שהייבוא הצליח, לאשר: python export_text_to_d1.py --commit   (כדי שהפעם הבאה תייצא רק שינויים)")
    return 0


if __name__ == "__main__":
    if "--commit" in sys.argv:
        d = sys.argv[sys.argv.index("--out") + 1] if "--out" in sys.argv else "d1_import"
        os.replace(os.path.join(d, "state.pending.json"), os.path.join(d, "state.json"))
        print("המצב עודכן: הפעם הבאה ייוצאו רק שינויים.")
        sys.exit(0)
    sys.exit(main())
