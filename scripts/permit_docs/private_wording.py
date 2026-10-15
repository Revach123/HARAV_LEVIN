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


# משפט מפתח קבוע של היתר פרטי: "החברה מאשרת בזאת התקשרות בהיתר עיסקא באופן פרטי עם כל המעוניין בכך"
# (בטקסט שחולץ מ-PDF או מ-OCR סדר המילים בעברית לפעמים הפוך, ולכן נבדקים שני הסדרים)
PHRASE = "החברה מאשרת בזאת התקשרות בהיתר עיסקא באופן פרטי עם כל המעוניין בכך".split()
PHRASE_MIN = 6        # לפחות כמה מילות מפתח חייבות להופיע ברצף בחלון קצר
PHRASE_WIN = 14


def _norm_word(w):
    return re.sub(r"[^\u05d0-\u05ea]", "", w)


def has_key_phrase(text):
    ws = [x for x in (_norm_word(w) for w in text.split()) if x]
    for seq in (ws, ws[::-1]):
        i = 0
        while i < len(seq):
            if seq[i] in ("פרטי", "עיסקא", "התקשרות", "המעוניין"):
                win = seq[max(0, i - PHRASE_WIN): i + PHRASE_WIN]
                if sum(1 for k in set(PHRASE) if k in win) >= PHRASE_MIN and "פרטי" in win and ("עיסקא" in win or "התקשרות" in win):
                    return True
            i += 1
    return False


def phrase_snippet(text):
    """קטע טקסט סביב המילה 'פרטי' במקום שבו נמצא משפט המפתח (לבדיקה ידנית של התאמה); ריק אם לא נמצא."""
    if not has_key_phrase(text):
        return ""
    ws = [x for x in text.split() if x.strip()]
    for i, w in enumerate(ws):
        if _norm_word(w) == "פרטי" and any(_norm_word(x) in ("עיסקא", "התקשרות") for x in ws[max(0, i - 8): i + 9]):
            return " ".join(ws[max(0, i - 12): i + 13])
    return ""


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
    ap.add_argument("--sig-private-min", type=float, default=0.03, help="נוסח נחשב 'נוסח פרטי' אם הוא מופיע בלפחות שיעור זה מהמסמכים הפרטיים")
    ap.add_argument("--sig-general-max", type=float, default=0.01, help="...ובלא יותר משיעור זה מהכלליים")
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
        docs.append({"id": r["attachment_id"], "file": r["file"], "title": r["post_title"], "type": "P" if pt in P_TYPES else "G", "win": windows(text), "phrase": has_key_phrase(text), "snippet": phrase_snippet(text)})
    P = [d for d in docs if d["type"] == "P"]
    G = [d for d in docs if d["type"] == "G"]
    print(f"מסמכים עם טקסט: פרטי {len(P)}, כללי {len(G)}")
    print(f"משפט המפתח של היתר פרטי: בפרטיים {sum(1 for d in P if d['phrase'])}/{len(P)}, בכלליים {sum(1 for d in G if d['phrase'])}/{len(G)}")
    with open("phrase_samples.csv", "w", encoding="utf-8-sig", newline="") as f:      # דוגמאות: איפה נמצא משפט המפתח, לפי מיקום הקובץ
        w = csv.writer(f)
        w.writerow(["attachment_id", "file", "type_by_location", "snippet"])
        for typ, lst in (("כללי", G), ("פרטי", P)):
            for d in [x for x in lst if x["phrase"]][:40]:
                w.writerow([d["id"], d["file"], typ, d["snippet"]])
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

    # נוסח פרטי = נוסחים שנמצאים בשיעור מינימלי מהפרטיים ובשיעור קטן מאוד מהכלליים
    sig = [c["rep"] for c in clusters if len(c["P"]) / len(P) >= a.sig_private_min and len(c["G"]) / max(1, len(G)) <= a.sig_general_max]
    print(f"נוסחי היתר פרטי מבדילים: {len(sig)}")
    bad, ok = [], 0
    for d in docs:
        hit = d["phrase"] or any(ratio(wt, s) >= a.similar for wt in d["win"] for s in sig)
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
