# -*- coding: utf-8 -*-
"""בדיקה חד-פעמית וקריאה בלבד: כמה אג"ח לא סחירות (isTradable=false, לא נמחקו) יש לחברות המאושרות ברשימת האג"ח.
סורקת את מאיה כמו הבנייה היומית, אבל סופרת גם ניירות לא סחירים. כותבת data/probe/nontradable_bonds.{json,csv}. לא משנה את רשימות האג"ח."""
import collections, concurrent.futures, csv, json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_approved_bonds as B

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
OUT = os.path.join(ROOT, "data", "probe")


def main():
    os.makedirs(OUT, exist_ok=True)
    companies = B.load_companies()
    approved = B.approved_map(companies)
    print(f"approved companies: {len(approved)}")
    have = set()
    p = os.path.join(ROOT, "data", "bonds_list", "bonds_all.json")
    if os.path.exists(p):
        d = json.load(open(p, encoding="utf-8")); rows = d if isinstance(d, list) else d.get("rows", [])
        have = {str(r.get("security_id")) for r in rows}
    found = errors = 0
    rows, by_type, by_flag = [], collections.Counter(), collections.Counter()
    with concurrent.futures.ThreadPoolExecutor(B.WORKERS) as ex:
        for cid, body in ex.map(B.fetch_company, range(1, B.MAX_ID + 1)):
            if body == "error":
                errors += 1; continue
            if not body:
                continue
            found += 1
            k = B.chp_norm(body.get("corporateNo")); info = approved.get(k)
            if not info:
                continue
            for sec in body.get("secrities") or []:
                if sec.get("securityId") is None:
                    continue
                st = sec.get("securityType") or ""; ac = B.coarse_type(st)
                deleted = bool(sec.get("isDeleted")); trad = bool(sec.get("isTradable"))
                by_flag[("deleted" if deleted else "live", "tradable" if trad else "non-tradable", "bond" if ac in B.BOND_COARSE else "other")] += 1
                if deleted or trad or ac not in B.BOND_COARSE:
                    continue
                by_type[st] += 1
                rows.append({"company": info["company"], "chp": k, "security_id": sec["securityId"], "name": (sec.get("securityName") or "").strip(),
                             "symbol": sec.get("symbol") or "", "type": st, "in_list_already": str(sec["securityId"]) in have})
    companies_with = len({r["chp"] for r in rows})
    summary = {"approved_companies": len(approved), "maya_companies_found": found, "errors": errors,
               "nontradable_live_bonds": len(rows), "companies_with_nontradable": companies_with,
               "by_security_type": dict(by_type.most_common()), "flags": {" / ".join(k): v for k, v in by_flag.most_common()}}
    json.dump(summary, open(os.path.join(OUT, "nontradable_bonds.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    with open(os.path.join(OUT, "nontradable_bonds.csv"), "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["company", "chp", "security_id", "name", "symbol", "type", "in_list_already"]); w.writeheader(); w.writerows(sorted(rows, key=lambda r: (r["company"], r["name"])))
    print(json.dumps(summary, ensure_ascii=False))


if __name__ == "__main__":
    main()
