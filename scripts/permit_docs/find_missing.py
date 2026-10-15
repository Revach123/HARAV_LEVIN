# -*- coding: utf-8 -*-
"""
חיפוש מסמך לכל חברה שחסר לה: סורק את הטקסט של כל הקבצים (PDF + OCR) ומחפש את שם החברה, ה-ח.פ. שלה ושם הפוסט הדומה לשמה.
קריאה בלבד: לא משייך, לא כותב למאגר ולא משנה קבצים.
  קלט:  כיסוי_חברות.csv (coverage_report.py), סופי_מאוחד.csv, attachments.csv, ocr_text\\, businesses.json
  פלט:  מועמדים_לחברות_חסרות.csv  - לכל חברה שחסר לה מסמך, עד 5 קבצים מועמדים, עם סוג הראיה:
          "ח.פ. בטקסט" (חזק) / "שם החברה בטקסט" / "שם פוסט דומה"
        וכן ספירה: כמה חברות חסרות קיבלו לפחות מועמד אחד, וכמה מהמועמדים הם קבצים שעדיין לא משויכים לאף חברה.
    python find_missing.py [--ocr-dir ocr_text]
"""
import argparse
import csv
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import match_pdfs as m  # noqa: E402

STOP = {"בעמ", "בע", "מ", "ישראל", "החזקות", "קבוצת", "חברת", "ה"}


def name_variants(b, fallback=""):
    """כל השמות של העסק לחיפוש: שם ברשם וגם 'שם בהיתר עיסקא' (permit_name; אפשר כמה שמות מופרדים ב- ; | / או שורה), וגם בלי הטקסט שבסוגריים."""
    out = {}
    for label, raw in (("שם ברשם", (b or {}).get("registrar_name") or fallback), ("שם בהיתר", (b or {}).get("permit_name") or "")):
        for part in re.split(r"[;|\n/]+", raw or ""):
            part = part.strip()
            if not part:
                continue
            for v in {part, re.sub(r"\([^)]*\)", " ", part)}:
                cn = " ".join(w for w in m.norm(v).split() if w not in ("בעמ", "בע", "מ"))
                if len(cn) >= 6:
                    out.setdefault(cn, label)
    return out


def core_name(name):
    return " ".join(w for w in m.norm(name).split() if w not in ("בעמ", "בע", "מ"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--coverage", default="כיסוי_חברות.csv")
    ap.add_argument("--businesses", default="businesses.json")
    ap.add_argument("--final", default="סופי_מאוחד.csv")
    ap.add_argument("--attachments", default="attachments.csv")
    ap.add_argument("--uploads", default=os.path.join("wp-content", "uploads"))
    ap.add_argument("--ocr-dir", default="ocr_text")
    ap.add_argument("--out", default="מועמדים_לחברות_חסרות.csv")
    ap.add_argument("--max-per-company", type=int, default=5)
    a = ap.parse_args()

    guid = {r["ID"]: r.get("guid", "") for r in m.read_csv(a.attachments)}
    files = m.read_csv(a.final)
    texts = {}
    for n, r in enumerate(files, 1):
        aid = r["attachment_id"]
        t = ""
        p = m.local_path(a.uploads, guid.get(aid, ""))
        if p and os.path.exists(p) and int(r.get("text_chars") or 0) >= 15:
            t += m.pdf_text(p)
        for od in a.ocr_dir.split(","):
            op = os.path.join(od.strip(), f"{aid}.txt")
            if os.path.exists(op):
                t += "\n" + open(op, encoding="utf-8").read()
        texts[aid] = (m.norm(t), set(re.findall(r"(?<!\d)\d{9}(?!\d)", t.replace(",", ""))))
        if n % 300 == 0:
            print(f"  נקראו {n}/{len(files)}", flush=True)

    import json
    biz_by_chp = {}
    if os.path.exists(a.businesses):
        for b in json.load(open(a.businesses, encoding="utf-8")):
            if b.get("chp_number"):
                biz_by_chp[str(b["chp_number"]).zfill(9)] = b
    cov = [c for c in m.read_csv(a.coverage) if c.get("missing")]
    print(f"{len(cov)} חברות שחסר להן מסמך; מחפש בטקסט {len(files)} קבצים...")
    out, found_any, unassigned_cands = [], 0, set()
    for c in cov:
        name, chp = c["company"], str(c.get("chp") or "").zfill(9) if c.get("chp") else ""
        variants = name_variants(biz_by_chp.get(chp), name)
        cands = []
        for r in files:
            aid = r["attachment_id"]
            if c["company"] and r.get("business_name") == name:
                continue          # כבר משויך לחברה הזו
            ntext, nums = texts.get(aid, ("", set()))
            if chp and chp in (r.get("doc_hps_in_db") or "") and r.get("business_name") == name:
                continue
            ev = []
            if chp and chp in nums:
                ev.append(("ח.פ. בטקסט", 3))
            hit = [lab for cn, lab in variants.items() if cn in ntext]
            if hit:
                ev.append(("שם בהיתר בטקסט" if "שם בהיתר" in hit else "שם החברה בטקסט", 2))
            if r.get("post_title") and any(m.sim(r["post_title"], nm) >= 0.85 for nm in {name, (biz_by_chp.get(chp) or {}).get("permit_name") or name}):
                ev.append(("שם פוסט דומה", 1))
            if ev:
                cands.append((max(s for _, s in ev), ", ".join(e for e, _ in ev), r))
        cands.sort(key=lambda x: -x[0])
        if cands:
            found_any += 1
        for score, evidence, r in cands[:a.max_per_company]:
            assigned = r.get("business_name") or ""
            if not assigned:
                unassigned_cands.add(r["attachment_id"])
            out.append({"company": name, "chp": c.get("chp", ""), "registered": c.get("registered", ""), "missing": c["missing"],
                        "status": c.get("status", ""), "candidate_id": r["attachment_id"], "candidate_file": r.get("file", ""),
                        "candidate_location": r.get("post_type", "") or "ללא מיקום", "currently_assigned_to": assigned,
                        "evidence": evidence, "post_title": r.get("post_title", "")})
    with open(a.out, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["company", "chp", "registered", "missing", "status", "candidate_id", "candidate_file",
                                          "candidate_location", "currently_assigned_to", "evidence", "post_title"])
        w.writeheader()
        w.writerows(out)
    print(f"{found_any} מתוך {len(cov)} חברות שחסר להן מסמך קיבלו לפחות מועמד אחד -> {a.out}")
    print(f"{len(unassigned_cands)} קבצים מועמדים שעדיין לא משויכים לאף חברה")


if __name__ == "__main__":
    sys.exit(main())
