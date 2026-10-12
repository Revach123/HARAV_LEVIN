# -*- coding: utf-8 -*-
"""
scripts/bonds_list/build_approved_bonds.py

בונה מחדש בכל הרצה רשימת אג"ח ממאיה (TASE), רק של חברות שבמאגר החברות של
HARAV_LEVIN מסומנות "מאושר לאג"ח" (agch_approved), ומפצל לשתי רשימות:
  data/bonds_list/bonds_private.{json,csv}  — חברות מסומנות visibility = "פרטי" ומאושרות (כן / רק פרטי)
  data/bonds_list/bonds_general.{json,csv}  — כל המאושרות (כן / רק כללי), כולל חברות מסומנות "פרטי";
                                              רק "רק פרטי" לא נכנס. (כמו functions/api/lists.js)

שלבים:
  1. מאגר החברות:  GET {HARAV_API}/api/lists?type=companies-all
     (או קובץ JSON מקומי עם אותו מבנה, ארגומנט ראשון / COMPANIES_FILE).
  2. סריקת מאיה:   GET maya.tase.co.il/api/v1/companies/{id}/details לכל id
     בטווח; מתוך התגובה נלקחים corporateNo ורשימת "secrities". נשמרות רק
     חברות שהח"פ שלהן מאושר, ורק ניירות סחירים (isTradable) מסוג אג"ח לפי סיווג Revach (classify.coarse_type, ר' classify.py), בלי ני"ע מסחריים.
  3. תנאי הנייר:   GET api.tase.co.il/api/company/securitydata לכל אג"ח שנשמר
     (פדיון, ריבית, הצמדה, שער, תשואה...).
  4. היסטוריה:     first_seen לכל נייר (state.json) — מתי הופיע לראשונה בסריקה.

אם הסריקה נראית חלקית/חסומה (מעט מדי חברות או אפס אג"ח) הסקריפט נכשל בלי
לדרוס את הפלט הקיים.

משתני סביבה: HARAV_API, MAYA_MAX_ID (ברירת מחדל 3000), WORKERS (6).
"""
import concurrent.futures
import csv
import datetime
import json
import os
import re
import sys
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from classify import coarse_type  # noqa: E402  (עותק של Revach)

HARAV_API = os.environ.get("HARAV_API", "https://harav-levin.pages.dev")
MAYA_URL = "https://maya.tase.co.il/api/v1/companies/{id}/details"
TERMS_URL = "https://api.tase.co.il/api/company/securitydata?securityId={id}&lang=0"

MAX_ID = int(os.environ.get("MAYA_MAX_ID", "3000"))
WORKERS = int(os.environ.get("WORKERS", "6"))
TIMEOUT, RETRIES = 20, 3
MIN_COMPANIES_FOUND = 1000   # מתחת לזה הסריקה נחשבת חסומה/חלקית

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
OUT = os.path.join(ROOT, "data", "bonds_list")
STATE_PATH = os.path.join(OUT, "state.json")

APPROVED = {"כן", "רק פרטי", "רק כללי"}
def is_commercial_paper(type_str):
    """ני"ע מסחריים — לא אג"ח לצורך הרשימה הזאת (החרגה שלנו; coarse_type של Revach כן סופר אותם)."""
    return "מסחרי" in (type_str or "")


# סוגי נכס שנחשבים "אג"ח" — כמו BOND_COARSE ב-Revach (build_bonds_heter_report.py)
BOND_COARSE = {"אג\"ח קונצרני", "אג\"ח ממשלתי", "אג\"ח להמרה", "מק\"מ"}

# הערות חברה שמסמנות בעלות גוי (כמו ב-Revach: heter_iska_lookup)
NOTES_GOYIM = {'בעלות גוי', 'מאושר מצד בעלות גוי', 'על סמך בנקים בחו"ל רוב גוים'}
GOYIM_NOTE = "בבעלות גוי"
TODAY = datetime.date.today().isoformat()

COLUMNS = [
    "security_id", "security_name", "symbol", "isin", "security_type",
    "asset_class", "issuer_name", "company", "chp_number", "agch_approved",
    "is_private", "notes",
    "redemption_date", "annual_interest", "linkage", "linkage_type",
    "last_price", "annual_yield", "base_indices", "is_tradable",
    "first_seen",
]


