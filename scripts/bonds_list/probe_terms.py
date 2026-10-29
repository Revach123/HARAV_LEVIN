# -*- coding: utf-8 -*-
"""בדיקה חד-פעמית: אילו שדות מחזיר api.tase.co.il/api/company/securitydata (האם יש תאריך הנפקה / רישום למסחר). קריאה בלבד -> data/probe/securitydata_sample.json"""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_approved_bonds as b

rows = json.load(open("data/bonds_list/bonds_all.json", encoding="utf-8"))["rows"]
ids = [r["security_id"] for r in rows if str(r.get("first_seen", "")) >= "2026-10-26" and r.get("redemption_date")][:3] + [7190242, 1233162]
out = {}
for sid in ids:
    try:
        out[str(sid)] = b.get_json(b.TERMS_URL.format(id=sid))
    except Exception as e:
        out[str(sid)] = {"error": str(e)}
os.makedirs("data/probe", exist_ok=True)
json.dump(out, open("data/probe/securitydata_sample.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print(json.dumps({k: sorted(v.keys()) if isinstance(v, dict) else v for k, v in out.items()}, ensure_ascii=False)[:1500])
