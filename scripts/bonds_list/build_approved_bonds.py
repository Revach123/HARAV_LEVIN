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
     חברות שהח"פ שלהן מאושר, ורק ניירות סחירים (isTradable) מסוג אג"ח לפי סיווג Revach (classify.coarse_type, ר' classify.py), כולל ני"ע מסחריים.
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
import decimal
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from classify import coarse_type  # noqa: E402  (עותק של Revach)
import offerings  # noqa: E402
import market_data  # noqa: E402

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
INTERNAL_PATH = os.path.join(OUT, "bonds_internal.json")
NAMES_PATH = os.path.join(OUT, "names_seen.json")   # שם וסימול ראשונים של כל נייר: שמות ב-datawise מקוצרים לפעמים (ני"ע "-רמ"), אז שם שכבר נראה נשמר

APPROVED = {"כן", "רק פרטי", "רק כללי"}
SELECTIVE = 'בחירת אג"ח מסוימים'   # אישור לאג"ח מסוימות בלבד: נבחרות בדף הניהול ונשמרות בטבלה approved_bonds
MANUAL_SCOPES = {"private", "general", "both"}
# ני"ע מסחריים נכללים ברשימה (כמו ב-Revach ובקובץ ה-Excel הישן): coarse_type מסווג אותם כאג"ח קונצרני.


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
    "midroog_rating", "maalot_rating", "ytm_gross",   # enrich.py: דירוגים + תשואה ברוטו לפדיון (לא צמוד בלבד)
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


def _clean(text):
    """רווחים רגילים בלבד (כולל NBSP), בלי כפילויות."""
    return " ".join(str(text or "").split())


def bond_scope(agch, notes_raw):
    """לאילו רשימות מאושרות אג"ח החברה: both | private_only | general_only.
    מהשדה "אישור אג"ח" ('רק פרטי' / 'רק כללי'), או מהערה מפורשת כמו "מאושר רק לאג"ח פרטי בלבד".
    זה נוגע לאישור האג"ח בלבד, לא להיתר העסקה של החברה."""
    n = _clean(notes_raw)
    if agch == "רק פרטי" or 'לאג"ח פרטי בלבד' in n or 'רק לאג"ח פרטי' in n:
        return "private_only"
    if agch == "רק כללי" or 'לאג"ח כללי בלבד' in n or 'רק לאג"ח כללי' in n:
        return "general_only"
    return "both"


def bond_note(notes_raw, scope=""):
    """הערת החברה לתצוגה ברשימת האג"ח. ברירת המחדל: ההערות מוצגות רק ברשימת החברות (חוץ מ"בעלות גוי" ו"בפירוק", שנשארות תמיד).
    בדף הניהול אפשר לבחור לכל חברה היכן ההערה מוצגת (notes_scope): 'bonds' / 'both' = גם ברשימת האג"ח; ריק / 'companies' = רק בחברות."""
    n = _clean(notes_raw)
    return n if (n and (scope or "").strip() in ("bonds", "both") and not is_goyim(n)) else ""


def fmt_interest(v):
    """ריבית לתצוגה: עד 2 ספרות אחרי הנקודה, בלי אפסים מיותרים (8.13420 -> 8.13, 9.49000 -> 9.49, 3.50000 -> 3.5)."""
    if v in ("", None):
        return ""
    try:
        q = decimal.Decimal(str(v)).quantize(decimal.Decimal("0.01"), rounding=decimal.ROUND_HALF_UP)
    except decimal.InvalidOperation:
        return v
    t = f"{q:f}"
    if "." in t:
        t = t.rstrip("0").rstrip(".")
    return "0" if t in ("-0", "") else t


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


def load_manual_bonds(path=None):
    """אג"ח שנבחרו ידנית בדף הניהול (טבלת approved_bonds): {ח"פ: {security_id: scope}}.
    404 / טבלה שעוד לא קיימת = אין אג"ח ידניות. כל שגיאה אחרת עוצרת את הריצה (לא להפיל בשקט אג"ח שנבחרו)."""
    path = path or os.environ.get("MANUAL_BONDS_FILE")
    if path:
        with open(path, encoding="utf-8") as f:
            raw = json.load(f)
    else:
        try:
            raw = get_json(f"{HARAV_API}/api/approved-bonds", referer=HARAV_API)
        except RuntimeError as e:
            if "404" in str(e):
                print("manual bonds: endpoint not deployed yet - none")
                return {}
            raise SystemExit(f"cannot load manual bonds list ({e}) - bond lists left untouched")
    if isinstance(raw, dict):
        if raw.get("ok") is False:
            raise SystemExit(f"manual bonds API error: {raw.get('error')} - bond lists left untouched")
        raw = raw.get("rows", [])
    out = {}
    for r in raw:
        k, scope = chp_norm(r.get("chp_number")), (r.get("scope") or "").strip()
        try:
            sid = int(r.get("security_id"))
        except (TypeError, ValueError):
            continue
        if k and scope in MANUAL_SCOPES:
            out.setdefault(k, {})[sid] = scope
    return out


def company_names(companies):
    """ח"פ -> שם להצגה, רק לחברות שאינן מחוסלות/מחוקות (לא מציגים אג"ח ידניות של חברה כזו)."""
    out = {}
    for c in companies:
        k = chp_norm(c.get("chp_number"))
        reg = (c.get("registry_status") or "").strip()
        if k and k not in out and not reg.startswith(("מחוסל", "חיסול", "מחוק", "נגרע", "בפרוק")):
            out[k] = c.get("permit_name") or c.get("registrar_name") or ""
    return out


def approved_map(companies):
    """chp -> {company, agch_approved, is_private}. ח"פ כפול: מועדפת השורה המאושרת."""
    out = {}
    for c in companies:
        k = chp_norm(c.get("chp_number"))
        status = (c.get("agch_approved") or "").strip()
        if not k or status not in APPROVED:
            continue
        reg = (c.get("registry_status") or "").strip()      # נקבע ע"י registry-refresh
        if reg.startswith(("מחוסל", "חיסול", "מחוק", "נגרע", "בפרוק")):               # חברה מחוסלת - לא ברשימת האג"ח
            continue
        if k in out:
            continue
        out[k] = {
            "company": c.get("permit_name") or c.get("registrar_name") or "",
            "agch_approved": status,
            "goyim": is_goyim(c.get("notes")),
            "is_private": (c.get("visibility") or "").strip() == "פרטי",
            "bond_scope": bond_scope(status, c.get("notes")),
            "bond_note": "; ".join(x for x in (bond_note(c.get("notes"), c.get("notes_scope"))) if x),
        }
    return out


# ── 2. סריקת מאיה ───────────────────────────────────────────────────────────
def fetch_company(cid):
    try:
        return cid, get_json(MAYA_URL.format(id=cid), referer="https://maya.tase.co.il/")
    except RuntimeError:
        return cid, "error"


def sweep_maya(approved, fetch=fetch_company, max_id=MAX_ID, manual=None, names=None, snapshot=None):
    """מחזיר (bonds, companies_found, errors). bonds: רשימת dict בסיסיים לכל אג"ח.
    manual = {ח"פ: {security_id: scope}} - אג"ח שנבחרו ידנית; נכללות רק אם עדיין קיימות במאיה (סחירות, לא נמחקו).
    snapshot (dict, ממולא במקום) = {ח"פ: [אג"ח במאיה]} לכל החברות - מקור הרשימה בחלון "בחירת אג"ח מסוימים"."""
    manual, names = manual or {}, names or {}
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
            picks = manual.get(k) or {}
            if not info and not picks and snapshot is None:
                continue
            listed = []
            for sec in body.get("secrities") or []:
                if sec.get("securityId") is None or sec.get("isDeleted") or not sec.get("isTradable"):
                    continue
                ac = coarse_type(sec.get("securityType"))
                if ac not in BOND_COARSE:
                    continue
                sid = int(sec["securityId"])
                name = (sec.get("securityName") or "").strip()
                listed.append({"security_id": sid, "name": name, "symbol": sec.get("symbol") or "",
                               "type": sec.get("securityType") or ""})
                if info:
                    bonds.append({
                        "security_id": sid,
                        "security_name": name,
                        "symbol": sec.get("symbol") or "",
                        "isin": sec.get("isin") or "",
                        "security_type": sec.get("securityType") or "",
                        "asset_class": ac,
                        "issuer_name": info["company"],
                        "company": info["company"],
                        "chp_number": k,
                        "maya_company_id": cid,
                        "notes": "; ".join(x for x in (GOYIM_NOTE if info["goyim"] else "", info["bond_note"]) if x),
                        "goyim": info["goyim"],
                        "bond_scope": info["bond_scope"],
                        "agch_approved": info["agch_approved"],
                        "is_private": info["is_private"],
                        "is_tradable": sec.get("isTradable"),
                    })
                elif sid in picks and k in names:
                    company = names[k]
                    bonds.append({
                        "security_id": sid, "security_name": name, "symbol": sec.get("symbol") or "",
                        "isin": sec.get("isin") or "", "security_type": sec.get("securityType") or "",
                        "asset_class": ac, "issuer_name": company, "company": company, "chp_number": k, "maya_company_id": cid,
                        "notes": "", "goyim": False, "bond_scope": "both", "agch_approved": SELECTIVE,
                        "is_private": picks[sid] in ("private", "both"),
                        "manual": True, "manual_scope": picks[sid], "is_tradable": sec.get("isTradable"),
                    })
            if snapshot is not None and k and listed:
                snapshot.setdefault(k, []).extend(listed)
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
            "annual_interest": fmt_interest(d.get("AnnualInterest")),
            "linkage": d.get("Linkage") or "",
            "linkage_type": d.get("LinkageType") or "",
            "last_price": last if last not in (None, "") else (d.get("BaseRate") or ""),
            # "תשואה שנתית" לפי הבורסה (כנראה 12 חודשים אחרונים / מתחילת שנה; ההגדרה המדויקת טרם אומתה)
            "annual_yield": "" if d.get("AnnualYield") is None else d.get("AnnualYield"),
            "base_indices": "" if d.get("BaseIndices") is None else d.get("BaseIndices"),
        })


