# -*- coding: utf-8 -*-
"""
כל הקישורים שהאתר הישן עצמו מגדיר בין חברה (פוסט ממסמכי היתר) לבין קובץ השטר שלה: קריאה בלבד.
מקור האמת הוא תוכן הפוסט (main_ducuments = כללי, privet_ducuments = פרטי, company, main_documents, product),
ולא רק "קובץ מצורף שההורה שלו הוא הפוסט" (כך שהיו שטרות שלא נתפסו).

    python old_site_links.py "C:\\...\\backup_..._-db.gz"
    python old_site_links.py db.gz --roots "wp-content\\uploads" "C:\\Users\\...\\BACKUP_harav_levin" --known text_index\\permit_text.db

המסמכים לא חייבים להיות באותה תיקייה: הסקריפט מחפש כל קובץ בכל התיקיות וקובצי ה-zip שבשורת --roots
(לפי הנתיב, ואם אין - לפי שם הקובץ), ומדווח איפה נמצא כל אחד, או שלא נמצא בשום מקום.
בנוסף: old_orphans.csv = קובצי PDF שנמצאו בתיקיות / בגיבויים ואף פוסט לא מקשר אליהם.

פלט: old_links.csv (שורה לכל פוסט + קבצים שלו), old_links_summary.txt
"""
import argparse
import csv
import gzip
import hashlib
import os
import re
import sqlite3
import sys
import zipfile
from urllib.parse import unquote

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from old_site_probe import columns, inserts  # noqa: E402

TYPES = {"main_ducuments": "כללי", "main_documents": "כללי", "privet_ducuments": "פרטי", "company": "פרטי", "product": "מוצר"}
URL = re.compile(r"""(?:https?://[^\s"'<>)\\]+|/?wp-content/uploads/[^\s"'<>)\\]+)\.(?:pdf|docx?|jpe?g|png|gif|tiff?|rtf|odt|xlsx?|zip)\b""", re.I)


def rel(u):
    u = unquote(u)
    i = u.find("wp-content/uploads/")
    return u[i + len("wp-content/uploads/"):] if i >= 0 else u


