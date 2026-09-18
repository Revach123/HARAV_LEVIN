#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
scripts/registry_audit/check_name_accuracy.py

בדיקת איכות נתונים לרשימת companies-all של האתר הזה (business-registry) -
מיועד למנהל האתר, כדי להראות איפה משתמשים עלולים לטעות כשהם מחפשים לפי
שם בלבד (בלי ח.פ.):

  1) דיוק שם - לכל עסק ברשימה, נשלף השם *הרשמי העדכני* מהרשם (data.gov.il)
     דרך /api/lookup?number=<חפ> (אותו endpoint שהמנהל כבר משתמש בו כשהוא
     מוסיף עסק - ר' functions/api/lookup.js, ללא הגבלת קצב). מושווה מול:
       - registrar_name (השם שנשמר בזמן ההוספה)
       - permit_name (שם ההיתר המוצג לציבור - עשוי להיות שונה בכוונה)
     חוסר-התאמה יכול לנבוע מטעות הקלדה, או משינוי שם רשמי מאז ההוספה.

  2) שמות דומים - בתוך הרשימה עצמה, אילו זוגות עסקים (ח.פ. שונה!) יש להם
     שם דומה מספיק כדי לבלבל מישהו שמחפש לפי שם בלבד.

הרצה:
    pip install requests
    python scripts/registry_audit/check_name_accuracy.py

פלט (בתיקיית out/ ליד הסקריפט):
    out/name_accuracy_report.json/csv     <- לכל עסק: השם שמור מול הרשמי
    out/similar_names_report.json/csv     <- זוגות עסקים עם שם דומה
"""

import csv
import json
import re
import time
import difflib
from pathlib import Path

import requests

HARAV_LEVIN_API = "https://harav-levin.pages.dev/api/lists?type=companies-all"
LOOKUP_URL = "https://harav-levin.pages.dev/api/lookup"
LOOKUP_DELAY_SEC = 0.4   # נימוס כלפי data.gov.il (lookup.js הוא proxy אליו, בלי הגבלת קצב משלו)

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


def lookup_official(chp, session, retries=2):
    for attempt in range(retries + 1):
        try:
            resp = session.get(LOOKUP_URL, params={"number": chp}, timeout=20)
            resp.raise_for_status()
            return resp.json()
        except Exception as e:
            if attempt == retries:
                return {"error": f"{type(e).__name__}: {e}"}
            time.sleep(1.0)


def check_name_accuracy(rows):
    session = requests.Session()
    results = []
    total = sum(1 for r in rows if r.get("chp_number"))
    done = 0
    for row in rows:
        chp = row.get("chp_number")
        if not chp:
            continue
        registrar_name = row.get("registrar_name") or ""
        permit_name = row.get("permit_name") or ""
        official = lookup_official(chp, session)
        done += 1

        entry = {
            "chp_number": chp,
            "category": row.get("category"),
            "registrar_name": registrar_name,
            "permit_name": permit_name,
        }
        if official.get("error"):
            entry["status"] = "שגיאת שליפה"
            entry["error"] = official["error"]
        elif not official.get("found"):
            entry["status"] = "לא נמצא ברשם (ייתכן ח.פ. שגוי/ישן)"
        else:
            official_name = official.get("name", "")
            entry["official_name"] = official_name
            entry["official_status"] = official.get("status", "")
            entry["official_entity_type"] = official.get("entityType", "")
            reg_match = normalize_name(registrar_name) == normalize_name(official_name)
            permit_match = normalize_name(permit_name) == normalize_name(official_name)
            entry["registrar_matches_official"] = reg_match
            entry["permit_matches_official"] = permit_match
            entry["permit_vs_official_similarity"] = round(
                difflib.SequenceMatcher(
                    None, normalize_name(permit_name), normalize_name(official_name)
                ).ratio(), 3
            )
            if reg_match and permit_match:
                entry["status"] = "תקין - השם תואם לרשם"
            elif permit_match:
                entry["status"] = "תקין (permit_name תואם, registrar_name לא)"
            else:
                entry["status"] = "שם לא מדויק - לבדיקה"
        results.append(entry)

        if done % 100 == 0:
            print(f"  [{done}/{total}] נבדקו...")
        time.sleep(LOOKUP_DELAY_SEC)

    return results


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

    print("\n=== בדיקת דיוק שם מול הרשם (data.gov.il) ===")
    accuracy_results = check_name_accuracy(rows)
    n_ok = sum(1 for r in accuracy_results if r.get("status", "").startswith("תקין"))
    n_bad = sum(1 for r in accuracy_results if r.get("status") == "שם לא מדויק - לבדיקה")
    n_missing = sum(1 for r in accuracy_results if "לא נמצא" in r.get("status", ""))
    print(f"\nתקין: {n_ok} | שם לא מדויק: {n_bad} | לא נמצא ברשם: {n_missing}")

    out_acc_json = OUT_DIR / "name_accuracy_report.json"
    out_acc_csv = OUT_DIR / "name_accuracy_report.csv"
    with open(out_acc_json, "w", encoding="utf-8") as f:
        json.dump(accuracy_results, f, ensure_ascii=False, indent=2)
    acc_fields = ["chp_number", "category", "status", "registrar_name", "permit_name",
                  "official_name", "official_status", "official_entity_type",
                  "registrar_matches_official", "permit_matches_official",
                  "permit_vs_official_similarity", "error"]
    with open(out_acc_csv, "w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=acc_fields)
        writer.writeheader()
        for row in accuracy_results:
            writer.writerow({k: row.get(k, "") for k in acc_fields})
    print(f"נכתבו: {out_acc_json}, {out_acc_csv}")

    print("\n=== חיפוש שמות דומים בתוך הרשימה ===")
    similar_pairs = find_similar_pairs(rows)
    print(f"נמצאו {len(similar_pairs)} זוגות עם שם דומה (סף {SIMILAR_NAMES_CUTOFF})")

    out_sim_json = OUT_DIR / "similar_names_report.json"
    out_sim_csv = OUT_DIR / "similar_names_report.csv"
    with open(out_sim_json, "w", encoding="utf-8") as f:
        json.dump(similar_pairs, f, ensure_ascii=False, indent=2)
    sim_fields = ["chp_1", "name_1", "chp_2", "name_2", "similarity"]
    with open(out_sim_csv, "w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=sim_fields)
        writer.writeheader()
        for pair in similar_pairs:
            writer.writerow(pair)
    print(f"נכתבו: {out_sim_json}, {out_sim_csv}")


if __name__ == "__main__":
    main()
