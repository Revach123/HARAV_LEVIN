# -*- coding: utf-8 -*-
"""
scripts/registry_refresh/refresh_businesses.py

מחליף את ה-Worker "registry-updater" (ר' archive/registry-updater-worker.js) בריצה ב-GitHub Actions.
עושה את אותן שתי עבודות על טבלת businesses ב-D1 (business-registry-db):

  1. שם רשמי + סוג עסק: לכל עסק עם ח"פ מספרי — שליפה מ-data.gov.il (חברות / שותפויות / עמותות)
     בבאצ'ים (datastore_search עם רשימת מספרים בפילטר; datastore_search_sql כבר מחזיר 404), לא בקשה לעסק.
     עדיפות: חברה > שותפות > עמותה (כמו ב-Worker). מעדכן registrar_name ו-biz_type כשהשתנו.
  2. דגל tase_has_agch ("יש"/"אין"): לפי רשימת ניירות הערך הסחירים של datawise (Securities Basic) — האם לח"פ
     יש אג"ח סחירה (קוד סוג 03/05/11/36), *כולל ני"ע מסחריים*.
  3. has_agch_any ("יש"/"אין", migrations/0022) = יש אג"ח *כולל לא סחיר*: סחירה (כמו בסעיף 2, או ח"פ ברשימת האג"ח bonds_all)
     או אג"ח לא סחירה פעילה (data/bonds_list/nontradable_chps.json + bonds_institutional.json, נבנים יומית ב-bonds-list).
     נפרד בכוונה מ-tase_has_agch (רשימות החברות מציגות "יש אג"ח" רק לפי סחירות). לפיו גם permits_category:
     'יש' = בקטגוריה "חברות מנפיקות אג"ח", 'אין' = יוצאת ממנה (כמו functions/api/_shared/bond-pcat.js). מתעדכן יחד עם דגל האג"ח.

מצבים:
  * ברירת מחדל = בדיקה בלבד (dry-run): לא כותב כלום ל-D1, רק מחשב ושומר דוח.
  * --apply: כותב ל-D1. דורש CF_ACCOUNT_ID + CF_D1_TOKEN (+ CF_DATABASE_ID, ברירת מחדל מ-wrangler.toml).
    בלי הסודות — נשאר dry-run גם אם ביקשו --apply.

הגנות לפני כתיבה (עוצרות בלי לשנות כלום):
  * data.gov.il החזיר פחות מ-85% מהח"פים המספריים (חסימה/הגבלה).
  * דריסה של שם קיים ביותר מ-15% מהעסקים (לפחות 50) — כנראה נתונים שגויים. מילוי שם ריק לא נספר.
  * רשימת datawise קטנה מ-1000 ניירות.
לא נכתב שום דבר עבור עסק שלא נמצא (כמו ב-Worker). לא נמחק כלום.

--scope: מה לעדכן. all (ברירת מחדל, כמו הריצה היומית) = שם רשמי + סוג עסק + דגל אג"ח; bonds = דגל אג"ח בלבד (קצר, מספר שניות
  מול datawise, לעדכון ידני מדף הניהול); names = שם רשמי + סוג עסק בלבד. אותה לוגיקה בדיוק בכל המצבים (אותן פונקציות).
  ריצה חלקית כותבת דוח משלה (last_run_<scope>.json, rollback_<scope>.sql) כדי לא לדרוס את הדוח של הריצה המלאה.

פלט: reports/registry_refresh/last_run.json — סיכום + רשימת השינויים (ערך ישן/חדש) לשחזור.
"""
import argparse
import datetime
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
REPORT = os.path.join(ROOT, "reports", "registry_refresh", "last_run.json")

SITE = os.environ.get("HARAV_API", "https://harav-levin.pages.dev")
GOV_SEARCH = "https://data.gov.il/api/3/action/datastore_search"   # datastore_search_sql מחזיר 404
BATCH = 150
TIMEOUT, RETRIES = 60, 4

