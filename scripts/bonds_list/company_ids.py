# -*- coding: utf-8 -*-
"""
מפת מזהי חברות במאיה: ח.פ. -> מזהה החברה במאיה (company id), בנויה מסריקת דפי החברה במאיה (מזהה 1 עד MAYA_MAX_ID),
עם חילוץ ה-ח.פ. (corporateNo) מכל דף. נשמרת ב-data/bonds_list/maya_company_ids.json.
  משמשת את העשרת האג"ח (אירועי חברה לתדירות ריבית ותשואה לפדיון). הבנייה היומית והמהירה קוראות אותה ולא סורקות.
  רצה פעם בשבוע (workflow maya-company-ids), וגם בתוך הבנייה כשהקובץ חסר/ישן, או כשחסר מזהה לחברה עם אג"ח.
  כשל סריקה (חסימה/שגיאות) לא דורס את הקובץ הקודם.
"""
import concurrent.futures
import datetime
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_approved_bonds as b  # noqa: E402

PATH = os.path.join(b.OUT, "maya_company_ids.json")
MAX_AGE_DAYS = 8
MIN_FOUND = 1000          # מתחת לזה הסריקה נחשבת חלקית/חסומה
EDGE_WARN = 0.95          # מזהה מקסימלי קרוב לגבול הסריקה = ייתכנו חברות מעבר לגבול


def scan(max_id=None, fetch=None):
    """-> ({ח"פ: מזהה}, מזהה מקסימלי שנמצא, שגיאות)."""
    max_id = max_id or b.MAX_ID
    fetch = fetch or b.fetch_company
    ids, top, errors = {}, 0, 0
    with concurrent.futures.ThreadPoolExecutor(b.WORKERS) as ex:
        for cid, body in ex.map(fetch, range(1, max_id + 1)):
            if body == "error":
                errors += 1
                continue
            if not body:
                continue
            top = max(top, cid)
            k = b.chp_norm(body.get("corporateNo"))
            if k:
                ids.setdefault(k, cid)
    return ids, top, errors


def load():
    if not os.path.exists(PATH):
        return None
    with open(PATH, encoding="utf-8") as f:
        return json.load(f)


def is_fresh(data, today=None):
    if not data or not data.get("ids"):
        return False
    today = today or datetime.date.today()
    try:
        return (today - datetime.date.fromisoformat(data["updated"])).days <= MAX_AGE_DAYS
    except (KeyError, ValueError):
        return False


def refresh(max_id=None, fetch=None):
    """סורק ושומר. מחזיר את המפה החדשה, או את הקודמת (או None) אם הסריקה נכשלה."""
    ids, top, errors = scan(max_id, fetch)
    old = load()
    if len(ids) < MIN_FOUND:
        print(f"company ids: scan looks partial ({len(ids)} found, {errors} errors) - previous map kept", file=sys.stderr)
        return old
    if old:      # חברה שנעלמה מהסריקה הנוכחית נשארת מהקובץ הקודם (לא מוחקים מזהה בגלל שגיאה נקודתית)
        for k, v in old.get("ids", {}).items():
            ids.setdefault(k, v)
    if top >= (max_id or b.MAX_ID) * EDGE_WARN:
        print(f"WARNING: highest Maya company id found ({top}) is near the scan limit {max_id or b.MAX_ID} - raise MAYA_MAX_ID", file=sys.stderr)
    data = {"updated": datetime.date.today().isoformat(), "max_id_seen": top, "scan_limit": max_id or b.MAX_ID,
            "errors": errors, "ids": dict(sorted(ids.items()))}
    os.makedirs(b.OUT, exist_ok=True)
    with open(PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    print(f"company ids: {len(ids)} companies, highest id {top}, {errors} errors")
    return data


def get_ids(needed=()):
    """המפה לבנייה: טריה וכוללת את כל ה-needed (ח.פ. של חברות עם אג"ח); אחרת מרעננת בסריקה. -> {ח"פ: מזהה}."""
    data = load()
    missing = [k for k in needed if data and k not in data.get("ids", {})]
    if not is_fresh(data) or missing:
        print(f"company ids: refreshing ({'missing/stale' if not is_fresh(data) else str(len(missing)) + ' companies without id'})")
        data = refresh() or data
    return (data or {}).get("ids", {})


if __name__ == "__main__":
    refresh()
