# -*- coding: utf-8 -*-
"""
ייצוא רשימת מצטרפים מגיבוי בסיס הנתונים של וורדפרס (טופס 91), וביטולי הצטרפות (טופס 118).
רץ רק במחשב שלך: הפלט מכיל פרטים אישיים (כולל ת.ז. ו-IP), ואסור להעלות אותו לגיט או לשום מקום ציבורי.

בנוי להרחבה:
  * מיפוי השדות מהטופס לעמודות נמצא כולו ב-FIELD_MAP למטה: כדי להוסיף שדה או לשנות מיפוי, מוסיפים שורה אחת.
  * כל שדה שלא מופה נשמר ב"נוסף" (JSON), כך שלא הולך לאיבוד ואפשר למפות אותו אחר כך בלי לחלץ מחדש.
  * לכל הגשה יש מפתח מקור יציב (מקור + מספר שורה), כדי שגיבוי חדש יתווסף על הקיים בלי כפילויות.
  * שני התוספים (CFDB7 ו-Advanced CF7 DB) שומרים לעיתים את אותה הגשה: מאחדים לרשומה אחת.

    python joiners_export.py "wp-content\\updraft\\backup_..._-db.gz"
פלט (בתיקייה joiners_private, לא להעלות לגיט):
    joiners.csv            מצטרפים (טופס 91), מאוחדים; עמודה "ביטל" אם נמצא ביטול מתאים
    joiners_cancels.csv    כל ביטולי ההצטרפות (טופס 118), עם עמודה "הותאם למצטרף"
ומדפיס רק ספירות.
"""
import argparse
import collections
import csv
import gzip
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from joiners_probe import columns, inserts  # noqa: E402

JOIN_FORM, CANCEL_FORM = "91", "118"

# עמודה ברשימה -> שמות השדות האפשריים בטופס (לפי הסדר; הראשון שיש בו ערך נבחר). להוסיף שדה: להוסיף שורה כאן.
FIELD_MAP = {
    JOIN_FORM: {
        "שם פרטי": ["private"],
        "שם משפחה": ["family"],
        "תעודת זהות": ["id-number"],
        "דוא\"ל": ["your-email", "email", "youremail", "your-email2"],
        "טלפון": ["tel-760", "tel-780", "tel-860"],
        "חברות שנבחרו": ["companys"],
        "כל החברות": ["לבחירת כל החברות שנרשמו וירשמו בהמשך"],
        "קובץ אישור": ["wpcf7cfpdf_hidden_name"],
        "כתובת IP": ["submit_ip"],
    },
    CANCEL_FORM: {
        "שם": ["your-name"],
        "דוא\"ל": ["your-email"],
        "טלפון": ["tel-297"],
        "תאריך בקשה": ["date-475"],
    },
}
NOISE = re.compile(r"^(cfdb7_status|redirect_nonce|submit_time|submit_ip|_wpcf7|wpcf7cfpdf_hidden_(date|reference)|today|MydatePicker)", re.I)


# ───────── PHP unserialize (לשדות ש-CFDB7 שומר) ─────────
def php_unserialize(b, i=0):
    t = b[i:i + 1]
    if t == b"N":
        return None, i + 2
    if t in (b"b", b"i", b"d"):
        j = b.index(b";", i)
        raw = b[i + 2:j].decode()
        return (raw == "1" if t == b"b" else int(raw) if t == b"i" else float(raw)), j + 1
    if t == b"s":
        j = b.index(b":", i + 2)
        n = int(b[i + 2:j])
        s = b[j + 2:j + 2 + n].decode("utf-8", "replace")
        return s, j + 2 + n + 2
    if t == b"a":
        j = b.index(b":", i + 2)
        n = int(b[i + 2:j])
        i = j + 2
        out = {}
        for _ in range(n):
            k, i = php_unserialize(b, i)
            v, i = php_unserialize(b, i)
            out[k] = v
        return out, i + 1
    raise ValueError("serialize")


def maybe_unserialize(v):
    if isinstance(v, str) and v[:2] in ("a:", "s:", "i:", "b:"):
        try:
            return php_unserialize(v.encode("utf-8"))[0]
        except Exception:  # noqa: BLE001
            return v
    return v


