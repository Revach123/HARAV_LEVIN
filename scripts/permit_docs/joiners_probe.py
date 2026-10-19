# -*- coding: utf-8 -*-
"""
בדיקת מצטרפים בגיבוי בסיס הנתונים של וורדפרס (קריאה בלבד, ונתונים מצטברים בלבד):
  * wp_db7_forms (תוסף CFDB7): כמה הגשות לכל טופס, טווח תאריכים, ושמות השדות
  * wp_cf7_vdata / wp_cf7_vdata_entry (תוסף Advanced CF7 DB): כמה הגשות לכל טופס, טווח תאריכים, ושמות השדות
לא מודפס ולא נשמר אף ערך אישי (שם, טלפון, מייל...): רק ספירות ושמות שדות.

    python joiners_probe.py "wp-content\\updraft\\backup_..._-db.gz"
"""
import collections
import gzip
import re
import sys


def tuples(sql):
    """מפרק את החלק אחרי VALUES לשורות (רשימות ערכים), כולל מחרוזות עם מרכאות בורחות."""
    i, n = 0, len(sql)
    while i < n:
        while i < n and sql[i] != "(":
            if sql[i] == ";":
                return
            i += 1
        i += 1
        row, cur, inq = [], [], False
        while i < n:
            ch = sql[i]
            if inq:
                if ch == "\\" and i + 1 < n:
                    cur.append({"n": "\n", "r": "\r", "0": "\0", "Z": "\x1a"}.get(sql[i + 1], sql[i + 1])); i += 2; continue
                if ch == "'":
                    if i + 1 < n and sql[i + 1] == "'":
                        cur.append("'"); i += 2; continue
                    inq = False; i += 1; continue
                cur.append(ch); i += 1; continue
            if ch == "'":
                inq = True; i += 1; continue
            if ch == ",":
                row.append("".join(cur).strip()); cur = []; i += 1; continue
            if ch == ")":
                row.append("".join(cur).strip()); i += 1; yield row; break
            cur.append(ch); i += 1


def columns(sql, table):
    m = re.search(r"CREATE TABLE `%s` \((.*?)\)\s*ENGINE" % re.escape(table), sql, re.S)
    return [c for c in re.findall(r"^\s*`([^`]+)`", m.group(1), re.M)] if m else []


def inserts(sql, table):
    for m in re.finditer(r"INSERT INTO `%s`(?: \([^)]*\))? VALUES\s*" % re.escape(table), sql):
        yield from tuples(sql[m.end():])


def main(path):
    sql = gzip.open(path, "rt", encoding="utf-8", errors="replace").read()
    for table in ("wp_db7_forms", "wp_cf7_vdata", "wp_cf7_vdata_entry"):
        print(f"{table}: עמודות {columns(sql, table) or 'אין טבלה'}")
    # CFDB7
    cols = columns(sql, "wp_db7_forms")
    if cols:
        ip, vp, dp = cols.index("form_post_id"), cols.index("form_value"), cols.index("form_date")
        by = collections.defaultdict(lambda: [0, "9", "0", collections.Counter()])
        for r in inserts(sql, "wp_db7_forms"):
            b = by[r[ip]]
            b[0] += 1
            b[1], b[2] = min(b[1], r[dp][:10]), max(b[2], r[dp][:10])
            b[3].update(set(re.findall(r's:\d+:"([^"]{1,60})";', r[vp])[::2]))
        print("\nCFDB7 (wp_db7_forms): לכל טופס")
        for fid, (n, a, z, f) in sorted(by.items(), key=lambda x: -x[1][0]):
            print(f"  טופס {fid}: {n} הגשות, {a} עד {z}; שדות: {', '.join(k for k, _ in f.most_common(14))}")
    # Advanced CF7 DB
    vc, ec = columns(sql, "wp_cf7_vdata"), columns(sql, "wp_cf7_vdata_entry")
    if vc and ec:
        when = {}
        if "id" in vc and "created" in vc:
            ii, ci = vc.index("id"), vc.index("created")
            for r in inserts(sql, "wp_cf7_vdata"):
                when[r[ii]] = r[ci][:10]
        eid, ecf, enm = ec.index("data_id"), ec.index("cf7_id"), ec.index("name")
        by = collections.defaultdict(lambda: [set(), "9", "0", collections.Counter()])
        for r in inserts(sql, "wp_cf7_vdata_entry"):
            b = by[r[ecf]]
            b[0].add(r[eid])
            d = when.get(r[eid], "")
            if d:
                b[1], b[2] = min(b[1], d), max(b[2], d)
            b[3][r[enm]] += 1
        print("\nAdvanced CF7 DB (wp_cf7_vdata_entry): לכל טופס")
        for f, (ids, a, z, c) in sorted(by.items(), key=lambda x: -len(x[1][0])):
            print(f"  טופס {f}: {len(ids)} הגשות, {a} עד {z}; שדות: {', '.join(k for k, _ in c.most_common(14))}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    main(sys.argv[1])
