# -*- coding: utf-8 -*-
"""
הוספת שיוכים לקבצים בקובץ ההחלטות (החלטות_בדיקה.csv) מהשורה, לפי ח.פ. של החברות - למשל כשהקובץ מזכיר כמה חברות לפי שם.
קריאה/כתיבה מקומית בלבד: לא נכתב כלום למאגר או לאתר. לפני ההרצה יש לסגור את הדשבורד (Ctrl+C).
  python add_assignments.py --ids 1672,1758 --chp 510706153,512053513 [--note "טקסט"] [--no-group]
* מצרף את החברות לשיוך הקיים של כל קובץ (לא מוחק), ויוצר שורה אם אין.
* משני חברות ויותר: מסמן "מסמך קבוצתי (כמה חברות)" (אלא אם --no-group).
"""
import argparse
import csv
import json
import os
import sys
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import match_pdfs as m  # noqa: E402
from review_server import DEC_COLS  # noqa: E402

GRP = "מסמך קבוצתי (כמה חברות)"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ids", required=True, help="מזהי קבצים (attachment_id) מופרדים בפסיק")
    ap.add_argument("--chp", required=True, help="ח.פ. של החברות להוספה, מופרדים בפסיק")
    ap.add_argument("--note", default="")
    ap.add_argument("--no-group", action="store_true")
    ap.add_argument("--decisions", default="החלטות_בדיקה.csv")
    ap.add_argument("--businesses", default="businesses.json")
    ap.add_argument("--attachments", default="attachments.csv")
    a = ap.parse_args()

    biz = {str(b.get("chp_number") or "").zfill(9): b for b in json.load(open(a.businesses, encoding="utf-8")) if b.get("chp_number")}
    add = []
    for h in [x.strip() for x in a.chp.split(",") if x.strip()]:
        b = biz.get(h.zfill(9))
        if not b:
            print(f"ח.פ. {h} לא נמצא ב-{a.businesses}")
            return 1
        add.append((b["id"], b.get("registrar_name") or b.get("permit_name") or ""))
    files = {r.get("ID"): os.path.basename(r.get("guid") or "") for r in m.read_csv(a.attachments)} if os.path.exists(a.attachments) else {}
    cur = {r["attachment_id"]: r for r in m.read_csv(a.decisions)} if os.path.exists(a.decisions) else {}
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    for aid in [x.strip() for x in a.ids.split(",") if x.strip()]:
        r = cur.get(aid) or {k: "" for k in DEC_COLS}
        r["attachment_id"], r["file"] = aid, r.get("file") or files.get(aid, "")
        ids = [x for x in (r.get("company_ids") or r.get("company_id") or "").split(";") if x]
        names = (r.get("company_names") or r.get("company_name") or "").split(";") if ids else []
        names += [""] * (len(ids) - len(names))
        for cid, nm in add:
            if cid not in ids:
                ids.append(cid)
                names.append(nm)
        r["company_ids"], r["company_names"] = ";".join(ids), ";".join(names)
        r["company_id"], r["company_name"] = ids[0], names[0]
        if len(ids) >= 2 and not a.no_group:
            r["company_special"] = GRP
        elif r.get("company_special") not in ("", GRP):
            r["company_special"] = ""
        if a.note:
            r["note"] = (r.get("note") + " | " if r.get("note") else "") + a.note
        r["time"] = now
        cur[aid] = r
        print(f"{aid}: {len(ids)} חברות")
    tmp = a.decisions + ".tmp"
    with open(tmp, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=DEC_COLS, extrasaction="ignore")
        w.writeheader()
        w.writerows(cur.values())
    os.replace(tmp, a.decisions)
    return 0


if __name__ == "__main__":
    sys.exit(main())
