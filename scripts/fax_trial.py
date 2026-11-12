"""
ניסוי איכות פקס לשטר אחד: מפיק מהשטר גרסת ניסוי (תמונת שחור-לבן 1-bit בדחיסת Flate, עמוד A4 בדיוק 1728x2292 - כמו שהספק משדר בפועל, בלי CCITT)
ושולח אותה דרך האתר (functions/api/fax-confirm.js, ?trial) למספר שצוין. לא משנה כלום ב-R2 או ב-D1 מעבר לשורת ניסוי בתור.
שימוש: python fax_trial.py <doc_id> <fax>     דורש: wrangler, poppler-utils, pillow, numpy, img2pdf, CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID, CRON_SECRET
"""
import io, json, os, re, sys, tempfile, urllib.request
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from compress_permit_pdfs import d1, r2_get, pages, sh, ID_RE, KEY_RE, log
from fax_permit_pdfs import binarize
from PIL import Image
import glob, img2pdf

W, H, DX, DY = 1728, 2292, 204, 196          # 1728x2292 = מה שהספק משדר (A4 ב-204x196)
BASE = os.environ.get("SITE", "https://harav-levin.pages.dev") + "/api/fax-confirm"
HDR = {"X-Cron-Secret": os.environ.get("CRON_SECRET", ""), "User-Agent": "Mozilla/5.0"}


def call(url, data=None):
    req = urllib.request.Request(url, data=data, headers=HDR, method="POST" if data is not None else "GET")
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read().decode())


def main():
    doc_id, fax = sys.argv[1], re.sub(r"\D", "", sys.argv[2])
    if not ID_RE.match(doc_id) or not re.match(r"^0\d{8,10}$", fax): sys.exit("bad args")
    rows = d1(f"SELECT file_key, original_name FROM permit_docs WHERE id = '{doc_id}'")
    if not rows or not KEY_RE.match(str(rows[0]["file_key"])): sys.exit("doc not found")
    with tempfile.TemporaryDirectory() as td:
        src = os.path.join(td, "o.pdf")
        r2_get(str(rows[0]["file_key"]), src)
        n = pages(src)
        log(f"{doc_id}: {n} עמודים")
        sh(["pdftoppm", "-rx", str(DX), "-ry", str(DY), "-gray", "-png", src, os.path.join(td, "p")], timeout=600)
        pngs = []
        for f in sorted(glob.glob(os.path.join(td, "p-*.png"))):
            bw = binarize(Image.open(f).convert("L"))
            canvas = Image.new("1", (W, H), 1)
            if bw.width > W or bw.height > H:
                bw = bw.resize((min(bw.width, W), min(bw.height, H)))
            canvas.paste(bw, ((W - bw.width) // 2, (H - bw.height) // 2))
            buf = io.BytesIO(); canvas.save(buf, "PNG"); pngs.append(buf.getvalue())
        pdf = img2pdf.convert(pngs, layout_fun=img2pdf.get_fixed_dpi_layout_fun((W / (210 / 25.4), H / (297 / 25.4))))
        log(f"PDF נוצר: {len(pdf)} בייט, {len(pngs)} עמודים")
        tid = call(f"{BASE}?trial={fax}")["id"]
        res = call(f"{BASE}?id={tid}", pdf)
        log(f"נשלח לספק: {res}")


if __name__ == "__main__":
    main()