def drop_empty_terms(bonds):
    """נייר בלי שום תנאי (אין שער, ריבית או מועד פדיון) = כנראה כבר לא נסחר (נפדה/נמחק) ומאיה עוד מציגה אותו.
    לא מפרסמים אותו. מוחזר (נשארים, הוסרו)."""
    kept, dropped = [], []
    for b in bonds:
        has_terms = any(b.get(k) not in ("", None) for k in ("redemption_date", "annual_interest", "last_price"))
        (kept if has_terms else dropped).append(b)
    return kept, dropped


# מגן: אם הרבה ניירות "ריקים" בבת אחת, כנראה שליפת התנאים נכשלה (לא שהם באמת נפדו) - לא דורסים את הפלט.
MAX_DROPPED_ABS, MAX_DROPPED_PCT = 5, 0.02


# ── 3ב. אימות מול datawise הרשמי (Securities Basic, חינמי) ──────────────────
DATAWISE = "https://datawise.tase.co.il"
def _datawise_key():
    key = os.environ.get("TASE_DATAWISE_KEY")
    if key:
        return key
    # ברירת מחדל: המפתח שכבר קיים בקוד של הפרויקט (בלי עותק נוסף). sync-tase.js כבר לא מכיל מפתח,
    # ולכן קוראים מ-debug-tase.js; עדיף להגדיר Secret בשם TASE_DATAWISE_KEY.
    for name in ("sync-tase.js", "debug-tase.js"):
        try:
            with open(os.path.join(ROOT, "functions", "api", name), encoding="utf-8") as fh:
                m = re.search(r'TASE_KEY\s*=\s*"([^"]+)"', fh.read())
        except OSError:
            continue
        if m:
            return m.group(1)
    return ""


