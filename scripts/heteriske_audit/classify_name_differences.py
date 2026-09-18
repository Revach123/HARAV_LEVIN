#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
scripts/heteriske_audit/classify_name_differences.py

לכל רשומה ב-heteriske_name_accuracy_report.json שסומנה "קירוב" (fuzzy) -
מסווג האם ההבדל בין השם ב-heteriske לשם במאגר שלנו הוא:

  - טכני/מנהלי בלבד (לא חשוב)  - למשל תוספת סיומת משפטית כמו "(חל\"צ)",
                                   "(ע\"ר)", "בע\"מ"/"בעמ" - אחרי הסרת
                                   הסיומות הליבה של השם זהה.
  - הבדל איות קל (כנראה לא משמעותי) - אחרי הסרת הסיומות, הליבה קרובה
                                   מאוד (>=0.93) אבל לא זהה - למשל אות
                                   בודדת שונה.
  - הבדל משמעותי (לבדיקה)      - נשאר הבדל אמיתי בליבה (מילה נוספת/חסרה,
                                   מספר שמבדיל בין ישויות, וכו') - בדיוק
                                   המקרים שמשתמש בלי ח.פ. עלול לטעות בהם.

מיועד למנהל האתר - חומר מסונן וברור, לא כל ה"קירובים" הגולמיים.

קלט:
    out/heteriske_name_accuracy_report.json   (פלט של build_name_accuracy_report.py)

הרצה:
    python scripts/heteriske_audit/classify_name_differences.py

פלט (בתיקיית out/ ליד הסקריפט):
    out/heteriske_name_differences_classified.json/csv
"""

import csv
import json
import re
import difflib
from pathlib import Path

OUT_DIR = Path(__file__).resolve().parent / "out"
IN_FILE = OUT_DIR / "heteriske_name_accuracy_report.json"

# סיומות משפטיות/מנהליות - לא תוכן מבדיל, רק צורת ההתאגדות
# חל"צ/חל"ץ - נמצא בנתונים גם עם צ רגילה וגם עם ץ סופית (לא עקבי במקור) - שתיהן.
ADMIN_PATTERNS = [
    r'\(חל"?[צץ]\)', r'חל"?[צץ]',
    r'\(ע"ר\)', r'ע"ר',
    r'עמותה רשומה', r'עמותה', r'עמותת',
    r'בע"מ', r'בעמ',
    r'שותפות מוגבלת', r'שותפות',
    r'חברת\s',  # קידומת גנרית ("חברת X בע"מ" == "X בע"מ") - לא חלק מהשם המבחין
]

SPELLING_SIMILARITY_THRESHOLD = 0.93


def strip_admin(name: str) -> str:
    n = name or ""
    for p in ADMIN_PATTERNS:
        n = re.sub(p, "", n)
    n = re.sub(r'["\'\(\)\-–,.]', "", n)
    n = re.sub(r"\s+", " ", n).strip().lower()
    return n


def extract_numbers(s: str) -> set:
    return set(re.findall(r"\d+", s))


def classify(heteriske_name, our_name):
    a = strip_admin(heteriske_name)
    b = strip_admin(our_name)
    if a == b:
        return "לא חשוב - הבדל מנהלי/טכני בלבד (למשל סיומת משפטית)", 1.0
    ratio = difflib.SequenceMatcher(None, a, b).ratio()
    # מספר שמופיע בצד אחד ולא בשני (או מספר שונה) - כמעט תמיד מבדיל בין
    # ישויות שונות (קרן 1 מול קרן 2, סניף/מבנה שונה וכו') - גם אם הציון
    # הכולל גבוה, כי ההבדל קצר יחסית לאורך השם. אף פעם לא "לא חשוב".
    if extract_numbers(a) != extract_numbers(b):
        return "לבדיקה - הבדל משמעותי (מספר מבדיל בין הישויות)", ratio
    if ratio >= SPELLING_SIMILARITY_THRESHOLD:
        return "כנראה לא משמעותי - הבדל איות קל", ratio
    return "לבדיקה - הבדל משמעותי בליבת השם", ratio


def main():
    with open(IN_FILE, encoding="utf-8") as f:
        rows = json.load(f)

    approx_rows = [r for r in rows if r.get("name_accurate") is False]
    print(f"{len(approx_rows)} רשומות 'קירוב' לסיווג...")

    classified = []
    for r in approx_rows:
        significance, core_ratio = classify(r["heteriske_name"], r["our_name"])
        classified.append({
            **r,
            "significance": significance,
            "core_similarity_after_admin_strip": round(core_ratio, 3),
        })

    classified.sort(key=lambda r: r["core_similarity_after_admin_strip"])

    n_trivial = sum(1 for r in classified if r["significance"].startswith("לא חשוב"))
    n_spelling = sum(1 for r in classified if r["significance"].startswith("כנראה"))
    n_significant = sum(1 for r in classified if r["significance"].startswith("לבדיקה"))
    print(f"\nלא חשוב (טכני/מנהלי): {n_trivial}")
    print(f"הבדל איות קל:          {n_spelling}")
    print(f"לבדיקה (משמעותי):      {n_significant}")

    out_json = OUT_DIR / "heteriske_name_differences_classified.json"
    out_csv = OUT_DIR / "heteriske_name_differences_classified.csv"

    with open(out_json, "w", encoding="utf-8") as f:
        json.dump(classified, f, ensure_ascii=False, indent=2)

    fields = ["heteriske_code", "heteriske_name", "chp_number", "our_name",
              "significance", "core_similarity_after_admin_strip", "chp_verified"]
    with open(out_csv, "w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        for row in classified:
            writer.writerow({k: row.get(k, "") for k in fields})

    print(f"\nנכתבו: {out_json}, {out_csv}")

    print("\n=== רשימת ה'לבדיקה' (הבדל משמעותי) ===")
    for r in classified:
        if r["significance"].startswith("לבדיקה"):
            print(f"  [{r['heteriske_code']}] '{r['heteriske_name']}'  מול  '{r['our_name']}'"
                  f"  (ח.פ. {r['chp_number']}, verified={r['chp_verified']})")


if __name__ == "__main__":
    main()
