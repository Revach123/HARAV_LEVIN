# -*- coding: utf-8 -*-
"""
מחפש באתר הישן (עותק וורדפרס מקומי) תמונות שנראות כמו באנר / כותרת: רחבות ונמוכות יחסית,
ומעתיק את המועמדות לתיקיית banner_candidates כדי לבחור ביניהן. לא משנה דבר באתר.

הרצה מתיקיית האתר (C:\\localwp\\Local Sites\\iska\\app\\public):
    python find_banner.py
"""
import os
import shutil
import sys

try:
    from PIL import Image
except ImportError:
    sys.exit("חסרה Pillow: pip install pillow")

ROOT = os.path.join("wp-content")
OUT = "banner_candidates"
EXT = (".jpg", ".jpeg", ".png", ".webp", ".gif", ".svg")
NAME_HINT = ("banner", "header", "hero", "cover", "bg", "background", "slider", "באנר")
SKIP_DIRS = ("cache", "updraft", "plugins", "node_modules")


def main():
    found = []
    for base, dirs, files in os.walk(ROOT):
        dirs[:] = [d for d in dirs if d.lower() not in SKIP_DIRS or "uploads" in base.lower()]
        low = base.lower()
        if "updraft" in low or "/cache" in low.replace("\\", "/"):
            continue
        for f in files:
            if not f.lower().endswith(EXT):
                continue
            p = os.path.join(base, f)
            if f.lower().endswith(".svg"):
                score = 3 if any(h in f.lower() for h in NAME_HINT) else 0
                if score:
                    found.append((score, 0, 0, p))
                continue
            try:
                w, h = Image.open(p).size
            except Exception:
                continue
            if w < 900 or h < 80:
                continue
            ratio = w / h
            score = (2 if ratio >= 2.2 else 0) + (3 if any(x in f.lower() for x in NAME_HINT) else 0) + (1 if "theme" in low else 0)
            if score >= 2:
                found.append((score, w, h, p))
    found.sort(key=lambda x: (-x[0], -x[1]))
    os.makedirs(OUT, exist_ok=True)
    for i, (sc, w, h, p) in enumerate(found[:40], 1):
        dst = os.path.join(OUT, f"{i:02d}_{os.path.basename(p)}")
        shutil.copy2(p, dst)
        print(f"{i:02d}  {w}x{h}  {p}")
    print(f"\nהועתקו {min(len(found), 40)} מועמדות אל {OUT}\\ . לבחור את הבאנר ולשלוח לי אותו (או את שמו).")


if __name__ == "__main__":
    main()
