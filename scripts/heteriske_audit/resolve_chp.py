#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
scripts/heteriske_audit/resolve_chp.py

heteriske.com לא חושף ח.פ. בשום מקום (data-attribute, JSON-LD, wp-json -
נבדק ונשלל). התוכנית ההפוכה:

  א) שליפת רשימה מלאה         - out/heteriske_businesses.json (scrape_heteriske.py)
  ב) סינון שמות + חיפוש ח.פ.   - מול המרשם המלא של revach.pages.dev
     (גם fuzzy)                  (חברות/שותפויות/עמותות - לא רק הרשימה
                                  המצומצמת של האתר הזה) דרך /api/match
                                  (exact) ו-/api/search (fuzzy).
  ג) שליחת הח.פ. לחיפוש         - כל ח.פ. שנפתר נבדק מול heteriske.com עצמו
     ב-heteriske                 (?company_id=<חפ>, ר' probe_company_id.py) -
                                  מוודא שהתוצאה מצביעה בחזרה על *אותה* רשומת
                                  heteriske שממנה יצאנו (לפי "קוד במערכת").
  ד) הוספת הח.פ. לרשימה         - out/heteriske_businesses_with_chp.json/csv

שלב ב עובד מול ה-API הציבורי של revach.pages.dev (אתר-אחות שלנו, לא
heteriske) - מכבד את ה-rate-limit שלו (guard.js: SOFT_LIMIT=8 בקשות/60ש'
לפני אתגר Turnstile): /api/match מקבל עד 100 שמות בבת אחת (seek זול על
name_norm, לא scan) - כמעט כל 1050 השמות נבדקים ב-~11 קריאות. /api/search
(fuzzy, למי שנשאר לא-פתור) הוא לפי-שם-בודד - מרווח בין קריאות כדי להישאר
מתחת לסף הרך.

הרצה:
    pip install requests
    python scripts/heteriske_audit/resolve_chp.py

פלט (בתיקיית out/ ליד הסקריפט):
    out/heteriske_businesses_with_chp.json
    out/heteriske_businesses_with_chp.csv