def flat(v):
    if isinstance(v, dict):
        v = list(v.values())
    if isinstance(v, list):
        return ", ".join(str(x) for x in v if str(x).strip())
    return "" if v is None else str(v).strip()


# ───────── קריאת הגשות משני התוספים ─────────
def read_cfdb7(sql):
    cols = columns(sql, "wp_db7_forms")
    if not cols:
        return
    iid, ifm, ival, idt = cols.index("form_id"), cols.index("form_post_id"), cols.index("form_value"), cols.index("form_date")
    for r in inserts(sql, "wp_db7_forms"):
        try:
            data = php_unserialize(r[ival].encode("utf-8"))[0]
        except Exception:  # noqa: BLE001
            continue
        if isinstance(data, dict):
            yield {"מקור": "cfdb7", "מפתח": f"cfdb7:{r[iid]}", "טופס": r[ifm], "תאריך": r[idt], "שדות": {k: maybe_unserialize(v) for k, v in data.items()}}


def read_adv(sql):
    vc, ec = columns(sql, "wp_cf7_vdata"), columns(sql, "wp_cf7_vdata_entry")
    if not (vc and ec):
        return
    when = {}
    if "id" in vc and "created" in vc:
        ii, ci = vc.index("id"), vc.index("created")
        for r in inserts(sql, "wp_cf7_vdata"):
            when[r[ii]] = r[ci]
    ed, ef, en, ev = ec.index("data_id"), ec.index("cf7_id"), ec.index("name"), ec.index("value")
    groups = collections.OrderedDict()
    for r in inserts(sql, "wp_cf7_vdata_entry"):
        g = groups.setdefault((r[ef], r[ed]), {})
        g[r[en]] = maybe_unserialize(r[ev])
    for (form, did), fields in groups.items():
        yield {"מקור": "advcf7", "מפתח": f"advcf7:{did}", "טופס": form, "תאריך": fields.get("submit_time") or when.get(did, ""), "שדות": fields}


def to_row(sub):
    fm = FIELD_MAP[sub["טופס"]]
    f, used, row = sub["שדות"], set(), {}
    for col, names in fm.items():
        row[col] = ""
        for n in names:
            if n in f and flat(f[n]):
                row[col] = flat(f[n]); used.add(n)
                if col != "טלפון":
                    break
            if col == "טלפון" and n in f and flat(f[n]):
                row[col] = ", ".join(dict.fromkeys(x for x in [row[col], flat(f[n])] if x))
    extra = {k: flat(v) for k, v in f.items() if k not in used and not NOISE.match(str(k)) and flat(v)}
    row.update({"תאריך": str(sub["תאריך"])[:19], "מקור": sub["מקור"], "מפתח": sub["מפתח"], "נוסף": json.dumps(extra, ensure_ascii=False) if extra else ""})
    return row


def digits(x):
    return re.sub(r"\D", "", x or "")


def nm(x):
    return re.sub(r"[\s\"'`.\-]+", "", (x or "").lower())


def ts(x):
    from datetime import datetime
    try:
        return datetime.strptime(str(x)[:19], "%Y-%m-%d %H:%M:%S").timestamp()
    except ValueError:
        return None