# ── עזרים ────────────────────────────────────────────────────────────────────
def chp_norm(v):
    s = str(v if v is not None else "").strip()
    if not s:
        return ""
    try:
        return str(int(float(s)))
    except ValueError:
        return s


def is_goyim(notes_raw):
    return (notes_raw or "").strip().replace("\xa0", " ") in NOTES_GOYIM


def http_get(url, accept="application/json", referer="https://market.tase.co.il/"):
    req = urllib.request.Request(url, headers={
        "User-Agent": "Mozilla/5.0", "Accept": accept, "Referer": referer})
    last = None
    for _ in range(RETRIES):
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
                return r.status, r.read()
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return 404, b""
            last = e
        except Exception as e:  # noqa: BLE001
            last = e
    raise RuntimeError(f"GET failed: {url}: {last}")


def get_json(url, referer="https://market.tase.co.il/"):
    status, body = http_get(url, referer=referer)
    return None if status == 404 else json.loads(body)


# ── 1. מאגר החברות ──────────────────────────────────────────────────────────
def load_companies(path=None):
    path = path or os.environ.get("COMPANIES_FILE")
    if path:
        with open(path, encoding="utf-8") as f:
            raw = json.load(f)
    else:
        raw = get_json(f"{HARAV_API}/api/lists?type=companies-all", referer=HARAV_API)
    if isinstance(raw, dict):
        if raw.get("ok") is False:
            raise RuntimeError(f"companies API error: {raw.get('error')}")
        raw = raw.get("rows", [])
    return raw


def approved_map(companies):
    """chp -> {company, agch_approved, is_private}. ח"פ כפול: מועדפת השורה המאושרת."""
    out = {}
    for c in companies:
        k = chp_norm(c.get("chp_number"))
        status = (c.get("agch_approved") or "").strip()
        if not k or status not in APPROVED:
            continue
        if k in out:
            continue
        out[k] = {
            "company": c.get("permit_name") or c.get("registrar_name") or "",
            "agch_approved": status,
            "goyim": is_goyim(c.get("notes")),
            "is_private": (c.get("visibility") or "").strip() == "פרטי",
        }
    return out


# ── 2. סריקת מאיה ───────────────────────────────────────────────────────────
def fetch_company(cid):
    try:
        return cid, get_json(MAYA_URL.format(id=cid), referer="https://maya.tase.co.il/")
    except RuntimeError:
        return cid, "error"


def sweep_maya(approved, fetch=fetch_company, max_id=MAX_ID):
    """מחזיר (bonds, companies_found, errors). bonds: רשימת dict בסיסיים לכל אג"ח."""
    bonds, found, errors = [], 0, 0
    with concurrent.futures.ThreadPoolExecutor(WORKERS) as ex:
        for cid, body in ex.map(fetch, range(1, max_id + 1)):
            if body == "error":
                errors += 1
                continue
            if not body:
                continue
            found += 1
            k = chp_norm(body.get("corporateNo"))
            info = approved.get(k)
            if not info:
                continue
            for sec in body.get("secrities") or []:
                if sec.get("securityId") is None or sec.get("isDeleted") or not sec.get("isTradable"):
                    continue
                ac = coarse_type(sec.get("securityType"))
                if ac not in BOND_COARSE or is_commercial_paper(sec.get("securityType")):
                    continue
                bonds.append({
                    "security_id": int(sec["securityId"]),
                    "security_name": (sec.get("securityName") or "").strip(),
                    "symbol": sec.get("symbol") or "",
                    "isin": sec.get("isin") or "",
                    "security_type": sec.get("securityType") or "",
                    "asset_class": ac,
                    "issuer_name": info["company"],
                    "company": info["company"],
                    "chp_number": k,
                    "notes": GOYIM_NOTE if info["goyim"] else "",
                    "goyim": info["goyim"],
                    "agch_approved": info["agch_approved"],
                    "is_private": info["is_private"],
                    "is_tradable": sec.get("isTradable"),
                })
    return bonds, found, errors


# ── 3. תנאי הנייר ───────────────────────────────────────────────────────────
def fetch_terms(sid):
    try:
        return sid, get_json(TERMS_URL.format(id=sid))
    except RuntimeError:
        return sid, None