DW_KEY = _datawise_key()
DW_HEADERS = {"accept": "application/json", "accept-language": "he-IL", "apikey": DW_KEY,
              "User-Agent": "Mozilla/5.0"}
BOND_CODE_PREFIXES = ("03", "05", "11", "36")   # אג"ח לפי קוד סוג (כמו sync-tase.js); לא כולל קרנות סל (43)
MAX_MISSING_ABS, MAX_MISSING_PCT = 5, 0.03   # מעל זה — הריצה נכשלת ולא דורסת פלט


def dw_get(path):
    req = urllib.request.Request(DATAWISE + path, headers=DW_HEADERS)
    last = None
    for i in range(RETRIES + 2):
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
                return json.loads(r.read())
        except Exception as e:  # noqa: BLE001
            last = e
            if i < RETRIES + 1:
                time.sleep(3 * (i + 1))     # 403/429 חולפים אצל datawise: ממתינים ומנסים שוב (3, 6, 9, 12 שניות)
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
                and coarse_type(types.get(str(r.get("securityFullTypeCode")), "")) in BOND_COARSE}
    mine = {b["security_id"] for b in bonds if not b.get("manual")}
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
        if b.get("manual"):                 # אג"ח שנבחרה ידנית: לפי הבחירה (פרטי / כללי / שניהם)
            return b["manual_scope"] in (("private", "both") if private else ("general", "both"))
        if b["goyim"]:                      # בבעלות גוי — נכנס לשתי הרשימות
            return True
        scope = b.get("bond_scope", "both")   # האם האישור לאג"ח הוא גם לכללי וגם לפרטי
        if private:   # סימון "פרטי" + מאושר (כן / רק פרטי), ולא אישור "רק כללי"
            return b["is_private"] and b["agch_approved"] in ("כן", "רק פרטי") and scope != "general_only"
        # כללי = כל המאושרות (כן / רק כללי), *גם* חברות מסומנות "פרטי"; "רק פרטי" (בשדה האישור או בהערה מפורשת) לא נכנס
        return b["agch_approved"] in ("כן", "רק כללי") and scope != "private_only"

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
    bid = lambda r: r["security_id"] or r.get("_key")   # noqa: E731  (הנפקה עתידית: אין מספר נייר)
    os.makedirs(OUT, exist_ok=True)
    counts, merged = {}, {}
    for name, private in (("private", True), ("general", False)):
        rows = sorted((view(b) for b in bonds if allowed(b, private)), key=key)
        counts[name] = len(rows)
        dump(f"bonds_{name}", rows, COLUMNS)
        for r in rows:
            merged.setdefault(bid(r), []).append("פרטי" if private else "כללי")
    # רשימה ממוזגת: נייר אחד בשורה אחת, עמודת list = פרטי / כללי / פרטי+כללי
    by_id = {bid(b): b for b in bonds}
    all_rows = sorted((view(by_id[i], "+".join(sorted(l))) for i, l in merged.items()), key=key)
    counts["all"] = len(all_rows)
    dump("bonds_all", all_rows, COLUMNS + ["list"])
    return counts


