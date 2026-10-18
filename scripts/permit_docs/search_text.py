# -*- coding: utf-8 -*-
"""
חיפוש בכל השטרות (אחרי build_text_index.py).
  python search_text.py "מסלול הלכה"            חיפוש ביטוי בכל המסמכים והעמודים
  python search_text.py "סדרה ו" --limit 50      יותר תוצאות
  python search_text.py --hp 513621110            אילו מסמכים מזכירים מספר תאגיד
  python search_text.py --name "אלבר"             אילו מסמכים מזכירים שם חברה (חלק משם)
"""
import argparse
import os
import re
import sqlite3
import sys


def norm_fts(t):
    return re.sub(r"[\"'׳״`]", "", t or "")


def ensure_fts(db):
    """אינדקס החיפוש: trigram (חיפוש בכל מקום בתוך מילה, כך שגם "ומסלול" נמצא כשמחפשים "מסלול") על טקסט בלי גרשיים. בונה מחדש מהטקסט השמור אם צריך."""
    db.execute("CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT)")
    cur = db.execute("SELECT v FROM meta WHERE k = 'fts_norm'").fetchone()
    if cur and cur[0] == "2":
        return
    has_pages = db.execute("SELECT 1 FROM sqlite_master WHERE name = 'pages'").fetchone()
    print("בונה מחדש את אינדקס החיפוש (פעם אחת)…")
    db.execute("DROP TABLE IF EXISTS pages_fts")
    db.execute("CREATE VIRTUAL TABLE pages_fts USING fts5(text, sha UNINDEXED, page UNINDEXED, tokenize='trigram')")
    if has_pages:
        rows = db.execute("SELECT sha, page, text FROM pages").fetchall()
        db.executemany("INSERT INTO pages_fts (text, sha, page) VALUES (?,?,?)", [(norm_fts(t), s, p) for s, p, t in rows])
    db.execute("INSERT OR REPLACE INTO meta VALUES ('fts_norm', '2')")
    db.commit()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("query", nargs="?", default="")
    ap.add_argument("--db", default=os.path.join("text_index", "permit_text.db"))
    ap.add_argument("--limit", type=int, default=25)
    ap.add_argument("--hp", default="")
    ap.add_argument("--name", default="")
    a = ap.parse_args()
    if not os.path.exists(a.db):
        print("אין מאגר: הרץ קודם build_text_index.py")
        return 1
    db = sqlite3.connect(a.db)
    ensure_fts(db)
    files = dict(db.execute("SELECT sha, files FROM docs"))
    if a.hp:
        c = 0
        for sha, n, pg in db.execute("SELECT sha, n, pages FROM hps WHERE hp = ? ORDER BY n DESC", (a.hp.strip(),)):
            print(f"{files.get(sha, sha[:12])} | הופעות: {n} | עמודים: {pg}")
            c += 1
        ink = [r for r in db.execute("SELECT sha, page, kind, crop FROM ink_hits WHERE value = ?", (a.hp.strip(),))] if db.execute("SELECT 1 FROM sqlite_master WHERE name = 'ink_hits'").fetchone() else []
        for sha, pg, kind, crop in ink:
            print(f"{files.get(sha, sha[:12])} | עמוד {pg} | {kind} | תמונה: {crop}")
            c += 1
        if not c:
            print(f"המספר {a.hp} לא נמצא באף מסמך שבמאגר (המאגר כולל {len(files)} מסמכים)")
        return 0
    if a.name:
        seen = set()
        for sha, nm, src in db.execute("SELECT sha, name, src FROM names WHERE name LIKE ? LIMIT 2000", (f"%{a.name}%",)):
            if (sha, nm) in seen:
                continue
            seen.add((sha, nm))
            print(f"{files.get(sha, sha[:12])} | {nm} | {src}")
            if len(seen) >= a.limit:
                break
        return 0
    if not a.query:
        print(__doc__)
        return 0
    q = '"' + norm_fts(a.query).replace('"', " ") + '"'          # ביטוי מדויק; גרשיים מוסרים (כמו באינדקס)
    n = 0
    plain = norm_fts(a.query).strip()
    if len(plain) < 3:          # trigram דורש לפחות 3 תווים: חיפוש רגיל בטקסט
        cur = ((sha, page, "…" + t[max(0, t.lower().find(plain.lower()) - 30): t.lower().find(plain.lower()) + 60] + "…") for sha, page, t in db.execute("SELECT sha, page, text FROM pages") if plain.lower() in norm_fts(t).lower())
    else:
        cur = db.execute("SELECT sha, page, snippet(pages_fts, 0, '[', ']', '…', 14) FROM pages_fts WHERE pages_fts MATCH ? LIMIT ?", (q, a.limit))
    for sha, page, snip in cur:
        n += 1
        print(f"{files.get(sha, sha[:12])} | עמוד {page}\n    {snip.replace(chr(10), ' ')}")
    print(f"נמצאו {n} תוצאות" + (f" (מוצגות {a.limit} הראשונות)" if n >= a.limit else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
