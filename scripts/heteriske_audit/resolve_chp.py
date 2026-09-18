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
  ד) הוספת הח.פ. לרשימה         - out/heteriske_businesses_with_chp.json/csv,
                                  + out/heteriske_similar_candidates.json/csv:
                                  רשומות fuzzy עם חלופות-שם קרובות בציון
                                  ו/או שנכשלו באימות מול heteriske - חשד
                                  ל"שם דומה אבל חברה אחרת", לבדיקה ידנית

שלב ב עובד מול ה-API הציבורי של revach.pages.dev (אתר-אחות שלנו, לא
heteriske) - מכבד את ה-rate-limit שלו (guard.js: SOFT_LIMIT=8 בקשות/60ש'
לפני אתגר Turnstile): /api/match מקבל עד 100 שמות בבת אחת (seek זול על
name_norm, לא scan) - כמעט כל 1050 השמות נבדקים ב-~11 קריאות. /api/search
(fuzzy, למי שנשאר לא-פתור) הוא לפי-שם-בודד - מרווח בין קריאות כדי להישאר
מתחת לסף הרך.

הגנה מפני עצירה באמצע: הריצה כולה (טייר fuzzy + אימות) יכולה לקחת שעה-
שעתיים (paced, בקשה-בקשה). כדי שעצירה/timeout/כישלון runner לא יאבד את כל
ההתקדמות, כל טייר שומר checkpoint (reports/heteriske_audit/
resolve_chp_checkpoint.json) - נכתב ל-git תוך כדי הריצה (לא רק בסוף), כך
שריצה חדשה שמתחילה עם אותו checkout ממשיכה בדיוק מאיפה שהקודמת עצרה, בלי
לשלוח שוב בקשות ל-revach.pages.dev/heteriske.com על מה שכבר נפתר/אומת.

הרצה:
    pip install requests
    python scripts/heteriske_audit/resolve_chp.py

פלט (בתיקיית out/ ליד הסקריפט):
    out/heteriske_businesses_with_chp.json
    out/heteriske_businesses_with_chp.csv
    out/heteriske_similar_candidates.json    <- "דומים" - לבדיקה ידנית
    out/heteriske_similar_candidates.csv
