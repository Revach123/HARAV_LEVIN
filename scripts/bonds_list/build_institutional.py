# -*- coding: utf-8 -*-
"""
scripts/bonds_list/build_institutional.py

"רשימה מלאה למוסדיים": האג"ח הלא סחירות הפעילות (לא נמחקו, ולא פקעו) של החברות המאושרות, ממאיה.
(הבנייה היומית הרגילה כוללת רק סחירות, לפי datawise.) הפלט: data/bonds_list/bonds_institutional.json - שורות באותו מבנה של bonds_all,
עם list = פרטי / כללי / פרטי+כללי לפי אותם כללי אישור, ו-is_tradable=false. הדף מוסיף אותן לרשימה כשבוחרים "רשימה מלאה למוסדיים".
כשל / סריקה חלקית: הקובץ הקיים נשאר ולא נדרס. רץ אחרי הבנייה הרגילה (bonds-list.yml).
"""
import concurrent.futures, datetime, json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_approved_bonds as B

OUT_PATH = os.path.join(B.OUT, "bonds_institutional.json")


def parse_date(v):
    for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%d.%m.%Y"):
        try:
            return datetime.datetime.strptime(str(v)[:10], fmt).date()
        except ValueError:
            pass
    return None


def main():
    companies = B.load_companies()
    approved = B.approved_map(companies)
    print(f"approved companies: {len(approved)}")
    rows, found, errors = [], 0, 0
    with concurrent.futures.ThreadPoolExecutor(B.WORKERS) as ex:
        for cid, body in ex.map(B.fetch_company, range(1, B.MAX_ID + 1)):
            if body == "error":
                errors += 1
                continue
            if not body:
                continue
            found += 1
            k = B.chp_norm(body.get("corporateNo"))
            info = approved.get(k)
            if not info:
                continue
            for sec in body.get("secrities") or []:
                if sec.get("securityId") is None or sec.get("isDeleted") or sec.get("isTradable"):
                    continue
                ac = B.coarse_type(sec.get("securityType"))
                if ac not in B.BOND_COARSE:
                    continue
                rows.append({
                    "security_id": int(sec["securityId"]), "security_name": " ".join((sec.get("securityName") or "").split()),
                    "symbol": sec.get("symbol") or "", "isin": sec.get("isin") or "", "security_type": sec.get("securityType") or "",
                    "asset_class": ac, "issuer_name": info["company"], "company": info["company"], "chp_number": k, "maya_company_id": cid,
                    "notes": "; ".join(x for x in (B.GOYIM_NOTE if info["goyim"] else "", info["bond_note"]) if x),
                    "goyim": info["goyim"], "bond_scope": info["bond_scope"], "agch_approved": info["agch_approved"],
                    "is_private": info["is_private"], "is_tradable": False,
                })
    if found < 500 or errors > 0.05 * B.MAX_ID:
        raise SystemExit(f"Maya sweep looks partial (found={found}, errors={errors}) - institutional list left untouched")
    B.add_terms(rows)
    today, kept, old = datetime.date.today(), [], 0
    for r in rows:
        d = parse_date(r.get("redemption_date"))
        if d and d < today:                       # פקע: לא מציגים
            old += 1
            continue
        kept.append(r)
    out = []
    for r in kept:
        lst = []
        if B.bond_allowed(r, True):
            lst.append("פרטי")
        if B.bond_allowed(r, False):
            lst.append("כללי")
        if not lst:
            continue
        v = dict(r)
        v["is_private"] = "כן" if r["is_private"] else "לא"
        v["list"] = "+".join(sorted(lst))
        v["first_seen"] = ""
        out.append({c: v.get(c, "") for c in B.COLUMNS + ["list"]})
    out.sort(key=lambda r: (r["company"], r["security_name"], str(r["security_id"])))
    os.makedirs(B.OUT, exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump({"updated": B.TODAY, "count": len(out), "expired_skipped": old, "columns": B.COLUMNS + ["list"], "rows": out},
                  f, ensure_ascii=False, indent=1)
    print(f"institutional (non-tradable, live): {len(out)} (expired skipped: {old}) from {found} Maya companies")


if __name__ == "__main__":
    main()
