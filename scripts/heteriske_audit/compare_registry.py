#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
scripts/heteriske_audit/compare_registry.py

שלב 2: השוואה דו-כיוונית בין heteriske.com לרשימה שלנו (companies-all של
האתר הזה עצמו) - מה יש ב-heteriske ולא אצלנו, ומה יש אצלנו ולא ב-heteriske.
התאמה לפי שם מנורמל בלבד (ל-heteriske אין ח.פ. חשוף בכרטיסי הרשימה - ר'
inspect_raw_html.py/probe_company_id.py; resolve_chp.py פותר ח.פ. בכיוון ההפוך).

קלט:
    out/heteriske_businesses.json   (פלט של scrape_heteriske.py)

מקור הרשימה שלנו - /api/lists?type=companies-all (functions/api/lists.js
בריפו הזה עצמו) - האתר הזה *הוא* המקור, אז תמיד שולפים חי.

הרצה:
    pip install requests
    python scripts/heteriske_audit/compare_registry.py

פלט (בתיקיית out/ ליד הסקריפט):
    out/comparison_report.json
    out/comparison_missing_in_harav_levin.csv   <- עסקים ב-heteriske שלא נמצאו אצלנו
    out/comparison_missing_in_heteriske.csv     <- עסקים אצלנו שלא נמצאו ב-heteriske