def bond_rows_by_chp(dw_rows, types):
    """אג"ח סחירות מרשימת הניירות של datawise, לפי ח.פ. המנפיק: {ח"פ: [(שורה, סוג)]}."""
    out = {}
    for r in dw_rows:
        code = str(r.get("securityFullTypeCode") or "")
        if r.get("securityId") is None or not code.startswith(BOND_CODE_PREFIXES):
            continue
        stype = types.get(code, "")
        if coarse_type(stype) not in BOND_COARSE:
            continue
        k = chp_norm(r.get("corporateId"))
        if k:
            out.setdefault(k, []).append((r, stype))
    return out


def desired_rows(k, items, approved, manual, names):
    """השורות הרצויות לחברה: חברה מאושרת רגילה = כל האג"ח שלה; אחרת רק הבחירות הידניות (אם החברה במאגר)."""
    info, picks = approved.get(k), manual.get(k) or {}
    out = []
    for r, stype in items:
        sid = int(r["securityId"])
        base = {"security_id": sid, "security_name": (r.get("securityName") or "").strip(), "symbol": r.get("symbol") or "",
                "isin": r.get("isin") or "", "security_type": stype, "asset_class": coarse_type(stype),
                "chp_number": k, "is_tradable": True}
        if info:
            out.append({**base, "issuer_name": info["company"], "company": info["company"],
                        "notes": "; ".join(x for x in (GOYIM_NOTE if info["goyim"] else "", info["bond_note"]) if x),
                        "goyim": info["goyim"], "bond_scope": info["bond_scope"], "agch_approved": info["agch_approved"],
                        "is_private": info["is_private"]})
        elif sid in picks and k in names:
            out.append({**base, "issuer_name": names[k], "company": names[k], "notes": "", "goyim": False, "bond_scope": "both",
                        "agch_approved": SELECTIVE, "is_private": picks[sid] in ("private", "both"),
                        "manual": True, "manual_scope": picks[sid]})
    return out


