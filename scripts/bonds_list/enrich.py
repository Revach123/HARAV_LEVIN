# -*- coding: utf-8 -*-
"""
scripts/bonds_list/enrich.py — הרחבת רשימת האג"ח: דירוגים (מידרוג / מעלות) ותשואה ברוטו לפדיון (לאג"ח לא צמודות בלבד).

*** לוגיקה כפולה *** הקוד כאן הועתק מ-Revach (scripts/securities/fetch_securities.py ו-securities.html), כדי ש-HARAV_LEVIN
יישאר עצמאי. תיקון באחד מהם = לבדוק אם צריך לתקן גם בשני. מה הועתק ומאיפה:
  - fetch_midroog / fetch_rating_reports / download_attachment / parse_rating_tsv      <- fetch_securities.py (Phase 3, 4)
  - fetch_corporate_actions / derive_frequency / parse_redemption_pct                  <- fetch_securities.py (Phase 5)
  - gen_coupon_times / solve_ytm                                                        <- securities.html (genCouponTimes, solveYtm2)
  - תנאי הדילוג על חישוב תשואה (tryComputeYtm)                                         <- securities.html

עיקרון: כשל כלשהו כאן *לא* מפיל את בניית הרשימה. עמודה שלא ניתן למלא נשארת ריקה.
מצב מתמשך: data/bonds_list/enrich_state.json (דירוגים אחרונים לכל נייר, נקודת ביקורת לחיפוש דירוגים, תדירויות ריבית, ניירות לשיעורין).
תשואה לפדיון: רק לא צמוד, בלי לשיעורין, בלי מושהה, בלי מט"ח / מובנות / להמרה. מחיר נקי + ריבית צבורה (כמו ב-Revach אחרי התיקון מ-13.10.2026); המידע בבדיקה.
"""
import concurrent.futures
import datetime
import json
import os
import re
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
STATE_PATH = os.path.join(HERE, "..", "..", "data", "bonds_list", "enrich_state.json")

MIDROOG_URL = "https://www.midroog.co.il/api/ratings/excel"
MAYA_RATINGS_SEARCH_URL = "https://maya.tase.co.il/api/v1/reports/companies"
MAYA_CORP_ACTIONS_URL = "https://maya.tase.co.il/api/v1/corporate-actions/events"
MAYA_FILES_BASE = "https://mayafiles.tase.co.il/"
RATING_EVENT_ID = 206                 # "דוח מיידי על דירוג"
EVENT_INTEREST_PAYMENT = 7            # "יום תשלום - ריבית"
EVENT_PARTIAL_REDEMPTION = 9          # "יום תשלום - פדיון חלקי" (אג"ח לשיעורין)
PAGE_LIMIT = 30                       # ה-API דוחה יותר מ-30
MAX_RATING_PAGES = 500
RATINGS_LOOKBACK_DEFAULT = int(os.environ.get("RATINGS_LOOKBACK_DAYS", "400"))   # ריצה ראשונה (בלי נקודת ביקורת): backfill מלא
RATINGS_OVERLAP_DAYS = 2
# הבדיקה (probe-maya, 13.10.2026): toDate של +30 שנה נדחה ב-HTTP 400 ("Error occured while trying to bind input to model"); +10 שנה עובד.
CA_LOOKBACK_YEARS, CA_LOOKAHEAD_YEARS, CA_MAX_PAGES = 3, 10, 20
WORKERS = 8
RETRIES = 3


# ── HTTP ─────────────────────────────────────────────────────────────────────
def _request(url, body=None, headers=None, timeout=30, raw=False):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    h = {"User-Agent": "Mozilla/5.0", "Accept": "application/json, text/plain, */*", "Accept-Language": "he-IL"}
    if data is not None:
        h["Content-Type"] = "application/json"
    h.update(headers or {})
    last = None
    for _ in range(RETRIES):
        try:
            req = urllib.request.Request(url, data=data, headers=h, method="POST" if data is not None else "GET")
            with urllib.request.urlopen(req, timeout=timeout) as r:
                payload = r.read()
            return payload if raw else json.loads(payload)
        except urllib.error.HTTPError as e:
            try:
                body_txt = e.read().decode("utf-8", "replace")[:200]
            except Exception:  # noqa: BLE001
                body_txt = ""
            last = f"{e} {body_txt}"
        except Exception as e:  # noqa: BLE001
            last = e
    raise RuntimeError(f"{url[:70]}: {last}")