"""

import json
import csv
import re
import difflib
from pathlib import Path

import requests

HARAV_LEVIN_API = "https://harav-levin.pages.dev/api/lists?type=companies-all"

OUT_DIR = Path(__file__).resolve().parent / "out"
HETERISKE_FILE = OUT_DIR / "heteriske_businesses.json"

# סיומות/מילות חברה נפוצות שמסירים לצורך השוואה (לא ממצה - אפשר להרחיב)
SUFFIXES = [
    r'בע"מ', r"בעמ", r'ע"ר', r"עמותה רשומה", r"עמותה",
    r"שותפות מוגבלת", r"שותפות", r'\(ע"ר\)',
]

FUZZY_CUTOFF = 0.82


def normalize_name(name: str) -> str:
    n = name or ""
    n = n.strip()
    for suf in SUFFIXES:
        n = re.sub(suf, "", n)
    n = re.sub(r'["\'\.\(\)\-–,]', "", n)
    n = re.sub(r"\s+", " ", n).strip()
    return n.lower()


def load_heteriske(path=HETERISKE_FILE):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def load_harav_levin():
    print(f"HARAV_LEVIN: שולף חי מ-{HARAV_LEVIN_API}")
    resp = requests.get(HARAV_LEVIN_API, timeout=30)
    resp.raise_for_status()
    data = resp.json()
    if not data.get("ok"):
        raise RuntimeError(f"HARAV_LEVIN data error: {data}")
    return data["rows"]


def build_index(rows, name_key):
    idx = {}
    for row in rows:
        key = normalize_name(row.get(name_key, ""))
        if key:
            idx.setdefault(key, []).append(row)
    return idx


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    heteriske = load_heteriske()
    harav = load_harav_levin()

    print(f"heteriske.com: {len(heteriske)} עסקים")
    print(f"HARAV_LEVIN:   {len(harav)} עסקים")

    harav_by_norm = build_index(harav, "permit_name")
    heteriske_by_norm = build_index(heteriske, "name")

    all_harav_names_norm = list(harav_by_norm.keys())
    all_heteriske_names_norm = list(heteriske_by_norm.keys())

    # כיוון 1: heteriske -> HARAV_LEVIN
    matched = []
    missing_in_harav_levin = []
    fuzzy_heteriske_to_harav = []

    for biz in heteriske:
        key = normalize_name(biz["name"])
        if key in harav_by_norm:
            matched.append({
                "heteriske_name": biz["name"],
                "heteriske_code": biz["code"],
                "harav_levin_match": harav_by_norm[key][0].get("permit_name"),
                "chp_number": harav_by_norm[key][0].get("chp_number"),
            })
        else:
            close = difflib.get_close_matches(key, all_harav_names_norm, n=1, cutoff=FUZZY_CUTOFF)
            entry = {
                "heteriske_name": biz["name"],
                "heteriske_code": biz["code"],
                "category": biz["category"],
                "permit_link": biz["permit_link"],
            }
            if close:
                candidate = harav_by_norm[close[0]][0]
                entry["possible_match"] = candidate.get("permit_name")
                entry["possible_chp_number"] = candidate.get("chp_number")
                fuzzy_heteriske_to_harav.append(entry)
            else:
                missing_in_harav_levin.append(entry)

    # כיוון 2: HARAV_LEVIN -> heteriske (עסקים אצלנו שלא נמצאו ב-heteriske)
    missing_in_heteriske = []
    fuzzy_harav_to_heteriske = []

    for row in harav:
        key = normalize_name(row.get("permit_name", ""))
        if not key or key in heteriske_by_norm:
            continue  # ריק, או כבר נספר כהתאמה ודאית בכיוון 1
        close = difflib.get_close_matches(key, all_heteriske_names_norm, n=1, cutoff=FUZZY_CUTOFF)
        entry = {
            "harav_levin_name": row.get("permit_name"),
            "chp_number": row.get("chp_number"),
            "category": row.get("category"),
            "biz_type": row.get("biz_type"),
        }
        if close:
            candidate = heteriske_by_norm[close[0]][0]
            entry["possible_match"] = candidate.get("name")
            entry["possible_heteriske_code"] = candidate.get("code")
            fuzzy_harav_to_heteriske.append(entry)
        else:
            missing_in_heteriske.append(entry)

    print(f"\n--- heteriske.com -> HARAV_LEVIN ---")
    print(f"התאמות ודאיות:                {len(matched)}")
    print(f"התאמות מקורבות (בדוק ידנית):   {len(fuzzy_heteriske_to_harav)}")
    print(f"ב-heteriske ולא אצלנו:         {len(missing_in_harav_levin)}")

    print(f"\n--- HARAV_LEVIN -> heteriske.com ---")
    print(f"התאמות מקורבות (בדוק ידנית):   {len(fuzzy_harav_to_heteriske)}")
    print(f"אצלנו ולא ב-heteriske:         {len(missing_in_heteriske)}")

    report = {
        "summary": {
            "heteriske_total": len(heteriske),
            "harav_levin_total": len(harav),
            "matched": len(matched),
            "fuzzy_heteriske_to_harav": len(fuzzy_heteriske_to_harav),
            "missing_in_harav_levin": len(missing_in_harav_levin),
            "fuzzy_harav_to_heteriske": len(fuzzy_harav_to_heteriske),
            "missing_in_heteriske": len(missing_in_heteriske),
        },
        "matched": matched,
        "fuzzy_heteriske_to_harav": fuzzy_heteriske_to_harav,
        "missing_in_harav_levin": missing_in_harav_levin,
        "fuzzy_harav_to_heteriske": fuzzy_harav_to_heteriske,
        "missing_in_heteriske": missing_in_heteriske,
    }

    out_report = OUT_DIR / "comparison_report.json"
    out_missing_harav_csv = OUT_DIR / "comparison_missing_in_harav_levin.csv"
    out_missing_heteriske_csv = OUT_DIR / "comparison_missing_in_heteriske.csv"

    with open(out_report, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)

    with open(out_missing_harav_csv, "w", encoding="utf-8-sig", newline="") as f:
        fieldnames = ["heteriske_code", "heteriske_name", "category", "permit_link"]
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for row in missing_in_harav_levin:
            writer.writerow({k: row.get(k, "") for k in fieldnames})

    with open(out_missing_heteriske_csv, "w", encoding="utf-8-sig", newline="") as f:
        fieldnames = ["chp_number", "harav_levin_name", "category", "biz_type"]
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for row in missing_in_heteriske:
            writer.writerow({k: row.get(k, "") for k in fieldnames})

    print(f"\nנכתבו: {out_report}, {out_missing_harav_csv}, {out_missing_heteriske_csv}")


if __name__ == "__main__":
    main()
