#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
scripts/registry_audit/check_similar_names.py

בתוך רשימת companies-all של האתר הזה (המאגר שבנינו) - אילו זוגות עסקים
(ח.פ. שונה!) יש להם שם דומה מספיק כדי לבלבל מישהו שמחפש לפי שם בלבד,
בלי ח.פ. מיועד למנהל האתר, להראות איפה משתמשים עלולים לטעות.

עובד רק על הנתונים שכבר יש לנו (companies-all) - בלי קריאה חיצונית
נוספת, מהיר.

הרצה:
    pip install requests
    python scripts/registry_audit/check_similar_names.py

פלט (בתיקיית out/ ליד הסקריפט):
    out/similar_names_report.json/csv
"""

import csv
import json
import re
import difflib
from pathlib import Path

import requests

HARAV_LEVIN_API = "https://harav-levin.pages.dev/api/lists?type=companies-all"
OUT_DIR = Path(__file__).resolve().parent / "out"

SUFFIXES = [
    r'בע"מ', r"בעמ", r'ע"ר', r"עמותה רשומה", r"עמותה",
    r"שותפות מוגבלת", r"שותפות", r'\(ע"ר\)',
]

SIMILAR_NAMES_CUTOFF = 0.85


def normalize_name(name: str) -> str:
    n = name or ""
    n = n.strip()
    for suf in SUFFIXES:
        n = re.sub(suf, "", n)
    n = re.sub(r'["\'\.\(\)\-–,]', "", n)
    n = re.sub(r"\s+", " ", n).strip()
    return n.lower()


def load_harav_levin():
    resp = requests.get(HARAV_LEVIN_API, timeout=30)
    resp.raise_for_status()
    data = resp.json()
    if not data.get("ok"):
        raise RuntimeError(f"HARAV_LEVIN data error: {data}")
    return data["rows"]


def find_similar_pairs(rows, cutoff=SIMILAR_NAMES_CUTOFF):
    items = []
    for row in rows:
        chp = row.get("chp_number")
        name = row.get("permit_name") or row.get("registrar_name") or ""
        norm = normalize_name(name)
        if chp and norm:
            items.append((chp, name, norm))

    pairs = []
    n = len(items)
    for i in range(n):
        chp1, name1, norm1 = items[i]
        for j in range(i + 1, n):
            chp2, name2, norm2 = items[j]
            if chp1 == chp2:
                continue
            # פילטר מהיר לפני difflib - אורכים רחוקים מדי לא יכולים להגיע לציון גבוה
            if abs(len(norm1) - len(norm2)) > max(len(norm1), len(norm2)) * (1 - cutoff) + 2:
                continue
            score = difflib.SequenceMatcher(None, norm1, norm2).ratio()
            if score >= cutoff:
                pairs.append({
                    "chp_1": chp1, "name_1": name1,
                    "chp_2": chp2, "name_2": name2,
                    "similarity": round(score, 3),
                })
    pairs.sort(key=lambda p: -p["similarity"])
    return pairs


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    print("שולף רשימת companies-all...")
    rows = load_harav_levin()
    print(f"{len(rows)} עסקים ברשימה.")

    print("\n=== חיפוש שמות דומים בתוך הרשימה ===")
    similar_pairs = find_similar_pairs(rows)
    print(f"נמצאו {len(similar_pairs)} זוגות עם שם דומה (סף {SIMILAR_NAMES_CUTOFF})")

    out_json = OUT_DIR / "similar_names_report.json"
    out_csv = OUT_DIR / "similar_names_report.csv"
    with open(out_json, "w", encoding="utf-8") as f:
        json.dump(similar_pairs, f, ensure_ascii=False, indent=2)
    fields = ["chp_1", "name_1", "chp_2", "name_2", "similarity"]
    with open(out_csv, "w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        for pair in similar_pairs:
            writer.writerow(pair)
    print(f"נכתבו: {out_json}, {out_csv}")


if __name__ == "__main__":
    main()