# ── דירוגים ──────────────────────────────────────────────────────────────────
def fetch_midroog():
    """POST יחיד: כל היסטוריית פעולות הדירוג (כ-20 אלף רשומות). -> {security_id: {rating, outlook, date}} (האחרונה לכל נייר)."""
    body = {"lang": "he", "orderBy": {"field": "ratingReport.publishDate", "order": "desc"}, "search": "", "skip": 0}
    raw = _request(MIDROOG_URL, body, {"Referer": "https://www.midroog.co.il/he/ratings"}, timeout=60)
    latest = {}
    for rec in raw if isinstance(raw, list) else []:
        try:
            sid = int((rec.get("symbol") or "").strip())
        except ValueError:
            continue
        pub = rec.get("publishDate") or ""
        if sid not in latest or pub > latest[sid]["date"]:
            latest[sid] = {"rating": (rec.get("rating") or {}).get("titleHeb") or "",
                           "outlook": rec.get("outlookTitle") or (rec.get("outlook") or {}).get("titleHeb") or "",
                           "date": pub}
    return latest


def fetch_rating_reports(from_iso, to_iso):
    """חיפוש דוחות דירוג ב-Maya (eventsIds=[206]), עם עימוד. מחזיר רשימה שטוחה."""
    out, page = [], 1
    while page <= MAX_RATING_PAGES:
        body = {"pageNumber": page, "fromDate": from_iso, "toDate": to_iso, "isPriority": False, "isTradeHalt": False,
                "by": "company", "eventsIds": [RATING_EVENT_ID], "limit": PAGE_LIMIT, "offset": (page - 1) * PAGE_LIMIT}
        items = _request(MAYA_RATINGS_SEARCH_URL, body, {"Referer": "https://maya.tase.co.il/he/reports/companies"})
        items = items if isinstance(items, list) else []
        if not items:
            break
        out.extend(items)
        if len(items) < PAGE_LIMIT:
            break
        page += 1
    return out


def fetch_reports_chunked(fetch, from_dt, to_dt, step_days=30, log=print):
    """חיפוש דוחות דירוג בחלונות של step_days ימים (חיפוש רחב אחד נכשל ב-HTTP 400 בעומק העימוד בריצה האמיתית הראשונה).
    -> (דוחות, כל החלונות הצליחו?). חלון שנכשל לא מפיל את האחרים, אבל אז לא מקדמים את נקודת הביקורת."""
    fmt = "%Y-%m-%dT%H:%M:%S.000Z"
    out, ok, cur = [], True, from_dt
    while cur < to_dt:
        nxt = min(cur + datetime.timedelta(days=step_days), to_dt)
        try:
            out.extend(fetch(cur.strftime(fmt), nxt.strftime(fmt)))
        except Exception as e:  # noqa: BLE001
            ok = False
            log(f"enrich: WARNING rating reports window {cur.date()}..{nxt.date()} failed: {e}")
        cur = nxt
    return out, ok


def download_attachment(rel_url):
    try:
        return _request(MAYA_FILES_BASE + rel_url, headers={"Referer": "https://maya.tase.co.il/"}, timeout=20, raw=True)
    except RuntimeError:
        return None


def parse_rating_tsv(content):
    """שורה 3 = כותרות באנגלית, 4+ = נתונים (TSV, UTF-8 עם BOM)."""
    if not content:
        return []
    lines = [ln for ln in content.decode("utf-8-sig", errors="replace").splitlines() if ln.strip()]
    if len(lines) < 4:
        return []
    header = lines[2].split("\t")
    return [dict(zip(header, ln.split("\t"))) for ln in lines[3:]]