SOURCES = [   # סדר = עדיפות
    {"kind": "company", "resource": "f004176c-b85f-4542-8901-7b3176f9a054",
     "id": "מספר חברה", "name": "שם חברה", "extra": ["סוג תאגיד", "מגבלות"], "status": "סטטוס חברה"},
    {"kind": "partnership", "resource": "139aa193-fabb-4f6b-a71b-0bb40fd73eb2",
     "id": "מספר שותפות", "name": "שם שותפות", "extra": [], "status": "סטטוס תאגיד"},
    {"kind": "association", "resource": "be5b7935-3922-45d4-9638-08871b17ec95",
     "id": "מספר עמותה", "name": "שם עמותה בעברית", "extra": []},
]
BOND_TYPE_PREFIXES = ("03", "05", "11", "36")
DATAWISE = "https://datawise.tase.co.il"

MIN_FOUND_RATIO = 0.85
MAX_NAME_CHANGE_PCT, MAX_NAME_CHANGE_ABS = 0.15, 50
MIN_DATAWISE_ROWS = 1000


# ── עזרים ────────────────────────────────────────────────────────────────────
def clean_name(name):
    s = (name or "").replace("~", '"').replace("שותפות מוגבלת", "").strip()
    return re.sub(r'[.,\-!?~"]+$', "", s).strip()


def classify(source, rec):
    if source["kind"] == "company":
        type_raw = str(rec.get("סוג תאגיד") or "").strip()
        lim_raw = str(rec.get("מגבלות") or "").strip()
        kind = "חברה ציבורית" if "ציבורית" in type_raw else "חברה פרטית"
        lim = "לא מוגבלת" if "לא מוגבלת" in lim_raw else 'בע"מ'
        return f"{kind} - {lim}"
    return 'שותפות - לא בע"מ' if source["kind"] == "partnership" else "עמותה רשומה"


def http_json(url, data=None, headers=None):
    h = {"User-Agent": "Mozilla/5.0", "Accept": "application/json"}
    if data is not None:
        h["Content-Type"] = "application/json"
    h.update(headers or {})
    body = json.dumps(data).encode() if data is not None else None
    last = None
    for attempt in range(RETRIES):
        try:
            req = urllib.request.Request(url, data=body, headers=h, method="POST" if body else "GET")
            with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
                text = r.read().decode("utf-8", "replace")
            if text.lstrip().startswith("<"):
                raise RuntimeError("HTML response (blocked?)")
            return json.loads(text)
        except urllib.error.HTTPError as e:
            last = e
            if e.code in (400, 404, 405):          # לא יעזור לנסות שוב
                break
            time.sleep(3 * (attempt + 1))
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(3 * (attempt + 1))
    raise RuntimeError(f"request failed: {url[:80]}: {last}")


def sql_q(v):
    return "NULL" if v is None else "'" + str(v).replace("'", "''") + "'"


# ── D1 ──────────────────────────────────────────────────────────────────────
class D1:
    def __init__(self, name="business-registry-db"):
        self.account = os.environ.get("CF_ACCOUNT_ID", "")
        self.token = os.environ.get("CF_D1_TOKEN", "")
        # CF_DATABASE_ID = המסד הראשי (business-registry-db); מסד אחר (למשל company-info-db) - תמיד לפי שמו ב-wrangler.toml
        self.db = (os.environ.get("CF_DATABASE_ID") if name == "business-registry-db" else "") or self._db_from_wrangler(name)

    @staticmethod
    def _db_from_wrangler(name="business-registry-db"):
        """מזהה המסד לפי *שם* המסד (ב-wrangler.toml יש כמה מסדים)."""
        db_name = name
        try:
            with open(os.path.join(ROOT, "wrangler.toml"), encoding="utf-8") as f:
                text = f.read()
        except OSError:
            return ""
        for block in text.split("[[d1_databases]]")[1:]:
            name = re.search(r'database_name\s*=\s*"([^"]+)"', block)
            ident = re.search(r'database_id\s*=\s*"([^"]+)"', block)
            if name and ident and name.group(1) == db_name:
                return ident.group(1)
        return ""

    @property
    def can_write(self):
        return bool(self.account and self.token and self.db)

    def query(self, sql):
        url = f"https://api.cloudflare.com/client/v4/accounts/{self.account}/d1/database/{self.db}/query"
        res = http_json(url, {"sql": sql}, {"Authorization": f"Bearer {self.token}"})
        if not res.get("success"):
            raise RuntimeError(f"D1 error: {res.get('errors')}")
        return res["result"]


OPTIONAL_COLS = ("registry_status", "has_agch_any", "permits_category")   # עמודות שנוספו במיגרציות (0002 / 0022 / 0019)


