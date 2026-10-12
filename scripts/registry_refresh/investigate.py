# -*- coding: utf-8 -*-
"""חד-פעמי: חקירה. כותב reports/registry_refresh/investigation.json
 A. היסטוגרמת updated_at ב-D1 (למה הדגל היה מיושן — האם ה-Worker עבד?)
 B. חשודים: האם יש חברה עם שם זהה/דומה אך ח"פ אחר במאגר data.gov.il
 C. datawise: אג"ח של חברות שדגלן הפך ל"אין" תחת ח"פ אחר? + נוכחות ניירות ישנים של Revach
"""
import datetime, difflib, json, os, re, sys, time, urllib.parse
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import refresh_businesses as r

d1 = r.D1()
out = {}
# ── A ──
if d1.can_write:
    out["A_updated_at_by_day"] = d1.query(
        "SELECT substr(updated_at,1,10) AS day, COUNT(*) AS n FROM businesses GROUP BY day ORDER BY day DESC LIMIT 60")[0]["results"]
    out["A_total"] = d1.query("SELECT COUNT(*) AS n FROM businesses")[0]["results"]
rows_all = (d1.query("SELECT id, chp_number, permit_name, registrar_name, entity_type, agch_approved, visibility, tase_has_agch "
                     "FROM businesses WHERE chp_number IS NOT NULL AND chp_number != ''")[0]["results"]
            if d1.can_write else [])

def norm(s):
    s = (s or "").replace("~", '"')
    s = re.sub(r'בע"?מ|\(ע"ר\)|\(ע.ר\)|חברה|ה?חזקות|["\'`.,\-()״׳]', "", s)
    return re.sub(r"\s+", "", s)

def sim(a, b):
    a, b = norm(a), norm(b)
    return difflib.SequenceMatcher(None, a, b).ratio(), (a in b or b in a) if a and b else False

# ── B ──
suspects = []
for b in rows_all:
    p, g = (b.get("permit_name") or ""), (b.get("registrar_name") or "")
    if p.strip() == "מסלול הלכה" or not r.numeric_chp(b["chp_number"]):
        continue
    if g:
        s, contained = sim(p, g)
        if s < 0.6 and not contained:
            suspects.append({**b, "why": f"registry name differs (sim={s:.2f})"})
    else:
        suspects.append({**b, "why": "not found in registry by chp"})
out["B_suspect_count"] = len(suspects)

def name_search(source, text):
    q = urllib.parse.quote(text)
    try:
        res = r.http_json(f"{r.GOV_SEARCH}?resource_id={source['resource']}&q={q}&limit=15")
    except RuntimeError:
        return []
    return (res.get("result") or {}).get("records") or []

b_out = []
for b in suspects:
    p = (b.get("permit_name") or "").strip()
    words = [w for w in re.split(r"\s+", re.sub(r"[\"'`.,\-()]", " ", p)) if len(w) > 1 and w not in ("בע", "מ", "בעמ")]
    queries = [" ".join(words[:3])] + ([" ".join(words[:2])] if len(words) > 2 else [])
    seen, cands = set(), []
    for src in r.SOURCES[:1] + (r.SOURCES[2:] if "ע" in p and "ר" in p else []):
        for qtext in dict.fromkeys(queries):
            if not qtext:
                continue
            for rec in name_search(src, qtext):
                num = str(rec.get(src["id"]))
                nm = r.clean_name(rec.get(src["name"]))
                if (src["kind"], num) in seen or not nm:
                    continue
                seen.add((src["kind"], num))
                s1, c1 = sim(p, nm)
                s2, c2 = sim(b.get("registrar_name") or "", nm) if b.get("registrar_name") else (0, False)
                if s1 >= 0.7 or c1:
                    cands.append({"kind": src["kind"], "chp": num, "name": nm,
                                  "status": rec.get("סטטוס חברה") or rec.get("סטטוס עמותה"),
                                  "sim_to_permit": round(s1, 2), "same_chp_as_db": r.numeric_chp(num) == r.numeric_chp(b["chp_number"])})
            time.sleep(0.3)
    b_out.append({"chp": b["chp_number"], "permit_name": p, "registrar_name": b.get("registrar_name"),
                  "agch": b.get("agch_approved"), "why": b["why"],
                  "similar_in_registry": sorted(cands, key=lambda c: -c["sim_to_permit"])[:6]})
out["B_suspects"] = b_out

# ── C ──
H = {"accept": "application/json", "accept-language": "he-IL", "apikey": r.datawise_key()}
types = {str(t["securityFullTypeCode"]): t.get("securityTypeDesc") for t in
         r.http_json(f"{r.DATAWISE}/v1/basic-securities/securities-types", headers=H)["securitiesTypes"]["result"]}
rows, day = [], None
for d in range(8):
    dt = datetime.date.today() - datetime.timedelta(days=d)
    res = r.http_json(f"{r.DATAWISE}/v1/basic-securities/trade-securities-list/{dt:%Y/%m/%d}", headers=H)
    rows = (res.get("tradeSecuritiesList") or {}).get("result") or []
    if rows:
        day = str(dt); break
out["C_datawise_day"] = day
flip_down = {"514068980": "ויקטורי", "520007469": "מנורה מבטחים", "1863501": "סטרוברי", "514837111": "דלק תמלוגים"}
c_out = {}
for chp, key in flip_down.items():
    hits = [{"corporateId": s.get("corporateId"), "company": s.get("companyName"), "security": s.get("securityName"),
             "type": types.get(str(s.get("securityFullTypeCode"))), "id": s.get("securityId")}
            for s in rows if key in (s.get("companyName") or "") or key in (s.get("securityName") or "")]
    c_out[f"{chp} ({key})"] = hits[:15]
out["C_flag_true_to_false_name_search"] = c_out
revach_old = [1177823, 1147479, 1155522, 6390348, 1136464, 1160241, 1168038, 1169127, 1179340, 1182948,
              1189554, 1189877, 1192129, 1197029, 1238500, 2260545, 5660063, 5760251, 5760269, 7200173]
present = {s.get("securityId") for s in rows}
out["C_revach_old_ids_present_in_datawise_today"] = {str(i): (i in present) for i in revach_old}
try:
    dl = r.http_json(f"{r.DATAWISE}/v1/basic-securities/delisted-securities-list/{datetime.date.today():%Y/%m}", headers=H)
    drows = (dl.get("delistedSecuritiesList") or {}).get("result") or []
    out["C_delisted_this_month_count"] = len(drows)
    out["C_revach_old_ids_in_delisted_this_month"] = [i for i in revach_old if i in {x.get("securityId") for x in drows}]
except RuntimeError as e:
    out["C_delisted_error"] = str(e)[:100]

os.makedirs(os.path.join(r.ROOT, "reports", "registry_refresh"), exist_ok=True)
json.dump(out, open(os.path.join(r.ROOT, "reports", "registry_refresh", "investigation.json"), "w", encoding="utf-8"),
          ensure_ascii=False, indent=1)
print("ok", out["B_suspect_count"], len(b_out))