"""

import csv
import json
import subprocess
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

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parents[1]
OUT_DIR = SCRIPT_DIR / "out"
HETERISKE_FILE = OUT_DIR / "heteriske_businesses.json"

REPORTS_DIR = REPO_ROOT / "reports" / "heteriske_audit"
CHECKPOINT_FILE = REPORTS_DIR / "resolve_chp_checkpoint.json"

MATCH_BATCH = 100            # מקסימום ל-/api/match לפי BATCH_MAX ב-revach/functions/api/match.js
SEARCH_DELAY_SEC = 8.0       # מרווח בין קריאות /api/search - נשאר מתחת ל-SOFT_LIMIT (8/60s)
HETERISKE_DELAY_SEC = 0.4    # נימוס כלפי heteriske.com (כמו scrape_heteriske.py)
FUZZY_CUTOFF = 0.80

FUZZY_CHECKPOINT_EVERY = 10     # פריטים בין checkpoint בטייר ה-fuzzy
VERIFY_CHECKPOINT_EVERY = 150   # פריטים בין checkpoint בטייר האימות

CODE_RE_LINE_START = "קוד במערכת"


def load_heteriske():
    with open(HETERISKE_FILE, encoding="utf-8") as f:
        return json.load(f)


# ── checkpoint: נשמר ל-git תוך כדי הריצה, כדי לשרוד עצירה/timeout/כישלון ──
def load_checkpoint():
    if CHECKPOINT_FILE.exists():
        try:
            with open(CHECKPOINT_FILE, encoding="utf-8") as f:
                state = json.load(f)
            print(f"נמצא checkpoint קודם ({CHECKPOINT_FILE}) - ממשיכים ממנו: "
                  f"exact={len(state.get('exact', {}))}, fuzzy={len(state.get('fuzzy', {}))}, "
                  f"verified={len(state.get('verified', {}))}")
            return state
        except Exception as e:
            print(f"אזהרה: לא הצלחתי לקרוא checkpoint קיים ({e}) - מתחילים מאפס.")
    return {"exact": {}, "fuzzy": {}, "verified": {}}


def _run_git(args, check=True):
    return subprocess.run(
        ["git", "-C", str(REPO_ROOT)] + args,
        check=check, capture_output=True, text=True,
    )


def save_checkpoint(state, note=""):
    """כותב את ה-checkpoint לדיסק ומנסה לדחוף ל-git. כישלון push לא מפיל
    את הריצה - ההתקדמות עדיין בזיכרון וב-checkpoint שנכתב לפני-כן ב-git,
    והכתיבה הבאה תנסה שוב."""
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    with open(CHECKPOINT_FILE, "w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False, indent=2)
    try:
        _run_git(["add", str(CHECKPOINT_FILE)])
        diff = _run_git(["diff", "--staged", "--quiet"], check=False)
        if diff.returncode == 0:
            return  # אין שינוי אמיתי (נדיר, אבל אפשרי)
        _run_git(["commit", "-m", f"resolve_chp checkpoint: {note}" if note else "resolve_chp checkpoint"])
        _run_git(["pull", "--rebase", "--autostash"])
        _run_git(["push"])
        print(f"  [checkpoint נשמר: {note}]")
    except subprocess.CalledProcessError as e:
        print(f"  אזהרה: checkpoint commit/push נכשל (ממשיכים, ננסה שוב בפעם הבאה): "
              f"{e.stderr.strip()[:200] if e.stderr else e}")


def clear_checkpoint():
    if not CHECKPOINT_FILE.exists():
        return
    try:
        CHECKPOINT_FILE.unlink()
        _run_git(["add", str(CHECKPOINT_FILE)])
        diff = _run_git(["diff", "--staged", "--quiet"], check=False)
        if diff.returncode != 0:
            _run_git(["commit", "-m", "resolve_chp: pipeline completed - clearing checkpoint"])
            _run_git(["pull", "--rebase", "--autostash"])
            _run_git(["push"])
    except subprocess.CalledProcessError as e:
        print(f"אזהרה: לא הצלחתי למחוק את ה-checkpoint מה-git ({e}) - לא קריטי.")


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


def resolve_exact(names, session, exact, state):
    """מעדכן את exact (dict) במקום - מדלג על שמות שכבר יש להם מפתח ב-exact."""
    todo = [n for n in names if n not in exact]
    if not todo:
        print("  טייר 1 כבר הושלם (מ-checkpoint קודם) - מדלג.")
        return
    for i in range(0, len(todo), MATCH_BATCH):
        batch = todo[i:i + MATCH_BATCH]
        print(f"  /api/match batch {i // MATCH_BATCH + 1}/{-(-len(todo)//MATCH_BATCH)} "
              f"({len(batch)} שמות)...")
        matches = match_exact_batch(batch, session)
        exact.update(matches)
    save_checkpoint(state, f"tier1 exact done ({len(exact)} names)")


# ── שלב ב, טייר 2: fuzzy דרך /api/search (יקר יותר - מרווח בין קריאות) ────
def search_fuzzy(name, session):
    resp = session.get(SEARCH_URL, params={"q": name}, headers=SITE_HEADERS, timeout=30)
    _check_guard_response(resp)
    return resp.json().get("results", [])


ALT_MARGIN = 0.15       # חלופה נחשבת "דומה מספיק כדי לבלבל" אם הציון שלה בטווח הזה מתחת לנבחרת
MAX_ALTERNATIVES = 3    # כמה חלופות שומרים לכל היותר


def best_fuzzy_candidate(name, results):
    """
    בוחר את המועמד הכי טוב לפי difflib, אבל שומר גם מועמדים "דומים" אחרים
    (חלופות) שקרובים בציון למועמד הנבחר - אלה בדיוק המקרים שבהם השם דומה
    לרשומה ברשימה, אבל בפועל הכוונה לחברה אחרת (למשל שתי חברות עם שם כמעט
    זהה, או אם/בת). מוחזר: (chosen_dict_with_score, [alternative_dicts]).
    """
    if not results:
        return None, []
    scored = [
        (difflib.SequenceMatcher(None, name, r.get("name", "")).ratio(), r)
        for r in results
    ]
    scored.sort(key=lambda t: -t[0])
    best_score, best = scored[0]
    if best_score < FUZZY_CUTOFF:
        return None, []
    chosen = {**best, "score": round(best_score, 3)}
    alternatives = [
        {**r, "score": round(s, 3)}
        for s, r in scored[1:1 + MAX_ALTERNATIVES]
        if s >= best_score - ALT_MARGIN and (r.get("id") != best.get("id"))
    ]
    return chosen, alternatives


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

    state = load_checkpoint()
    exact = state["exact"]
    fuzzy = state["fuzzy"]
    verified = state["verified"]   # code -> {chp_verified, chp_verify_returned_code, chp_verify_error?}

    site_session = requests.Session()
    heteriske_session = requests.Session()

    names = [b["name"] for b in businesses]

    # --- טייר 1: exact ---
    print("\n=== שלב ב, טייר 1: exact seek דרך /api/match ===")
    try:
        resolve_exact(names, site_session, exact, state)
    except GuardBlocked as e:
        print(f"\nנחסם ע\"י guard.js כבר ב-/api/match: {e}")
        print("ה-IP של ה-runner כנראה כבר מעל הסף (טראפיק אחר משותף) - "
              "אין טעם להמשיך. ה-checkpoint (אם היה) נשמר; נסה שוב מאוחר יותר.")
        raise SystemExit(1)
    n_exact = sum(1 for v in exact.values() if v)
    print(f"נפתרו exact: {n_exact}/{len(names)}")

    # --- טייר 2: fuzzy (רק למי ש-exact לא מצא, ושעדיין לא ב-checkpoint) ---
    unresolved_names = [n for n in names if not exact.get(n) and n not in fuzzy]
    already_fuzzy = sum(1 for n in names if not exact.get(n) and n in fuzzy)
    if already_fuzzy:
        print(f"\n{already_fuzzy} שמות כבר נפתרו בטייר ה-fuzzy מ-checkpoint קודם - מדלגים עליהם.")
    print(f"=== שלב ב, טייר 2: fuzzy דרך /api/search ({len(unresolved_names)} שמות נותרו, "
          f"~{len(unresolved_names) * SEARCH_DELAY_SEC / 60:.1f} דקות) ===")
    blocked_mid_run = False
    for i, name in enumerate(unresolved_names, 1):
        if blocked_mid_run:
            fuzzy[name] = None
            continue
        try:
            results = search_fuzzy(name, site_session)
            chosen, alternatives = best_fuzzy_candidate(name, results)
            if chosen:
                fuzzy[name] = {**chosen, "confidence": "fuzzy", "alternatives": alternatives}
                alt_note = f", {len(alternatives)} חלופות דומות" if alternatives else ""
                print(f"  [{i}/{len(unresolved_names)}] '{name}' -> '{chosen.get('name')}' "
                      f"(score={chosen['score']:.2f}{alt_note})")
            else:
                fuzzy[name] = None
        except GuardBlocked as e:
            print(f"  [{i}/{len(unresolved_names)}] נחסם ע\"י guard.js: {e} - "
                  f"מפסיק את טייר ה-fuzzy, ממשיך עם מה שכבר נפתר.")
            blocked_mid_run = True
            fuzzy[name] = None
            save_checkpoint(state, f"tier2 fuzzy stopped by guard at {i}/{len(unresolved_names)}")
            continue
        except Exception as e:
            print(f"  [{i}/{len(unresolved_names)}] שגיאה על '{name}': {type(e).__name__}: {e}")
            fuzzy[name] = None
        if i % FUZZY_CHECKPOINT_EVERY == 0:
            save_checkpoint(state, f"tier2 fuzzy {i}/{len(unresolved_names)}")
        time.sleep(SEARCH_DELAY_SEC)
    save_checkpoint(state, "tier2 fuzzy done")

    n_fuzzy = sum(1 for v in fuzzy.values() if v)
    print(f"נפתרו fuzzy: {n_fuzzy}/{len(names) - n_exact}")

    # --- מיזוג טייר 1+2 ---
    resolved_by_name = {}
    for n, m in exact.items():
        if m:
            resolved_by_name[n] = m
    for n, m in fuzzy.items():
        if m:
            resolved_by_name[n] = m

    # --- שלב ג: אימות מול heteriske.com (מדלג על קודים שכבר ב-checkpoint) ---
    to_verify = [b for b in businesses if resolved_by_name.get(b["name"]) and b["code"] not in verified]
    already_verified = sum(1 for b in businesses if resolved_by_name.get(b["name"]) and b["code"] in verified)
    if already_verified:
        print(f"\n{already_verified} עסקים כבר אומתו מ-checkpoint קודם - מדלגים עליהם.")
    print(f"=== שלב ג: אימות {len(to_verify)} ח.פ. נותרים מול heteriske.com "
          f"(~{len(to_verify) * HETERISKE_DELAY_SEC / 60:.1f} דקות) ===")
    verified_count = sum(1 for v in verified.values() if v.get("chp_verified"))
    mismatch_count = sum(1 for v in verified.values() if not v.get("chp_verified"))
    for i, biz in enumerate(to_verify, 1):
        chp = str(resolved_by_name[biz["name"]]["id"])
        result = {}
        try:
            returned_code = verify_on_heteriske(chp, heteriske_session)
            result["chp_verify_returned_code"] = returned_code
            if returned_code and returned_code == biz["code"]:
                result["chp_verified"] = True
                verified_count += 1
            else:
                result["chp_verified"] = False
                mismatch_count += 1
        except Exception as e:
            result["chp_verified"] = False
            result["chp_verify_error"] = f"{type(e).__name__}: {e}"
            mismatch_count += 1
        verified[biz["code"]] = result
        if i % 50 == 0:
            print(f"  [{i}/{len(to_verify)}] אומתו כה: {verified_count}, אי-התאמה: {mismatch_count}")
        if i % VERIFY_CHECKPOINT_EVERY == 0:
            save_checkpoint(state, f"tier3 verify {i}/{len(to_verify)}")
        time.sleep(HETERISKE_DELAY_SEC)
    save_checkpoint(state, "tier3 verify done")

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
        v = verified.get(biz["code"], {})
        biz["chp_verified"] = v.get("chp_verified")
        biz["chp_verify_returned_code"] = v.get("chp_verify_returned_code")
        if v.get("chp_verify_error"):
            biz["chp_verify_error"] = v["chp_verify_error"]

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

    # --- "דומים": רשומות שנפתרו ב-fuzzy עם חלופות קרובות בציון, ו/או
    #     שהאימות מול heteriske.com לא תואם - כלומר יש סיכוי ממשי שהשם
    #     דומה לרשומה ברשימה אבל בפועל מדובר בחברה אחרת. ---
    similar_rows = []
    for biz in businesses:
        m = resolved_by_name.get(biz["name"])
        if not m or m.get("confidence") != "fuzzy":
            continue
        alternatives = m.get("alternatives") or []
        verify_failed = biz.get("chp_verified") is False
        if not alternatives and not verify_failed:
            continue
        similar_rows.append({
            "heteriske_code": biz["code"],
            "heteriske_name": biz["name"],
            "chosen_name": m.get("name"),
            "chosen_chp": m.get("id"),
            "chosen_kind": m.get("kind"),
            "chosen_score": m.get("score"),
            "chp_verified": biz.get("chp_verified"),
            "chp_verify_returned_code": biz.get("chp_verify_returned_code"),
            "alternatives": alternatives,
        })

    out_similar_json = OUT_DIR / "heteriske_similar_candidates.json"
    out_similar_csv = OUT_DIR / "heteriske_similar_candidates.csv"

    with open(out_similar_json, "w", encoding="utf-8") as f:
        json.dump(similar_rows, f, ensure_ascii=False, indent=2)

    similar_fieldnames = [
        "heteriske_code", "heteriske_name", "chosen_name", "chosen_chp", "chosen_kind",
        "chosen_score", "chp_verified", "chp_verify_returned_code",
        "alt1_name", "alt1_chp", "alt1_score",
        "alt2_name", "alt2_chp", "alt2_score",
        "alt3_name", "alt3_chp", "alt3_score",
    ]
    with open(out_similar_csv, "w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=similar_fieldnames)
        writer.writeheader()
        for row in similar_rows:
            flat = {k: row.get(k, "") for k in similar_fieldnames}
            for idx, alt in enumerate(row["alternatives"][:3], 1):
                flat[f"alt{idx}_name"] = alt.get("name", "")
                flat[f"alt{idx}_chp"] = alt.get("id", "")
                flat[f"alt{idx}_score"] = alt.get("score", "")
            writer.writerow(flat)

    n_verify_failed_fuzzy = sum(1 for r in similar_rows if r["chp_verified"] is False)
    print(f"\n'דומים' לבדיקה ידנית: {len(similar_rows)} רשומות "
          f"({n_verify_failed_fuzzy} מהן גם נכשלו באימות מול heteriske.com - "
          f"סימן חזק שמדובר בחברה אחרת)")
    print(f"נכתבו: {out_similar_json}, {out_similar_csv}")

    clear_checkpoint()


if __name__ == "__main__":
    main()
