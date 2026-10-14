# -*- coding: utf-8 -*-
"""
הנפקות אג"ח עתידיות ופתוחות (datawise של הבורסה, אותו מפתח כמו שאר הרשימות).
  /v1/tase-offering/upcoming  - הנפקות עתידיות (רק אג"ח / אג"ח להמרה; כמו השאילתה ב-Power Query)
  /v1/tase-offering/open      - הנפקות פתוחות (רק ניירות עם קוד סוג שמתחיל ב-05 = אג"ח)
  פלט: data/bonds_list/offerings.json  - ההנפקות + רשימת חברות (ח.פ.) עם הנפקה עתידית / פתוחה.
  ח.פ.: בהנפקה פתוחה לפי issuerId מול רשימת הניירות של הבורסה; בעתידית לפי שם החברה (אותו שם בבורסה, ואם אין - שם במאגר שלנו).
  לא נוגע ברשימות האג"ח; כשל לא מפיל את הבנייה היומית (נשאר הקובץ הקודם).
"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_approved_bonds as b  # noqa: E402

BOND_TYPES_UPCOMING = {'אג"ח', 'אג"ח להמרה'}
OUT_FILE = os.path.join(b.OUT, "offerings.json")


def norm_name(s):
    s = re.sub(r"בע\"?מ|בע״מ|בע''מ", "", str(s or ""))
    return re.sub(r"[^0-9a-z֐-׿]", "", s.lower())


def parse_upcoming(raw):
    out = []
    for o in (((raw or {}).get("getUpcomingOfferingData") or {}).get("result")) or []:
        secs = [{"security_type": s.get("securityType"), "maalot_rating": s.get("maalotRating"),
                 "midroog_rating": s.get("midrugRating")}
                for s in (o.get("securitiesTypes") or []) if s.get("securityType") in BOND_TYPES_UPCOMING]
        if not secs:
            continue
        out.append({"id": o.get("upcomingOfferingId"), "maya_report_id": o.get("mayaReportId"),
                    "company_name": (o.get("companyName") or "").strip(), "is_new_company": o.get("isTheCompanyNew"),
                    "new_company_type": o.get("newCompanyType"), "draft_no": o.get("draftNo"),
                    "draft_title": o.get("draftTitle"), "link_prospectus": o.get("linkToProspectus"),
                    "link_trust_indenture": o.get("linkToTrustIndenture"),
                    "link_presentation": o.get("linkToCompanyPresentation"), "securities": secs})
    return out


def parse_open(raw):
    out = []
    for o in (((raw or {}).get("getOpenOfferingData") or {}).get("result")) or []:
        secs = [{"security_id": s.get("securityId"), "security_name": s.get("securityName"),
                 "linkage_type": s.get("linkageType"), "maalot_rating": s.get("maalotRating"),
                 "midroog_rating": s.get("midrugRating")}
                for s in (o.get("securities") or []) if str(s.get("securityFullTypeCode") or "")[:2] == "05"]
        if not secs:
            continue
        out.append({"offer_number": o.get("offerNumber"), "issuer_id": o.get("issuerId"),
                    "issuer_name": (o.get("issuerName") or "").strip(), "is_new_company": o.get("isTheCompanyNew"),
                    "begins_at": o.get("offerBeginsAt"), "ends_at": o.get("offerEndsAt"),
                    "offer_type": o.get("offerType"), "offering_type": o.get("offeringType"),
                    "interest": o.get("interest"), "is_variable_interest": o.get("isTheVariableInterest"),
                    "price_per_unit": o.get("pricePerUnit"), "link_offer_report": o.get("linkToOfferReport"),
                    "securities": secs})
    return out


def build(upcoming_raw, open_raw, trade_rows, our_companies):
    """-> dict לכתיבה. trade_rows = רשימת ניירות הבורסה (issuerId/corporateId/שם); our_companies = [(שם, ח"פ)]."""
    by_issuer, by_name = {}, {}
    for r in trade_rows or []:
        chp = b.chp_norm(r.get("corporateId"))
        if not chp:
            continue
        if r.get("issuerId") not in (None, ""):
            by_issuer.setdefault(str(r["issuerId"]).strip(), chp)
        for k in ("companyName", "issuerName", "corporateName"):
            if r.get(k):
                by_name.setdefault(norm_name(r[k]), chp)
    for name, chp in our_companies or []:
        if chp and norm_name(name):
            by_name.setdefault(norm_name(name), b.chp_norm(chp))
    up, op = parse_upcoming(upcoming_raw), parse_open(open_raw)
    for o in up:
        o["chp_number"] = by_name.get(norm_name(o["company_name"]), "")
    for o in op:
        o["chp_number"] = by_issuer.get(str(o["issuer_id"]).strip(), "") or by_name.get(norm_name(o["issuer_name"]), "")
    companies = {}
    for kind, items, name_key in (("עתידית", up, "company_name"), ("פתוחה", op, "issuer_name")):
        for o in items:
            if o["chp_number"]:
                c = companies.setdefault(o["chp_number"], {"chp_number": o["chp_number"], "name": o[name_key], "statuses": []})
                if kind not in c["statuses"]:
                    c["statuses"].append(kind)
    return {"upcoming": up, "open": op, "companies": sorted(companies.values(), key=lambda c: c["chp_number"]),
            "unmatched": [o.get("company_name") or o.get("issuer_name") for o in up + op if not o["chp_number"]]}


def main():
    try:
        up_raw = b.dw_get("/v1/tase-offering/upcoming")
        op_raw = b.dw_get("/v1/tase-offering/open")
    except RuntimeError as e:
        print(f"WARNING: offerings fetch failed, file left untouched: {e}", file=sys.stderr)
        return 1
    dw = b.fetch_datawise_securities()
    trade_rows = dw[0] if dw else []
    ours = []
    try:
        ours = [((c.get("registrar_name") or c.get("permit_name") or ""), c.get("chp_number")) for c in b.load_companies(None)]
    except BaseException as e:  # noqa: BLE001  (load_companies may SystemExit)
        print(f"WARNING: our companies unavailable, name fallback skipped: {e}", file=sys.stderr)
    data = build(up_raw, op_raw, trade_rows, ours)
    os.makedirs(b.OUT, exist_ok=True)
    with open(OUT_FILE, "w", encoding="utf-8") as f:
        json.dump({"updated": b.TODAY, **data}, f, ensure_ascii=False, indent=1)
    print(f"offerings: upcoming={len(data['upcoming'])}, open={len(data['open'])}, "
          f"companies with ח\"פ={len(data['companies'])}, unmatched={len(data['unmatched'])}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
