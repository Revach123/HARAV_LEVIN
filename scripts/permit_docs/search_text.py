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
import sqlite3
import sys


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
    files = dict(db.execute("SELECT sha, files FROM docs"))
    if a.hp:
        for sha, n, pg in db.execute("SELECT sha, n, pages FROM hps WHERE hp = ? ORDER BY n DESC", (a.hp.strip(),)):
            print(f"{files.get(sha, sha[:12])} | הופעות: {n} | עמודים: {pg}")
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
    q = a.query if '"' in a.query else '"' + a.query.replace('"', "") + '"'
    n = 0
    for sha, page, snip in db.execute("SELECT sha, page, snippet(pages_fts, 0, '[', ']', '…', 14) FROM pages_fts WHERE pages_fts MATCH ? LIMIT ?", (q, a.limit)):
        n += 1
        print(f"{files.get(sha, sha[:12])} | עמוד {page}\n    {snip.replace(chr(10), ' ')}")
    print(f"נמצאו {n} תוצאות" + (f" (מוצגות {a.limit} הראשונות)" if n >= a.limit else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
