# -*- coding: utf-8 -*-
"""
הנפקות אג"ח עתידיות ופתוחות (datawise של הבורסה, אותו מפתח כמו שאר הרשימות). נקרא מ-build_approved_bonds.py.
  /v1/tase-offering/upcoming  - הנפקות עתידיות (טיוטה): ללא מספר נייר, רק סוג נייר ודירוגים
  /v1/tase-offering/open      - הנפקות פתוחות: כולל מספר נייר
  כל סוגי האג"ח לפי אותם כללים של שאר הרשימה: קוד סוג 03/05/11/36 וסיווג גס ב-BOND_COARSE (פתוחות),
  וסיווג גס לפי שם הסוג (עתידיות, שבהן אין קוד).
  ח.פ.: בפתוחה לפי issuerId מול רשימת ניירות הבורסה; בעתידית לפי שם החברה (בבורסה, ואם אין - במאגר שלנו).
"""
import re

from classify import coarse_type

STATUS_OPEN, STATUS_UPCOMING = "בהנפקה", "הנפקה עתידית"


def norm_name(s):
    s = re.sub(r"בע\"?מ|בע״מ|בע''מ", "", str(s or ""))
    return re.sub(r"[^0-9a-z֐-׿]", "", s.lower())


def _result(raw, key):
    return (((raw or {}).get(key) or {}).get("result")) or []


def parse_upcoming(raw, bond_coarse):
    out = []
    for o in _result(raw, "getUpcomingOfferingData"):
        secs = [{"security_type": s.get("securityType"), "maalot_rating": s.get("maalotRating"),
                 "midroog_rating": s.get("midrugRating")}
                for s in (o.get("securitiesTypes") or []) if coarse_type(s.get("securityType")) in bond_coarse]
        if not secs:
            continue
        out.append({"id": o.get("upcomingOfferingId"), "maya_report_id": o.get("mayaReportId"),
                    "company_name": (o.get("companyName") or "").strip(), "is_new_company": o.get("isTheCompanyNew"),
                    "new_company_type": o.get("newCompanyType"), "draft_no": o.get("draftNo"),
                    "draft_title": o.get("draftTitle"), "link_prospectus": o.get("linkToProspectus"),
                    "link_trust_indenture": o.get("linkToTrustIndenture"),
                    "link_presentation": o.get("linkToCompanyPresentation"), "securities": secs})
    return out


def parse_open(raw, types, prefixes, bond_coarse):
    out = []
    for o in _result(raw, "getOpenOfferingData"):
        secs = []
        for s in o.get("securities") or []:
            code = str(s.get("securityFullTypeCode") or "")
            tdesc = (types or {}).get(code, "")
            if not code.startswith(prefixes) or (types and coarse_type(tdesc) not in bond_coarse):
                continue
            secs.append({"security_id": s.get("securityId"), "security_name": (s.get("securityName") or "").strip(),
                         "security_type": tdesc, "linkage_type": s.get("linkageType"),
                         "maalot_rating": s.get("maalotRating"), "midroog_rating": s.get("midrugRating")})
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


def build(upcoming_raw, open_raw, trade_rows, our_companies, types, prefixes, bond_coarse, chp_norm):
    """-> dict לכתיבה ל-offerings.json. our_companies = [(שם, ח"פ)]."""
    by_issuer, by_name = {}, {}
    for r in trade_rows or []:
        chp = chp_norm(r.get("corporateId"))
        if not chp:
            continue
        if r.get("issuerId") not in (None, ""):
            by_issuer.setdefault(str(r["issuerId"]).strip(), chp)
        for k in ("companyName", "issuerName", "corporateName"):
            if r.get(k):
                by_name.setdefault(norm_name(r[k]), chp)
    for name, chp in our_companies or []:
        if chp and norm_name(name):
            by_name.setdefault(norm_name(name), chp_norm(chp))
    up = parse_upcoming(upcoming_raw, bond_coarse)
    op = parse_open(open_raw, types, prefixes, bond_coarse)
    for o in up:
        o["chp_number"] = by_name.get(norm_name(o["company_name"]), "")
    for o in op:
        o["chp_number"] = by_issuer.get(str(o["issuer_id"]).strip(), "") or by_name.get(norm_name(o["issuer_name"]), "")
    companies = {}
    for status, items, name_key in ((STATUS_UPCOMING, up, "company_name"), (STATUS_OPEN, op, "issuer_name")):
        for o in items:
            if o["chp_number"]:
                c = companies.setdefault(o["chp_number"], {"chp_number": o["chp_number"], "name": o[name_key], "statuses": []})
                if status not in c["statuses"]:
                    c["statuses"].append(status)
    return {"upcoming": up, "open": op, "companies": sorted(companies.values(), key=lambda c: c["chp_number"]),
            "unmatched": [o.get("company_name") or o.get("issuer_name") for o in up + op if not o["chp_number"]]}