def agency_ratings_from_reports(reports, download=download_attachment):
    """-> {(agency, security_id): {rating, outlook, date}} - האחרון לכל (חברת דירוג, נייר). M_ = מידרוג, S_ = מעלות."""
    atts = []
    for rep in reports:
        for att in rep.get("attachments") or []:
            if att.get("fileType") != "txt1":
                continue
            name = att.get("fileName") or ""
            agency = "midroog" if name.startswith("M_") else "maalot" if name.startswith("S_") else None
            if agency and att.get("url"):
                atts.append((att["url"], agency))
    latest = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=WORKERS) as ex:
        for (url, agency), content in zip(atts, ex.map(lambda a: download(a[0]), atts)):
            for row in parse_rating_tsv(content):
                if (row.get("SecurityNumberIsExist") or "").strip() != "1":
                    continue
                try:
                    sid = int((row.get("SecurityNumber") or "").strip())
                except ValueError:
                    continue
                date = (row.get("RatingDate") or "").strip()
                key = (agency, sid)
                if key not in latest or date > latest[key]["date"]:
                    latest[key] = {"rating": (row.get("Rating") or "").strip(),
                                   "outlook": (row.get("StablePositiveNegative") or "").strip(), "date": date}
    return latest


# ── תדירות ריבית ולוח פדיון ──────────────────────────────────────────────────
def fetch_corporate_actions(company_id, from_iso, to_iso):
    out, page = [], 1
    while page <= CA_MAX_PAGES:
        body = {"pageSize": PAGE_LIMIT, "pageNumber": page, "companyId": company_id, "fromDate": from_iso, "toDate": to_iso}
        items = _request(MAYA_CORP_ACTIONS_URL, body)
        items = items if isinstance(items, list) else []
        if not items:
            break
        out.extend(items)
        if len(items) < PAGE_LIMIT:
            break
        page += 1
    return out


