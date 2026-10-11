# -*- coding: utf-8 -*-
"""
scripts/registry_refresh/refresh_businesses.py

מחליף את ה-Worker "registry-updater" (ר' archive/registry-updater-worker.js) בריצה ב-GitHub Actions.
עושה את אותן שתי עבודות על טבלת businesses ב-D1 (business-registry-db):

  1. שם רשמי + סוג עסק: לכל עסק עם ח"פ מספרי — שליפה מ-data.gov.il (חברות / שותפויות / עמותות)
     בבאצ'ים (datastore_search עם רשימת מספרים בפילטר; datastore_search_sql כבר מחזיר 404), לא בקשה לעסק.
     עדיפות: חברה > שותפות > עמותה (כמו ב-Worker). מעדכן registrar_name ו-biz_type כשהשתנו.
  2. דגל tase_has_agch ("יש"/"אין"): לפי רשימת ניירות הערך של datawise (Securities Basic) — האם לח"פ
     יש אג"ח (קוד סוג 03/05/11/36), כמו sync-tase.js וה-Worker.

מצבים:
  * ברירת מחדל = בדיקה בלבד (dry-run): לא כותב כלום ל-D1, רק מחשב ושומר דוח.
  * --apply: כותב ל-D1. דורש CF_ACCOUNT_ID + CF_D1_TOKEN (+ CF_DATABASE_ID, ברירת מחדל מ-wrangler.toml).
    בלי הסודות — נשאר dry-run גם אם ביקשו --apply.

הגנות לפני כתיבה (עוצרות בלי לשנות כלום):
  * data.gov.il החזיר פחות מ-85% מהח"פים המספריים (חסימה/הגבלה).
  * דריסה של שם קיים ביותר מ-15% מהעסקים (לפחות 50) — כנראה נתונים שגויים. מילוי שם ריק לא נספר.
  * רשימת datawise קטנה מ-1000 ניירות.
לא נכתב שום דבר עבור עסק שלא נמצא (כמו ב-Worker). לא נמחק כלום.

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
     "id": "מספר חברה", "name": "שם חברה", "extra": ["סוג תאגיד", "מגבלות"]},
    {"kind": "partnership", "resource": "139aa193-fabb-4f6b-a71b-0bb40fd73eb2",
     "id": "מספר שותפות", "name": "שם שותפות", "extra": []},
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
    def __init__(self):
        self.account = os.environ.get("CF_ACCOUNT_ID", "")
        self.token = os.environ.get("CF_D1_TOKEN", "")
        self.db = os.environ.get("CF_DATABASE_ID") or self._db_from_wrangler()

    @staticmethod
    def _db_from_wrangler():
        try:
            with open(os.path.join(ROOT, "wrangler.toml"), encoding="utf-8") as f:
                m = re.search(r'database_id\s*=\s*"([^"]+)"', f.read())
            return m.group(1) if m else ""
        except OSError:
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


def load_businesses(d1):
    cols = "id, chp_number, permit_name, registrar_name, entity_type, biz_type, tase_has_agch"
    if d1.can_write:   # מקור אמת: D1 עצמו
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
            found[key] = {"name": name, "biz_type": classify(source, rec)}


def fetch_source(numbers, source):
    """-> ({מספר: {name, biz_type}}, batches_failed).
    בקשה אחת לכל באץ' (filters עם רשימת מספרים = IN). אם נכשלה — שליפה בודדת לכל מספר, כמו ב-Worker."""
    found, failed = {}, 0
    fields = [source["id"], source["name"]] + source["extra"]
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


def numeric_chp(v):
    s = str(v or "").strip()
    return str(int(s)) if s.isdigit() else None


# ── datawise ─────────────────────────────────────────────────────────────────
def datawise_key():
    key = os.environ.get("TASE_DATAWISE_KEY")
    if key:
        return key
    try:   # ברירת מחדל: המפתח שכבר קיים ב-functions/api/sync-tase.js (בלי עותק נוסף)
        with open(os.path.join(ROOT, "functions", "api", "sync-tase.js"), encoding="utf-8") as f:
            m = re.search(r'TASE_KEY\s*=\s*"([^"]+)"', f.read())
        return m.group(1) if m else ""
    except OSError:
        return ""


def fetch_bond_corporate_ids():
    headers = {"accept": "application/json", "accept-language": "he-IL", "apikey": datawise_key()}
    for d in range(8):
        dt = datetime.date.today() - datetime.timedelta(days=d)
        res = http_json(f"{DATAWISE}/v1/basic-securities/trade-securities-list/{dt:%Y/%m/%d}", headers=headers)
        rows = (res.get("tradeSecuritiesList") or {}).get("result") or []
        if rows:
            ids = {str(r.get("corporateId") or "").strip() for r in rows
                   if str(r.get("securityFullTypeCode") or "")[:2] in BOND_TYPE_PREFIXES}
            ids.discard("")
            return ids, len(rows), str(dt)
    return None, 0, None


# ── חישוב השינויים ───────────────────────────────────────────────────────────
def compute_changes(businesses, registry, bond_ids):
    changes = []
    for b in businesses:
        key = numeric_chp(b.get("chp_number"))
        info = registry.get(key) if key else None
        if info:
            if info["name"] != (b.get("registrar_name") or "").strip():
                changes.append({"id": b["id"], "chp": b["chp_number"], "field": "registrar_name",
                                "old": b.get("registrar_name"), "new": info["name"]})
            if info["biz_type"] != (b.get("biz_type") or "").strip():
                changes.append({"id": b["id"], "chp": b["chp_number"], "field": "biz_type",
                                "old": b.get("biz_type"), "new": info["biz_type"]})
        if bond_ids is not None:
            has = "יש" if str(b.get("chp_number") or "").strip() in bond_ids else "אין"
            if has != (b.get("tase_has_agch") or "").strip():
                changes.append({"id": b["id"], "chp": b["chp_number"], "field": "tase_has_agch",
                                "old": b.get("tase_has_agch"), "new": has})
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
    return sent


