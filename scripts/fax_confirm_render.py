"""
אישורי הצטרפות בפקס: שולף מ-/api/fax-confirm את האישורים הממתינים (HTML - אותו אישור כמו במייל), מפיק PDF שחור-לבן חד (כמו גרסת הפקס של השטרות)
ומחזיר ל-/api/fax-confirm, שמשגר לספק. דורש: CRON_SECRET (משתנה סביבה), playwright+chromium, poppler-utils, pillow, numpy.
"""
import json, os, sys, tempfile, urllib.request
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fax_permit_pdfs import make_fax

BASE = os.environ.get("SITE", "https://harav-levin.pages.dev") + "/api/fax-confirm"
H = {"X-Cron-Secret": os.environ["CRON_SECRET"], "User-Agent": "Mozilla/5.0"}


def call(url, data=None):
    req = urllib.request.Request(url, data=data, headers=H, method="POST" if data is not None else "GET")
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read().decode())


def main():
    from playwright.sync_api import sync_playwright
    items = call(BASE).get("items", [])
    print(f"{len(items)} אישורים ממתינים")
    if not items: return
    with sync_playwright() as pw, tempfile.TemporaryDirectory() as td:
        b = pw.chromium.launch()
        for it in items:
            iid = it["id"]
            try:
                pg = b.new_page()
                pg.set_content(it["html"], wait_until="networkidle")
                src, dst = os.path.join(td, "s.pdf"), os.path.join(td, "f.pdf")
                pg.pdf(path=src, format="A4", margin={"top": "12mm", "bottom": "12mm", "left": "10mm", "right": "10mm"})
                pg.close()
                # PDF וקטורי רגיל (טקסט חד): הספק ממיר אותו בעצמו ל-200x300 בלי גרגור. (גרסת ה-CCITT עדיין לא אומתה מול הספק - make_fax)
                os.replace(src, dst)
                res = call(f"{BASE}?id={iid}", open(dst, "rb").read())
                print(f"{iid}: {res.get('status')}")
            except Exception as e:
                print(f"{iid}: נכשל ({e})")
        b.close()


if __name__ == "__main__":
    main()