def derive_frequency(dates_iso):
    """מספר תשלומי ריבית בשנה לפי חציון הפער בין תשלומים; None אם לא סדיר / פחות משני תאריכים."""
    if len(dates_iso) < 2:
        return None
    ds = sorted(datetime.date.fromisoformat(d[:10]) for d in dates_iso)
    gaps = sorted((ds[i + 1] - ds[i]).days for i in range(len(ds) - 1))
    g = gaps[len(gaps) // 2]
    if 75 <= g <= 105:
        return 4
    if 160 <= g <= 200:
        return 2
    if 340 <= g <= 390:
        return 1
    return None


def analyze_company_events(events):
    """-> ({security_id: [תאריכי תשלום ריבית]}, {security_id של אג"ח לשיעורין})."""
    pay, partial = {}, set()
    for ev in events:
        sid, dt, name = ev.get("securityId"), ev.get("date"), ev.get("eventName") or ""
        if sid is None or not dt or "תשלום" not in name:   # אירועי "יום אקס" מתערבבים תחת אותו מזהה
            continue
        if ev.get("eventId") == EVENT_INTEREST_PAYMENT:
            pay.setdefault(int(sid), []).append(dt)
        elif ev.get("eventId") == EVENT_PARTIAL_REDEMPTION and re.match(r"^\s*[\d.]+\s*%", ev.get("moreInfo") or ""):
            partial.add(int(sid))
    return pay, partial


# ── תשואה לפדיון (כמו solveYtm2 ו-genCouponTimes ב-Revach) ───────────────────
def parse_tase_date(s):
    m = re.match(r"^(\d{2})/(\d{2})/(\d{4})$", s or "")
    return datetime.date(int(m.group(3)), int(m.group(2)), int(m.group(1))) if m else None


def gen_coupon_times(maturity, freq, today):
    """זמני תשלום (בשנים מהיום) - צעידה אחורה מהפדיון בקפיצות של 12/freq חודשים."""
    times, y, mth, day = [], maturity.year, maturity.month, maturity.day
    step = 12 // freq
    cur = maturity
    while cur > today:
        times.insert(0, (cur - today).days / 365.25)
        mth -= step
        while mth < 1:
            mth += 12
            y -= 1
        last = [31, 29 if (y % 4 == 0 and (y % 100 != 0 or y % 400 == 0)) else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mth - 1]
        cur = datetime.date(y, mth, min(day, last))
    return times


def solve_ytm(price, coupon_pct, freq, times):
    """תשואה שנתית נומינלית באחוזים (ריבית תקופתית x תדירות). None אם אין פתרון.
    ה-price שמתקבל הוא מחיר נקי; מוסיפים ריבית צבורה (חלק התקופה שחלף מאז התשלום האחרון) כדי לקבל מחיר מלא.
    אותו תיקון הוכנס גם ב-Revach (securities.html solveYtm2, securities.js solveYtm) ב-13.10.2026."""
    if not times:
        return None
    coupon = 100 * coupon_pct / 100 / freq
    price = price + coupon * min(max(1 - times[0] * freq, 0.0), 1.0)

    def f(r):
        return sum(coupon / (1 + r) ** (t * freq) for t in times) + 100 / (1 + r) ** (times[-1] * freq) - price

    lo, hi = -0.99, 5.0
    if f(lo) * f(hi) > 0:
        return None
    for _ in range(100):
        mid = (lo + hi) / 2
        fm = f(mid)
        if abs(fm) < 1e-7:
            lo = hi = mid
            break
        if f(lo) * fm < 0:
            hi = mid
        else:
            lo = mid
    return (lo + hi) / 2 * freq * 100


def eligible_for_ytm(b, partial_ids):
    """תנאי הדילוג (tryComputeYtm ב-Revach) + החלטה: רק אג"ח לא צמודות."""
    if b["security_id"] in partial_ids:
        return False
    if (b.get("linkage") or "").strip() not in ("לא צמוד", "שקלי"):    # צמוד מדד / מט"ח - לא מחושב כרגע
        return False
    st = b.get("security_type") or ""
    if re.search(r"גלובלי|להמרה|מובנות", st):
        return False
    return True


# ── מצב מתמשך ────────────────────────────────────────────────────────────────
def load_state(path=STATE_PATH):
    try:
        with open(path, encoding="utf-8") as f:
            s = json.load(f)
    except (OSError, ValueError):
        s = {}
    for k in ("ratings", "frequencies", "checked", "partial"):
        s.setdefault(k, {} if k in ("ratings", "frequencies") else [])
    return s


def save_state(state, path=STATE_PATH):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    os.replace(tmp, path)


# ── הרצה ─────────────────────────────────────────────────────────────────────
def enrich(bonds, state_path=STATE_PATH, today=None, log=print, fetchers=None):
    """מוסיף לכל אג"ח: midroog_rating, maalot_rating, ytm_gross (ריק כשלא ניתן). לא זורק חריגות."""
    f = {"midroog": fetch_midroog, "reports": fetch_rating_reports, "download": download_attachment,
         "events": fetch_corporate_actions}
    f.update(fetchers or {})
    today = today or datetime.date.today()
    now = datetime.datetime.now(datetime.timezone.utc)
    state = load_state(state_path)
    for b in bonds:
        b.setdefault("midroog_rating", ""); b.setdefault("maalot_rating", ""); b.setdefault("ytm_gross", "")

    # 1. דירוגים: מידרוג (כל ההיסטוריה) + דוחות Maya (שתי החברות), עם נקודת ביקורת
    try:
        for sid, v in f["midroog"]().items():
            state["ratings"][f"midroog:{sid}"] = v
        log(f"enrich: midroog ratings known: {sum(1 for k in state['ratings'] if k.startswith('midroog:'))}")
    except Exception as e:  # noqa: BLE001
        log(f"enrich: WARNING midroog failed: {e}")
    try:
        through = state.get("ratings_checked_through")
        if through:
            from_dt = datetime.datetime.fromisoformat(through.replace("Z", "+00:00")) - datetime.timedelta(days=RATINGS_OVERLAP_DAYS)
        else:
            from_dt = now - datetime.timedelta(days=RATINGS_LOOKBACK_DEFAULT)
        fmt = "%Y-%m-%dT%H:%M:%S.000Z"
        reports, all_ok = fetch_reports_chunked(f["reports"], from_dt, now, log=log)
        for (agency, sid), v in agency_ratings_from_reports(reports, f["download"]).items():
            old = state["ratings"].get(f"{agency}:{sid}")
            if not old or v["date"] >= old.get("date", ""):
                state["ratings"][f"{agency}:{sid}"] = v
        if all_ok:
            state["ratings_checked_through"] = now.strftime(fmt)
        else:
            log("enrich: checkpoint not advanced (some windows failed)")
        log(f"enrich: {len(reports)} rating reports processed")
    except Exception as e:  # noqa: BLE001
        log(f"enrich: WARNING rating reports failed (checkpoint not advanced): {e}")

    # 2. תדירות ריבית / אג"ח לשיעורין - לפי חברה (id של Maya), רק לחברות עם נייר שטרם נבדק
    try:
        by_company = {}
        for b in bonds:
            if b.get("maya_company_id") and str(b["security_id"]) not in set(state["checked"]):
                by_company.setdefault(b["maya_company_id"], set()).add(b["security_id"])
        fmt = "%Y-%m-%dT%H:%M:%S.000Z"
        a = (now - datetime.timedelta(days=365 * CA_LOOKBACK_YEARS)).strftime(fmt)
        z = (now + datetime.timedelta(days=365 * CA_LOOKAHEAD_YEARS)).strftime(fmt)
        checked = set(state["checked"]); partial = set(state["partial"])
        errors, with_events = 0, 0
        with concurrent.futures.ThreadPoolExecutor(max_workers=WORKERS) as ex:
            futs = {ex.submit(f["events"], cid, a, z): (cid, sids) for cid, sids in by_company.items()}
            for fut in concurrent.futures.as_completed(futs):
                cid, sids = futs[fut]
                try:
                    events = fut.result()
                except Exception as e:  # noqa: BLE001
                    errors += 1
                    if errors <= 3:
                        log(f"enrich: WARNING corporate actions failed for company {cid}: {e}")
                    continue                       # לא מסמנים כנבדק - ננסה שוב בריצה הבאה
                with_events += 1 if events else 0
                pay, part = analyze_company_events(events)
                for sid, dates in pay.items():
                    fr = derive_frequency(dates)
                    if fr and str(sid) not in state["frequencies"]:
                        state["frequencies"][str(sid)] = fr
                partial.update(str(s) for s in part)
                checked.update(str(s) for s in sids)
        state["checked"] = sorted(checked); state["partial"] = sorted(partial)
        log(f"enrich: companies {len(by_company)}, request errors {errors}, with events {with_events}; frequencies known {len(state['frequencies'])}, amortizing {len(partial)}")
    except Exception as e:  # noqa: BLE001
        log(f"enrich: WARNING corporate actions failed: {e}")

    # 3. מילוי העמודות
    partial_ids = {int(x) for x in state["partial"]}
    ytm_n = 0
    for b in bonds:
        sid = b["security_id"]
        for agency in ("midroog", "maalot"):
            r = state["ratings"].get(f"{agency}:{sid}")
            if r and r.get("rating"):
                b[f"{agency}_rating"] = r["rating"]
        fr = state["frequencies"].get(str(sid))
        d = parse_tase_date(b.get("redemption_date"))
        try:
            price, coupon = float(b.get("last_price")), float(b.get("annual_interest"))
        except (TypeError, ValueError):
            continue
        if fr and d and d > today and price > 0 and eligible_for_ytm(b, partial_ids):
            y = solve_ytm(price, coupon, fr, gen_coupon_times(d, fr, today))
            if y is not None:
                b["ytm_gross"] = round(y, 2)
                ytm_n += 1
    log(f"enrich: ytm computed for {ytm_n}/{len(bonds)}; midroog {sum(1 for b in bonds if b['midroog_rating'])}, maalot {sum(1 for b in bonds if b['maalot_rating'])}")
    try:
        save_state(state, state_path)
    except OSError as e:
        log(f"enrich: WARNING could not save state: {e}")
    return bonds
