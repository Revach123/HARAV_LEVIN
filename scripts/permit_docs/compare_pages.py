# -*- coding: utf-8 -*-
"""
השוואת עמודים בין המסמכים של חברה אחת (קריאה בלבד, מקומי): איזה עמודים זהים בין המסמכים.
  python compare_pages.py --company "אביעד פיקדונות"        (חלק מהשם, או ח.פ.)
  python compare_pages.py --company 513931659 --files HGJ.pdf,SDF.pdf,EER.pdf
פלט: השוואת_עמודים.html (נפתח בדפדפן): לכל מסמך שורת תמונות ממוזערות של כל העמודים; עמודים זהים (בין מסמכים שונים) מסומנים באותה מסגרת צבעונית ובאותו מספר קבוצה.
      וגם סיכום בחלון הפקודות: לכל זוג מסמכים כמה עמודים זהים, ואיזה עמוד מול איזה.
עמוד עם טקסט נחשב זהה אם 80%+ מרצפי המילים זהים; עמוד סרוק בלי טקסט - לפי טביעת אצבע חזותית, מחמירה (עד 12 סיביות הבדל מתוך 1024), כך שסריקה חוזרת של אותו עמוד עלולה לא להיחשב זהה: בדקו בעין ב-HTML.
"""
import argparse
import base64
import collections
import html
import itertools
import json
import os
import sys

try:
    import pymupdf as fitz
except ImportError:
    import fitz

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import match_pdfs as m  # noqa: E402
from coverage_report import file_hashes  # noqa: E402
from dedupe_company_docs import words, shingles, same_page, visual_sig, fine_sig, exact_page, MAX_PAGES  # noqa: E402

COLORS = ["#e6194b", "#3cb44b", "#4363d8", "#f58231", "#911eb4", "#008080", "#9a6324", "#800000", "#808000", "#000075", "#f032e6", "#469990"]


