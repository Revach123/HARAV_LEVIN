#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
scripts/heteriske_audit/scrape_heteriske.py

שלב 1: שליפת רשימת העסקים המלאה מ-heteriske.com (היתר עסקה עולמי)
ומיזוגה לקובץ JSON/CSV מסודר, לצורך השוואה מול הרשימה שלנו
(/api/lists?type=companies-all - ר' scripts/heteriske_audit/compare_registry.py).

הרצה:
    pip install requests beautifulsoup4
    python scripts/heteriske_audit/scrape_heteriske.py

פלט (בתיקיית out/ ליד הסקריפט):
    out/heteriske_businesses.json
    out/heteriske_businesses.csv

הערה: heteriske.com הוא אתר וורדפרס+Elementor רגיל, לא REST API - הרשימה
מוצגת בעימוד בפרמטר ?bd_paged=N. נצפתה חוסר-עקביות ב-web_fetch בין בקשות
עוקבות ל-bd_paged (כנראה cache בצד ה-fetcher/CDN ולא באתר עצמו); סקריפט זה
משתמש ב-requests ישירות (בלי שכבת cache נוספת), בדיוק כמו דפדפן רגיל.
אם בכל זאת מתקבל תוכן כפול בין עמודים - יש התראה בפלט (duplicate codes).
"""

import re
import json
import csv
import time
import sys
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://heteriske.com/%D7%97%D7%99%D7%A4%D7%95%D7%A9-%D7%A2%D7%A1%D7%A7%D7%99%D7%9D/"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9,he;q=0.8",
    "Cache-Control": "no-cache",
    "Pragma": "no-cache",
}

CODE_RE = re.compile(r"^קוד במערכת:\s*#?(\d+)$")

OUT_DIR = Path(__file__).resolve().parent / "out"


def fetch_page(session: requests.Session, page: int):
    url = BASE_URL if page == 1 else f"{BASE_URL}?bd_paged={page}"
    resp = session.get(url, headers=HEADERS, timeout=30)
    resp.raise_for_status()
    return resp.text


def detect_last_page(html: str) -> int:
    """מחפש את מספר העמוד האחרון מתוך קישורי ה-pagination בתחתית הרשימה."""
    nums = [int(n) for n in re.findall(r"bd_paged=(\d+)", html)]
    return max(nums) if nums else 1


def parse_page(html: str):
    """
    מפרק עמוד יחיד לרשימת עסקים.
    כל כרטיס עסק מזוהה לפי העוגן הקבוע "קוד במערכת: #NNN".
    """
    soup = BeautifulSoup(html, "html.parser")

    # כל קישורי "לצפיה בהיתר עסקה" בסדר הופעתם בדף - אלה קבצי ה-PDF/Drive
    permit_links = [
        a["href"] for a in soup.find_all("a", href=True)
        if "לצפיה בהיתר עסקה" in a.get_text()
    ]

    text = soup.get_text("\n")
    lines = [ln.strip() for ln in text.split("\n") if ln.strip()]

    businesses = []
    link_idx = 0
    for i, line in enumerate(lines):
        m = CODE_RE.match(line)
        if not m:
            continue
        code = m.group(1)
        category = lines[i - 1] if i - 1 >= 0 else ""
        name = lines[i + 1] if i + 1 < len(lines) else ""
        status = lines[i + 2] if i + 2 < len(lines) else ""
        location = ""
        # שורת מיקום אופציונלית - לא מתחילה ב"לצפיה"
        if i + 3 < len(lines) and "לצפיה" not in lines[i + 3]:
            location = lines[i + 3]

        link = permit_links[link_idx] if link_idx < len(permit_links) else ""
        link_idx += 1

        businesses.append({
            "code": code,
            "category": category,
            "name": name,
            "status": status,
            "location": location,
            "permit_link": link,
        })
    return businesses


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    session = requests.Session()
    print("שולף עמוד 1...")
    html1 = fetch_page(session, 1)
    last_page = detect_last_page(html1)
    print(f"זוהו {last_page} עמודים.")

    all_by_code = {}
    for b in parse_page(html1):
        all_by_code[b["code"]] = b

    for page in range(2, last_page + 1):
        print(f"שולף עמוד {page}/{last_page}...")
        html = fetch_page(session, page)
        page_businesses = parse_page(html)
        new_codes = 0
        for b in page_businesses:
            if b["code"] not in all_by_code:
                new_codes += 1
            all_by_code[b["code"]] = b
        if new_codes == 0:
            print(f"  אזהרה: עמוד {page} לא הוסיף קודים חדשים - "
                  f"ייתכן כפילות/בעיית cache. בדוק ידנית.", file=sys.stderr)
        time.sleep(0.5)  # נימוס כלפי השרת

    results = list(all_by_code.values())
    print(f"\nסה\"כ עסקים ייחודיים שנאספו: {len(results)}")

    out_json = OUT_DIR / "heteriske_businesses.json"
    out_csv = OUT_DIR / "heteriske_businesses.csv"

    with open(out_json, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)

    with open(out_csv, "w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=["code", "category", "name", "status", "location", "permit_link"])
        writer.writeheader()
        writer.writerows(results)

    print(f"נכתבו: {out_json}, {out_csv}")


if __name__ == "__main__":
    main()
