# -*- coding: utf-8 -*-
"""
"קטגוריה עבור רשימת השטרות": מושך מהאתר הישן את הדף "שטרות היתר עסקה" (קטגוריות והחברות שבהן), ומשייך לכל עסק באתר את הקטגוריה שלו.

שלבים (קריאה בלבד עד --apply):
  1. python old_categories.py extract "…-db.gz" [--post מזהה]
       מוצא את הדף בגיבוי, מפרק אותו לקטגוריות ופריטים → old_categories.csv + old_categories_probe.txt
       (אם הפירוק לא נראה נכון: להדביק את old_categories_probe.txt בשיחה)
  1ב. python old_categories.py terms "…-db.gz" [--taxonomy שם]
       אם הקטגוריות באתר הישן הן קטגוריות (טקסונומיה) שמוצמדות לפוסטים של השטרות: קורא אותן מהגיבוי → old_categories.csv (במקום extract)
  2. python old_categories.py match
       משווה לעסקים באתר (GET /api/businesses) → old_categories_plan.csv (עסק לכל פריט, ביטחון, קטגוריה נוכחית) + סיכום
  3. python old_categories.py apply            הרצה יבשה (רק מדפיס)
     python old_categories.py apply --go       כתיבה לאתר (ביטחון "גבוה" ומעלה); --min mid כולל גם בינוני
     python old_categories.py apply --go --undo old_categories_log.jsonl   (החזרה: ראו --undo)
  צריך קודם להריץ את migrations/0019_permits_category.sql ב-D1. כל שינוי נרשם ב-old_categories_log.jsonl לפני הכתיבה.
"""
import argparse
import collections
import csv
import difflib
import getpass
import gzip
import html
import json
import os
import re
import ssl
import sys
import time
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from old_site_probe import columns, inserts  # noqa: E402

CAT_SHORTCODES = r"fusion_toggle|toggle|tab|vc_tta_section|vc_toggle|vc_accordion_tab|accordion_item|accordion-item|et_pb_toggle|et_pb_tab|fusion_tab|su_spoiler|su_tab|collapse|pane|tabs_item|tab_item"
RE_SC_CAT = re.compile(r"\[(?:%s)\b[^\]]*?\b(?:title|heading|name|label)\s*=\s*[\"”“'‘’]([^\"”“'‘’\]]+)[\"”“'‘’][^\]]*\]" % CAT_SHORTCODES, re.I)
RE_HEAD = re.compile(r"<h([1-6])[^>]*>(.*?)</h\1>", re.S | re.I)
RE_LINK = re.compile(r"""<a\b[^>]*?href\s*=\s*["']([^"']+)["'][^>]*>(.*?)</a>""", re.S | re.I)


def clean(t):
    t = re.sub(r"<[^>]+>", " ", t or "")
    t = re.sub(r"\[/?[a-zA-Z_][^\]]*\]", " ", t)          # שאריות shortcode
    t = html.unescape(t).replace("\xa0", " ")
    return re.sub(r"\s+", " ", t).strip(" \t-–—:•·*")


def elementor_text(node):
    """Elementor שומר ב-postmeta JSON: כותרות לשוניות/אקורדיון + תוכן; מחזיר טקסט עם סימוני [[CAT:...]]."""
    out = []
    def walk(n):
        if isinstance(n, dict):
            ttl = n.get("tab_title") or n.get("title") or n.get("accordion_title")
            if isinstance(ttl, str) and ttl.strip():
                out.append("\n[[CAT:%s]]\n" % ttl.strip())
            for k in ("tab_content", "editor", "description", "content", "text", "item_description"):
                v = n.get(k)
                if isinstance(v, str) and v.strip():
                    out.append("\n" + v + "\n")
            for v in n.values():
                if isinstance(v, (dict, list)):
                    walk(v)
        elif isinstance(n, list):
            for v in n:
                walk(v)
    walk(node)
    return "".join(out)


def parse(text):
    """→ [(קטגוריה, פריט, קישור)]"""
    text = re.sub(r"<!--.*?-->", "", text or "", flags=re.S)
    text = RE_SC_CAT.sub(lambda m: "\n[[CAT:%s]]\n" % m.group(1), text)
    text = RE_HEAD.sub(lambda m: "\n[[CAT:%s]]\n" % clean(m.group(2)), text)
    text = re.sub(r"</?(p|div|li|tr|ul|ol|table|br|tbody|section)\b[^>]*>", "\n", text, flags=re.I)
    rows, cat = [], ""
    for line in text.split("\n"):
        m = re.search(r"\[\[CAT:(.*?)\]\]", line)
        if m:
            cat = clean(m.group(1))
            continue
        link = ""
        lm = RE_LINK.search(line)
        if lm:
            link = html.unescape(lm.group(1))
        item = clean(line)
        if not item or len(item) > 140 or not re.search(r"[א-תA-Za-z0-9]", item):
            continue
        rows.append((cat, item, link))
    return rows


