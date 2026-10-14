# -*- coding: utf-8 -*-
"""
איזה נוסח מופיע בקביעות בהיתר "פרטי" ולא בהיתר "כללי"?  (לפי מיקום הקובץ באתר: privet_ducuments / company = פרטי, main_ducuments = כללי)
מחשב אילו מילים וצירופי מילים (1-4 מילים) מופיעים ברוב המסמכים הפרטיים ובמעט הכלליים (ולהפך), ובודק כמה מסמכים
"נקראים" נכון לפי נוסח כזה - כדי לאמת את הסיווג לפי מיקום (ולמצוא מסמכים שהסיווג שלהם חשוד).

  python type_phrases.py --results כל_הקבצים4.csv --attachments attachments.csv --uploads "<uploads>" [--ocr-dir ocr_text]

פלט:  type_phrases.csv (הצירופים המבדילים)  +  type_check.csv (מסמכים שהנוסח שלהם לא מתאים למיקום - לבדיקה ידנית).
"""
import argparse
import csv
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import match_pdfs as m  # noqa: E402

P_TYPES = {"privet_ducuments", "company"}
G_TYPES = {"main_ducuments"}


def words(text):
    t = re.sub(r"[^\w\s]", " ", text.lower())
    t = re.sub(r"\d+", " # ", t)             # מספרים (ח.פ., תאריכים) -> סימן אחד
    return [w for w in t.split() if w]


def grams(ws, n):
    return {" ".join(ws[i:i + n]) for i in range(len(ws) - n + 1)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--results", required=True)
    ap.add_argument("--attachments", required=True)
    ap.add_argument("--uploads", required=True)
    ap.add_argument("--ocr-dir", default="ocr_text")
    ap.add_argument("--out", default="type_phrases.csv")
    ap.add_argument("--check-out", default="type_check.csv")
    ap.add_argument("--min-private", type=float, default=0.6, help="שיעור מינימלי של המסמכים הפרטיים שמכילים את הצירוף")
    ap.add_argument("--max-general", type=float, default=0.1, help="שיעור מקסימלי של המסמכים הכלליים שמכילים אותו")
    a = ap.parse_args()

    guid = {r["ID"]: r.get("guid", "") for r in m.read_csv(a.attachments)}
    docs = []
    for r in m.read_csv(a.results):
        pt = r.get("post_type", "")
        if pt not in P_TYPES | G_TYPES:
            continue
        text = ""
        p = m.local_path(a.uploads, guid.get(r["attachment_id"], ""))
        if p and os.path.exists(p) and int(r.get("text_chars") or 0) >= 15:
            text += m.pdf_text(p)
        op = os.path.join(a.ocr_dir, f"{r['attachment_id']}.txt")
        if os.path.exists(op):
            text += "\\n" + open(op, encoding="utf-8").read()
        ws = words(text)
        if len(ws) < 30:
            continue
        docs.append({"id": r["attachment_id"], "file": r["file"], "title": r["post_title"], "type": "P" if pt in P_TYPES else "G",
                     "g": {n: grams(ws, n) for n in (1, 2, 3, 4)}})
    P = [d for d in docs if d["type"] == "P"]
    G = [d for d in docs if d["type"] == "G"]
    print(f"מסמכים עם טקסט: פרטי {len(P)}, כללי {len(G)}")
    if len(P) < 5 or len(G) < 5:
        print("אין מספיק מסמכים עם טקסט בשני הסוגים (חכה לסיום ה-OCR)")
        return

    rows = []
    for n in (1, 2, 3, 4):
        cp, cg = {}, {}
        for d in P:
            for g in d["g"][n]:
                cp[g] = cp.get(g, 0) + 1
        for d in G:
            for g in d["g"][n]:
                cg[g] = cg.get(g, 0) + 1
        for g, c in cp.items():
            fp, fg = c / len(P), cg.get(g, 0) / len(G)
            if fp >= a.min_private and fg <= a.max_general:
                rows.append((n, "פרטי", g, round(fp, 3), round(fg, 3)))
        for g, c in cg.items():
            fg, fp = c / len(G), cp.get(g, 0) / len(P)
            if fg >= a.min_private and fp <= a.max_general:
                rows.append((n, "כללי", g, round(fg, 3), round(fp, 3)))
    rows.sort(key=lambda r: (r[1], -(r[3] - r[4]), -r[0]))
    with open(a.out, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(["words", "type", "phrase", "share_in_type", "share_in_other_type"])
        w.writerows(rows)
    print(f"נמצאו {len(rows)} צירופים מבדילים -> {a.out}")
    for typ in ("פרטי", "כללי"):
        top = [r for r in rows if r[1] == typ][:8]
        print(f"--- הצירופים הבולטים של היתר {typ}:")
        for r in top:
            print(f"   [{r[0]} מילים] {r[2]}   (ב-{int(r[3]*100)}% מה{typ}, ב-{int(r[4]*100)}% מהסוג השני)")

    # בדיקה: איזה שיעור מהצירופים המבדילים של ההיתר הפרטי נמצא במסמך. נוכחות רבה = פרטי, היעדר = כללי, באמצע = לא ברור.
    sigP = {r[2] for r in rows if r[1] == "פרטי" and r[0] >= 2}
    sigG = {r[2] for r in rows if r[1] == "כללי" and r[0] >= 2}
    bad, ok = [], 0
    for d in docs:
        allg = set().union(*d["g"].values())
        rp = len(allg & sigP) / max(1, len(sigP))
        rg = len(allg & sigG) / max(1, len(sigG))
        guess = "P" if rp >= 0.4 and rp >= rg else "G" if rp < 0.2 else "?"
        if guess == d["type"]:
            ok += 1
        else:
            bad.append((d["id"], d["file"], d["title"], "פרטי" if d["type"] == "P" else "כללי", round(rp, 2), round(rg, 2), {"P": "פרטי", "G": "כללי", "?": "לא ברור"}[guess]))
    with open(a.check_out, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(["attachment_id", "file", "post_title", "type_by_location", "share_of_private_phrases", "share_of_general_phrases", "type_by_text"])
        w.writerows(bad)
    print(f"הנוסח מתאים למיקום ב-{ok} מתוך {len(docs)} מסמכים; {len(bad)} חשודים -> {a.check_out}")


if __name__ == "__main__":
    sys.exit(main())