def load_businesses(d1):
    cols = "id, chp_number, permit_name, registrar_name, entity_type, biz_type, tase_has_agch, notes"
    if d1.can_write:   # מקור אמת: D1 עצמו
        try:
            have = {r["name"] for r in d1.query("PRAGMA table_info(businesses)")[0]["results"]}
        except (RuntimeError, KeyError, IndexError):
            have = {"registry_status"}
        extra = [c for c in OPTIONAL_COLS if c in have]
        for c in OPTIONAL_COLS:
            if c not in extra:
                print(f"WARNING: column {c} missing in D1 - it will not be updated", file=sys.stderr)
        try:
            rows = d1.query(f"SELECT {', '.join([cols] + extra)} FROM businesses WHERE chp_number IS NOT NULL AND chp_number != ''")[0]["results"]
        except RuntimeError as e:
            if "no such column" not in str(e):
                raise
            rows = d1.query(f"SELECT {cols} FROM businesses WHERE chp_number IS NOT NULL AND chp_number != ''")[0]["results"]
        return rows, "d1"
    rows = http_json(f"{SITE}/api/businesses")   # GET ציבורי — מספיק לבדיקה
    return [r for r in rows if str(r.get("chp_number") or "").strip()], "public_api"


# ── data.gov.il ──────────────────────────────────────────────────────────────
def _records_to_found(records, source, found):
    for rec in records or []:
        try:
            key = str(int(float(rec.get(source["id"]))))
        except (TypeError, ValueError):
            continue
        name = clean_name(rec.get(source["name"]))
        if name:
            status = str(rec.get(source.get("status") or "") or "").replace("~", '"').strip()
            found[key] = {"name": name, "biz_type": classify(source, rec), "status": status}


def fetch_source(numbers, source):
    """-> ({מספר: {name, biz_type}}, batches_failed).
    בקשה אחת לכל באץ' (filters עם רשימת מספרים = IN). אם נכשלה — שליפה בודדת לכל מספר, כמו ב-Worker."""
    found, failed = {}, 0
    fields = [source["id"], source["name"]] + source["extra"] + ([source["status"]] if source.get("status") else [])
    for i in range(0, len(numbers), BATCH):
        batch = numbers[i:i + BATCH]
        try:
            res = http_json(GOV_SEARCH, {"resource_id": source["resource"], "fields": fields, "limit": len(batch) + 50,
                                          "filters": {source["id"]: [int(n) for n in batch]}})
            if not res.get("success", True):
                raise RuntimeError(str(res.get("error"))[:100])
            _records_to_found((res.get("result") or {}).get("records"), source, found)
        except RuntimeError as e:
            failed += 1
            print(f"WARNING: {source['kind']} batch {i // BATCH} failed ({e}) - falling back to single lookups",
                  file=sys.stderr)
            for n in batch:
                try:
                    q = urllib.parse.quote(json.dumps({source["id"]: int(n)}))
                    one = http_json(f"{GOV_SEARCH}?resource_id={source['resource']}&filters={q}&limit=1")
                    _records_to_found((one.get("result") or {}).get("records"), source, found)
                except RuntimeError:
                    pass
                time.sleep(0.5)
        time.sleep(1)
    return found, failed


# אגודות שיתופיות, מפלגות, אגודות עות'מאניות והקדשות: לא באחד משלושת הרשמים של data.gov.il שלמעלה אלא בטבלת associations ב-company-info-db (נטענות שם ע"י
# load_cooperatives.py / load_parties.py ב-Revach). סוג העסק זהה ל-functions/api/lookup.js (מה שנקבע בהוספת עסק חדש).
LOCAL_BIZ_TYPES = {"אגודה שיתופית": "אגודה שיתופית רשומה", "מפלגה": "מפלגה רשומה",
                   "אגודה עות'מאנית": "אגודה עות'מאנית רשומה", "הקדש ציבורי": "הקדש ציבורי רשום"}