def sha_of(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for ch in iter(lambda: f.read(1 << 20), b""):
            h.update(ch)
    return h.hexdigest()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("db")
    ap.add_argument("--roots", nargs="*", default=[os.path.join("wp-content", "uploads")], help="תיקיות לחיפוש (וגם קובצי zip בתוכן)")
    ap.add_argument("--known", default=os.path.join("text_index", "permit_text.db"))
    ap.add_argument("--out", default="old_links.csv")
    ap.add_argument("--extract", default="", help="תיקייה: מחלץ אליה כל PDF שחתימתו לא במאגר המקומי (קבצים שהתגלו עכשיו: גרסאות שנדרסו, יתומים), בשם <חתימה>__<נתיב>.pdf, כדי להריץ עליהם run_step2.py --extra")
    a = ap.parse_args()
    sql = gzip.open(a.db, "rt", encoding="utf-8", errors="replace").read()
    pc, mc = columns(sql, "wp_posts"), columns(sql, "wp_postmeta")
    ix = {k: pc.index(k) for k in ("ID", "post_title", "post_name", "post_type", "post_status", "post_content", "post_parent", "post_date", "post_modified") if k in pc}
    posts = {}
    for r in inserts(sql, "wp_posts"):
        posts[r[ix["ID"]]] = {k: r[i] for k, i in ix.items()}
    # קובץ מצורף -> נתיב ומי ההורה שלו
    files = {}
    mi = {k: mc.index(k) for k in ("post_id", "meta_key", "meta_value")}
    for r in inserts(sql, "wp_postmeta"):
        if r[mi["meta_key"]] == "_wp_attached_file":
            files[r[mi["post_id"]]] = r[mi["meta_value"]]
    by_parent = {}
    for pid, x in posts.items():
        if x["post_type"] == "attachment" and pid in files:
            by_parent.setdefault(x["post_parent"], []).append(files[pid])

    # אינדקס של כל הקבצים בכל התיקיות וקובצי ה-zip: לפי נתיב יחסי ל-uploads, ולפי שם קובץ
    by_rel, by_exact, by_base, allpdf = {}, {}, {}, []
    def add(src, inner, size):
        norm = inner.replace("\\", "/")
        i = norm.lower().rfind("uploads/")
        relp = norm[i + 8:] if i >= 0 else norm
        ent = (src, inner, size)
        by_rel.setdefault(relp.lower(), []).append(ent)
        by_exact.setdefault(relp, []).append(ent)          # באותיות גדולות/קטנות כפי שהן: ב-Windows שני קבצים ששמם שונה רק באותיות נדרסים זה את זה
        by_base.setdefault(os.path.basename(norm).lower(), []).append(ent)
        if norm.lower().endswith(".pdf"):
            allpdf.append((relp, ent))
    for root in a.roots:
        for dp, dn, fn in os.walk(root):
            for f in fn:
                fp = os.path.join(dp, f)
                if f.lower().endswith(".zip"):
                    try:
                        with zipfile.ZipFile(fp) as z:
                            for zi in z.infolist():
                                if not zi.is_dir():
                                    add(fp, zi.filename, zi.file_size)
                    except Exception as e:  # noqa: BLE001
                        print("  zip לא נקרא:", fp, e)
                else:
                    try:
                        add(fp, fp, os.path.getsize(fp))
                    except OSError:
                        pass
    print(f"באינדקס: {sum(len(v) for v in by_rel.values())} קבצים, מהם PDF: {len(allpdf)}")

    def read_sha(ent):
        src, inner, _ = ent
        h = hashlib.sha256()
        if src == inner:
            return sha_of(src)
        with zipfile.ZipFile(src) as z, z.open(inner) as f:
            for ch in iter(lambda: f.read(1 << 20), b""):
                h.update(ch)
        return h.hexdigest()

    known = set()
    if os.path.exists(a.known):
        db = sqlite3.connect("file:" + os.path.abspath(a.known).replace("\\", "/") + "?mode=ro", uri=True)
        known = {r[0] for r in db.execute("SELECT sha FROM docs")}
        db.close()
    print(f"מסמכים ידועים במאגר המקומי: {len(known)}")

    rows, stats, other_refs, ref_ents = [], {}, [], set()
    for pid, x in posts.items():          # קישורים מכל שאר סוגי הפוסטים (דפים, פוסטים, פורטפוליו...): הקובץ אינו יתום אם יש מי שמקשר אליו
        if x["post_type"] in TYPES or x["post_type"] in ("attachment", "revision", "nav_menu_item"):
            continue
        for u in URL.findall(x["post_content"]):
            r_ = rel(u)
            other_refs.append([x["post_type"], pid, x["post_status"], x["post_title"], r_])
            for e in by_rel.get(r_.lower(), []):
                ref_ents.add(e)
    shas, used_ents, new_refs = {}, set(), {}
    for pid, x in posts.items():
        t = x["post_type"]
        if t not in TYPES or x["post_status"] == "auto-draft":
            continue
        urls = []
        for u in URL.findall(x["post_content"]):
            r_ = rel(u)
            if re.search(r"-\d+x\d+\.(?:png|jpe?g|gif)$", r_, re.I):  # תמונה ממוזערת: לא קובץ נפרד
                continue
            if r_ not in urls:
                urls.append(r_)
        attached = by_parent.get(pid, [])
        s = stats.setdefault((t, x["post_status"]), dict(posts=0, with_url=0, only_url=0, files=0, exact=0, name_only=0, conflict=0, missing=0, known=0, notknown=0))
        s["posts"] += 1
        if not urls:
            rows.append([TYPES[t], t, pid, x["post_status"], x["post_date"][:10], x["post_title"], x["post_name"], "", "", "", "", "", "", "", ""])
            continue
        s["with_url"] += 1
        outside = [u for u in urls if u not in attached]
        if outside:
            s["only_url"] += 1          # יש קובץ בתוכן שאינו "מצורף לפוסט": כאן הפספוס של השיטה הישנה
        for u in urls:
            s["files"] += 1
            cands, how = by_exact.get(u, []), "נתיב"
            if not cands:
                cands, how = by_rel.get(u.lower(), []), "אותיות"
            if not cands:
                cands, how = by_base.get(os.path.basename(u).lower(), [])[:5], "שם קובץ בלבד"
            sh_list, where, flag = [], "", ""
            for c in cands:
                used_ents.add(c)
                new_refs.setdefault(c, set()).add(f"{TYPES[t]}: {x['post_title']}")
                if c not in shas and u.lower().endswith(".pdf"):
                    try:
                        shas[c] = read_sha(c)
                    except Exception:  # noqa: BLE001
                        shas[c] = ""
                sh_list.append((c, shas.get(c, "")))
            distinct = {h for _, h in sh_list if h}
            if cands:
                c0, h0 = sh_list[0]
                where = (os.path.basename(c0[0]) + " :: " + c0[1] if c0[0] != c0[1] else c0[0]) + (f" (+{len(cands) - 1} עותקים)" if len(cands) > 1 else "")
                if how == "אותיות":
                    flag = "לא מאומת: נמצא רק בהבדל אותיות גדולות/קטנות בנתיב (יכול להיות מסמך אחר)"
                    s["name_only"] += 1
                elif how != "נתיב":
                    flag = "לא מאומת: נמצא רק לפי שם קובץ (יכול להיות מסמך אחר)"
                    s["name_only"] += 1
                else:
                    s["exact"] += 1
                    if len(distinct) > 1:
                        flag = "גרסאות שונות באותו נתיב"
                        s["conflict"] += 1
                if any(h in known for h in distinct):
                    s["known"] += 1
                elif distinct:
                    s["notknown"] += 1
            else:
                s["missing"] += 1
            rows.append([TYPES[t], t, pid, x["post_status"], x["post_date"][:10], x["post_title"], x["post_name"], u,
                         "כן" if u in attached else "לא", where if cands else "לא נמצא בשום מקום", sh_list[0][1][:12] if sh_list else "",
                         ("כן" if any(h in known for h in distinct) else "לא") if distinct else "", x["post_modified"][:10],
                         flag, " | ".join(f"{(os.path.basename(c[0]) if c[0] != c[1] else 'תיקייה')}:{h[:12]}" for c, h in sh_list) if len(sh_list) > 1 else ""])
    with open(a.out, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(["סוג", "post_type", "post_id", "סטטוס", "תאריך", "כותרת (חברה)", "slug", "קובץ (נתיב ב-uploads)", "מצורף לפוסט", "איפה נמצא", "חתימה", "במאגר", "עודכן", "הערה", "כל הגרסאות (מקור:חתימה)"])
        w.writerows(rows)
    try:
        from find_missed_pdfs import permit_like
    except Exception:  # noqa: BLE001
        permit_like = None
    def read_bytes(ent):
        src, inner, _ = ent
        if src == inner:
            return open(src, "rb").read()
        with zipfile.ZipFile(src) as z:
            return z.read(inner)
    cf7 = re.compile(r"^(?!20\d\d/)\d+/")
    groups = {}
    for r_, e in allpdf:
        if e not in used_ents and e not in ref_ents:
            groups.setdefault(r_.lower(), []).append((r_, e))
    n_cf7 = sum(len(v) for k, v in groups.items() if cf7.match(k))
    orph = []
    for k, lst in sorted(groups.items()):
        if cf7.match(k):
            continue          # תיקיות ממוספרות = אישורי הצטרפות (טפסים), לא שטרות
        for r_, e in lst:
            try:
                data = read_bytes(e)
                sh = hashlib.sha256(data).hexdigest()
                looks = permit_like(data) if permit_like else ""
            except Exception as ex:  # noqa: BLE001
                sh, looks = "", "לא נקרא"
            orph.append([r_, os.path.basename(e[0]) if e[0] != e[1] else "תיקייה מקומית", e[2], sh[:12], "כן" if sh in known else "לא", looks])
            if sh and sh not in known and not re.search(r"(document-pdf|preview-\d+|^plugins/)", r_.lower()):
                new_refs.setdefault(e, set()).add("יתום (אף פוסט לא מקשר אליו)")
    with open("old_orphans.csv", "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(["נתיב", "מקור", "גודל", "חתימה", "במאגר", "נראה כמו"])
        w.writerows(orph)
    with open("old_other_refs.csv", "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(["post_type", "post_id", "סטטוס", "כותרת", "קובץ"])
        w.writerows(other_refs)
    nk = sum(1 for o in orph if o[4] == "לא")
    print(f"PDF שאף פוסט לא מקשר אליהם: {len(orph)} מחוץ לטפסי ההצטרפות (מהם לא במאגר: {nk}); בתיקיות ממוספרות (טפסים): {n_cf7}")
    if a.extract:
        os.makedirs(a.extract, exist_ok=True)
        done_sha, listing = set(), []
        for ent, why in new_refs.items():
            try:
                data = read_bytes(ent)
                sh = hashlib.sha256(data).hexdigest()
            except Exception:  # noqa: BLE001
                continue
            if sh in known or sh in done_sha or not data[:5] == b"%PDF-":
                continue
            done_sha.add(sh)
            rel_name = ent[1].replace("\\", "/").split("uploads/")[-1].replace("/", "_")
            fn = f"{sh[:12]}__{rel_name}"
            with open(os.path.join(a.extract, fn), "wb") as f:
                f.write(data)
            listing.append([fn, sh[:12], os.path.basename(ent[0]) if ent[0] != ent[1] else "תיקייה מקומית", " | ".join(sorted(why))[:300]])
        with open("old_new_files.csv", "w", encoding="utf-8-sig", newline="") as f:
            w = csv.writer(f)
            w.writerow(["קובץ", "חתימה", "מקור", "מקושר מ"])
            w.writerows(listing)
        print(f"חולצו {len(listing)} קבצים חדשים (שחתימתם לא במאגר המקומי) אל {a.extract}\\ ; הרשימה ב-old_new_files.csv")
    lines = ["post_type / סטטוס: פוסטים | עם קישור בתוכן | מהם עם קובץ שאינו מצורף לפוסט | קבצים | נמצא בנתיב מדויק | נמצא רק לפי שם (לא מאומת) | גרסאות שונות באותו נתיב | לא נמצא בשום מקום | חתימה ידועה במאגר | חתימה לא ידועה"]
    for (t, st), s in sorted(stats.items()):
        lines.append(f"{t} / {st}: {s['posts']} | {s['with_url']} | {s['only_url']} | {s['files']} | {s['exact']} | {s['name_only']} | {s['conflict']} | {s['missing']} | {s['known']} | {s['notknown']}")
    uniq = {r[7] for r in rows if r[7]}
    lines.append(f"\nקבצים ייחודיים בקישורים: {len(uniq)}; שורות: {len(rows)}; לא נמצאו בשום מקום: {sum(1 for r in rows if r[9] == 'לא נמצא בשום מקום')}; גרסאות שונות באותו נתיב: {sum(1 for r in rows if r[13] == 'גרסאות שונות באותו נתיב')}")
    txt = "\n".join(lines)
    print(txt)
    open("old_links_summary.txt", "w", encoding="utf-8").write(txt)
    print(f"\nנכתב: {a.out}, old_links_summary.txt")


if __name__ == "__main__":
    main()
