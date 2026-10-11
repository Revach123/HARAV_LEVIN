# -*- coding: utf-8 -*-
"""
scripts/bonds_list/classify.py

עותק *מילולי* של coarse_type() מ-Revach (scripts/classify.py) — סיווג סוג נייר לפי
שדה securityType של מאיה. מועתק (לא מיובא) כדי ש-HARAV_LEVIN יישאר עצמאי.
כל שינוי בסיווג ב-Revach צריך להיעשות גם כאן ידנית.
"""


def coarse_type(security_type):
    s = (security_type or "").strip()
    if not s:
        return None
    if "מלוה קצר" in s or s == "מק\"מ":
        return "מק\"מ"
    if "ממשלת" in s:                       # שחר/גליל/גלובלית/גילון חדש
        return "אג\"ח ממשלתי"
    if "להמרה" in s:                        # אג"ח/אגח (הוני) ניתן להמרה
        return "אג\"ח להמרה"
    if "מסחרי" in s:                        # ני"ע מסחריים
        return "אג\"ח קונצרני"
    if "אג\"ח" in s or "אגח" in s or "שטר הון" in s or "חוב" in s:
        return "אג\"ח קונצרני"
    if "השתתפות" in s or s.startswith("יהש"):
        return "יחידת השתתפות"
    if "אופצי" in s:                        # אופציה.../אופצית רכישה
        return "אופציה"
    if "זכויות" in s:
        return "זכויות"
    if "מני" in s:                          # מניה.../מנית ...
        return "מניה"
    return None