def fetch_local_registry(numbers):
    """-> {מספר: {name, biz_type, status}} למספרים שאינם בשלושת הרשמים של data.gov.il, מ-company-info-db (בלי DB/סודות: ריק + אזהרה)."""
    out = {}
    if not numbers:
        return out
    db = D1("company-info-db")
    if not db.can_write:
        print("WARNING: no CF secrets / company-info-db id - cooperatives, parties, Ottoman and hekdeshot are not refreshed", file=sys.stderr)
        return out
    cats = ",".join(sql_q(c) for c in LOCAL_BIZ_TYPES)
    for i in range(0, len(numbers), 90):
        ids = ",".join(str(int(n)) for n in numbers[i:i + 90])
        rows = db.query(f"SELECT id, name, status, category FROM associations WHERE id IN ({ids}) AND category IN ({cats})")[0]["results"]
        for r in rows:
            name = clean_name(r.get("name"))
            if name:
                # סטטוס ברשם: כמו שהוא בטבלה (אגודה שיתופית: פעילה / בפירוק / מחוקה (סגורה); הקדש: פעיל; לעות'מאנית ולמפלגה אין סטטוס בנתונים)
                out[str(int(r["id"]))] = {"name": name, "biz_type": LOCAL_BIZ_TYPES[r["category"]], "status": str(r.get("status") or "")}
    return out


def numeric_chp(v):
    s = str(v or "").strip()
    return str(int(s)) if s.isdigit() else None


# ── datawise ─────────────────────────────────────────────────────────────────
def datawise_key():
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


def load_maya_companies():
    """data/bonds_list/maya_companies.json (סריקת מאיה השבועית) -> ({מספר תאגיד מנורמל: שם}, {מזהה בורסה של חברה בלי מספר תאגיד: שם}, {מזהה בורסה: מספר תאגיד}).
    חברות שאינן ברשם הישראלי (זרות / חוץ-בורסאיות): השם מגיע מכאן. קובץ חסר = ריק."""
    by_chp, by_id_nochp, chp_by_id, shorts = {}, {}, {}, set()
    try:
        with open(os.path.join(ROOT, "data", "bonds_list", "maya_companies.json"), encoding="utf-8") as fh:
            for c in json.load(fh).get("companies", []):
                name = str(c.get("name") or "").strip()
                if c.get("short"):
                    shorts.add(str(c["short"]).strip())
                if c.get("chp"):
                    chp_by_id[str(c["id"])] = maya_key(c["chp"])
                    if name:
                        by_chp[maya_key(c["chp"])] = name
                elif name:
                    by_id_nochp[str(c["id"])] = name
    except (OSError, ValueError):
        print("WARNING: maya_companies.json missing - no names from Maya", file=sys.stderr)
    return by_chp, by_id_nochp, chp_by_id, shorts


def maya_key(v):
    return re.sub(r"^0+(?=\d)", "", str(v or "").strip())


def fetch_bond_corporate_ids():
    """ח"פים עם אג"ח *סחירה* (datawise כולל רק ניירות סחירים), כולל ני"ע מסחריים."""
    headers = {"accept": "application/json", "accept-language": "he-IL", "apikey": datawise_key()}
    types = {str(t["securityFullTypeCode"]): t.get("securityTypeDesc") or "" for t in
             http_json(f"{DATAWISE}/v1/basic-securities/securities-types", headers=headers)["securitiesTypes"]["result"]}
    for d in range(8):
        dt = datetime.date.today() - datetime.timedelta(days=d)
        res = http_json(f"{DATAWISE}/v1/basic-securities/trade-securities-list/{dt:%Y/%m/%d}", headers=headers)
        rows = (res.get("tradeSecuritiesList") or {}).get("result") or []
        if rows:
            ids = {str(r.get("corporateId") or "").strip() for r in rows
                   if str(r.get("securityFullTypeCode") or "")[:2] in BOND_TYPE_PREFIXES
                   }
            ids.discard("")
            ids.discard("0")
            # חברה בלי מספר תאגיד בנתוני הבורסה: לפי מספר המנפיק (issuerId) או מספר התאגיד שלו במאיה
            _, _, chp_by_id, _ = load_maya_companies()
            for r in rows:
                if str(r.get("securityFullTypeCode") or "")[:2] in BOND_TYPE_PREFIXES and str(r.get("corporateId") or "").strip() in ("", "0") \
                        and r.get("issuerId") not in (None, ""):
                    iid = str(int(r["issuerId"]))
                    ids.add(chp_by_id.get(iid) or iid)
            return ids, len(rows), str(dt)
    return None, 0, None


BOND_PCAT = 'חברות מנפיקות אג"ח'