def _fmt_date(s):
    m = re.match(r"(\d{4})-(\d{2})-(\d{2})", str(s or ""))
    return f"{m.group(3)}/{m.group(2)}/{m.group(1)}" if m else ""


def bond_rows(data, approved, manual, names, selective, goyim_note, today):
    """שורות לרשימת האג"ח: חברות מאושרות (כמו האג"ח הרגילות) + אג"ח פתוחות שנבחרו ידנית. עתידיות: רק לחברות מאושרות."""
    rows = []
    for o in data["open"]:
        k = o["chp_number"]
        info, picks = approved.get(k), manual.get(k) or {}
        for s in o["securities"]:
            sid = s["security_id"]
            if sid is None:
                continue
            sid = int(sid)
            note = f"הנפקה פתוחה" + (f" עד {_fmt_date(o['ends_at'])}" if _fmt_date(o["ends_at"]) else "")
            base = {"security_id": sid, "security_name": s["security_name"], "symbol": "", "isin": "",
                    "security_type": s["security_type"], "asset_class": coarse_type(s["security_type"]),
                    "chp_number": k, "is_tradable": False, "offering_status": STATUS_OPEN,
                    "annual_interest": "" if o["interest"] in (None, "") else o["interest"],
                    "linkage": s["linkage_type"] or "", "midroog_rating": s["midroog_rating"] or "",
                    "maalot_rating": s["maalot_rating"] or "", "redemption_date": "", "first_seen": today}
            if info:
                rows.append({**base, "issuer_name": info["company"], "company": info["company"],
                             "notes": "; ".join(x for x in (goyim_note if info["goyim"] else "", info["bond_note"], note) if x),
                             "goyim": info["goyim"], "bond_scope": info["bond_scope"],
                             "agch_approved": info["agch_approved"], "is_private": info["is_private"]})
            elif sid in picks and k in names:
                rows.append({**base, "issuer_name": names[k], "company": names[k], "notes": note, "goyim": False,
                             "bond_scope": "both", "agch_approved": selective, "is_private": picks[sid] in ("private", "both"),
                             "manual": True, "manual_scope": picks[sid]})
    for o in data["upcoming"]:
        info = approved.get(o["chp_number"])
        if not info:
            continue
        for i, s in enumerate(o["securities"]):
            label = (s["security_type"] or 'אג"ח') + " - " + info["company"]
            rows.append({"security_id": "", "_key": f"U{o['id']}-{i}", "security_name": label, "symbol": "", "isin": "",
                         "security_type": s["security_type"] or "", "asset_class": coarse_type(s["security_type"]),
                         "issuer_name": info["company"], "company": info["company"], "chp_number": o["chp_number"],
                         "notes": "; ".join(x for x in (goyim_note if info["goyim"] else "", info["bond_note"], "הנפקה עתידית") if x),
                         "goyim": info["goyim"], "bond_scope": info["bond_scope"], "agch_approved": info["agch_approved"],
                         "is_private": info["is_private"], "is_tradable": False, "offering_status": STATUS_UPCOMING,
                         "midroog_rating": s["midroog_rating"] or "", "maalot_rating": s["maalot_rating"] or "",
                         "first_seen": today})
    return rows


def snapshot_entries(data):
    """אג"ח פתוחות לחלון בחירת האג"ח (יש להן מספר נייר): {ח"פ: [..]}."""
    out = {}
    for o in data["open"]:
        for s in o["securities"]:
            if o["chp_number"] and s["security_id"] is not None:
                out.setdefault(o["chp_number"], []).append({"security_id": int(s["security_id"]),
                    "name": f"{s['security_name']} ({STATUS_OPEN})", "symbol": "", "type": s["security_type"]})
    return out
