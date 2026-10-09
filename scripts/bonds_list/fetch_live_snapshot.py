# -*- coding: utf-8 -*-
"""חד-פעמי: מוריד מהאתר החי את רשימות האג"ח (D1) לתיקיית reports/live_bonds."""
import json, os, urllib.request
BASE = "https://harav-levin.pages.dev"
os.makedirs("reports/live_bonds", exist_ok=True)
for t in ("bonds-all", "bonds-private", "bonds-general"):
    req = urllib.request.Request(f"{BASE}/api/lists?type={t}", headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        d = json.loads(r.read())
    json.dump(d, open(f"reports/live_bonds/{t}.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(t, d.get("ok"), d.get("count"), list((d.get("rows") or [{}])[0].keys()))