def load_any_bond_chps():
    """ח"פים עם אג"ח שאינם בדגל הסחירות: ברשימת האג"ח (bonds_all) או עם אג"ח לא סחירה פעילה. קובץ חסר = מדלגים עליו."""
    base, out = os.path.join(ROOT, "data", "bonds_list"), set()
    for name, get in (("bonds_all.json", lambda d: [r.get("chp_number") for r in d.get("rows") or []]),
                      ("nontradable_chps.json", lambda d: d.get("chps") or []),
                      ("bonds_institutional.json", lambda d: [r.get("chp_number") for r in d.get("rows") or []])):
        try:
            with open(os.path.join(base, name), encoding="utf-8") as fh:
                out |= {str(c or "").strip() for c in get(json.load(fh))}
        except (OSError, ValueError, AttributeError):
            print(f"WARNING: {name} missing - has_agch_any computed without it", file=sys.stderr)
    out.discard("")
    return out


def with_bond_pcat(value, has):
    """כמו withBondPcat ב-functions/api/_shared/bond-pcat.js: מוסיף/מסיר את הקטגוריה; בלי קטגוריה = "שונות"."""
    cur = [x.strip() for x in str(value or "").split("|")]
    cur = [x for x in cur if x and x != "שונות" and (has or x != BOND_PCAT)]   # הסדר הקיים נשמר
    if has and BOND_PCAT not in cur:
        cur.append(BOND_PCAT)
    return "|".join(cur) if cur else "שונות"


ASSOC_PCAT, BIZ_PCAT, OLD_BIZ_PCAT = "עמותות", "עסקים", "חנויות ומוסדות"


def is_association(b):
    """כמו isAssociation ב-functions/api/_shared/assoc-pcat.js."""
    name = f"{b.get('permit_name') or ''} {b.get('registrar_name') or ''}"
    return bool(re.fullmatch(r"58\d{7}", re.sub(r"\D", "", str(b.get("chp_number") or "")))
                or b.get("entity_type") == "association" or "עמותה" in str(b.get("biz_type") or "")
                or re.search(r"\(\s*ע[\"״']?ר\s*\)", name) or "עמותה" in str(b.get("notes") or ""))


def with_assoc_pcat(value, b):
    """כמו withAssocPcat ב-functions/api/_shared/assoc-pcat.js: "חנויות ומוסדות" -> "עסקים"; עמותה בלי קטגוריה
    שנבחרה (ריק / "שונות") -> "עמותות". קטגוריה שנבחרה ידנית לא נדרסת."""
    cur = []
    for x in (x.strip() for x in str(value or "").split("|")):
        x = BIZ_PCAT if x == OLD_BIZ_PCAT else x
        if x and x not in cur:
            cur.append(x)
    chosen = [x for x in cur if x not in ("שונות", BOND_PCAT)]
    if not chosen and is_association(b):
        cur = [ASSOC_PCAT] + [x for x in cur if x != "שונות"]
    cur = [x for x in cur if x != "שונות"]
    return "|".join(cur) if cur else "שונות"


# ── חישוב השינויים ───────────────────────────────────────────────────────────
def is_liquidated(status):
    return str(status or "").startswith(("מחוסל", "חיסול", "מחוק", "נגרע"))