def load_db(path):
    sql = gzip.open(path, "rt", encoding="utf-8", errors="replace").read()
    pc, mc = columns(sql, "wp_posts"), columns(sql, "wp_postmeta")
    ix = {k: pc.index(k) for k in ("ID", "post_title", "post_type", "post_status", "post_content") if k in pc}
    posts = {}
    for r in inserts(sql, "wp_posts"):
        posts[r[ix["ID"]]] = {k: r[i] for k, i in ix.items()}
    mi = {k: mc.index(k) for k in ("post_id", "meta_key", "meta_value")}
    meta = collections.defaultdict(list)
    for r in inserts(sql, "wp_postmeta"):
        v = r[mi["meta_value"]]
        if len(v) > 300 and r[mi["post_id"]] in posts:
            meta[r[mi["post_id"]]].append((r[mi["meta_key"]], v))
    return posts, meta


def cmd_extract(a):
    posts, meta = load_db(a.db)
    DOCT = {"main_ducuments", "main_documents", "privet_ducuments", "company", "product", "attachment", "revision", "nav_menu_item"}
    def score(p):          # ככל שהכותרת קרובה ל"שטרות היתר עסקה" ויש בה תוכן
        t = html.unescape(p["post_title"])
        return (("שטר" in t) * 2 + ("היתר" in t) + ("עיסקא" in t or "עסקא" in t)) * 10 + (p["post_type"] == "page") * 5 + (p["post_status"] == "publish") * 3 + min(len(p["post_content"]) // 2000, 5)
    cands = [p for p in posts.values() if p["post_type"] not in DOCT and any(w in html.unescape(p["post_title"]) for w in ("שטר", "היתר", "עיסקא", "עסקא"))]
    cands.sort(key=lambda p: -score(p))
    cnt = collections.Counter(p["post_type"] for p in posts.values())
    lines = ["== סוגי פוסטים בגיבוי: " + ", ".join(f"{k}={v}" for k, v in cnt.most_common(15)), "", "== פוסטים/דפים עם 'שטר' / 'היתר' / 'עיסקא' בכותרת (לפי התאמה) =="]
    for p in cands[:40]:
        lines.append(f"{p['ID']}\t{p['post_type']}\t{p['post_status']}\t{html.unescape(p['post_title'])}\tתוכן: {len(p['post_content'])} תווים\tmeta גדולים: {len(meta.get(p['ID'], []))}")
    pg = [p for p in posts.values() if p["post_type"] == "page"]
    lines += ["", f"== כל הדפים (page) בגיבוי: {len(pg)} =="] + [f"{p['ID']}\t{p['post_status']}\t{html.unescape(p['post_title'])}\t{len(p['post_content'])}" for p in sorted(pg, key=lambda x: html.unescape(x['post_title']))[:150]]
    pid = a.post or (cands[0]["ID"] if cands else None)
    if not pid or pid not in posts:
        print("\n".join(lines)); print("לא נמצא דף אוטומטית. ציין --post <מזהה> לפי הרשימה למעלה (ואם הדף לא ברשימה - להדביק לי את old_categories_probe.txt)."); open("old_categories_probe.txt", "w", encoding="utf-8").write("\n".join(lines)); return
    p = posts[pid]
    srcs = [("post_content", p["post_content"])]
    for k, v in meta.get(pid, []):
        if v.lstrip().startswith(("{", "[")) and ("tab_title" in v or '"title"' in v or "editor" in v):
            try:
                srcs.append((k, elementor_text(json.loads(v))))
                continue
            except Exception:  # noqa: BLE001
                pass
        srcs.append((k, v))
    rows = []
    for name, t in srcs:
        got = parse(t)
        lines.append(f"\nמקור {name}: {len(t)} תווים, {len(got)} פריטים, {len({c for c, _, _ in got})} קטגוריות")
        for c, i, l in got:
            rows.append((c, i, l, name))
    use = collections.defaultdict(list)
    for r in rows:
        use[r[3]].append(r)
    best = max(use.values(), key=len) if use else []          # המקור עם הכי הרבה פריטים
    seen, final = set(), []
    for r in best:
        k = (r[0], r[1])
        if k not in seen:
            seen.add(k); final.append(r)
    with open("old_categories.csv", "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f); w.writerow(["קטגוריה", "פריט", "קישור", "מקור"]); w.writerows(final)
    cc = collections.Counter(r[0] for r in final)
    lines += [f"\nדף {pid}: {p['post_title']} — נבחר המקור עם הכי הרבה פריטים: {len(final)} פריטים ב-{len(cc)} קטגוריות", ""]
    lines += [f"{n:4d}  {c or '(ללא קטגוריה)'}" for c, n in cc.most_common(60)]
    lines += ["", "== 1500 תווים ראשונים של התוכן הגולמי =="] + [re.sub(r"\s+", " ", p["post_content"])[:1500]]
    open("old_categories_probe.txt", "w", encoding="utf-8").write("\n".join(lines))
    print("\n".join(lines[:80]))
    print("\nנכתבו: old_categories.csv, old_categories_probe.txt")


def cmd_terms(a):
    """הקטגוריות של האתר הישן הן טקסונומיה (קטגוריות) שמוצמדת לפוסטים של השטרות (main_ducuments / privet_ducuments ...): נקרא את הקשר פוסט<->קטגוריה."""
    sql = gzip.open(a.db, "rt", encoding="utf-8", errors="replace").read()
    def table(name, cols):
        c = columns(sql, name)
        ix = {k: c.index(k) for k in cols if k in c}
        return [{k: r[i] for k, i in ix.items()} for r in inserts(sql, name)]
    pc = columns(sql, "wp_posts")
    pix = {k: pc.index(k) for k in ("ID", "post_title", "post_type", "post_status", "post_content") if k in pc}
    posts = {}
    for r in inserts(sql, "wp_posts"):
        posts[r[pix["ID"]]] = {k: r[i] for k, i in pix.items()}
    terms = {t["term_id"]: t for t in table("wp_terms", ["term_id", "name", "slug"])}
    tax = {t["term_taxonomy_id"]: t for t in table("wp_term_taxonomy", ["term_taxonomy_id", "term_id", "taxonomy", "parent", "count"])}
    rel = table("wp_term_relationships", ["object_id", "term_taxonomy_id"])
    tname = lambda ttid: html.unescape(terms.get(tax[ttid]["term_id"], {}).get("name", "")) if ttid in tax else ""
    def path(ttid):
        names, seen = [], set()
        while ttid in tax and ttid not in seen:
            seen.add(ttid); names.append(tname(ttid))
            par = tax[ttid].get("parent", "0")
            ttid = next((k for k, v in tax.items() if v["term_id"] == par and par not in ("", "0")), None)
        return " › ".join(reversed([n for n in names if n]))
    DOC = set(a.types.split(","))
    use = collections.defaultdict(lambda: collections.Counter())        # taxonomy -> סוג פוסט -> כמות
    by_post = collections.defaultdict(list)
    for r in rel:
        t, post = tax.get(r["term_taxonomy_id"]), posts.get(r["object_id"])
        if not t or not post or post["post_status"] != "publish":
            continue
        use[t["taxonomy"]][post["post_type"]] += 1
        by_post[(post["ID"], t["taxonomy"])].append(r["term_taxonomy_id"])
    lines = ["== טקסונומיות בגיבוי (לפי סוג פוסט) =="]
    for tx, c in sorted(use.items(), key=lambda x: -sum(x[1].values())):
        n_terms = sum(1 for v in tax.values() if v["taxonomy"] == tx)
        lines.append(f"{tx}: {n_terms} קטגוריות; " + ", ".join(f"{k}={v}" for k, v in c.most_common(6)))
    cand = {tx: sum(v for k, v in c.items() if k in DOC) for tx, c in use.items() if tx not in ("nav_menu", "post_format", "link_category")}
    chosen = a.taxonomy or "general_categry,privet_category"
    chosen_set = {x.strip() for x in chosen.split(",") if x.strip()}
    lines.append(f"\nטקסונומיות שנבחרו: {', '.join(sorted(chosen_set))}")
    rows, seen = [], set()
    cnt = collections.Counter()
    for (pid, tx), ttids in by_post.items():
        if tx not in chosen_set or posts[pid]["post_type"] not in DOC:
            continue
        post = posts[pid]
        m = re.search(r"https?://[^\s\"'<>)\\]+\.pdf", post["post_content"], re.I)
        for tt in ttids:
            cat = path(tt)
            key = (cat, norm(html.unescape(post["post_title"])))
            if key in seen:
                continue
            seen.add(key); cnt[cat] += 1
            rows.append((cat, html.unescape(post["post_title"]).strip(), m.group(0) if m else "", post["post_type"]))
    rows.sort(key=lambda r: (r[0] == "שונות", r[0], r[1]))         # "שונות" אחרון: אם לפריט יש קטגוריה ספציפית היא תנצח
    with open("old_categories.csv", "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f); w.writerow(["קטגוריה", "פריט", "קישור", "מקור"]); w.writerows(rows)
    bykey = collections.defaultdict(set)
    for r in rows:
        bykey[norm(r[1])].add(r[0])
    with open("old_categories_multi.csv", "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f); w.writerow(["פריט", "קטגוריות"])
        for r in rows:
            if len(bykey[norm(r[1])]) > 1 and bykey.get(norm(r[1])) is not None:
                w.writerow([r[1], " | ".join(sorted(bykey.pop(norm(r[1]))))])
    multi = collections.Counter(r[1] for r in rows)
    lines += [f"{len(rows)} שורות (קטגוריה + שם פוסט) ב-{len(cnt)} קטגוריות; פריטים בכמה קטגוריות: {sum(1 for v in multi.values() if v > 1)}", ""]
    lines += [f"{n:5d}  {c}" for c, n in cnt.most_common(80)]
    open("old_categories_probe.txt", "w", encoding="utf-8").write("\n".join(lines))
    print("\n".join(lines[:90]))
    print("\nנכתבו: old_categories.csv, old_categories_probe.txt")


# ───────── התאמה לעסקים באתר ─────────
def norm(x):
    x = str(x or "").lower()
    x = re.sub(r"\([^)]*\)", " ", x)
    x = re.sub(r"[\"'`״׳.,\-–_/:;]", " ", x)
    x = re.sub(r"(^|\s)(בע\s*מ|בעמ|ltd|inc|חברה|חברת)(?=\s|$)", " ", x)
    return re.sub(r"\s+", " ", x).strip()


STRICT = [True]


def ctx():
    c = ssl.create_default_context()
    if not STRICT[0] and hasattr(ssl, "VERIFY_X509_STRICT"):
        c.verify_flags &= ~ssl.VERIFY_X509_STRICT
    return c


def call(site, token, path, body=None, method=None):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(site.rstrip("/") + "/api" + path, data=data, method=method or ("PUT" if data else "GET"),
                                 headers={"User-Agent": "Mozilla/5.0 (old-categories)", "Content-Type": "application/json", **({"Authorization": "Bearer " + token} if token else {})})
    last = None
    for attempt in range(5):
        try:
            with urllib.request.urlopen(req, timeout=90, context=ctx()) as r:
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            raise RuntimeError(f"{e.code}: {e.read().decode('utf-8', 'replace')[:200]}")
        except urllib.error.URLError as e:
            last = e
            if STRICT[0] and isinstance(e.reason, ssl.SSLCertVerificationError) and "key usage" in str(e.reason):
                STRICT[0] = False
                continue
        except (TimeoutError, OSError) as e:
            last = e
        time.sleep(2 * (attempt + 1))
    raise last


def cmd_match(a):
    biz = call(a.site, "", "/businesses")
    biz = biz if isinstance(biz, list) else biz.get("businesses", [])
    by_name = collections.defaultdict(list)
    by_hp = collections.defaultdict(list)
    for b in biz:
        for n in (b.get("permit_name"), b.get("registrar_name")):
            if norm(n):
                by_name[norm(n)].append(b)
        hp = re.sub(r"\D", "", str(b.get("chp_number") or ""))
        if hp:
            by_hp[hp.lstrip("0")].append(b)
    names = list(by_name)
    rows = [r for r in csv.DictReader(open(a.csv, encoding="utf-8-sig"))]
    out, cnt = [], collections.Counter()
    for r in rows:
        item = r["פריט"]
        found, how, conf = [], "", ""
        for d in re.findall(r"\d{7,9}", item):
            if by_hp.get(d.lstrip("0")):
                found, how, conf = by_hp[d.lstrip("0")], "ח.פ. בטקסט", "גבוה"
                break
        if not found:
            n = norm(item)
            if n in by_name:
                found, how, conf = by_name[n], "שם זהה", "גבוה"
            elif n:
                hit = difflib.get_close_matches(n, names, n=3, cutoff=0.86)
                if hit:
                    found = by_name[hit[0]]
                    how, conf = "שם דומה (" + hit[0] + ")", "בינוני" if len(hit) == 1 else "נמוך"
        uniq = {b["id"]: b for b in found}.values()
        if uniq:
            for b in uniq:
                out.append([r["קטגוריה"], item, b.get("permit_name") or b.get("registrar_name"), b.get("chp_number") or "", b["id"], how, conf, b.get("permits_category") or ""])
        else:
            out.append([r["קטגוריה"], item, "", "", "", "לא נמצא", "", ""])
        cnt[conf or "לא נמצא"] += 1
    with open("old_categories_plan.csv", "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f); w.writerow(["קטגוריה", "פריט בדף הישן", "עסק", "ח.פ.", "business_id", "התאמה", "ביטחון", "קטגוריה נוכחית"]); w.writerows(out)
    multi = collections.Counter((x[0], x[1]) for x in out if x[4])
    print(f"פריטים בדף הישן: {len(rows)}; לפי ביטחון: {dict(cnt)}; פריטים שהתאימו לכמה עסקים: {sum(1 for v in multi.values() if v > 1)}")
    print("נכתב old_categories_plan.csv (לבדוק את 'בינוני' / 'נמוך' / 'לא נמצא' לפני apply)")


def cmd_apply(a):
    order = {"high": ["גבוה"], "mid": ["גבוה", "בינוני"], "low": ["גבוה", "בינוני", "נמוך"]}[a.min]
    token = os.environ.get("ADMIN_PASSWORD") or ""
    if not token and os.path.exists(a.password_file):
        token = (open(a.password_file, encoding="utf-8").readline() or "").strip()
    if a.go and not token:
        token = getpass.getpass("סיסמת מנהל האתר: ")
    if a.undo:
        for line in reversed([json.loads(x) for x in open(a.undo, encoding="utf-8") if x.strip()]):
            print("מחזיר", line["id"], "←", repr(line["before"]))
            if a.go:
                cur = call(a.site, token, "/businesses")
                b = next(x for x in cur if x["id"] == line["id"])
                call(a.site, token, "/businesses/" + line["id"], {**b, "permits_category": line["before"]})
        return
    rows = [r for r in csv.DictReader(open("old_categories_plan.csv", encoding="utf-8-sig")) if r["business_id"] and r["ביטחון"] in order]
    cur = {b["id"]: b for b in (lambda x: x if isinstance(x, list) else x.get("businesses", []))(call(a.site, "", "/businesses"))}
    todo, seen = [], set()
    for r in rows:
        b = cur.get(r["business_id"])
        if not b or r["business_id"] in seen:
            continue
        seen.add(r["business_id"])
        if (b.get("permits_category") or "") != r["קטגוריה"]:
            todo.append((b, r["קטגוריה"]))
    print(f"{len(todo)} עסקים לעדכון מתוך {len(rows)} התאמות ({'כתיבה' if a.go else 'הרצה יבשה'})")
    for b, c in todo[:25]:
        print(f"  {b.get('permit_name') or b.get('registrar_name')}: '{b.get('permits_category') or ''}' ← '{c}'")
    if not a.go:
        print("(לביצוע: apply --go)"); return
    with open("old_categories_log.jsonl", "a", encoding="utf-8") as lg:
        for i, (b, c) in enumerate(todo, 1):
            lg.write(json.dumps({"id": b["id"], "before": b.get("permits_category") or "", "after": c}, ensure_ascii=False) + "\n"); lg.flush()
            call(a.site, token, "/businesses/" + b["id"], {**b, "permits_category": c})
            if i % 25 == 0:
                print(f"  {i}/{len(todo)}")
    print("הסתיים. (החזרה: apply --go --undo old_categories_log.jsonl)")


def main():
    ap = argparse.ArgumentParser()
    sp = ap.add_subparsers(dest="cmd", required=True)
    e = sp.add_parser("extract"); e.add_argument("db"); e.add_argument("--post")
    t = sp.add_parser("terms"); t.add_argument("db"); t.add_argument("--taxonomy", default=""); t.add_argument("--types", default="main_ducuments,main_documents,privet_ducuments,company")
    m = sp.add_parser("match"); m.add_argument("--site", default="https://harav-levin.pages.dev"); m.add_argument("--csv", default="old_categories.csv")
    p = sp.add_parser("apply"); p.add_argument("--site", default="https://harav-levin.pages.dev"); p.add_argument("--go", action="store_true")
    p.add_argument("--min", default="high", choices=["high", "mid", "low"]); p.add_argument("--undo", default=""); p.add_argument("--password-file", default="admin_password.txt")
    a = ap.parse_args()
    {"extract": cmd_extract, "terms": cmd_terms, "match": cmd_match, "apply": cmd_apply}[a.cmd](a)


if __name__ == "__main__":
    main()
