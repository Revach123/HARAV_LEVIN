#!/usr/bin/env python3
"""
build_audio.py — מייצר ב-Azure Speech קובץ שמע לכל ביטוי קבוע של שלוחה 6, ומעלה לימות.

קלט:  JSON מ-dump_phrases.mjs ({voice, folder, phrases:{מפתח: טקסט}}).
פלט:  קבצי wav בשלוחת השמע בימות (ברירת מחדל 99) + functions/api/_shared/ivr_audio_manifest.js:
      {מפתח: {text, voice, path}} — path הוא מה שהקוד מעביר ל-f- (בלי סיומת).

אינקרמנטלי: ביטוי שהטקסט והקול שלו כבר במניפסט — מדלגים. טקסט שהשתנה — מופק מחדש (והקובץ
הישן נפסל בקוד אוטומטית, כי הקוד משווה את הטקסט). המניפסט נכתב רק לביטויים שההעלאה שלהם הצליחה.

משתני סביבה:
  AZURE_SPEECH_KEY, AZURE_SPEECH_REGION   (region ברירת מחדל: eastus)
  YEMOT_TTS      API KEY של ימות (נשלח ב-header authorization).

דוגמאות:
  node scripts/ivr_audio/dump_phrases.mjs > /tmp/phrases.json
  python scripts/ivr_audio/build_audio.py --phrases /tmp/phrases.json --dry-run
  python scripts/ivr_audio/build_audio.py --phrases /tmp/phrases.json
"""
import argparse
import hashlib
import json
import os
import re
import sys
import time
from xml.sax.saxutils import escape

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_MANIFEST = os.path.join(HERE, "..", "..", "functions", "api", "_shared", "ivr_audio_manifest.js")
UPLOAD_URL = "https://www.call2all.co.il/ym/api/UploadFile"
AZURE_FORMAT = "riff-8khz-16bit-mono-pcm"      # wav טלפוניה: 8kHz, 16bit, mono
HEADER = '// נוצר ע"י scripts/ivr_audio/build_audio.py - אל תערוך ידנית.\n' \
         '// {מפתח ביטוי: {text, voice, path}} - path הוא נתיב הקובץ בימות (בלי סיומת).\n'
PREFIX = "export default "


def file_name(voice, text):
    return "c6_" + hashlib.sha1(f"{voice}\n{text}".encode("utf-8")).hexdigest()[:12]


def read_manifest(path):
    if not os.path.exists(path):
        return {}
    with open(path, encoding="utf-8") as f:
        src = f.read()
    i = src.index(PREFIX) + len(PREFIX)
    return json.loads(src[i:].strip().rstrip(";"))


def write_manifest(path, manifest):
    with open(path, "w", encoding="utf-8") as f:
        f.write(HEADER + PREFIX + json.dumps(dict(sorted(manifest.items())), ensure_ascii=False, indent=1) + ";\n")


def ssml_for(text, voice, prons=()):
    """SSML ל-Azure. prons = [(מילה, IPA)]: כל מילה עטופה ב-<phoneme alphabet='ipa'>."""
    body = escape(text)
    if prons:
        words = sorted((w for w, _ in prons), key=len, reverse=True)
        ipa = dict(prons)
        rx = re.compile("(?<![\u05d0-\u05ea])(" + "|".join(re.escape(escape(w)) for w in words) + ")")
        lookup = {escape(w): v for w, v in ipa.items()}
        body = rx.sub(lambda m: f"<phoneme alphabet='ipa' ph='{lookup[m.group(1)]}'>{m.group(1)}</phoneme>", body)
    return ("<speak version='1.0' xml:lang='he-IL' xmlns='http://www.w3.org/2001/10/synthesis'>"
            f"<voice name='{voice}'>{body}</voice></speak>")


def prons_sig(prons):
    return hashlib.sha1(json.dumps(prons, ensure_ascii=False).encode("utf-8")).hexdigest()[:8] if prons else ""


def azure_tts(session, region, key, body, retries=7):
    url = f"https://{region}.tts.speech.microsoft.com/cognitiveservices/v1"
    headers = {
        "Ocp-Apim-Subscription-Key": key,
        "Content-Type": "application/ssml+xml; charset=utf-8",
        "X-Microsoft-OutputFormat": AZURE_FORMAT,
        "User-Agent": "harav-levin-ivr-audio/1.0",
    }
    last = None
    for attempt in range(retries):
        r = session.post(url, headers=headers, data=body.encode("utf-8"), timeout=60)
        if r.status_code == 200 and r.content[:4] == b"RIFF":
            return r.content
        last = f"{r.status_code} {r.text[:200]}"
        if r.status_code in (429, 500, 502, 503, 504):
            try:
                wait = float(r.headers.get("Retry-After", 0))
            except ValueError:
                wait = 0
            time.sleep(min(60, max(wait, 5 * 2 ** attempt)))
            continue
        break
    raise RuntimeError(f"Azure Speech נכשל: {last}")