def add_terms(bonds, fetch=fetch_terms):
    with concurrent.futures.ThreadPoolExecutor(WORKERS) as ex:
        terms = dict(ex.map(fetch, [b["security_id"] for b in bonds]))
    for b in bonds:
        d = terms.get(b["security_id"]) or {}
        last = d.get("LastRate")
        b.update({
            "redemption_date": d.get("RedemptionDate") or "",
            "annual_interest": "" if d.get("AnnualInterest") in (None, "") else d.get("AnnualInterest"),
            "linkage": d.get("Linkage") or "",
            "linkage_type": d.get("LinkageType") or "",
            "last_price": last if last not in (None, "") else (d.get("BaseRate") or ""),
            "annual_yield": "" if d.get("AnnualYield") is None else d.get("AnnualYield"),
            "base_indices": "" if d.get("BaseIndices") is None else d.get("BaseIndices"),
        })


# ── 3ב. אימות מול datawise הרשמי (Securities Basic, חינמי) ──────────────────
DATAWISE = "https://datawise.tase.co.il"
def _datawise_key():
    key = os.environ.get("TASE_DATAWISE_KEY")
    if key:
        return key
    try:   # ברירת מחדל: המפתח שכבר קיים ב-functions/api/sync-tase.js (בלי עותק נוסף בקוד)
        with open(os.path.join(ROOT, "functions", "api", "sync-tase.js"), encoding="utf-8") as f:
            m = re.search(r'TASE_KEY\s*=\s*"([^"]+)"', f.read())
        return m.group(1) if m else ""
    except OSError:
        return ""


DW_KEY = _datawise_key()
DW_HEADERS = {"accept": "application/json", "accept-language": "he-IL", "apikey": DW_KEY,
              "User-Agent": "Mozilla/5.0"}
BOND_CODE_PREFIXES = ("03", "05", "11", "36")   # אג"ח לפי קוד סוג (כמו sync-tase.js); לא כולל קרנות סל (43)
MAX_MISSING_ABS, MAX_MISSING_PCT = 5, 0.03   # מעל זה — הריצה נכשלת ולא דורסת פלט


def dw_get(path):
    req = urllib.request.Request(DATAWISE + path, headers=DW_HEADERS)
    last = None
    for _ in range(RETRIES):
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
                return json.loads(r.read())
        except Exception as e:  # noqa: BLE001
            last = e
    raise RuntimeError(f"datawise {path}: {last}")


def fetch_datawise_securities():
    """רשימת ניירות של יום המסחר האחרון + מילון סוגים. -> (rows, date, types) או None."""
    try:
        types = {str(r["securityFullTypeCode"]): r.get("securityTypeDesc") or ""
                 for r in dw_get("/v1/basic-securities/securities-types")["securitiesTypes"]["result"]}
        for d in range(8):
            dt = datetime.date.today() - datetime.timedelta(days=d)
            res = dw_get(f"/v1/basic-securities/trade-securities-list/{dt:%Y/%m/%d}")
            rows = (res.get("tradeSecuritiesList") or {}).get("result") or []
            if rows:
                return rows, str(dt), types
    except RuntimeError as e:
        print(f"WARNING: datawise unavailable: {e}", file=sys.stderr)
    return None


def cross_check(bonds, approved, dw):
    """משווה את מה שנמצא במאיה למה ש-datawise מדווח לחברות המאושרות."""
    if dw is None:
        return {"status": "datawise_unavailable"}
    rows, dw_date, types = dw
    expected = {int(r["securityId"]) for r in rows
                if chp_norm(r.get("corporateId")) in approved
                and str(r.get("securityFullTypeCode") or "").startswith(BOND_CODE_PREFIXES)
                and coarse_type(types.get(str(r.get("securityFullTypeCode")), "")) in BOND_COARSE
                and not is_commercial_paper(types.get(str(r.get("securityFullTypeCode")), ""))}
    mine = {b["security_id"] for b in bonds}
    missing, extra = sorted(expected - mine), sorted(mine - expected)
    by_id = {int(r["securityId"]): r for r in rows}
    detail = [{"id": i, "name": (by_id[i].get("securityName") or "").strip(),
               "type": types.get(str(by_id[i].get("securityFullTypeCode")), ""),
               "code": by_id[i].get("securityFullTypeCode"), "chp": chp_norm(by_id[i].get("corporateId"))}
              for i in missing[:300]]
    limit = max(MAX_MISSING_ABS, int(MAX_MISSING_PCT * len(expected)))
    return {"status": "ok" if len(missing) <= limit else "too_many_missing",
            "datawise_date": dw_date, "expected": len(expected), "maya": len(mine),
            "missing_in_maya": missing, "missing_detail": detail, "extra_in_maya": extra, "limit": limit}


