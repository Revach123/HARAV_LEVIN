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
    ap.add_argument("--attachments", required=True, help="attachments.csv (לזיהוי הקובץ המדויק לפי מזהה)")
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
    guid = {r["ID"]: r.get("guid", "") for r in m.read_csv(a.attachments)}

    rows = m.read_csv(a.results)
    if a.limit:
        rows = rows[:a.limit]
    nm_label = lambda bid: (by_id[bid].get("registrar_name") or by_id[bid].get("permit_name") or "")

    # שלב 1: טקסט (PDF + OCR) וחילוץ ח.פ. ושמות לכל קובץ
    data = []
    for r in rows:
        p = m.local_path(a.uploads, guid.get(r["attachment_id"], ""))
        text, src = "", []
        if p and os.path.exists(p) and int(r.get("text_chars") or 0) >= 15:
            t = m.pdf_text(p)
            if t.strip():
                text += t
                src.append("PDF")
        for od in a.ocr_dir.split(","):        # אפשר כמה תיקיות OCR (עמוד ראשון + עמודים נוספים)
            op = os.path.join(od.strip(), f"{r['attachment_id']}.txt")
            if os.path.exists(op):
                text += "\n" + open(op, encoding="utf-8").read()
                if "OCR" not in src:
                    src.append("OCR")
        ntext = m.norm(text)
        hps = hp_candidates(text)
        data.append({"r": r, "text": text, "src": "+".join(src) or "אין", "hps": hps, "nm": doc_name_matches(ntext, names) if ntext else {}})

    # שמות שמופיעים בחלק גדול מהמסמכים (למשל שם המכון בכותרת / בתחתית) לא מוכיחים כלום
    with_text = [d for d in data if d["text"].strip()]
    freq = {}
    for d in with_text:
        for bid in d["nm"]:
            freq[bid] = freq.get(bid, 0) + 1
    limit = max(15, int(0.04 * len(with_text)))
    stop = {bid for bid, c in freq.items() if c > limit}
    if stop:
        print("שמות שהוסרו כי מופיעים ביותר מדי מסמכים:", ", ".join(f"{nm_label(b)} ({freq[b]})" for b in stop))

    cols = ["attachment_id", "file", "doc_type", "post_type", "post_title", "status", "sources", "business_id", "business_name", "hp",
            "title_business", "title_differs", "doc_hps_in_db", "doc_hps_not_in_db", "doc_name_matches", "text_source", "text_chars", "note"]
    stats = {}
    with open(a.out, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(cols)
        for d in data:
            r, text, src, hps = d["r"], d["text"], d["src"], d["hps"]
            nm = {k: v for k, v in d["nm"].items() if k not in stop}
            votes = {}                                  # business id -> set of sources
            t = m.classify("", r["post_title"], {}, names)
            tb = t[1] if t[2] in ("ודאי (לפי שם)", "סביר") else None
            if tb:
                votes.setdefault(tb["id"], set()).add("T")
            in_db = [h for h in hps if h in by_hp]
            for h in in_db:
                for b in by_hp[h]:
                    votes.setdefault(b["id"], set()).add("H")
            for bid in nm:
                votes.setdefault(bid, set()).add("N")

            differs = ""
            if not votes:
                status, bid, srcs, note = "לא זוהה", "", "", ("אין טקסט בקובץ (דורש OCR)" if src == "אין" else "")
            else:
                ranked = sorted(votes.items(), key=lambda kv: (-len(kv[1]), kv[0]))
                top, topv = ranked[0]
                strong = [k for k, v in ranked if len(v) == len(topv)]
                if len(topv) >= 2 and len(strong) == 1:
                    status, bid, srcs, note = "מאומת", top, "+".join(sorted(topv)), ""
                    if tb and tb["id"] != top:
                        status, differs = "מאומת - שם הפוסט שונה", "כן"
                        note = f"שם הפוסט מצביע על: {nm_label(tb['id'])}"
                    elif len(ranked) > 1:
                        note = "יש גם עסקים נוספים עם תמיכה חלשה יותר: " + ", ".join(nm_label(k) for k, _ in ranked[1:3])
                elif len(ranked) == 1:
                    status, bid, srcs, note = "מקור יחיד", top, "+".join(sorted(topv)), "מקור אחד בלבד"
                else:
                    status, bid, srcs = "סתירה", "", ""
                    note = "; ".join(f"{nm_label(k)} ({'+'.join(sorted(v))})" for k, v in ranked[:4])
            b = by_id.get(bid) if bid else None
            stats[status] = stats.get(status, 0) + 1
            w.writerow([r["attachment_id"], r["file"], TYPE.get(r.get("post_type"), "?"), r.get("post_type", ""), r["post_title"], status, srcs, bid,
                        ((b or {}).get("registrar_name") or (b or {}).get("permit_name") or ""), (b or {}).get("chp_number", ""),
                        (tb or {}).get("registrar_name", "") if tb else "", differs, " ".join(in_db), " ".join(h for h in hps if h not in by_hp),
                        " | ".join(nm_label(k) for k in list(nm)[:4]), src, len(text.strip()), note])
    print("סיום:", stats, "->", a.out)


if __name__ == "__main__":
    sys.exit(main())
