#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
scripts/heteriske_audit/probe_company_id.py

בדיקה חד-פעמית: heteriske.com חושף פרמטרי חיפוש בעמוד הרשימה עצמו
(q, company_id, country, city, field, heter_iska_number) - נצפה ב-referrer
של בקשת cdn-cgi/rum כש-URL היה ?...&company_id=515279396&...

מטרה: לבדוק אם חיפוש לפי company_id (ח.פ.) מחזיר תוצאה מדויקת ומציג
ח.פ./heter_iska_number גלוי בכרטיס - מה שהיה מאפשר התאמה לפי ID במקום
נרמול שם (הרבה יותר אמין, ר' compare_registry.py).

מדפיס תוצאות ל-stdout בלבד (דיאגנוסטיקה, לא כותב קבצים).
"""

import re
import sys

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://heteriske.com/%D7%97%D7%99%D7%A4%D7%95%D7%A9-%D7%A2%D7%A1%D7%A7%D7%99%D7%9D/"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9,he;q=0.8",
}

# company_id שנצפה בפועל ב-referrer שהמשתמש שלח, + ח.פ. אמיתיים של עסקים
# שכבר נמצאו בהתאמת-שם ודאית (matched), כדי לבדוק אם חיפוש לפי ID מוצא
# אותם ומציג ח.פ. גלוי בתוצאה.
SAMPLE_IDS = [
    "515279396",  # מהמשתמש - company_id שנצפה ב-referrer בפועל
    "515293223",  # אגוז הנפקות ופיננסים בע"מ (matched) - צפוי קוד #653
    "520018078",  # בנק לאומי לישראל בע"מ (matched) - צפוי קוד #468
    "514817154",  # מיטב הלוואות בע"מ (matched) - צפוי קוד #529
    # בקרת שלילה - ח.פ. מומצא/לא קיים, כדי לוודא שהחיפוש באמת מסנן
    # ולא סתם מחזיר תוצאת ברירת מחדל בכל מקרה. אם גם אלה מחזירים כרטיס -
    # החיפוש לא באמת מסנן לפי ID והמסקנה מהבדיקות הקודמות בטלה.
    "000000000",
    "999999999",
    "111111111",
]


def fetch(url):
    resp = requests.get(url, headers=HEADERS, timeout=30)
    resp.raise_for_status()
    return resp.text


def dump_probe(company_id):
    url = f"{BASE_URL}?q=&company_id={company_id}&country=&city=&field=&heter_iska_number="
    print(f"\n=== company_id={company_id} ===\nURL: {url}")
    html = fetch(url)
    print(f"תשובה: {len(html)} bytes")

    soup = BeautifulSoup(html, "html.parser")
    text = soup.get_text("\n")
    lines = [ln.strip() for ln in text.split("\n") if ln.strip()]

    # חפש את מספר ה-ID עצמו בטקסט הגלוי (אם מופיע - יש שדה ח.פ. גלוי)
    hits = [i for i, ln in enumerate(lines) if company_id in ln]
    print(f"מופעים של '{company_id}' בטקסט הגלוי: {len(hits)}")
    for i in hits[:5]:
        ctx = lines[max(0, i - 3):i + 4]
        print("  הקשר:", " | ".join(ctx))

    # חפש עוגן "קוד במערכת" כדי לראות אם יש בכלל כרטיס תוצאה
    code_hits = [ln for ln in lines if ln.startswith("קוד במערכת")]
    print(f"כרטיסי תוצאה (לפי 'קוד במערכת'): {len(code_hits)}")
    for ln in code_hits[:5]:
        print("  ", ln)

    # הדפס גם 40 השורות הראשונות לבדיקה חזותית של מבנה התוצאה
    print("--- 40 השורות הראשונות של הטקסט הגלוי ---")
    for ln in lines[:40]:
        print("  ", ln)


def main():
    ids = SAMPLE_IDS + sys.argv[1:]
    for cid in ids:
        try:
            dump_probe(cid)
        except Exception as e:
            print(f"שגיאה עבור {cid}: {type(e).__name__}: {e}")


if __name__ == "__main__":
    main()
