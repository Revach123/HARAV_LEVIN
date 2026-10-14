# -*- coding: utf-8 -*-
"""
מציץ בכמה קבצי PDF לדוגמה (לפי שם קובץ) ומכין קובץ peek.txt: מספר עמודים, כמה טקסט יש, כמה תמונות, והטקסט של העמוד הראשון.
שימוש:  python peek.py "<תיקיית uploads>" [שם קובץ ...]
בלי שמות קבצים - לוקח את הדוגמאות שנבחרו מהבדיקה הראשונה.
"""
import os
import sys

from pypdf import PdfReader

DEFAULT = ["CDF.pdf", "GJJ.pdf", "FGH.pdf", "JFI.pdf", "AASDFD.pdf", "FRH.pdf"]


def find(root, name):
    for d, _, files in os.walk(root):
        if name in files:
            return os.path.join(d, name)
    return ""


def main():
    root = sys.argv[1]
    names = sys.argv[2:] or DEFAULT
    with open("peek.txt", "w", encoding="utf-8") as out:
        for n in names:
            p = find(root, n)
            out.write("=" * 60 + f"\n{n}  ({'נמצא' if p else 'לא נמצא'})\n")
            if not p:
                continue
            try:
                r = PdfReader(p)
                first = r.pages[0]
                text = first.extract_text() or ""
                try:
                    imgs = len(first.images)
                except Exception:  # noqa: BLE001
                    imgs = "?"
                alltext = sum(len((pg.extract_text() or "")) for pg in r.pages[:10])
                out.write(f"עמודים: {len(r.pages)} | תווים בעמוד 1: {len(text.strip())} | תווים ב-10 עמודים ראשונים: {alltext} | תמונות בעמוד 1: {imgs}\n")
                out.write("--- טקסט עמוד 1 (עד 1200 תווים) ---\n" + text.strip()[:1200] + "\n")
            except Exception as e:  # noqa: BLE001
                out.write(f"שגיאה בקריאה: {e}\n")
    print("נכתב peek.txt")


if __name__ == "__main__":
    main()