def stabilize_names(rows):
    """שם וסימול של נייר שכבר נראה נשארים כפי שנשמרו (names_seen.json); נייר חדש נרשם עם השם מ-datawise."""
    seen = {}
    if os.path.exists(NAMES_PATH):
        with open(NAMES_PATH, encoding="utf-8") as f:
            seen = json.load(f)
    for r in rows:
        k = str(r["security_id"])
        if k in seen:
            r["security_name"], r["symbol"] = seen[k]
        else:
            seen[k] = [r["security_name"], r["symbol"]]
    with open(NAMES_PATH, "w", encoding="utf-8") as f:
        json.dump(seen, f, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def snapshot_from_datawise(by_chp):
    """מקור חלון הבחירה: כל האג"ח הסחירות של כל חברה, לפי datawise."""
    return {k: [{"security_id": int(r["securityId"]), "name": (r.get("securityName") or "").strip(),
                 "symbol": r.get("symbol") or "", "type": stype} for r, stype in items] for k, items in by_chp.items()}


def add_market_bonds(bonds, approved, manual, names, snapshot, dw, ids_fn=None):
    """אג"ח שבנתוני המסחר של הבורסה ולא בדף החברה במאיה: נוספות כמו אג"ח רגילות של חברה מאושרת (או שנבחרה ידנית),
    וגם לחלון הבחירה. החברה והסוג נלקחים מרשימת ניירות datawise לפי מספר הנייר. -> (שורות חדשות, דגימה)."""
    ids, sample = (ids_fn or market_data.fetch_ids)()
    if not ids or not dw:
        return [], sample
    rows, _d, types = dw
    by_sid = {int(r["securityId"]): r for r in rows if r.get("securityId") is not None}
    have = {x["security_id"] for x in bonds} | {int(e["security_id"]) for v in snapshot.values() for e in v}
    out = []
    for sid in ids:
        r = by_sid.get(sid)
        code = str((r or {}).get("securityFullTypeCode") or "")
        if sid in have or not r or not code.startswith(BOND_CODE_PREFIXES):
            continue
        stype = types.get(code, "")
        ac = coarse_type(stype)
        if ac not in BOND_COARSE:
            continue
        k = chp_norm(r.get("corporateId"))
        name = (r.get("securityName") or "").strip()
        if k:
            snapshot.setdefault(k, []).append({"security_id": sid, "name": name, "symbol": r.get("symbol") or "", "type": stype})
        info, picks = approved.get(k), (manual.get(k) or {})
        base = {"security_id": sid, "security_name": name, "symbol": r.get("symbol") or "", "isin": r.get("isin") or "",
                "security_type": stype, "asset_class": ac, "chp_number": k, "maya_company_id": None, "is_tradable": True}
        if info:
            out.append({**base, "issuer_name": info["company"], "company": info["company"],
                        "notes": "; ".join(x for x in (GOYIM_NOTE if info["goyim"] else "", info["bond_note"]) if x),
                        "goyim": info["goyim"], "bond_scope": info["bond_scope"], "agch_approved": info["agch_approved"],
                        "is_private": info["is_private"]})
        elif sid in picks and k in names:
            out.append({**base, "issuer_name": names[k], "company": names[k], "notes": "", "goyim": False, "bond_scope": "both",
                        "agch_approved": SELECTIVE, "is_private": picks[sid] in ("private", "both"),
                        "manual": True, "manual_scope": picks[sid]})
    sample["added_to_lists"] = len(out)
    return out, sample


OFFERINGS_STATE_PATH = os.path.join(OUT, "offerings_state.json")


def collect_offerings(dw, approved, manual, names, companies, regular_ids=frozenset()):
    """הנפקות עתידיות ופתוחות -> (offerings.json, שורות לרשימת האג"ח).
    זיכרון: הנפקה שנעלמה מהבורסה נשארת 3 ימים (offerings_state.json), עד שהאג"ח ברשימה הרגילה. כשל בשליפה לא מפיל
    את הבנייה: נשארות רק הנפקות מהזיכרון."""
    empty = {"upcoming": [], "open": [], "companies": [], "unmatched": []}
    state = {}
    if os.path.exists(OFFERINGS_STATE_PATH):
        with open(OFFERINGS_STATE_PATH, encoding="utf-8") as f:
            state = json.load(f)
    try:
        up_raw, op_raw = dw_get("/v1/tase-offering/upcoming"), dw_get("/v1/tase-offering/open")
        rows, _date, types = dw if dw else ([], "", {})
        ours = [((c.get("registrar_name") or c.get("permit_name") or ""), c.get("chp_number")) for c in companies]
        data = offerings.build(up_raw, op_raw, rows, ours, types, BOND_CODE_PREFIXES, BOND_COARSE, chp_norm)
    except Exception as e:  # noqa: BLE001
        print(f"WARNING: offerings fetch failed, using remembered offerings only: {e}", file=sys.stderr)
        data = dict(empty)
    try:
        data, state = offerings.apply_memory(data, state, TODAY, set(regular_ids))
        bonds = offerings.bond_rows(data, approved, manual, names, SELECTIVE, GOYIM_NOTE, TODAY)
    except Exception as e:  # noqa: BLE001
        print(f"WARNING: offerings failed, no offering bonds this run: {e}", file=sys.stderr)
        return empty, []
    with open(OFFERINGS_STATE_PATH, "w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False, indent=1, sort_keys=True)
    with open(os.path.join(OUT, "offerings.json"), "w", encoding="utf-8") as f:
        json.dump({"updated": TODAY, **data}, f, ensure_ascii=False, indent=1)
    print(f"offerings: upcoming={len(data['upcoming'])}, open={len(data['open'])}, "
          f"companies={len(data['companies'])}, unmatched={len(data['unmatched'])}, bond rows={len(bonds)}")
    return data, bonds


def main(companies_path=None):
    companies = load_companies(companies_path)
    approved = approved_map(companies)
    print(f"companies: {len(companies)}, approved with ח\"פ: {len(approved)}")
    if not approved:
        raise SystemExit("no approved companies - refusing to overwrite output")

    manual = load_manual_bonds()
    print(f"manual bond picks: {sum(len(v) for v in manual.values())} bonds in {len(manual)} companies")
    dw = fetch_datawise_securities()
    if not dw:
        raise SystemExit("datawise securities list unavailable - output left untouched")
    dw_rows, _dw_date, dw_types = dw
    by_chp = bond_rows_by_chp(dw_rows, dw_types)
    names = company_names(companies)
    bonds = []
    for k in sorted(set(approved) | set(manual)):
        bonds.extend(desired_rows(k, by_chp.get(k, []), approved, manual, names))
    print(f"datawise: {len(dw_rows)} securities, {sum(len(v) for v in by_chp.values())} bonds in {len(by_chp)} companies; "
          f"{len(bonds)} bonds for approved/picked companies ({sum(1 for x in bonds if x.get('manual'))} picked manually)")
    prev = None
    if os.path.exists(INTERNAL_PATH):
        with open(INTERNAL_PATH, encoding="utf-8") as f:
            prev = len(json.load(f).get("regular") or [])
    if not bonds or (prev and len(bonds) < 0.8 * prev):
        raise SystemExit(f"bond count looks wrong ({len(bonds)} vs previous {prev}) - output left untouched")
    stabilize_names(bonds)
    snapshot = snapshot_from_datawise(by_chp)
    import company_ids      # כאן ולא בראש הקובץ: company_ids מייבא את הקובץ הזה
    cid_map = company_ids.get_ids({x["chp_number"] for x in bonds})     # מזהי חברה במאיה (להעשרה): מהמפה, לא מסריקה
    for x in bonds:
        x["maya_company_id"] = cid_map.get(x["chp_number"])

    check = cross_check(bonds, approved, dw)
    print("datawise check:", {k: (v if not isinstance(v, list) else len(v)) for k, v in check.items()})
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, "verification.json"), "w", encoding="utf-8") as f:
        json.dump({"updated": TODAY, **check}, f, ensure_ascii=False, indent=1)
    if check["status"] == "too_many_missing":
        raise SystemExit("datawise cross-check failed - bond lists left untouched")

    offering_data, offering_bonds = collect_offerings(dw, approved, manual, company_names(companies), companies,
                                                      {int(x['security_id']) for v in snapshot.values() for x in v})
    for chp, entries in offerings.snapshot_entries(offering_data).items():   # הנפקות פתוחות גם בחלון הבחירה
        have = {e["security_id"] for e in snapshot.get(chp, [])}
        snapshot.setdefault(chp, []).extend(e for e in entries if e["security_id"] not in have)
    with open(os.path.join(OUT, "maya_securities.json"), "w", encoding="utf-8") as f:   # מקור חלון הבחירה בדף הניהול
        json.dump({"updated": TODAY, "companies": snapshot}, f, ensure_ascii=False, separators=(",", ":"))
    add_terms(bonds)
    try:   # דירוגים + תשואה לפדיון (enrich.py, לוגיקה כפולה מ-Revach). כשל לא מפיל את הרשימה: העמודות נשארות ריקות.
        import enrich
        enrich.enrich(bonds, recheck_all=True)      # בנייה מלאה: בדיקה מחדש של כל החברות (לוחות סילוקין משתנים)
    except Exception as e:  # noqa: BLE001
        print(f"WARNING: enrich failed, ratings/yield columns left empty: {e}", file=sys.stderr)
    total_before = len(bonds)
    bonds, dropped = drop_empty_terms(bonds)
    if len(dropped) > max(MAX_DROPPED_ABS, int(MAX_DROPPED_PCT * total_before)):
        raise SystemExit(f"{len(dropped)}/{total_before} bonds came back without terms - terms fetch looks partial, bond lists left untouched")
    if dropped:
        print(f"dropped {len(dropped)} bond(s) without any terms:", [(b['security_id'], b['company']) for b in dropped])
    check["dropped_no_terms"] = [{"security_id": b["security_id"], "security_name": " ".join(str(b["security_name"]).split()),
                                  "company": b["company"], "chp_number": b["chp_number"]} for b in dropped]
    with open(os.path.join(OUT, "verification.json"), "w", encoding="utf-8") as f:
        json.dump({"updated": TODAY, **check}, f, ensure_ascii=False, indent=1)
    state = load_state()
    apply_first_seen(bonds, state)
    with open(INTERNAL_PATH, "w", encoding="utf-8") as f:    # בסיס לבנייה המהירה (fast_build.py): הרשימה הרגילה המלאה, עם השדות הפנימיים
        json.dump({"updated": TODAY, "regular": bonds}, f, ensure_ascii=False, separators=(",", ":"), default=str)
    bonds = bonds + offering_bonds       # הנפקות: אחרי ההעשרה והסינון (אין להן תנאים מהבורסה)
    counts = write_lists(bonds)
    os.makedirs(OUT, exist_ok=True)
    with open(STATE_PATH, "w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False, indent=1, sort_keys=True)
    print(f"written: private={counts['private']}, general={counts['general']}, all(merged)={counts['all']}")


if __name__ == "__main__":
    main(*sys.argv[1:2])
