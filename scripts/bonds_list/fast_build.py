# -*- coding: utf-8 -*-
"""
בנייה מהירה של רשימת האג"ח (כדקה במקום 6), להפעלה אחרי שמירת בחירה בחלון "בחירת אג"ח מסוימים".
  לא סורקת את מאיה. נשענת על הרשימה המלאה האחרונה (bonds_internal.json, נשמרת בכל בנייה מלאה) ועל רשימת הניירות של datawise.
  מחשבת מחדש רק חברות "בעייתיות": חברות עם בחירה ידנית (כולל שהייתה ועכשיו הוסרה), החברה שנשלחה בהפעלה,
  חברה שאושרה והיא בלי שורות, וחברה שהפסיקה להיות מאושרת. שאר החברות נשארות כפי שנבנו בבנייה המלאה האחרונה.
  תנאים (שער/ריבית/פדיון) נשלפים רק לאג"ח חדשות. אין קובץ בסיס -> בנייה מלאה.
שימוש: python fast_build.py [ח"פ]
"""
import json
import os
import re
import shutil
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_approved_bonds as b  # noqa: E402
import company_ids  # noqa: E402
import offerings  # noqa: E402

FLAGS = ("issuer_name", "company", "notes", "goyim", "bond_scope", "agch_approved", "is_private", "manual", "manual_scope")


bond_rows_by_chp, desired_rows = b.bond_rows_by_chp, b.desired_rows


def main(chp_arg=""):
    if not os.path.exists(b.INTERNAL_PATH):
        print("fast build: no base file (bonds_internal.json) - running the full build")
        return b.main()
    with open(b.INTERNAL_PATH, encoding="utf-8") as f:
        regular = json.load(f)["regular"]
    companies = b.load_companies()
    approved = b.approved_map(companies)
    if not approved:
        raise SystemExit("no approved companies - refusing to overwrite output")
    names = b.company_names(companies)
    manual = b.load_manual_bonds()
    dw = b.fetch_datawise_securities()
    if not dw:
        raise SystemExit("datawise unavailable - lists left untouched")
    rows, _d, types = dw
    by_chp = bond_rows_by_chp(rows, types)

    current = {r["chp_number"] for r in regular}
    targets = set(manual) | {r["chp_number"] for r in regular if r.get("manual")}
    if re.fullmatch(r"\d{4,9}", chp_arg or ""):
        targets.add(b.chp_norm(chp_arg))
    targets |= {k for k in approved if k not in current and by_chp.get(k)}       # אושרה ועדיין אין לה שורות
    targets |= {k for k in current if k not in approved and k not in manual}      # הפסיקה להיות מאושרת
    print(f"fast build: {len(targets)} companies to recompute: {sorted(targets)}")

    old_by_sid = {r["security_id"]: r for r in regular if r["chp_number"] in targets}
    keep = [r for r in regular if r["chp_number"] not in targets]
    maya_id = {r["chp_number"]: r.get("maya_company_id") for r in regular if r.get("maya_company_id")}
    maya_id.update((company_ids.load() or {}).get("ids", {}))      # המפה העצמאית גוברת
    updated, new = [], []
    for k in sorted(targets):
        for row in desired_rows(k, by_chp.get(k, []), approved, manual, names):
            old = old_by_sid.get(row["security_id"])
            if old:
                merged = {**old, **{x: row[x] for x in FLAGS if x in row}}
                for x in ("manual", "manual_scope"):
                    if x not in row:
                        merged.pop(x, None)
                updated.append(merged)
            else:
                row["maya_company_id"] = maya_id.get(k)
                new.append(row)
    if new:
        b.add_terms(new)
        try:   # העשרה בלי להזיז את נקודת הביקורת של הבנייה המלאה: על עותק של קובץ המצב, בלי שליפת דירוגים
            import enrich
            tmp = os.path.join(tempfile.mkdtemp(), "enrich_state.json")
            if os.path.exists(enrich.STATE_PATH):
                shutil.copy(enrich.STATE_PATH, tmp)
            enrich.enrich(new, state_path=tmp, fetchers={"midroog": lambda: {}, "reports": lambda *a, **k: []})
        except Exception as e:  # noqa: BLE001
            print(f"WARNING: enrich skipped for new bonds: {e}", file=sys.stderr)
        new, dropped = b.drop_empty_terms(new)
        if dropped:
            print(f"dropped {len(dropped)} new bond(s) without terms: {[x['security_id'] for x in dropped]}")
    state = b.load_state()
    b.apply_first_seen(new, state)
    regular2 = keep + updated + new

    offering_bonds = []
    off_path = os.path.join(b.OUT, "offerings.json")
    off = None
    if os.path.exists(off_path):
        with open(off_path, encoding="utf-8") as f:
            off = json.load(f)
        offering_bonds = offerings.bond_rows(off, approved, manual, names, b.SELECTIVE, b.GOYIM_NOTE, b.TODAY)

    snap_path = os.path.join(b.OUT, "maya_securities.json")     # חלון הבחירה: החברות שחושבו מחדש
    if os.path.exists(snap_path):
        with open(snap_path, encoding="utf-8") as f:
            snap = json.load(f)
        extra = offerings.snapshot_entries(off) if off else {}
        for k in targets:
            entries = [{"security_id": int(r["securityId"]), "name": (r.get("securityName") or "").strip(),
                        "symbol": r.get("symbol") or "", "type": stype} for r, stype in by_chp.get(k, [])]
            have = {e["security_id"] for e in entries}
            snap["companies"][k] = entries + [e for e in extra.get(k, []) if e["security_id"] not in have]
        with open(snap_path, "w", encoding="utf-8") as f:
            json.dump(snap, f, ensure_ascii=False, separators=(",", ":"))

    with open(b.INTERNAL_PATH, "w", encoding="utf-8") as f:
        json.dump({"updated": b.TODAY, "regular": regular2}, f, ensure_ascii=False, separators=(",", ":"), default=str)
    counts = b.write_lists(regular2 + offering_bonds)
    with open(b.STATE_PATH, "w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False, indent=1, sort_keys=True)
    print(f"fast build written: private={counts['private']}, general={counts['general']}, all={counts['all']} (new bonds: {len(new)})")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "")