def page_data(path):
    out = []
    doc = fitz.open(path)
    for i in range(min(len(doc), MAX_PAGES)):
        pg = doc[i]
        ws = words(pg.get_text() or "")
        r = pg.rect
        if len(ws) >= 6:
            sig = ("t", shingles(ws), fine_sig(pg))
        else:
            sig = visual_sig(pg) + (fine_sig(pg),)
        th = pg.get_pixmap(matrix=fitz.Matrix(170 / max(1, r.width), 170 / max(1, r.width)), colorspace=fitz.csGRAY)
        out.append({"sig": sig, "png": base64.b64encode(th.tobytes("png")).decode("ascii"), "kind": sig[0]})
    doc.close()
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--company", required=True)
    ap.add_argument("--files", default="", help="רשימת שמות קבצים להשוואה (אחרת: כל מסמכי החברה)")
    ap.add_argument("--map", default="מיפוי_קבצים.csv")
    ap.add_argument("--businesses", default="businesses.json")
    ap.add_argument("--attachments", default="attachments.csv")
    ap.add_argument("--uploads", default=os.path.join("wp-content", "uploads"))
    ap.add_argument("--hash-cache", default="hashes_cache.json")
    ap.add_argument("--out", default="השוואת_עמודים.html")
    a = ap.parse_args()

    q = a.company.strip()
    biz = [b for b in json.load(open(a.businesses, encoding="utf-8")) if q in (b.get("registrar_name") or "") or q in (b.get("permit_name") or "") or q == str(b.get("chp_number") or "")]
    if not biz:
        print("לא נמצאה חברה")
        return 1
    if len(biz) > 1:
        print("כמה חברות מתאימות; מדויק יותר (שם מלא או ח.פ.):")
        for b in biz[:15]:
            print("  ", b.get("registrar_name") or b.get("permit_name"), b.get("chp_number"))
        return 1
    b = biz[0]
    name = b.get("registrar_name") or b.get("permit_name")
    guid = {r["ID"]: r.get("guid", "") for r in m.read_csv(a.attachments)}
    hashes = file_hashes(a.attachments, a.uploads, a.hash_cache)
    want = {x.strip().lower() for x in a.files.split(",") if x.strip()}
    docs = {}
    for r in m.read_csv(a.map):
        if b["id"] not in (r.get("company_ids") or "").split(";"):
            continue
        if want and r["file"].lower() not in want:
            continue
        p = m.local_path(a.uploads, guid.get(r["attachment_id"], ""))
        sha = hashes.get(r["attachment_id"])
        if not sha or not p or not os.path.exists(p):
            continue
        d = docs.setdefault(sha, {"file": r["file"], "ids": [], "path": p, "types": set()})
        d["ids"].append(r["attachment_id"])
        if r["type"] in ("כללי", "פרטי"):
            d["types"].add(r["type"])
    ds = list(docs.values())
    if len(ds) < 1:
        print("אין מסמכים לחברה")
        return 1
    for d in ds:
        d["pages"] = page_data(d["path"])
    # קבוצות עמודים זהים (union-find)
    nodes = [(i, j) for i, d in enumerate(ds) for j in range(len(d["pages"]))]
    parent = {n: n for n in nodes}

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x
    for (i, j), (k, l) in itertools.combinations(nodes, 2):
        if i != k and same_page(ds[i]["pages"][j]["sig"], ds[k]["pages"][l]["sig"]):
            parent[find((i, j))] = find((k, l))
    groups = collections.defaultdict(list)
    for n in nodes:
        groups[find(n)].append(n)
    gid = {}
    for root, members in groups.items():
        if len({i for i, _ in members}) >= 2:
            gid[root] = len(gid) + 1
    # סיכום לכל זוג
    print(f"{name}: {len(ds)} מסמכים")
    for i, j in itertools.combinations(range(len(ds)), 2):
        pairs = [(p + 1, q + 1) for p in range(len(ds[i]["pages"])) for q in range(len(ds[j]["pages"]))
                 if find((i, p)) == find((j, q)) and find((i, p)) in gid]
        if pairs:
            n1, n2 = len(ds[i]["pages"]), len(ds[j]["pages"])
            same_pages = len({p for p, _ in pairs})
            print(f"  {ds[i]['file']} ({n1} עמ') ↔ {ds[j]['file']} ({n2} עמ'): {same_pages} עמודים זהים: " + ", ".join(f"{p}={q}" + ("" if exact_page(ds[i]["pages"][p - 1]["sig"], ds[j]["pages"][q - 1]["sig"]) else "⚠(הבדל קטן)") for p, q in pairs[:12]))
    rows = []
    rep_of = {root: members[0] for root, members in groups.items() if root in gid}     # נציג כל קבוצה: מולו נבדק אם יש הבדל קטן (שורה מחוקה / הערה)
    for i, d in enumerate(ds):
        cells = []
        for j, pg in enumerate(d["pages"]):
            g = gid.get(find((i, j)))
            col = COLORS[(g - 1) % len(COLORS)] if g else "#ccc"
            small = ""
            if g:
                ri, rj = rep_of[find((i, j))]
                if (ri, rj) != (i, j) and not exact_page(ds[ri]["pages"][rj]["sig"], pg["sig"]):
                    small = " · ⚠ הבדל קטן"
            tag = f'<div class="tag" style="background:{col}">קבוצה {g}{small}</div>' if g else '<div class="tag none">ייחודי</div>'
            cells.append(f'<div class="pg" style="border-color:{col}"><img src="data:image/png;base64,{pg["png"]}"><div class="n">עמוד {j + 1}{" (טקסט)" if pg["kind"] == "t" else " (סריקה)"}</div>{tag}</div>')
        t = "+".join(sorted(d["types"])) or "לא ידוע"
        rows.append(f'<h3>{html.escape(d["file"])} <small>· {len(d["pages"])} עמודים · {html.escape(t)} · מזהים: {html.escape(" ".join(d["ids"]))}</small></h3><div class="row">{"".join(cells)}</div>')
    page = f"""<!doctype html><html lang="he" dir="rtl"><meta charset="utf-8"><title>השוואת עמודים</title>
<style>body{{font-family:Arial;margin:20px}}h3{{margin:22px 0 6px}}small{{color:#666;font-weight:400}}.row{{display:flex;flex-wrap:wrap;gap:10px}}
.pg{{border:4px solid;border-radius:6px;padding:4px;width:180px;text-align:center}}.pg img{{width:100%}}.n{{font-size:12px;color:#444}}
.tag{{color:#fff;font-size:12px;border-radius:4px;margin-top:3px;padding:1px}}.tag.none{{background:#ccc;color:#444}}</style>
<h2>{html.escape(name)} — השוואת עמודים</h2><p>עמודים עם אותה מסגרת ואותו מספר קבוצה זהים בין מסמכים שונים. "ייחודי" = אין עמוד זהה במסמך אחר.</p>{"".join(rows)}</html>"""
    with open(a.out, "w", encoding="utf-8") as f:
        f.write(page)
    print(f"-> {a.out} (לפתוח בדפדפן)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