def compute_changes(businesses, registry, bond_ids, any_extra=frozenset(), maya=None):
    changes = []
    maya_chp, maya_nochp, _, maya_shorts = maya or ({}, {}, {}, set())
    for b in businesses:
        key = numeric_chp(b.get("chp_number"))
        info = registry.get(key) if key else None
        if info:
            if "registry_status" in b and info.get("status") and info["status"] != (b.get("registry_status") or "").strip():
                changes.append({"id": b["id"], "chp": b["chp_number"], "field": "registry_status",
                                "old": b.get("registry_status"), "new": info["status"]})
            if info["name"] != (b.get("registrar_name") or "").strip():
                changes.append({"id": b["id"], "chp": b["chp_number"], "field": "registrar_name",
                                "old": b.get("registrar_name"), "new": info["name"]})
            if info["biz_type"] != (b.get("biz_type") or "").strip():
                changes.append({"id": b["id"], "chp": b["chp_number"], "field": "biz_type",
                                "old": b.get("biz_type"), "new": info["biz_type"]})
        if not info:          # לא ברשם הישראלי: השם מרשימת החברות של מאיה (חברה זרה / חוץ-בורסאית) - גם בעדכונים מאוחרים
            mk = maya_key(b.get("chp_number"))
            mname = maya_chp.get(mk) or maya_nochp.get(mk) if mk else ""
            old_reg = (b.get("registrar_name") or "").strip()
            if mname and mname != old_reg:
                changes.append({"id": b["id"], "chp": b["chp_number"], "field": "registrar_name",
                                "old": b.get("registrar_name"), "new": mname})
                # השם שהוקלד ידנית (למשל באנגלית) לא הולך לאיבוד: נשמר כ"שם בהיתר עיסקא" אם אין שם בהיתר
                if old_reg and old_reg not in maya_shorts and not (b.get("permit_name") or "").strip():
                    changes.append({"id": b["id"], "chp": b["chp_number"], "field": "permit_name",
                                    "old": b.get("permit_name"), "new": old_reg})
        if bond_ids is not None:
            has = "יש" if str(b.get("chp_number") or "").strip() in bond_ids else "אין"
            if has != (b.get("tase_has_agch") or "").strip():
                changes.append({"id": b["id"], "chp": b["chp_number"], "field": "tase_has_agch",
                                "old": b.get("tase_has_agch"), "new": has})
            any_has = has == "יש" or str(b.get("chp_number") or "").strip() in any_extra   # יש אג"ח כולל לא סחיר
            if "has_agch_any" in b and ("יש" if any_has else "אין") != (b.get("has_agch_any") or "").strip():
                changes.append({"id": b["id"], "chp": b["chp_number"], "field": "has_agch_any",
                                "old": b.get("has_agch_any"), "new": "יש" if any_has else "אין"})
            if "permits_category" in b:
                b["_pc"] = with_bond_pcat(b.get("permits_category"), any_has)
        # קטגוריה: "חברות מנפיקות אג"ח" (למעלה, כשיש נתוני אג"ח) ואז "עמותות"/"עסקים" (assoc-pcat.js) - שינוי אחד
        if "permits_category" in b:
            pc = with_assoc_pcat(b.pop("_pc", b.get("permits_category")), b)
            if pc != (b.get("permits_category") or ""):
                changes.append({"id": b["id"], "chp": b["chp_number"], "field": "permits_category",
                                "old": b.get("permits_category"), "new": pc})
    return changes


def build_update_sql(changes):
    by_id = {}
    for c in changes:
        by_id.setdefault(c["id"], {})[c["field"]] = c["new"]
    stmts = []
    for biz_id, fields in by_id.items():
        sets = ", ".join(f"{f} = {sql_q(v)}" for f, v in fields.items())
        stmts.append(f"UPDATE businesses SET {sets}, updated_at = datetime('now') WHERE id = {sql_q(biz_id)};")
    return stmts


def apply_updates(d1, stmts, max_bytes=60000):
    chunk, size, sent = [], 0, 0
    for s in stmts:
        if chunk and size + len(s) > max_bytes:
            d1.query("\n".join(chunk)); sent += len(chunk); chunk, size = [], 0
        chunk.append(s); size += len(s) + 1
    if chunk:
        d1.query("\n".join(chunk)); sent += len(chunk)
    if sent:
        # מונה הגרסה של רשימת העסקים (app_meta) - כך דף הניהול הפתוח יודע לטעון מחדש (ר' _shared/data-version.js)
        d1.query("CREATE TABLE IF NOT EXISTS app_meta (k TEXT PRIMARY KEY, v INTEGER NOT NULL DEFAULT 0);\n"
                 "INSERT INTO app_meta (k, v) VALUES ('biz', 1) ON CONFLICT(k) DO UPDATE SET v = v + 1;")
    return sent


