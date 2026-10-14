# -*- coding: utf-8 -*-
"""
הצלבה של כמה מקורות לכל קובץ PDF - לא סומכים על מקור אחד:
  T = שם הפוסט באתר            (התאמה לשם עסק במאגר)
  H = ח.פ. שנמצא בקובץ עצמו    (כל המספרים התקינים לפי ספרת ביקורת, אפשר כמה; מותאם לעסקים במאגר)
  N = שם עסק שמופיע בטקסט הקובץ (התאמה של שמות העסקים במאגר מול הטקסט)
הטקסט: מה-PDF עצמו אם יש בו, אחרת מ-OCR (תיקיית ocr_text שהכין ocr_pdfs.py).

סטטוס לכל קובץ:
  מאומת        - לפחות שני מקורות מסכימים על אותו עסק ואין עסק אחר עם תמיכה דומה
  מקור יחיד    - רק מקור אחד מצביע על עסק (לבדיקה מדגמית)
  סתירה        - מקורות שונים מצביעים על עסקים שונים (לבדיקה ידנית)
  לא זוהה      - אין התאמה בשום מקור
סוג ההיתר (כללי / פרטי) לפי מיקום הקובץ באתר, ומסומן "?" (לא מאומת סופית).

  python reconcile.py --results כל_הקבצים4.csv --uploads "<uploads>" --businesses businesses.json --out סופי.csv
"""
import argparse
import csv
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import match_pdfs as m  # noqa: E402

TYPE = {"main_ducuments": "כללי?", "privet_ducuments": "פרטי?", "company": "פרטי?"}


def hp_candidates(text):
    out = []
    for x in re.findall(r"(?<!\d)(\d{8,9})(?!\d)", text.replace(",", "")):
        n = x.zfill(9)
        if m.check_digit_ok(n) and n not in out:
            out.append(n)
    return out


def doc_name_matches(ntext, names):
    """שמות עסקים (מנורמלים, 5+ תווים) שמופיעים בטקסט - גם אם נקרא הפוך (RTL)."""
    res = {}
    for n, b in names:
        nn = m.norm(n)
        if len(nn) >= 5 and (nn in ntext or nn[::-1] in ntext):
            res.setdefault(b["id"], (b, nn))
    return res


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--results", required=True)
    ap.add_argument("--uploads", required=True)
    ap.add_argument("--businesses", required=True)
    ap.add_argument("--ocr-dir", default="ocr_text")
    ap.add_argument("--out", default="סופי.csv")
    ap.add_argument("--limit", type=int, default=0)
    a = ap.parse_args()

    biz = m.load_businesses(a.businesses)
    by_hp, by_id = {}, {}
    for b in biz:
        by_id[b["id"]] = b
        d = re.sub(r"\D", "", b.get("chp_number") or "").lstrip("0")
        if d:
            by_hp.setdefault(d.zfill(9), []).append(b)
    names = [(n, b) for b in biz for n in {(b.get("registrar_name") or "").strip(), (b.get("permit_name") or "").strip()} if n]
    index = {}
    for d, _, files in os.walk(a.uploads):
        for f in files:
            if f.lower().endswith(".pdf"):
                index.setdefault(f, os.path.join(d, f))

    rows = m.read_csv(a.results)
    if a.limit:
        rows = rows[:a.limit]
    cols = ["attachment_id", "file", "doc_type", "post_type", "post_title", "status", "sources", "business_id", "business_name", "hp",
            "title_business", "doc_hps_in_db", "doc_hps_not_in_db", "doc_name_matches", "text_source", "text_chars", "note"]
    stats = {}
    with open(a.out, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(cols)
        for i, r in enumerate(rows, 1):
            text, src = "", "אין"
            if int(r.get("text_chars") or 0) >= 15 and r["file"] in index:
                text, src = m.pdf_text(index[r["file"]]), "PDF"
            else:
                p = os.path.join(a.ocr_dir, f"{r['attachment_id']}.txt")
                if os.path.exists(p):
                    text, src = open(p, encoding="utf-8").read(), "OCR"
            ntext = m.norm(text)
            votes = {}                                  # business id -> set of sources
            # T: שם הפוסט
            t = m.classify("", r["post_title"], {}, names)
            tb = t[1]
            if tb and t[2] in ("ודאי (לפי שם)", "סביר"):
                votes.setdefault(tb["id"], set()).add("T")
            # H: ח.פ. בקובץ
            hps = hp_candidates(text)
            in_db = [h for h in hps if h in by_hp]
            for h in in_db:
                for b in by_hp[h]:
                    votes.setdefault(b["id"], set()).add("H")
            # N: שם עסק בטקסט
            nm = doc_name_matches(ntext, names) if ntext else {}
            for bid in nm:
                votes.setdefault(bid, set()).add("N")

            if not votes:
                status, bid, srcs, note = "לא זוהה", "", "", ("אין טקסט בקובץ (דורש OCR)" if src == "אין" else "")
            else:
                ranked = sorted(votes.items(), key=lambda kv: (-len(kv[1]), kv[0]))
                top, topv = ranked[0]
                strong = [k for k, v in ranked if len(v) == len(topv)]
                if len(topv) >= 2 and len(strong) == 1:
                    status, bid, srcs, note = "מאומת", top, "+".join(sorted(topv)), ""
                    if len(ranked) > 1:
                        note = "יש גם עסקים נוספים עם תמיכה חלשה יותר: " + ", ".join(by_id[k].get("registrar_name", "") or by_id[k].get("permit_name", "") for k, _ in ranked[1:3])
                elif len(ranked) == 1:
                    status, bid, srcs, note = "מקור יחיד", top, "+".join(sorted(topv)), "מקור אחד בלבד"
                else:
                    status, bid, srcs = "סתירה", "", ""
                    note = "; ".join(f"{(by_id[k].get('registrar_name') or by_id[k].get('permit_name') or '')} ({'+'.join(sorted(v))})" for k, v in ranked[:4])
            b = by_id.get(bid) if bid else None
            stats[status] = stats.get(status, 0) + 1
            w.writerow([r["attachment_id"], r["file"], TYPE.get(r.get("post_type"), "?"), r.get("post_type", ""), r["post_title"], status, srcs, bid,
                        ((b or {}).get("registrar_name") or (b or {}).get("permit_name") or ""), (b or {}).get("chp_number", ""),
                        (tb or {}).get("registrar_name", "") if tb else "", " ".join(in_db), " ".join(h for h in hps if h not in by_hp),
                        " | ".join((v[0].get("registrar_name") or v[0].get("permit_name") or "") for v in list(nm.values())[:4]), src, len(text.strip()), note])
            if i % 200 == 0:
                print(f"{i}/{len(rows)}", stats, flush=True)
    print("סיום:", stats, "->", a.out)


if __name__ == "__main__":
    sys.exit(main())
