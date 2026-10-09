# -*- coding: utf-8 -*-
"""אבחון חד-פעמי: מה מאיה אומרת על 20 ניירות שנראו חסרים ברשימה. כותב reports/bonds_diag.json"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_approved_bonds as m  # noqa: E402

IDS = {1177823, 1147479, 1155522, 6390348, 1136464, 1160241, 1168038, 1169127, 1179340, 1182948,
       1189554, 1189877, 1192129, 1197029, 1238500, 2260545, 5660063, 5760251, 5760269, 7200173}

found, company_ids, hits = 0, [], {}
approved = m.approved_map(m.load_companies())
import concurrent.futures as cf
with cf.ThreadPoolExecutor(m.WORKERS) as ex:
    for cid, body in ex.map(m.fetch_company, range(1, 3401)):
        if not body or body == "error":
            continue
        found += 1
        company_ids.append(cid)
        for sec in body.get("secrities") or []:
            if sec.get("securityId") in IDS:
                hits[sec["securityId"]] = {
                    "maya_company_id": cid, "corporateNo": body.get("corporateNo"),
                    "company_approved_in_harav": m.chp_norm(body.get("corporateNo")) in approved,
                    "securityType": sec.get("securityType"), "isTradable": sec.get("isTradable"),
                    "isDeleted": sec.get("isDeleted"), "securityName": sec.get("securityName"),
                }
terms = {}
for sid in sorted(IDS):
    _, d = m.fetch_terms(sid)
    terms[sid] = None if not d else {k: d.get(k) for k in ("Type", "RedemptionDate", "LastRate", "SuspendStatusDate")}
out = {"companies_found": found, "max_company_id_found": max(company_ids), "in_maya_secrities": hits,
       "not_listed_in_any_company": sorted(IDS - set(hits)), "securitydata": terms}
os.makedirs("reports", exist_ok=True)
json.dump(out, open("reports/bonds_diag.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print(json.dumps(out, ensure_ascii=False)[:3000])
