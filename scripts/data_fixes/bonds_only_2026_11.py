# -*- coding: utf-8 -*-
"""
scripts/data_fixes/bonds_only_2026_11.py — עדכון חד-פעמי (נובמבר 2026): הפרדה בין היתר החברה לאישור האג"ח.

חברות שבהערה שלהן כתוב שההיתר הוא לאג"ח בלבד מקבלות visibility = 'רק לאג"ח' (לא ברשימות החברות באתר),
ואישור אג"ח מפורש כך שהאג"ח נשארות באותן רשימות כמו קודם. ועוד שתי החלטות ידניות (גולדן אנרג'י, עלמא יסודות).

הגנה: כל שורה מתעדכנת רק אם הערכים הנוכחיים שלה במסד הם בדיוק הערכים הצפויים (מה שנבדק לפני העדכון);
אחרת היא מדולגת ומדווחת. ברירת מחדל = בדיקה בלבד; --apply כותב (דורש CF_ACCOUNT_ID + CF_D1_TOKEN).
פלט: reports/data_fixes/bonds_only_2026_11.json (+ rollback_bonds_only_2026_11.sql אחרי כתיבה).
"""
import argparse
import datetime
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "registry_refresh"))
from refresh_businesses import D1, sql_q  # noqa: E402

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
OUT = os.path.join(ROOT, "reports", "data_fixes")
BONDS_ONLY, BOTH = 'רק לאג"ח', "פרטי + כללי"

# (id, ח"פ, שם, {שדה: (ערך נוכחי צפוי, ערך חדש)}, סיבה)
FIXES = [
    ("mp64jj1stmpd", "516214871", 'אלומה קרן תשתיות (2020) בע"מ', {"visibility": ("פרטי", BONDS_ONLY), "agch_approved": ("כן", BOTH)}, 'הערה: "לאג"ח בלבד"'),
    ("mp64jndwhikh", "510000813", 'אמפא בע"מ', {"visibility": ("פרטי", BONDS_ONLY), "agch_approved": ("כן", BOTH)}, 'הערה: "רק לאג"ח בלבד"'),
    ("mp64l40sj30k", "520043795", 'מיטב דש השקעות בע"מ', {"visibility": ("פרטי", BONDS_ONLY), "agch_approved": ("כן", BOTH)}, 'הערה: "לאג"ח בלבד - נוסח מהודר"'),
    ("mp64lhq9rlof", "512157603", 'פוקס - ויזל בע"מ', {"visibility": ("פרטי", BONDS_ONLY), "agch_approved": ("כן", BOTH)}, 'הערה: "לאג"ח בלבד"'),
    ("mp64k13m11hr", "520036658", 'בתי זקוק לנפט בע"מ', {"visibility": ("", BONDS_ONLY), "agch_approved": ("כן", "רק כללי")}, 'הערה: "לאג"ח בלבד"'),
    ("mp64izrr2aw3", "511316903", 'כרמל אולפינים בע"מ', {"visibility": ("", BONDS_ONLY), "agch_approved": ("כן", "רק כללי")}, 'הערה: "היתר עיסקא לאג"ח בלבד (היום אין אג"ח)"'),
    ("83f455c80ae6", "512832742", "בי קומיוניקיישנס", {"visibility": ("פרטי", BONDS_ONLY), "agch_approved": ("כן", BOTH)}, 'הערה: "לאג"ח בלבד"'),
    ("mp64k1sky2bc", "520044264", 'גולדן אנרג\'י פאואר בע"מ', {"agch_approved": ("רק פרטי", BOTH)}, "החלטה: לחברה היתר כללי, לאג\"ח גם פרטי"),
    ("mp64lki2okjz", "515116192", 'עלמא יסודות בע"מ', {"agch_approved": ("כן", "רק פרטי")}, "החלטה: החברה נשארת ברשימות, האג\"ח רק פרטי"),
    ("mp64lbcdjtu6", "550263107", "נאוויטס פטרוליום", {"visibility": ("פרטי", BONDS_ONLY)}, "החלטה: ההת\"ע לאג\"ח בלבד, לא לחברה (אישור האג\"ח נשאר: אג\"ח מסוימים)"),
]


def main(apply=False):
    d1 = D1()
    if not d1.can_write:
        sys.exit("missing CF_ACCOUNT_ID / CF_D1_TOKEN - nothing was read or written")
    ids = ", ".join(sql_q(f[0]) for f in FIXES)
    cur = {r["id"]: r for r in d1.query(f"SELECT id, chp_number, permit_name, visibility, agch_approved FROM businesses WHERE id IN ({ids})")[0]["results"]}
    plan, skipped, stmts, rollback = [], [], [], []
    for biz_id, chp, name, fields, why in FIXES:
        row = cur.get(biz_id)
        if not row or str(row.get("chp_number") or "").strip() != chp:
            skipped.append({"id": biz_id, "chp": chp, "name": name, "reason": "השורה לא נמצאה / ח\"פ שונה"})
            continue
        bad = {f: (row.get(f) or "") for f, (old, _new) in fields.items() if (row.get(f) or "") != old}
        if bad:
            skipped.append({"id": biz_id, "chp": chp, "name": name, "reason": "הערך במסד השתנה מאז הבדיקה", "now": bad})
            continue
        plan.append({"id": biz_id, "chp": chp, "name": name, "why": why, "changes": {f: {"from": o, "to": n} for f, (o, n) in fields.items()}})
        stmts.append("UPDATE businesses SET " + ", ".join(f"{f} = {sql_q(n)}" for f, (_o, n) in fields.items())
                     + f", updated_at = datetime('now') WHERE id = {sql_q(biz_id)};")
        rollback.append("UPDATE businesses SET " + ", ".join(f"{f} = {sql_q(o)}" for f, (o, _n) in fields.items()) + f" WHERE id = {sql_q(biz_id)};")

    mode, mismatches = "dry-run", []
    os.makedirs(OUT, exist_ok=True)
    if apply and stmts:
        with open(os.path.join(OUT, "rollback_bonds_only_2026_11.sql"), "w", encoding="utf-8") as f:
            f.write("\n".join(rollback) + "\n")
        d1.query("\n".join(stmts))
        mode = "applied"
        after = {r["id"]: r for r in d1.query(f"SELECT id, visibility, agch_approved FROM businesses WHERE id IN ({ids})")[0]["results"]}
        mismatches = [p["id"] for p in plan if any((after.get(p["id"], {}).get(f) or "") != c["to"] for f, c in p["changes"].items())]
    report = {"updated": datetime.datetime.utcnow().isoformat() + "Z", "mode": mode, "planned": len(plan), "skipped": skipped,
              "readback_mismatches": mismatches, "plan": plan}
    with open(os.path.join(OUT, "bonds_only_2026_11.json"), "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=1)
    print(json.dumps({k: report[k] for k in ("mode", "planned", "skipped", "readback_mismatches")}, ensure_ascii=False))
    if mismatches:
        sys.exit(f"{len(mismatches)} rows did not persist")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="כתיבה ל-D1")
    main(ap.parse_args().apply)