# ── 4. היסטוריית ניירות (first_seen) ────────────────────────────────────────
def load_state():
    if os.path.exists(STATE_PATH):
        with open(STATE_PATH, encoding="utf-8") as f:
            return json.load(f)
    return {"securities_first_seen": {}}


def apply_first_seen(bonds, state):
    first = state.setdefault("securities_first_seen", {})
    for b in bonds:
        first.setdefault(str(b["security_id"]), TODAY)
        b["first_seen"] = first[str(b["security_id"])]


# ── פלט ─────────────────────────────────────────────────────────────────────
def write_lists(bonds):
    def view(b, lst=""):
        r = dict(b)
        r["is_private"] = "כן" if b["is_private"] else "לא"
        r["list"] = lst
        return r

    def allowed(b, private):
        if b["goyim"]:                      # בבעלות גוי — נכנס לשתי הרשימות
            return True
        if private:   # סימון "פרטי" + מאושר (כן / רק פרטי)
            return b["is_private"] and b["agch_approved"] in ("כן", "רק פרטי")
        # כללי = כל המאושרות (כן / רק כללי), *גם* חברות מסומנות "פרטי"; רק "רק פרטי" לא נכנס
        return b["agch_approved"] in ("כן", "רק כללי")

    def dump(name, rows, cols):
        rows = [{c: r.get(c, "") for c in cols} for r in rows]
        with open(os.path.join(OUT, f"{name}.json"), "w", encoding="utf-8") as f:
            json.dump({"updated": TODAY, "count": len(rows), "columns": cols, "rows": rows},
                      f, ensure_ascii=False, indent=1)
        with open(os.path.join(OUT, f"{name}.csv"), "w", encoding="utf-8-sig", newline="") as f:
            w = csv.DictWriter(f, fieldnames=cols)
            w.writeheader()
            w.writerows(rows)

    key = lambda r: (r["company"], r["security_name"], str(r["security_id"]))  # noqa: E731
    os.makedirs(OUT, exist_ok=True)
    counts, merged = {}, {}
    for name, private in (("private", True), ("general", False)):
        rows = sorted((view(b) for b in bonds if allowed(b, private)), key=key)
        counts[name] = len(rows)
        dump(f"bonds_{name}", rows, COLUMNS)
        for r in rows:
            merged.setdefault(r["security_id"], []).append("פרטי" if private else "כללי")
    # רשימה ממוזגת: נייר אחד בשורה אחת, עמודת list = פרטי / כללי / פרטי+כללי
    by_id = {b["security_id"]: b for b in bonds}
    all_rows = sorted((view(by_id[i], "+".join(sorted(l))) for i, l in merged.items()), key=key)
    counts["all"] = len(all_rows)
    dump("bonds_all", all_rows, COLUMNS + ["list"])
    return counts


def main(companies_path=None):
    companies = load_companies(companies_path)
    approved = approved_map(companies)
    print(f"companies: {len(companies)}, approved with ח\"פ: {len(approved)}")
    if not approved:
        raise SystemExit("no approved companies - refusing to overwrite output")

    bonds, found, errors = sweep_maya(approved)
    print(f"maya: {found} companies found, {errors} request errors, {len(bonds)} approved bonds")
    if found < MIN_COMPANIES_FOUND or not bonds:
        raise SystemExit("maya sweep looks partial/blocked - output left untouched")

    check = cross_check(bonds, approved, fetch_datawise_securities())
    print("datawise check:", {k: (v if not isinstance(v, list) else len(v)) for k, v in check.items()})
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, "verification.json"), "w", encoding="utf-8") as f:
        json.dump({"updated": TODAY, **check}, f, ensure_ascii=False, indent=1)
    if check["status"] == "too_many_missing":
        raise SystemExit("datawise cross-check failed - bond lists left untouched")

    add_terms(bonds)
    state = load_state()
    apply_first_seen(bonds, state)
    counts = write_lists(bonds)
    os.makedirs(OUT, exist_ok=True)
    with open(STATE_PATH, "w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False, indent=1, sort_keys=True)
    print(f"written: private={counts['private']}, general={counts['general']}, all(merged)={counts['all']}")


if __name__ == "__main__":
    main(*sys.argv[1:2])
