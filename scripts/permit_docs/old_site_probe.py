# -*- coding: utf-8 -*-
"""
איך האתר הישן מחבר בין חברה לבין השטר שלה? קריאה בלבד על גיבוי בסיס הנתונים של וורדפרס (קובץ -db.gz).
מדפיס מבנה בלבד: סוגי פוסטים, באילו שדות / תוכן יש קישורים לקבצים, ומה יש בפוסט של חברה אחת לדוגמה
(לא נקרא ולא נשמר שום מידע אישי של מצטרפים; רק פוסטים ציבוריים).

    python old_site_probe.py "wp-content\\updraft\\backup_..._-db.gz"  "אחים נאוי"

הפלט נשמר גם ל-old_site_probe.txt (להדביק אותו בשיחה).
"""
import collections
import gzip
import re
import sys


def tuples(sql):
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


EXT = r"(?:pdf|docx?|jpe?g|png|gif|tiff?|rtf|odt|zip)"
URL = re.compile(r"""(?:https?://[^\s"'<>)\\]+|/?wp-content/uploads/[^\s"'<>)\\]+)\.""" + EXT + r"\b", re.I)
EXTLINK = re.compile(r"""https?://([^/\s"'<>)\\]+)""", re.I)
out_lines = []


def p(*a):
    s = " ".join(str(x) for x in a)
    print(s)
    out_lines.append(s)


def main(path, q):
    sql = gzip.open(path, "rt", encoding="utf-8", errors="replace").read()
    m = re.search(r"CREATE TABLE `(\w*?)posts`", sql)
    pre = m.group(1) if m else "wp_"
    p("קידומת טבלאות:", pre)
    p("טבלאות:", ", ".join(t for t in re.findall(r"CREATE TABLE `([^`]+)`", sql)))
    pc, mc = columns(sql, pre + "posts"), columns(sql, pre + "postmeta")
    ix = {k: pc.index(k) for k in ("ID", "post_title", "post_name", "post_type", "post_status", "post_content", "post_parent", "guid", "post_mime_type") if k in pc}
    posts = {}
    for r in inserts(sql, pre + "posts"):
        posts[r[ix["ID"]]] = {k: r[i] for k, i in ix.items()}
    p(f"\nפוסטים: {len(posts)}")
    tc = collections.Counter((x["post_type"], x["post_status"]) for x in posts.values())
    for (t, s), n in tc.most_common(25):
        p(f"  {t} / {s}: {n}")

    att = {i: x for i, x in posts.items() if x["post_type"] == "attachment"}
    mimes = collections.Counter(x.get("post_mime_type", "") for x in att.values())
    p("\nקבצים מצורפים (attachment) לפי סוג:", dict(mimes.most_common(10)))
    par = collections.Counter(posts[x["post_parent"]]["post_type"] if x["post_parent"] in posts else ("ללא הורה" if x["post_parent"] in ("0", "") else "הורה לא קיים") for x in att.values())
    p("קבצים מצורפים לפי סוג ההורה:", dict(par.most_common(10)))

    # קישורים בתוך תוכן הפוסטים
    inc, ext_dom, ex_content = collections.Counter(), collections.Counter(), {}
    for i, x in posts.items():
        if x["post_type"] in ("attachment", "revision", "nav_menu_item"):
            continue
        c = x.get("post_content", "")
        u = URL.findall(c)
        if u:
            inc[x["post_type"]] += 1
            ex_content.setdefault(x["post_type"], (x["post_title"], u[:2]))
        for d in EXTLINK.findall(c):
            if "iska.co.il" not in d:
                ext_dom[d.lower()] += 1
    p("\nפוסטים שבתוכן שלהם יש קישור לקובץ (לפי סוג):", dict(inc))
    for t, (ti, u) in ex_content.items():
        p(f"  דוגמה {t}: {ti[:50]} -> {u}")
    p("דומיינים חיצוניים בתוכן (למשל דרייב):", dict(ext_dom.most_common(10)))
    shortcodes = collections.Counter()
    for x in posts.values():
        if x["post_type"] in ("page", "post"):
            for sc in re.findall(r"\[([a-zA-Z0-9_\-]+)[ \]]", x.get("post_content", "")):
                shortcodes[sc] += 1
    p("שורטקודים שכיחים בדפים / פוסטים:", dict(shortcodes.most_common(12)))

    # שדות נוספים (postmeta)
    mi = {k: mc.index(k) for k in ("post_id", "meta_key", "meta_value")}
    keys_url, keys_att, keys_all = collections.Counter(), collections.Counter(), collections.Counter()
    ex_meta, by_post = {}, collections.defaultdict(list)
    for r in inserts(sql, pre + "postmeta"):
        pid, k, v = r[mi["post_id"]], r[mi["meta_key"]], r[mi["meta_value"]]
        keys_all[k] += 1
        if URL.search(v):
            keys_url[k] += 1
            ex_meta.setdefault(k, (posts.get(pid, {}).get("post_title", "")[:40], URL.findall(v)[:1]))
        elif v.isdigit() and v in att:
            keys_att[k] += 1
        if pid in posts and q and q in posts[pid].get("post_title", ""):
            by_post[pid].append((k, v))
    p("\nשדות (postmeta) שערכם קישור לקובץ:", dict(keys_url.most_common(15)))
    for k, (t, u) in list(ex_meta.items())[:8]:
        p(f"  {k}: {t} -> {u}")
    p("שדות שערכם מספר של קובץ מצורף (ACF וכד'):", dict(keys_att.most_common(15)))
    p("שדות כלליים שכיחים:", dict(keys_all.most_common(25)))

    # פוסט של חברה לדוגמה
    if q:
        p(f"\n=== פוסטים שכותרתם מכילה '{q}' ===")
        for i, x in posts.items():
            if q in x.get("post_title", "") and x["post_type"] != "revision":
                p(f"- ID {i} | {x['post_type']} | {x['post_status']} | {x['post_title']} | {x['post_name']}")
                c = x.get("post_content", "")
                p("  תוכן:", re.sub(r"\s+", " ", c)[:300])
                p("  קישורים בתוכן:", URL.findall(c)[:5])
                for k, v in by_post.get(i, [])[:30]:
                    if k.startswith("_edit") or k in ("_wp_old_slug",):
                        continue
                    p(f"  meta {k} = {v[:160]}")
                kids = [(j, a) for j, a in att.items() if a["post_parent"] == i]
                p(f"  קבצים מצורפים לפוסט: {len(kids)}", [a["guid"][-60:] for _, a in kids[:5]])
    open("old_site_probe.txt", "w", encoding="utf-8").write("\n".join(out_lines))
    print("\nנשמר: old_site_probe.txt")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    main(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else "")