def merge(rows, window=120):
    """אותה הגשה שנשמרה בשני התוספים נספרת פעם אחת: אותו אדם, ושעת ההגשה שונה בעד `window` שניות בין cfdb7 ל-advcf7.
    הגשות נפרדות של אותו אדם (גם באותו יום) נשארות נפרדות."""
    def ident(r):
        return digits(r.get("תעודת זהות")) or digits(r.get("טלפון"))[:10] or nm(r.get("שם פרטי", "") + r.get("שם משפחה", "")) or (r.get("דוא\"ל") or "").lower()
    cf = [r for r in rows if r["מקור"] == "cfdb7"]
    adv = [r for r in rows if r["מקור"] != "cfdb7"]
    by = collections.defaultdict(list)
    for r in cf:
        by[ident(r)].append(r)
    out, used = list(cf), set()
    for r in sorted(adv, key=lambda r: r["תאריך"]):
        t, best = ts(r["תאריך"]), None
        for c in by.get(ident(r), []):
            tc = ts(c["תאריך"])
            if id(c) in used or t is None or tc is None or abs(t - tc) > window:
                continue
            if best is None or abs(t - tc) < abs(t - ts(best["תאריך"])):
                best = c
        if best is None:
            out.append(r)
            continue
        used.add(id(best))
        keep, drop = (r, best) if sum(1 for v in r.values() if v) > sum(1 for v in best.values() if v) else (best, r)
        keep["מפתח"] = keep["מפתח"] + " | " + drop["מפתח"]
        for c, v in drop.items():
            if not keep.get(c) and v:
                keep[c] = v
        if keep is r:
            out[out.index(best)] = r
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("db_gz")
    ap.add_argument("--out", default="joiners_private")
    a = ap.parse_args()
    sql = gzip.open(a.db_gz, "rt", encoding="utf-8", errors="replace").read()
    subs = [s for s in list(read_cfdb7(sql)) + list(read_adv(sql)) if s["טופס"] in FIELD_MAP]
    joins = merge([to_row(s) for s in subs if s["טופס"] == JOIN_FORM])
    cancels = merge([to_row(s) for s in subs if s["טופס"] == CANCEL_FORM])
    by_mail = collections.defaultdict(list)
    by_tel = collections.defaultdict(list)
    by_name = collections.defaultdict(list)
    for j in joins:
        if j.get("דוא\"ל"):
            by_mail[j["דוא\"ל"].lower()].append(j)
        for t in re.split(r"[,\s]+", j.get("טלפון", "")):
            if len(digits(t)) >= 8:
                by_tel[digits(t)[-9:]].append(j)
        by_name[nm(j.get("שם פרטי", "") + j.get("שם משפחה", ""))].append(j)
    matched = 0
    for c in cancels:
        hit = by_mail.get((c.get("דוא\"ל") or "").lower(), []) or next((by_tel[digits(t)[-9:]] for t in re.split(r"[,\s]+", c.get("טלפון", "")) if len(digits(t)) >= 8 and by_tel.get(digits(t)[-9:])), []) or by_name.get(nm(c.get("שם")), []) if nm(c.get("שם")) else []
        c["הותאם למצטרף"] = ""
        for j in hit:
            j["ביטל"] = "כן, " + (c.get("תאריך בקשה") or c["תאריך"][:10]); c["הותאם למצטרף"] = "כן"
        matched += 1 if c["הותאם למצטרף"] else 0
    os.makedirs(a.out, exist_ok=True)
    jc = ["תאריך", "שם פרטי", "שם משפחה", "טלפון", "דוא\"ל", "תעודת זהות", "חברות שנבחרו", "כל החברות", "קובץ אישור", "כתובת IP", "ביטל", "נוסף", "מקור", "מפתח"]
    cc = ["תאריך", "שם", "טלפון", "דוא\"ל", "תאריך בקשה", "הותאם למצטרף", "נוסף", "מקור", "מפתח"]
    for fn, rows, cols in (("joiners.csv", joins, jc), ("joiners_cancels.csv", cancels, cc)):
        with open(os.path.join(a.out, fn), "w", encoding="utf-8-sig", newline="") as f:
            w = csv.DictWriter(f, fieldnames=cols, extrasaction="ignore")
            w.writeheader()
            w.writerows(sorted(rows, key=lambda r: r["תאריך"]))
    raw_join = sum(1 for s in subs if s["טופס"] == JOIN_FORM)
    print(f"הגשות הצטרפות שנקראו: {raw_join}; אחרי איחוד כפילויות בין התוספים: {len(joins)}")
    print(f"בקשות ביטול: {len(cancels)}; הותאמו למצטרף: {matched}; לא הותאמו: {len(cancels) - matched}; מצטרפים שסומנו כמבטלים: {sum(1 for j in joins if j.get('ביטל'))}")
    print("עמודות שלא מופו (מופיעות ב'נוסף'): " + ", ".join(k for k, _ in collections.Counter(k for r in joins for k in json.loads(r['נוסף'] or '{}')).most_common(10)))
    print(f"נכתב בתיקייה {a.out}: joiners.csv, joiners_cancels.csv  (פרטים אישיים: לא להעלות לגיט!)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