# ── main ─────────────────────────────────────────────────────────────────────
def main(apply=False):
    d1 = D1()
    businesses, source = load_businesses(d1)
    numerics = sorted({numeric_chp(b["chp_number"]) for b in businesses if numeric_chp(b["chp_number"])}, key=int)
    print(f"businesses with chp: {len(businesses)} (numeric ח\"פ: {len(numerics)}) from {source}")

    registry, failed_batches = {}, 0
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
    found_ratio = len(registry) / len(numerics) if numerics else 0

    bond_ids, dw_rows, dw_date = None, 0, None
    try:
        bond_ids, dw_rows, dw_date = fetch_bond_corporate_ids()
    except RuntimeError as e:
        print(f"WARNING: datawise unavailable: {e}", file=sys.stderr)
    if bond_ids is not None and dw_rows < MIN_DATAWISE_ROWS:
        print(f"WARNING: datawise list too small ({dw_rows}) - skipping tase_has_agch", file=sys.stderr)
        bond_ids = None

    changes = compute_changes(businesses, registry, bond_ids)
    not_found = [{"id": b["id"], "chp": b["chp_number"], "permit_name": b.get("permit_name"),
                  "registrar_name": b.get("registrar_name"), "entity_type": b.get("entity_type"),
                  "biz_type": b.get("biz_type")}
                 for b in businesses
                 if numeric_chp(b.get("chp_number")) and numeric_chp(b["chp_number"]) not in registry]
    non_numeric = [{"id": b["id"], "chp": b["chp_number"], "permit_name": b.get("permit_name")}
                   for b in businesses if not numeric_chp(b.get("chp_number"))]
    # הגנה: סופרים רק *דריסה* של שם קיים. מילוי שם ריק לא נחשב (זה בדיוק מה שאמור לקרות)
    name_changes = sum(1 for c in changes if c["field"] == "registrar_name" and (c["old"] or "").strip())
    lost = sum(1 for c in changes if (c["old"] or "").strip() and not (c["new"] or "").strip())
    def _empty(field):
        return sum(1 for b in businesses if not (b.get(field) or "").strip())
    filled = {f: sum(1 for c in changes if c["field"] == f and not (c["old"] or "").strip())
              for f in ("registrar_name", "biz_type")}
    summary = {
        "recovered_by_single_lookup": recovered, "unfound_after_batch": len(unfound),
        "values_lost": lost,
        "empty_before": {f: _empty(f) for f in ("registrar_name", "biz_type")},
        "empty_after": {f: _empty(f) - filled[f] for f in ("registrar_name", "biz_type")},
        "updated": datetime.datetime.utcnow().isoformat() + "Z", "source": source,
        "businesses": len(businesses), "numeric_chp": len(numerics),
        "found_in_registry": len(registry), "found_ratio": round(found_ratio, 3),
        "failed_batches": failed_batches, "datawise_rows": dw_rows, "datawise_date": dw_date,
        "bond_companies": None if bond_ids is None else len(bond_ids),
        "changes": {f: sum(1 for c in changes if c["field"] == f)
                    for f in ("registrar_name", "biz_type", "tase_has_agch")},
        "fills_of_empty": {f: sum(1 for c in changes if c["field"] == f and not (c["old"] or "").strip())
                           for f in ("registrar_name", "biz_type", "tase_has_agch")},
    }

    problems = []
    if lost:
        problems.append(f"{lost} existing values would be blanked")
    if numerics and found_ratio < MIN_FOUND_RATIO:
        problems.append(f"registry found ratio {found_ratio:.2f} < {MIN_FOUND_RATIO}")
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
        os.makedirs(os.path.dirname(REPORT), exist_ok=True)
        with open(os.path.join(os.path.dirname(REPORT), "rollback.sql"), "w", encoding="utf-8") as f:
            f.write("\n".join(rollback))
        applied = apply_updates(d1, build_update_sql(changes))
        mode = "applied"
        # אימות קריאה-חוזרת: כל ערך חדש נמצא ב-D1
        after = {r["id"]: r for r in d1.query("SELECT id, registrar_name, biz_type, tase_has_agch FROM businesses")[0]["results"]}
        bad = [c for c in changes if (after.get(c["id"], {}).get(c["field"]) or "") != (c["new"] or "")]
        summary["readback_mismatches"] = len(bad)
        if bad:
            problems.append(f"{len(bad)} values did not persist after write")
    elif apply and not d1.can_write:
        mode = "dry-run (no CF secrets)"
    elif apply and problems:
        mode = "blocked by guards"
    summary.update({"mode": mode, "statements_applied": applied, "problems": problems})

    os.makedirs(os.path.dirname(REPORT), exist_ok=True)
    with open(REPORT, "w", encoding="utf-8") as f:
        json.dump({"summary": summary, "changes": changes[:3000], "not_found": not_found,
                   "non_numeric_chp": non_numeric}, f, ensure_ascii=False, indent=1)
    print(json.dumps(summary, ensure_ascii=False))
    if problems:
        sys.exit("guards failed: " + "; ".join(problems))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="כתיבה ל-D1 (דורש סודות Cloudflare)")
    main(ap.parse_args().apply)
