# -*- coding: utf-8 -*-
"""
נוסח ההיתר הפרטי: מחפש במסמכים את המילים "פרטי / פרטני" (וצורותיהן), מוציא את המשפט שסביבן, מקבץ משפטים דומים,
ומראה איזה נוסחים מופיעים בהיתרים הפרטיים (לפי מיקום באתר) ולא בכלליים. אחר כך בודק בכל מסמך אם יש בו משפט דומה לנוסח פרטי -
ומשווה לסיווג לפי מיקום (מסמכים חשודים נכתבים ל-type_check.csv).

  python private_wording.py --results כל_הקבצים4.csv --attachments attachments.csv --uploads "<uploads>" [--ocr-dir ocr_text]

פלט: private_wording.csv (נוסחים לפי שכיחות), type_check.csv (מסמכים שהנוסח שלהם לא מתאים למיקום).
"""
import argparse
import csv
import difflib
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import match_pdfs as m  # noqa: E402

P_TYPES = {"privet_ducuments", "company"}
G_TYPES = {"main_ducuments"}
# מילה שלמה בלבד (עם אותיות שימוש כמו ה/ו/ב/ל/מ/ש/כ בהתחלה), כדי לא לתפוס "פרטים" / "פרטיו" וכו'
KEY = re.compile(r"^[והבלמשכ]{0,3}(פרטי|פרטית|פרטיים|פרטיות|פרטני|פרטנית|פרטניים|פרטניות)$")
WIN = 12          # מילים לפני ואחרי מילת המפתח


def tokens(text):
    t = re.sub(r"[^\w\s]", " ", text.lower())
    t = re.sub(r"\d+", "#", t)
    return t.split()


def windows(text):
    ws = tokens(text)
    out = []
    for i, w in enumerate(ws):
        if KEY.match(w):
            out.append(" ".join(ws[max(0, i - WIN): i + WIN + 1]))
    return out


def ratio(a, b):
    sm = difflib.SequenceMatcher(None, a, b)
    if sm.real_quick_ratio() < 0.6 or sm.quick_ratio() < 0.6:
        return 0.0
    return sm.ratio()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--results", required=True)
    ap.add_argument("--attachments", required=True)
    ap.add_argument("--uploads", required=True)
    ap.add_argument("--ocr-dir", default="ocr_text")
    ap.add_argument("--out", default="private_wording.csv")
    ap.add_argument("--check-out", default="type_check.csv")
    ap.add_argument("--similar", type=float, default=0.72, help="סף דמיון לקיבוץ משפטים / התאמה")
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
        for od in a.ocr_dir.split(","):      # אפשר כמה תיקיות OCR (עמוד ראשון + עמודים נוספים)
            op = os.path.join(od.strip(), f"{r['attachment_id']}.txt")
            if os.path.exists(op):
                text += "\n" + open(op, encoding="utf-8").read()
        if len(text.strip()) < 100:
            continue
        docs.append({"id": r["attachment_id"], "file": r["file"], "title": r["post_title"], "type": "P" if pt in P_TYPES else "G", "win": windows(text)})
    P = [d for d in docs if d["type"] == "P"]
    G = [d for d in docs if d["type"] == "G"]
    print(f"מסמכים עם טקסט: פרטי {len(P)}, כללי {len(G)}")
    print(f"מסמכים שמכילים 'פרטי/פרטני': בפרטיים {sum(1 for d in P if d['win'])}/{len(P)}, בכלליים {sum(1 for d in G if d['win'])}/{len(G)}")
    if len(P) < 3:
        print("אין מספיק מסמכים פרטיים עם טקסט (חכה לסיום ה-OCR)")
        return

    # קיבוץ משפטים דומים (חמדני)
    clusters = []     # {"rep": text, "P": set(doc ids), "G": set(doc ids)}
    for d in P + G:
        for wtxt in d["win"]:
            for c in clusters:
                if ratio(wtxt, c["rep"]) >= a.similar:
                    c[d["type"]].add(d["id"])
                    break
            else:
                clusters.append({"rep": wtxt, "P": {d["id"]}, "G": set() if d["type"] == "P" else set()})
                clusters[-1][d["type"]].add(d["id"])
    for c in clusters:
        c.setdefault("P", set())
        c.setdefault("G", set())
    clusters.sort(key=lambda c: -(len(c["P"]) / len(P) - len(c["G"]) / max(1, len(G))))
    with open(a.out, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(["share_in_private", "share_in_general", "docs_private", "docs_general", "sentence_around_keyword", "example_ids"])
        for c in clusters:
            w.writerow([round(len(c["P"]) / len(P), 3), round(len(c["G"]) / max(1, len(G)), 3), len(c["P"]), len(c["G"]), c["rep"], " ".join(sorted(c["P"])[:3])])
    print(f"{len(clusters)} נוסחים שונים -> {a.out}")
    print("--- הנוסחים הבולטים בהיתר פרטי:")
    for c in clusters[:6]:
        print(f"   ב-{len(c['P'])}/{len(P)} פרטיים, ב-{len(c['G'])}/{len(G)} כלליים:  ...{c['rep']}...")

    # נוסח פרטי = נוסחים שנמצאים ב-15%+ מהפרטיים ובפחות מ-5% מהכלליים
    sig = [c["rep"] for c in clusters if len(c["P"]) / len(P) >= 0.15 and len(c["G"]) / max(1, len(G)) < 0.05]
    print(f"נוסחי היתר פרטי מבדילים: {len(sig)}")
    bad, ok = [], 0
    for d in docs:
        hit = any(ratio(wt, s) >= a.similar for wt in d["win"] for s in sig)
        guess = "P" if hit else "G"
        if guess == d["type"]:
            ok += 1
        else:
            bad.append((d["id"], d["file"], d["title"], "פרטי" if d["type"] == "P" else "כללי", "יש נוסח פרטי" if hit else "אין נוסח פרטי", len(d["win"])))
    with open(a.check_out, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(["attachment_id", "file", "post_title", "type_by_location", "text_check", "keyword_hits"])
        w.writerows(bad)
    print(f"הנוסח מתאים למיקום ב-{ok} מתוך {len(docs)} מסמכים; {len(bad)} חשודים -> {a.check_out}")


if __name__ == "__main__":
    sys.exit(main())
