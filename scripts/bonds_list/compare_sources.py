# -*- coding: utf-8 -*-
"""
השוואת שלושה מקורות לאג"ח של חברות (קריאה בלבד, לא משנה שום רשימה):
  M = דפי החברה במאיה (סריקה מלאה, אג"ח סחירות ולא מחוקות)
  D = רשימת הניירות היומית של datawise (קוד סוג 03/05/11/36 וסיווג אג"ח)
  K = נתוני המסחר של הבורסה (api.tase.co.il, אג"ח חברות)
פלט: data/probe/source_comparison.json - גדלים, חיתוכים, ולכל הבדל: נייר, חברה, ח.פ., האם החברה מאושרת.
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_approved_bonds as b  # noqa: E402
import market_data  # noqa: E402

CAP = 400


def main():
    companies = b.load_companies()
    approved = b.approved_map(companies)
    names = b.company_names(companies)
    snapshot, cid_by_chp = {}, {}

    def fetch(cid):                      # כמו fetch_company, ושומר גם את מזהה החברה במאיה לכל ח.פ.
        c, body = b.fetch_company(cid)
        if body and body != "error":
            k = b.chp_norm(body.get("corporateNo"))
            if k:
                cid_by_chp.setdefault(k, set()).add(cid)
        return c, body

    _bonds, found, errors = b.sweep_maya(approved, fetch=fetch, snapshot=snapshot)
    print(f"maya: {found} companies, {errors} errors")
    M = {}
    for chp, items in snapshot.items():
        for e in items:
            M[int(e["security_id"])] = {"name": e["name"], "chp": chp, "type": e["type"]}
    dw = b.fetch_datawise_securities()
    D = {}
    if dw:
        rows, _d, types = dw
        for r in rows:
            code = str(r.get("securityFullTypeCode") or "")
            if r.get("securityId") is None or not code.startswith(b.BOND_CODE_PREFIXES):
                continue
            stype = types.get(code, "")
            if b.coarse_type(stype) in b.BOND_COARSE:
                D[int(r["securityId"])] = {"name": (r.get("securityName") or "").strip(), "chp": b.chp_norm(r.get("corporateId")), "type": stype}
    K = {}
    try:
        for sid, it in market_data.fetch_items().items():
            K[sid] = {"name": (it.get("Name") or "").strip(), "chp": "", "type": it.get("ShareType") or "", "maya_company_id": it.get("CompanyId")}
    except Exception as e:  # noqa: BLE001
        print(f"market data failed: {e}", file=sys.stderr)

    def info(sid, *srcs):
        for s in srcs:
            if sid in s:
                x = s[sid]
                chp = x.get("chp") or (D.get(sid) or M.get(sid) or {}).get("chp", "")
                return {"security_id": sid, "name": " ".join(str(x["name"]).split()), "type": x["type"], "chp": chp,
                        "company": names.get(chp, ""), "approved": chp in approved}
        return {"security_id": sid}

    def diff(a, bb, srcs):
        ids = sorted(set(a) - set(bb))
        return {"count": len(ids), "approved_companies": sum(1 for i in ids if info(i, *srcs).get("approved")),
                "rows": [info(i, *srcs) for i in ids[:CAP]]}

    # מזהה החברה במאיה (CompanyId בנתוני המסחר) מול מזהה החברה בסריקת מאיה, לכל ח.פ.
    market_cids = {}
    for sid, x in K.items():
        chp = (D.get(sid) or M.get(sid) or {}).get("chp", "")
        if chp and x.get("maya_company_id") not in (None, ""):
            market_cids.setdefault(chp, set()).add(int(x["maya_company_id"]))
    d_chps = {x["chp"] for x in D.values() if x["chp"]}
    no_cid_in_items = [sid for sid, x in K.items() if x.get("maya_company_id") in (None, "")]
    agree = [k for k in d_chps if k in market_cids and k in cid_by_chp and market_cids[k] <= cid_by_chp[k]]
    differ = [k for k in d_chps if k in market_cids and k in cid_by_chp and not market_cids[k] <= cid_by_chp[k]]
    no_market_cid = sorted(k for k in d_chps if k not in market_cids)
    cid_check = {"datawise_companies": len(d_chps), "market_items_without_CompanyId": len(no_cid_in_items),
                 "companies_with_market_CompanyId": len(market_cids), "companies_with_maya_id_from_sweep": len(cid_by_chp),
                 "agree_with_maya_sweep": len(agree), "differ_from_maya_sweep": len(differ),
                 "differ_examples": [{"chp": k, "market": sorted(market_cids[k]), "maya": sorted(cid_by_chp[k])} for k in differ[:30]],
                 "companies_without_market_CompanyId": len(no_market_cid),
                 "of_which_approved": sum(1 for k in no_market_cid if k in approved),
                 "of_which_maya_id_known": sum(1 for k in no_market_cid if k in cid_by_chp),
                 "examples_without": [{"chp": k, "company": names.get(k, ""), "approved": k in approved, "maya_ids": sorted(cid_by_chp.get(k, []))} for k in no_market_cid[:40]]}
    res = {"company_id_check": cid_check, "sizes": {"maya": len(M), "datawise": len(D), "market": len(K)},
           "intersections": {"M&D": len(set(M) & set(D)), "M&K": len(set(M) & set(K)), "D&K": len(set(D) & set(K)),
                             "all3": len(set(M) & set(D) & set(K))},
           "only_datawise_not_maya": diff(D, M, (D,)), "only_maya_not_datawise": diff(M, D, (M,)),
           "market_not_maya": diff(K, M, (D, K)), "market_not_datawise": diff(K, D, (K,)),
           "maya_not_market": diff(M, K, (M,)), "datawise_not_market": diff(D, K, (D,)),
           "example_1248434": {"maya": 1248434 in M, "datawise": 1248434 in D, "market": 1248434 in K}}
    os.makedirs("data/probe", exist_ok=True)
    with open("data/probe/source_comparison.json", "w", encoding="utf-8") as f:
        json.dump(res, f, ensure_ascii=False, indent=1)
    print(json.dumps({k: (v if k in ("sizes", "intersections", "example_1248434", "company_id_check") else {x: y for x, y in v.items() if x != "rows"}) for k, v in res.items()},
                     ensure_ascii=False, indent=1))


if __name__ == "__main__":
    sys.exit(main())
