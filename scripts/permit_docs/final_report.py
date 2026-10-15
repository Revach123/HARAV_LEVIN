# -*- coding: utf-8 -*-
"""
דוח סופי מאוחד: מחבר את כל המקורות לכל קובץ ולכל עסק.
  קלט: סופי_מלא.csv (reconcile) + type_check.csv (private_wording) + מיקום_לא_משויכים.csv (locate_unattached) + businesses.json
  פלט:
    סופי_מאוחד.csv     - שורה לכל קובץ: עסק, סוג לפי מיקום, בדיקת נוסח, שיוך לפי קישורים, וסימון "לבדיקה ידנית" עם סיבה
    סיכום_עסקים.csv   - שורה לכל עסק: מה רשום במאגר (כללי / יש גם פרטי / רק פרטי) מול המסמכים שנמצאו (כללי / פרטי), וסתירות
"""
import argparse
import csv
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import match_pdfs as m  # noqa: E402

VIS = {"": "רק כללי", "פרטי": "יש גם פרטי", "רק פרטי": "רק פרטי"}


def read(path):
    return m.read_csv(path) if path and os.path.exists(path) else []


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--final", default="סופי_מלא.csv")
    ap.add_argument("--type-check", default="type_check.csv")
    ap.add_argument("--unattached", default="מיקום_לא_משויכים.csv")
    ap.add_argument("--businesses", default="businesses.json")
    ap.add_argument("--hp-layout", default="hp_layout.csv")
    ap.add_argument("--out", default="סופי_מאוחד.csv")
    ap.add_argument("--out-biz", default="סיכום_עסקים.csv")
    a = ap.parse_args()

    biz = {b["id"]: b for b in json.load(open(a.businesses, encoding="utf-8"))}
    tcheck = {r["attachment_id"]: r for r in read(a.type_check)}
    unatt = {r["attachment_id"]: r for r in read(a.unattached)}
    layout = {r["attachment_id"]: r for r in read(a.hp_layout)}      # hp_layout.py: מסמך משותף / כמה מסמכים בקובץ
    rows = read(a.final)
    if not rows:
        print("אין קובץ סופי - הרץ קודם reconcile.py")
        return

    out, per_biz = [], {}
    for r in rows:
        flags = []
        aid = r["attachment_id"]
        dtype = r["doc_type"].rstrip("?")                  # כללי / פרטי / (ריק)
        tc = tcheck.get(aid)
        text_flag = ""
        if tc:       # הסיווג נקבע לפי המיקום באתר; הנוסח נשמר רק כמידע ואינו מייצר שאלה
            text_flag = f"נוסח הקובץ: {tc['text_check']} (מיקום: {tc['type_by_location']})"
        loc = unatt.get(aid)
        linked = loc["linked_in (type: title)"] if loc else ""
        if r["status"] in ("סתירה", "לא זוהה"):
            flags.append("שיוך לחברה: " + r["status"])
        # "שם הפוסט שונה" (עם ח.פ. מאומת) ו"מקור יחיד": נחשבים מאומתים ואינם מסומנים לבדיקה (26 מתוך 26 בבדיקה ידנית היו נכונים)
        if not r["post_type"] and not linked:
            flags.append("אין מיקום באתר (קובץ לא משויך)")
        out.append({**r, "doc_type_clean": dtype or "לא ידוע", "text_check": text_flag, "linked_in": linked, "needs_review": "כן" if flags else "", "review_reasons": " | ".join(flags),
                    "multi_kind": (layout.get(aid) or {}).get("kind", ""), "hp_pages": (layout.get(aid) or {}).get("hps_by_page", "")})
        bid = r["business_id"]
        if bid:
            d = per_biz.setdefault(bid, {"G": 0, "P": 0, "U": 0, "files": []})
            d[{"כללי": "G", "פרטי": "P"}.get(dtype, "U")] += 1
            d["files"].append(r["file"])

    cols = list(rows[0].keys()) + ["doc_type_clean", "text_check", "linked_in", "needs_review", "review_reasons", "multi_kind", "hp_pages"]
    with open(a.out, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=cols, extrasaction="ignore")
        w.writeheader()
        w.writerows(out)

    brows = []
    for bid, d in per_biz.items():
        b = biz.get(bid)
        if not b:
            continue
        vis = VIS.get(b.get("visibility") or "", b.get("visibility") or "")
        notes = []
        if vis == "יש גם פרטי" and d["P"] == 0:
            notes.append("במאגר: יש גם פרטי, אבל לא נמצא מסמך פרטי")
        if vis == "רק כללי" and d["P"] > 0:
            notes.append("במאגר: רק כללי, אבל נמצא מסמך פרטי")
        if vis == "רק פרטי" and d["G"] > 0 and d["P"] == 0:
            notes.append("במאגר: רק פרטי, אבל נמצא רק מסמך כללי")
        if d["G"] == 0 and vis in ("רק כללי", "יש גם פרטי"):
            notes.append("לא נמצא מסמך כללי")
        brows.append([b.get("registrar_name") or b.get("permit_name"), b.get("chp_number", ""), vis, d["G"], d["P"], d["U"], " | ".join(notes)])
    brows.sort(key=lambda x: (x[6] == "", x[0] or ""))
    with open(a.out_biz, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(["business", "chp", "registered_in_db", "general_docs", "private_docs", "unknown_type_docs", "notes"])
        w.writerows(brows)

    need = sum(1 for o in out if o["needs_review"])
    flagged = sum(1 for b in brows if b[6])
    print(f"{len(out)} קבצים, מהם {need} לבדיקה ידנית -> {a.out}")
    print(f"{len(brows)} עסקים עם מסמכים, מהם {flagged} עם הערה (סתירה מול המאגר) -> {a.out_biz}")


if __name__ == "__main__":
    sys.exit(main())