class YemotAuthError(RuntimeError):
    """הרשאה נדחתה — אין טעם להמשיך או לנסות שוב."""


def yemot_upload(session, api_key, folder, name, wav, retries=3):
    """UploadFile: multipart. convertAudio=1 דורש path שמסתיים ב-.wav; ה-API KEY ב-header authorization."""
    path = f"ivr2:{folder}/{name}.wav"          # כמו ב-revach: ivr2:99/<שם>.wav
    last = None
    for attempt in range(retries):
        try:
            r = session.post(UPLOAD_URL, data={"path": path, "convertAudio": "1"},
                             headers={"authorization": api_key},
                             files={"file": (f"{name}.wav", wav, "audio/wav")}, timeout=120)
            j = r.json()
            if j.get("responseStatus") == "OK":
                return j
            last = json.dumps(j, ensure_ascii=False)[:300]
            if j.get("responseStatus") == "FORBIDDEN" or "MFA_REQUIRED" in json.dumps(j):
                raise YemotAuthError(f"ימות דחתה את YEMOT_TTS: {last}")
            if j.get("responseCode") in (107, 108, 109, 110):
                break
        except YemotAuthError:
            raise
        except Exception as e:  # noqa: BLE001
            last = str(e)
        time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"UploadFile נכשל ({path}): {last}")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--phrases", required=True, help="פלט dump_phrases.mjs")
    ap.add_argument("--manifest", default=DEFAULT_MANIFEST)
    ap.add_argument("--folder", default=None, help="שלוחת קבצי השמע בימות (ברירת מחדל: מקובץ הביטויים)")
    ap.add_argument("--dry-run", action="store_true", help="רשימה בלבד, בלי Azure ובלי ימות")
    a = ap.parse_args()

    with open(a.phrases, encoding="utf-8") as f:
        data = json.load(f)
    voice, folder = data["voice"], a.folder or data["folder"]
    prons = [tuple(x) for x in data.get("pronunciations", [])]
    sig = prons_sig(prons)
    manifest = read_manifest(a.manifest)

    def uses_pron(t):
        return any(w in t for w, _ in prons)

    # ביטוי מיושן: טקסט/קול השתנו, או (אם יש בו מילה עם הגייה) חתימת ההגיות השתנתה
    todo = [(k, t) for k, t in data["phrases"].items()
            if not (k in manifest and manifest[k].get("text") == t and manifest[k].get("voice") == voice
                    and (not uses_pron(t) or manifest[k].get("pron", "") == sig))]
    chars = sum(len(t) for _, t in todo)
    print(f"ביטויים: {len(data['phrases'])} | חדשים או ששונו: {len(todo)} | תווים: {chars} | קול: {voice} | שלוחה: {folder}")
    for k, t in todo:
        print(f"  {k:28s} {t}")
    if a.dry_run or not todo:
        print("dry-run — לא נקראו Azure וימות." if a.dry_run else "אין מה לייצר.")
        return

    key = os.environ.get("AZURE_SPEECH_KEY")
    region = os.environ.get("AZURE_SPEECH_REGION") or "eastus"
    api_key = os.environ.get("YEMOT_TTS")
    if not key:
        sys.exit("חסר AZURE_SPEECH_KEY")
    if not api_key:
        sys.exit("חסר YEMOT_TTS (API KEY של ימות)")

    import requests  # בייבוא מאוחר כדי ש-dry-run לא ידרוש את החבילה
    session = requests.Session()
    done, rc = 0, 0
    try:
        for k, t in todo:
            name = file_name(voice, t) + sig
            used = sig if uses_pron(t) else ""
            try:
                wav = azure_tts(session, region, key, ssml_for(t, voice, prons if used else ()))
            except RuntimeError as e:
                if not used:
                    raise
                print(f"אזהרה: Azure דחה את ה-SSML עם phoneme עבור «{k}» ({e}); חוזר לטקסט המנוקד.", file=sys.stderr)
                used = ""
                wav = azure_tts(session, region, key, ssml_for(t, voice))
            yemot_upload(session, api_key, folder, name, wav)
            manifest[k] = {"text": t, "voice": voice, "path": f"/{folder}/{name}", "pron": sig if uses_pron(t) else "", "phoneme": bool(used)}
            done += 1
    except YemotAuthError as e:
        print(f"שגיאה: {e}", file=sys.stderr)
        rc = 3
    finally:
        # נשמר רק מה שהועלה בפועל; ריצה חוזרת ממשיכה משם
        write_manifest(a.manifest, manifest)
        print(f"הועלו {done}/{len(todo)} ביטויים. מניפסט: {len(manifest)} רשומות.")
    if rc:
        sys.exit(rc)


if __name__ == "__main__":
    main()