# ── main ─────────────────────────────────────────────────────────────────────
def main(apply=False, scope="all"):
    do_names = scope in ("all", "names")
    do_bonds = scope in ("all", "bonds")
    report = REPORT if scope == "all" else REPORT.replace("last_run.json", f"last_run_{scope}.json")
    rollback_name = "rollback.sql" if scope == "all" else f"rollback_{scope}.sql"
    d1 = D1()
    businesses, source = load_businesses(d1)
    numerics = sorted({numeric_chp(b["chp_number"]) for b in businesses if numeric_chp(b["chp_number"])}, key=int)
    print(f"businesses with chp: {len(businesses)} (numeric ח\"פ: {len(numerics)}) from {source}")

    registry, failed_batches = {}, 0
    unfound, recovered = [], 0
    if do_names:
        for src in SOURCES:    # עדיפות: ראשון מנצח
            got, failed = fetch_source(numerics, src)
            failed_batches += failed
            for k, v in got.items():
                registry.setdefault(k, v)
            print(f"  {src['kind']}: {len(got)} found, {failed} failed batches")
        # הזדמנות שנייה (זהה ללוגיקה של ה-Worker): שליפה בודדת לכל ח"פ שהבאץ' לא מצא — כדי לוודא שהשיטה
        # החדשה לא מחמיצה עסקים שהישנה כן הייתה מוצאת.
        unfound = [n for n in numerics if n not in registry]
        recovered = 0
        for n in unfound:
            for src in SOURCES:
                try:
                    q = urllib.parse.quote(json.dumps({src["id"]: str(n)}))
                    one = http_json(f"{GOV_SEARCH}?resource_id={src['resource']}&filters={q}&limit=1")
                except RuntimeError:
                    continue
                tmp = {}
                _records_to_found((one.get("result") or {}).get("records"), src, tmp)
                if tmp:
                    registry.setdefault(n, next(iter(tmp.values())))
                    recovered += 1
                    break
                time.sleep(0.3)
        print(f"  second-chance single lookups: {len(unfound)} tried, {recovered} recovered")
        try:
            local = fetch_local_registry([n for n in numerics if n not in registry])
        except RuntimeError as e:
            local = {}
            print(f"WARNING: local registry (cooperatives/parties) failed: {e}", file=sys.stderr)
        for k, v in local.items():
            registry.setdefault(k, v)
        print(f"  cooperatives / parties / Ottoman / hekdeshot (company-info-db): {len(local)} found")
    found_ratio = len(registry) / len(numerics) if numerics else 0

    bond_ids, dw_rows, dw_date = None, 0, None
    if do_bonds:
        try:
            bond_ids, dw_rows, dw_date = fetch_bond_corporate_ids()
        except RuntimeError as e:
            print(f"WARNING: datawise unavailable: {e}", file=sys.stderr)
        if bond_ids is not None and dw_rows < MIN_DATAWISE_ROWS:
            print(f"WARNING: datawise list too small ({dw_rows}) - skipping tase_has_agch", file=sys.stderr)
            bond_ids = None
    if scope == "bonds" and bond_ids is None:
        sys.exit("datawise unavailable or too small - nothing was updated")

    changes = compute_changes(businesses, registry, bond_ids, load_any_bond_chps() if bond_ids is not None else frozenset(), load_maya_companies())
    not_found = [{"id": b["id"], "chp": b["chp_number"], "permit_name": b.get("permit_name"),
                  "registrar_name": b.get("registrar_name"), "entity_type": b.get("entity_type"),
                  "biz_type": b.get("biz_type")}
                 for b in businesses
                 if numeric_chp(b.get("chp_number")) and numeric_chp(b["chp_number"]) not in registry]
    if not do_names:
        not_found = []
    non_numeric = [{"id": b["id"], "chp": b["chp_number"], "permit_name": b.get("permit_name")}
                   for b in businesses if not numeric_chp(b.get("chp_number"))]
    # הגנה: סופרים רק *דריסה* של שם קיים. מילוי שם ריק לא נחשב (זה בדיוק מה שאמור לקרות)
    name_changes = sum(1 for c in changes if c["field"] == "registrar_name" and (c["old"] or "").strip())
    lost = sum(1 for c in changes if (c["old"] or "").strip() and not (c["new"] or "").strip())
    def _empty(field):
        return sum(1 for b in businesses if not (b.get(field) or "").strip())
    filled = {f: sum(1 for c in changes if c["field"] == f and not (c["old"] or "").strip())
              for f in ("registrar_name", "biz_type")}
    status_counts = {}
    for b in businesses:
        key = numeric_chp(b.get("chp_number"))
        st = ((registry.get(key) or {}).get("status") if key else None) or (b.get("registry_status") or "")
        label = "מחוסלת/חיסול" if is_liquidated(st) else ("בפירוק" if st.startswith("בפרוק") else ("פעילה" if st else "לא ידוע"))
        status_counts[label] = status_counts.get(label, 0) + 1
    newly_liquidated = sum(1 for c in changes if c["field"] == "registry_status" and (c["old"] or "").strip()
                           and not is_liquidated(c["old"]) and is_liquidated(c["new"]))
    summary = {
        "scope": scope, "recovered_by_single_lookup": recovered, "unfound_after_batch": len(unfound),
        "values_lost": lost,
        "empty_before": {f: _empty(f) for f in ("registrar_name", "biz_type")},
        "empty_after": {f: _empty(f) - filled[f] for f in ("registrar_name", "biz_type")},
        "updated": datetime.datetime.utcnow().isoformat() + "Z", "source": source,
        "businesses": len(businesses), "numeric_chp": len(numerics),
        "found_in_registry": len(registry), "found_ratio": round(found_ratio, 3),
        "failed_batches": failed_batches, "datawise_rows": dw_rows, "datawise_date": dw_date,
        "bond_companies": None if bond_ids is None else len(bond_ids),
        "changes": {f: sum(1 for c in changes if c["field"] == f)
                    for f in ("registrar_name", "biz_type", "tase_has_agch", "registry_status", "has_agch_any", "permits_category")},
        "fills_of_empty": {f: sum(1 for c in changes if c["field"] == f and not (c["old"] or "").strip())
                           for f in ("registrar_name", "biz_type", "tase_has_agch", "registry_status", "has_agch_any", "permits_category")},
        "registry_status_counts": status_counts,
    }

    problems = []
    if lost:
        problems.append(f"{lost} existing values would be blanked")
    if do_names and numerics and found_ratio < MIN_FOUND_RATIO:
        problems.append(f"registry found ratio {found_ratio:.2f} < {MIN_FOUND_RATIO}")
    # הגנה: חברות שהיו מוצגות והפכו פתאום למחוסלות (נעלמות מהרשימות) - מעל סף חריג עוצרות את הכתיבה.
    if newly_liquidated > max(10, 0.03 * len(businesses)):
        problems.append(f"too many businesses became liquidated ({newly_liquidated})")
    if name_changes > max(MAX_NAME_CHANGE_ABS, MAX_NAME_CHANGE_PCT * len(businesses)):
        problems.append(f"too many name overwrites ({name_changes})")

    mode = "dry-run"
    applied = 0
    if apply and d1.can_write and not problems:
        old_by_id = {}
        for c in changes:
            old_by_id.setdefault(c["id"], {})[c["field"]] = c["old"]
        rollback = [f"UPDATE businesses SET " + ", ".join(f"{f} = {sql_q(v)}" for f, v in fl.items())
                    + f" WHERE id = {sql_q(i)};" for i, fl in old_by_id.items()]
        os.makedirs(os.path.dirname(report), exist_ok=True)
        with open(os.path.join(os.path.dirname(report), rollback_name), "w", encoding="utf-8") as f:
            f.write("\n".join(rollback))
        applied = apply_updates(d1, build_update_sql(changes))
        mode = "applied"
        # אימות קריאה-חוזרת: כל ערך חדש נמצא ב-D1
        status_col = "".join(f", {c}" for c in OPTIONAL_COLS if any(c in b for b in businesses))
        after = {r["id"]: r for r in d1.query(f"SELECT id, registrar_name, biz_type, tase_has_agch{status_col} FROM businesses")[0]["results"]}
        bad = [c for c in changes if (after.get(c["id"], {}).get(c["field"]) or "") != (c["new"] or "")]
        summary["readback_mismatches"] = len(bad)
        if bad:
            problems.append(f"{len(bad)} values did not persist after write")
    elif apply and not d1.can_write:
        mode = "dry-run (no CF secrets)"
    elif apply and problems:
        mode = "blocked by guards"
    summary.update({"mode": mode, "statements_applied": applied, "problems": problems})

    os.makedirs(os.path.dirname(report), exist_ok=True)
    with open(report, "w", encoding="utf-8") as f:
        json.dump({"summary": summary, "changes": changes[:3000], "not_found": not_found,
                   "non_numeric_chp": non_numeric}, f, ensure_ascii=False, indent=1)
    print(json.dumps(summary, ensure_ascii=False))
    if problems:
        sys.exit("guards failed: " + "; ".join(problems))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="כתיבה ל-D1 (דורש סודות Cloudflare)")
    ap.add_argument("--scope", choices=("all", "bonds", "names"), default="all",
                    help="all = הכול (ברירת מחדל); bonds = דגל אג\"ח בלבד (קצר); names = שם וסוג בלבד")
    args = ap.parse_args()
    main(args.apply, args.scope)