"""

import csv
import json
import time
import difflib
from pathlib import Path

import requests

SITE_BASE = "https://revach.pages.dev"
MATCH_URL = f"{SITE_BASE}/api/match"
SEARCH_URL = f"{SITE_BASE}/api/search"
# guard.js (functions/api/_shared/guard.js ב-revach) דורש Origin/Referer
# שכולל את ה-host כדי לא להיחסם ב-403 - זו לא "עקיפת אבטחה", זו קריאה
# תקנית ל-API הציבורי של revach.pages.dev, פשוט לא מהדפדפן.
SITE_HEADERS = {
    "Origin": SITE_BASE,
    "Referer": f"{SITE_BASE}/company-search.html",
    "User-Agent": "Mozilla/5.0 (heteriske-audit script; revach.pages.dev self-service)",
}

HETERISKE_BASE = "https://heteriske.com/%D7%97%D7%99%D7%A4%D7%95%D7%A9-%D7%A2%D7%A1%D7%A7%D7%99%D7%9D/"
HETERISKE_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9,he;q=0.8",
}

OUT_DIR = Path(__file__).resolve().parent / "out"
HETERISKE_FILE = OUT_DIR / "heteriske_businesses.json"

MATCH_BATCH = 100            # מקסימום ל-/api/match לפי BATCH_MAX ב-revach/functions/api/match.js
SEARCH_DELAY_SEC = 8.0       # מרווח בין קריאות /api/search - נשאר מתחת ל-SOFT_LIMIT (8/60s)
HETERISKE_DELAY_SEC = 0.4    # נימוס כלפי heteriske.com (כמו scrape_heteriske.py)
FUZZY_CUTOFF = 0.80

CODE_RE_LINE_START = "קוד במערכת"


def load_heteriske():
    with open(HETERISKE_FILE, encoding="utf-8") as f:
        return json.load(f)


class GuardBlocked(Exception):
    """guard.js (ב-revach.pages.dev) חסם (403 Origin, 428 Turnstile נדרש, או 429 rate-limit)."""


def _check_guard_response(resp):
    if resp.status_code in (403, 428, 429):
        try:
            body = resp.json()
        except Exception:
            body = resp.text[:200]
        raise GuardBlocked(f"HTTP {resp.status_code}: {body}")
    resp.raise_for_status()


# ── שלב ב, טייר 1: exact seek דרך /api/match (זול, batch עד 100) ──────────
def match_exact_batch(names, session):
    resp = session.post(MATCH_URL, json={"names": names}, headers=SITE_HEADERS, timeout=30)
    _check_guard_response(resp)
    return resp.json().get("matches", {})


def resolve_exact(names, session):
    """names -> {name: {kind,id,name,confidence,via} | None}"""
    out = {}
    for i in range(0, len(names), MATCH_BATCH):
        batch = names[i:i + MATCH_BATCH]
        print(f"  /api/match batch {i // MATCH_BATCH + 1} ({len(batch)} שמות)...")
        matches = match_exact_batch(batch, session)
        out.update(matches)
    return out


# ── שלב ב, טייר 2: fuzzy דרך /api/search (יקר יותר - מרווח בין קריאות) ────
def search_fuzzy(name, session):
    resp = session.get(SEARCH_URL, params={"q": name}, headers=SITE_HEADERS, timeout=30)
    _check_guard_response(resp)
    return resp.json().get("results", [])


def best_fuzzy_candidate(name, results):
    if not results:
        return None
    scored = [
        (difflib.SequenceMatcher(None, name, r.get("name", "")).ratio(), r)
        for r in results
    ]
    scored.sort(key=lambda t: -t[0])
    best_score, best = scored[0]
    if best_score >= FUZZY_CUTOFF:
        return best, best_score
    return None


# ── שלב ג: אימות מול heteriske.com לפי company_id ─────────────────────────
def verify_on_heteriske(chp, session):
    """
    שולח ?company_id=<chp> ל-heteriske ומחזיר את מספר 'קוד במערכת' של
    התוצאה היחידה שחוזרת (אם יש), אחרת None. ר' probe_company_id.py -
    כבר אומת ש-heteriske מסנן לפי company_id באופן מדויק (3 בדיקות חיוביות
    + 3 בבקרת שלילה החזירו 0 תוצאות).
    """
    url = f"{HETERISKE_BASE}?q=&company_id={chp}&country=&city=&field=&heter_iska_number="
    resp = session.get(url, headers=HETERISKE_HEADERS, timeout=30)
    resp.raise_for_status()
    html = resp.text
    idx = html.find(CODE_RE_LINE_START)
    if idx == -1:
        return None
    # השורה מוצגת כ-"קוד במערכת: #NNN" (או בלי #, תלוי רינדור) - שולפים ספרות
    tail = html[idx:idx + 60]
    digits = "".join(ch for ch in tail if ch.isdigit())
    return digits or None


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    businesses = load_heteriske()
    print(f"heteriske.com: {len(businesses)} עסקים לפתרון ח.פ.")

    site_session = requests.Session()
    heteriske_session = requests.Session()

    names = [b["name"] for b in businesses]

    # --- טייר 1: exact ---
    print("\n=== שלב ב, טייר 1: exact seek דרך /api/match ===")
    try:
        exact = resolve_exact(names, site_session)
    except GuardBlocked as e:
        print(f"\nנחסם ע\"י guard.js כבר ב-/api/match: {e}")
        print("ה-IP של ה-runner כנראה כבר מעל הסף (טראפיק אחר משותף) - "
              "אין טעם להמשיך. נסה שוב מאוחר יותר.")
        raise SystemExit(1)
    n_exact = sum(1 for v in exact.values() if v)
    print(f"נפתרו exact: {n_exact}/{len(names)}")

    # --- טייר 2: fuzzy (רק למי ש-exact לא מצא) ---
    unresolved_names = [n for n in names if not exact.get(n)]
    print(f"\n=== שלב ב, טייר 2: fuzzy דרך /api/search ({len(unresolved_names)} שמות, "
          f"~{len(unresolved_names) * SEARCH_DELAY_SEC / 60:.1f} דקות) ===")
    fuzzy = {}
    blocked_mid_run = False
    for i, name in enumerate(unresolved_names, 1):
        if blocked_mid_run:
            fuzzy[name] = None
            continue
        try:
            results = search_fuzzy(name, site_session)
            cand = best_fuzzy_candidate(name, results)
            if cand:
                candidate, score = cand
                fuzzy[name] = {**candidate, "confidence": "fuzzy", "score": round(score, 3)}
                print(f"  [{i}/{len(unresolved_names)}] '{name}' -> '{candidate.get('name')}' "
                      f"(score={score:.2f})")
            else:
                fuzzy[name] = None
        except GuardBlocked as e:
            print(f"  [{i}/{len(unresolved_names)}] נחסם ע\"י guard.js: {e} - "
                  f"מפסיק את טייר ה-fuzzy, ממשיך עם מה שכבר נפתר.")
            blocked_mid_run = True
            fuzzy[name] = None
            continue
        except Exception as e:
            print(f"  [{i}/{len(unresolved_names)}] שגיאה על '{name}': {type(e).__name__}: {e}")
            fuzzy[name] = None
        time.sleep(SEARCH_DELAY_SEC)

    n_fuzzy = sum(1 for v in fuzzy.values() if v)
    print(f"נפתרו fuzzy: {n_fuzzy}/{len(unresolved_names)}")

    # --- מיזוג טייר 1+2 ---
    resolved_by_name = {}
    for n, m in exact.items():
        if m:
            resolved_by_name[n] = m
    for n, m in fuzzy.items():
        if m:
            resolved_by_name[n] = m

    # --- שלב ג: אימות מול heteriske.com ---
    to_verify = [b for b in businesses if resolved_by_name.get(b["name"])]
    print(f"\n=== שלב ג: אימות {len(to_verify)} ח.פ. מול heteriske.com "
          f"(~{len(to_verify) * HETERISKE_DELAY_SEC / 60:.1f} דקות) ===")
    verified_count = 0
    mismatch_count = 0
    for i, biz in enumerate(to_verify, 1):
        chp = str(resolved_by_name[biz["name"]]["id"])
        try:
            returned_code = verify_on_heteriske(chp, heteriske_session)
            biz["chp_verify_returned_code"] = returned_code
            if returned_code and returned_code == biz["code"]:
                biz["chp_verified"] = True
                verified_count += 1
            else:
                biz["chp_verified"] = False
                mismatch_count += 1
        except Exception as e:
            biz["chp_verified"] = False
            biz["chp_verify_error"] = f"{type(e).__name__}: {e}"
        if i % 50 == 0:
            print(f"  [{i}/{len(to_verify)}] אומתו כה: {verified_count}, אי-התאמה: {mismatch_count}")
        time.sleep(HETERISKE_DELAY_SEC)

    print(f"\nאימות הושלם: {verified_count} תואמים, {mismatch_count} לא תואמים/לא נמצאו")

    # --- שלב ד: הוספת הח.פ. לרשימה ---
    for biz in businesses:
        m = resolved_by_name.get(biz["name"])
        if m:
            biz["chp_number"] = m.get("id")
            biz["chp_match_name"] = m.get("name")
            biz["chp_match_kind"] = m.get("kind")
            biz["chp_confidence"] = m.get("confidence")
        else:
            biz["chp_number"] = None
            biz["chp_match_name"] = None
            biz["chp_match_kind"] = None
            biz["chp_confidence"] = None
        biz.setdefault("chp_verified", None)

    out_json = OUT_DIR / "heteriske_businesses_with_chp.json"
    out_csv = OUT_DIR / "heteriske_businesses_with_chp.csv"

    with open(out_json, "w", encoding="utf-8") as f:
        json.dump(businesses, f, ensure_ascii=False, indent=2)

    fieldnames = ["code", "category", "name", "status", "location", "permit_link",
                  "chp_number", "chp_match_name", "chp_match_kind", "chp_confidence",
                  "chp_verified", "chp_verify_returned_code"]
    with open(out_csv, "w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for b in businesses:
            writer.writerow({k: b.get(k, "") for k in fieldnames})

    n_with_chp = sum(1 for b in businesses if b.get("chp_number"))
    print(f"\nסיכום: {n_with_chp}/{len(businesses)} עסקים קיבלו ח.פ. "
          f"({verified_count} מאומתים מול heteriske.com)")
    print(f"נכתבו: {out_json}, {out_csv}")


if __name__ == "__main__":
    main()
