# מערכת ניהול עסקים מורשים

אתר פשוט להצגת רשימת עסקים, עם ממשק מנהל לעריכה ושאיבה אוטומטית מרשם החברות.

---

## הכנה חד-פעמית (10 דקות)

### שלב 1 — התקן Node.js
הורד מ-https://nodejs.org (גרסה LTS) והתקן.

### שלב 2 — התקן Wrangler (כלי Cloudflare)
פתח Terminal / Command Prompt והרץ:
```
npm install -g wrangler
```

התחבר לחשבון Cloudflare שלך:
```
wrangler login
```

---

## הגדרת מסד הנתונים (D1)

### שלב 3 — צור מסד נתונים
```
wrangler d1 create business-registry-db
```

הפקודה תדפיס משהו כזה:
```
✅ Successfully created DB 'business-registry-db'
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

**העתק את ה-database_id** ופתח את הקובץ `wrangler.toml`.
החלף את `REPLACE_WITH_YOUR_DATABASE_ID` במספר שקיבלת.

### שלב 4 — צור את הטבלאות
```
wrangler d1 execute business-registry-db --file=./migrations/0001_initial.sql
```

---

## הגדרת סיסמת המנהל

### שלב 5 — שמור סיסמה כ-Secret מוצפן
```
wrangler pages secret put ADMIN_PASSWORD
```
הכנס את הסיסמה שתרצה (לא תוצג על המסך — זה בטוח).

---

## פריסה ל-Cloudflare Pages

### שלב 6 — חבר את GitHub
1. פתח https://dash.cloudflare.com
2. בחר **Pages** → **Create a project** → **Connect to Git**
3. בחר את ה-repository שבו שמרת את הקבצים
4. הגדרות build:
   - **Build command:** (השאר ריק)
   - **Build output directory:** `/`
5. לחץ **Save and Deploy**

### שלב 7 — חבר את D1 לפרויקט
1. בדשבורד Cloudflare, פתח את הפרויקט שיצרת
2. לחץ **Settings** → **Functions** → **D1 database bindings**
3. לחץ **Add binding**:
   - Variable name: `DB`
   - D1 database: בחר `business-registry-db`
4. שמור ו-Redeploy

---

## עדכון נתונים

כל `git push` לענף הראשי → הבנייה מתעדכנת אוטומטית ב-Cloudflare Pages.

---

## שימוש באתר

- **צפייה ציבורית:** כל אחד יכול לצפות בטבלה ולסנן
- **כניסת מנהל:** לחץ "כניסת מנהל" בפינה הימנית עליונה → הכנס הסיסמה שהגדרת
- **הוספת עסק:**
  1. הכנס מספר ח.פ. ולחץ "חפש ברשם"
  2. המערכת שואבת את השם מרשם החברות אוטומטית
  3. הוסף שם היתר עסקה אם שונה מהרשם
  4. מלא קטגוריה, אזור, הערות
  5. שמור

---

## מבנה קבצים

```
├── index.html                        ← האתר כולו (Frontend)
├── wrangler.toml                     ← הגדרות Cloudflare
├── migrations/
│   └── 0001_initial.sql             ← סכמת מסד הנתונים
└── functions/
    └── api/
        ├── _middleware.js           ← CORS לכל הנתיבים
        ├── businesses.js            ← GET רשימה / POST הוספה
        ├── businesses/
        │   └── [id].js             ← PUT עדכון / DELETE מחיקה
        └── lookup.js               ← פרוקסי לרשם החברות
```

---

## API (למפתחים)

| Method | נתיב | תיאור | Auth |
|--------|------|-------|------|
| GET    | `/api/businesses`      | רשימת כל העסקים | לא |
| POST   | `/api/businesses`      | הוספת עסק       | כן |
| PUT    | `/api/businesses/:id`  | עדכון עסק        | כן |
| DELETE | `/api/businesses/:id`  | מחיקת עסק        | כן |
| GET    | `/api/lookup?chp=XXX`  | שאיבה מרשם       | לא |

Auth = `Authorization: Bearer <סיסמה>`

---

## שאלות נפוצות

**שאלה:** הלחצן "חפש ברשם" לא עובד.  
**תשובה:** זה תקין — השאיבה עוברת דרך ה-Worker שלך (פונקציה בשרת). ודא שפרסת ל-Cloudflare.

**שאלה:** קיבלתי "Unauthorized" בעריכה.  
**תשובה:** ודא שהגדרת את `ADMIN_PASSWORD` כ-secret ב-Cloudflare Pages.

**שאלה:** רוצה לשנות סיסמה.  
**תשובה:** הרץ שוב `wrangler pages secret put ADMIN_PASSWORD` עם הסיסמה החדשה.

---

## חיפוש חברה בקול – שלוחת ימות 6

שלוחה נפרדת (`/api/ivr-company`), בלי תלות בשלוחה 5.

**`ext.ini` של שלוחה 6:**
```
type=api
api_link=https://harav-levin.pages.dev/api/ivr-company
api_add_0=sk=<IVR_SECRET>
tts_voice=jacob
tts_speed=8
title=חיפוש היתר עסקה חברות
```

**Secrets בפרויקט Cloudflare Pages** (לא ב-GitHub; `wrangler pages secret put <שם> --project-name harav-levin`, ואז פריסה מחדש):

| שם | תפקיד |
|---|---|
| `IVR_SECRET` | חובה. אותו ערך כמו ב-`api_add_0=sk=` |
| `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION` | זיהוי דיבור (Azure, he-IL). אזור ברירת מחדל `eastus` |
| `YEMOT_TOKEN` | `<מספר-מערכת>:<סיסמה>`, להורדת ההקלטה מימות |
| `YEMOT_TTS` | חלופה: API KEY של ימות (נשלח ב-header `authorization`) |

**חיפוש בכל מאגר הרישום:** בפרויקט הזה נדרש D1 binding בשם **`DB1`** לבסיס הנתונים `company-info-db` (אותו בסיס ש-revach משתמש בו: companies / partnerships / associations + אינדקסי FTS). בלעדיו השלוחה מחפשת רק בעסקים שבטבלת `businesses`.

**מה מוקרא לכל תוצאה** (כל תוצאה בשלוש הודעות נפרדות, כולן ברצף):
1. סוג: חברה פרטית / חברה ציבורית / שותפות מוגבלת / עמותה… (מחוקה מסומנת)
2. שם. "בע"מ" בסוף מוקרא בראשי תיבות ("בָּא אַם")
3. מצב היתר העסקה (הקישור לטבלת `businesses` לפי ח.פ., ובהיעדרו לפי שם): `visibility = 'רק פרטי'` = "לעסק זה יש רק היתר עסקה פרטי" + "ההיתר עסקה תקף רק למי שחתם על היתר עסקה פרטי"; `visibility = 'פרטי'` = "קיים גם היתר עסקה פרטי"; ריק = "קיים היתר עסקה כללי"; אין התאמה = "לא קיים היתר עסקה". אם לאותו ח.פ. כמה שורות, מוקרא הכי מלא ('פרטי' גובר על ריק, וריק גובר על 'רק פרטי'). המשפט החדש `permit:alsoPrivate` ינוגן ב-TTS של ימות עד שיופק לו קובץ שמע (workflow ‏ivr-audio).

אם נמצאו יותר מ-8 תוצאות לא מקריאים: "הרבה מדי אפשרויות, אנא אמרו את השם המלא, או חפשו לפי מספר ח.פ." (1 = שם מלא, 2 = ח.פ.). בסוף ההקראה: 1 = חיפוש נוסף, 2 = סיום.

**זרימה:** תפריט פותח (1 = לפי ח.פ., 2 = לפי שם). לפי שם: הקלטה (מוגבלת בזמן), זיהוי ב-Azure, חיפוש. ח.פ. שלא נמצא ממשיך לשם; אחרי שלושה ניסיונות לפי שם מציעים ח.פ. בלי Azure/ימות-API השלוחה עובדת במצב ח.פ. בלבד.

**אפשרויות (משתנים רגילים; מוגדרים בקובץ `wrangler.toml` תחת `[vars]`, כי הפרויקט מנוהל דרכו — לא בדשבורד):**
- `IVR_REC_MAX_SEC` (ברירת מחדל 6) ו-`IVR_REC_MIN_SEC` (1) – הגבלת זמן ההקלטה; `IVR_REC_MAX_SEC=0` מבטל את ההגבלה.
- `IVR_REC_FOLDER` (`/6`) – תיקיית ההקלטות הזמניות.
- `IVR_VOICE_READ_OPTS` – דריסת זנב פקודת ה-`read` של ההקלטה (`{folder} {file} {min} {max}` מוחלפים).
- `IVR_BACK_FOLDER` (`/5`) – לאן חוזרים בסיום.

בדיקות מקומיות (בלי ימות): `node --no-warnings scripts/voice_search/simulate_ivr.mjs` ו-`node scripts/voice_search/test_voice_match.mjs`.

### קבצי שמע של Azure לביטויים הקבועים

ההקראה בשלוחה 6 היא כברירת מחדל ב-TTS של ימות (`t-`). לביטויים **הקבועים** (התפריטים, סוג התאגיד, מצב ההיתר, "בָּא אַם") אפשר להפיק קבצי שמע ב-Azure (`he-IL-AvriNeural`) ולהעלות לימות (שלוחה 99); הקוד ישמיע אותם (`f-`) ברגע שהם קיימים, ובלעדיהם נופל ל-TTS. **שמות החברות** נשארים תמיד ב-TTS של ימות (דינמיים).

- הביטויים: `functions/api/_shared/ivr_phrases.js`. שינוי טקסט שם פוסל את הקובץ הישן אוטומטית עד שמופק חדש.
- הפקה: Actions ואז **ivr-audio** ואז **Run workflow** (קודם `dry_run`, אחר כך בלי). נדרשים secrets בריפו הזה: `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION`, `YEMOT_TTS`. ה-workflow מעלה לימות ורק אז עושה commit ל-`ivr_audio_manifest.js`. גם push ל-`main` שנוגע בביטויים מפעיל אותו (בלי secrets הוא מדלג).
- מקומית: `node scripts/ivr_audio/dump_phrases.mjs > phrases.json` ואחר כך `python scripts/ivr_audio/build_audio.py --phrases phrases.json [--dry-run]`.
- הגייה בעייתית ב-Azure: `PRONUNCIATIONS` ב-`ivr_phrases.js` (מילה מנוקדת ואז IPA). `build_audio.py` עוטף אותה ב-`<phoneme alphabet="ipa">`; אם Azure דוחה, הוא חוזר לטקסט המנוקד ומדווח בלוג (`"phoneme": false` במניפסט). כרגע: "חֶבְרָה" / "הַחֶבְרָה".

---

## רשימות האג"ח וכפתור "עדכן אג"ח מבורסה"

- **רשימת אג"ח אחת:** הקבצים `data/bonds_list/bonds_{private,general,all}.{json,csv}`. נבנים כל יום ב-GitHub Actions
  (`bonds-list`, `scripts/bonds_list/build_approved_bonds.py`) מדף החברה במאיה, רק לחברות מאושרות, רק ני"ע סחירים,
  בלי ני"ע מסחריים ובלי ניירות שאין להם שום תנאי (שער / ריבית / פדיון). ה-API (`/api/lists`) כבר לא מגיש אג"ח (410).
  האתר, דף הניהול ו-`display.html` (WordPress) קוראים את אותם קבצים.
- **ריצה יומית אחת לשמות, סוגים ודגל "יש אג"ח":** workflow `registry-refresh` (`--scope all`). בדף הניהול שני כפתורים, שניהם מפעילים
  את אותו סקריפט בלי עותק של הלוגיקה: "עדכן אג"ח מבורסה" = `--scope bonds` (קצר, רק הדגל) ו"עדכון מלא" = `--scope all`
  (כמו הריצה היומית, כ-6 דקות). ריצה חלקית כותבת דוח נפרד (`last_run_<scope>.json`). נדרש מפתח:
  `wrangler pages secret put GITHUB_DISPATCH_TOKEN --project-name harav-levin` (fine-grained token, הריפו הזה בלבד, הרשאה
  Actions: Read and write), ואז פריסה מחדש.
- **הרשימה הכללית (חברות ואג"ח):** כוללת גם עסקים עם היתר עסקה פרטי, חוץ ממי שמסומן במפורש "רק פרטי"
  (`agch_approved = 'רק פרטי'` או הערה שבה כתוב "רק ... פרטי"). עמודה "קיים היתר עסקה פרטי" מראה מי מהם.
- **אישור אג"ח לפרטי / כללי:** התהליך שבונה את רשימת האג"ח בודק אם האישור הוא רק לפרטי או רק לכללי (שדה "אישור אג"ח", או הערה מפורשת כמו
  "מאושר רק לאג"ח פרטי בלבד"). אישור "רק פרטי" לא נכנס לרשימה הכללית. הערה על אג"ח מוצגת כהערה בעמודת אישור האג"ח.
  זה שונה מ"רק פרטי" על היתר העסקה של החברה עצמה (`visibility = 'רק פרטי'`), שקובע אם החברה נשארת מחוץ לרשימת החברות הכללית.
- **ריבית** נשמרת ומוצגת עם עד 2 ספרות אחרי הנקודה, בלי אפסים מיותרים. **תשואה שנתית** = השדה `annual_yield` של הבורסה (כנראה 12 חודשים אחרונים; טרם אומת).



## הערות פומביות וייצוא לאקסל

- עמודת "הערות" (`notes`) מוצגת לציבור (הערות על אג"ח נשארות בעמודת האג"ח, לא בהערות) ברשימות החברות והאג"ח, ב-`display.html` ובתצוגה הציבורית ב-`index.html`.
- הכפתור "ייצוא לאקסל" בתצוגה הציבורית מוריד קובץ `.xlsx` אמיתי כטבלת Excel (מסננים, כותרת קפואה, מימין לשמאל), נבנה בדפדפן על ידי `xlsx-lite.js` (ללא ספריות חיצוניות). ייצואי ה-CSV של מסך הניהול נשארו CSV.
- בניהול ובטופס העריכה: ערך `visibility` נבחר מתוך "יש גם פרטי" (`פרטי`) או "רק פרטי".

## סטטוס רשם: מחוסלות מוסתרות, בפירוק מסומנות

- עמודה `businesses.registry_status` (`migrations/0002_registry_status.sql`, מוסיפים פעם אחת ב-D1) נקבעת בריצת `registry-refresh` מהרשם הממשלתי ("סטטוס חברה" / "סטטוס תאגיד"; לעמותות אין סטטוס).
- סטטוס שמתחיל ב"מחוסל", "חיסול", "מחוק" (מחוקה) או "נגרע" (נגרעה מהמרשם) - החברה לא מוצגת ברשימות החברות ולא נכללת ברשימת האג"ח.
- סטטוס שמתחיל ב"בפרוק" - החברה נשארת, ובעמודת ההערות (וברשימת האג"ח) מופיע "בפירוק".
- הגנה: אם יותר מ-10 חברות (או 3%) שהיו מוצגות הופכות למחוסלות בריצה אחת - הכתיבה נעצרת.
- כל עוד העמודה לא קיימת במסד, הכול ממשיך לעבוד בלי סינון.
## הטמעה בוורדפרס: iframe + גובה אוטומטי + כותרת קבועה (במחשב)

בלוק קוד אחד בעמוד (HTML מותאם אישית). `OFFSET` = גובה כותרת עליונה קבועה של האתר בפיקסלים (או 0 אם אין). הכותרת הקבועה פעילה ברוחב חלון של 992 פיקסלים ומעלה בלבד.
הקוד בכוונה בלי התווים `&`, `<`, `>` בתוך הסקריפט (וורדפרס / Avada מקודדים אותם ושוברים את הקוד), ובודק את מיקום ה-iframe בכל פריים (עובד גם כשהגלילה היא של אלמנט פנימי באתר ולא של החלון).

```html
<iframe id="hl-frame" src="https://harav-levin.pages.dev/display.html" style="width:100%;height:700px;border:0" scrolling="no"></iframe>
<script>
(function(){
var f=document.getElementById("hl-frame"),O="https://harav-levin.pages.dev",OFFSET=0,last=null,tick=0;
window.addEventListener("message",function(e){if(e.origin===O){if(e.data){if(e.data.source==="harav-levin"){if(e.data.type==="resize"){f.style.height=e.data.height+"px";}}}}});
function send(){var r=f.getBoundingClientRect();var t=Math.round(r.top);tick=tick+1;if(t!==last||tick%60===0){last=t;if(f.contentWindow){f.contentWindow.postMessage({source:"harav-parent",type:"scroll",top:t,offset:OFFSET,desktop:Math.floor(window.innerWidth/992)>0},O);}}window.requestAnimationFrame(send);}
window.requestAnimationFrame(send);
})();
</script>
```

**אבחון:** מוסיפים `?debug=1` ל-`src` של ה-iframe (`.../display.html?debug=1`). בפינה השמאלית העליונה יופיע תג קטן:
`sticky: parent connected (...)` = הקוד בעמוד עובד; `sticky: NO messages from the parent page` = הקוד העדכני לא נמצא בעמוד (או שהוא נשבר), צריך להחליף את הבלוק.
## אישור "בחירת אג"ח מסוימים" (אג"ח ספציפיות לחברה)

- בדף הניהול, באישור אג"ח: האפשרות **בחירת אג"ח מסוימים** פותחת חלון (וכפתור ⚙ ליד הבחירה) עם אג"ח החברה ממאיה (`data/bonds_list/maya_securities.json`, נבנה יומית), וכפתורי **פרטי / כללי** לכל אג"ח (אפשר שניהם). אפשר גם להוסיף אג"ח לפי מספר נייר.
- השמירה בטבלה `approved_bonds` (`migrations/0003_approved_bonds.sql`, מריצים פעם אחת ב-D1) דרך `PUT /api/approved-bonds` (ניהול בלבד).
- `bonds-list` קורא את הטבלה (`GET /api/approved-bonds`) ומוסיף את האג"ח שנבחרו, **רק אם הן עדיין קיימות במאיה** (סחירות ולא נמחקו). אג"ח שנעלמה ממאיה נשארת שמורה (לא נמחקת) ולא מוצגת; מחיקה רק ידנית בחלון (🗑).
- חברה "מאושרת" (כן / רק פרטי / רק כללי) מציגה את כל האג"ח שלה כרגיל; הבחירה הידנית משפיעה על חברות שמסומנות "בחירת אג"ח מסוימים" (או שאינן מאושרות).
- ברשימת החברות הציבורית החברה מופיעה "יש אג"ח - מאושר (אג"ח מסוימים)".
- אם הטבלה או ה-endpoint עדיין לא קיימים - bonds-list ממשיך כרגיל בלי אג"ח ידניות; שגיאת רשת/שרת בקריאה (לא 404) עוצרת את הריצה ולא דורסת את הרשימות.

## ⚠ לוגיקה כפולה עם Revach (לזכור לתקן בשני המקומות)

HARAV_LEVIN נשאר עצמאי, ולכן יש קוד שהועתק מהריפו **Revach** (ולהפך). תיקון באחד = לבדוק אם צריך גם בשני:

| כאן (HARAV_LEVIN) | ב-Revach | מה זה |
|---|---|---|
| `scripts/bonds_list/classify.py` (`coarse_type`) | `scripts/classify.py` | סיווג סוג נייר (אג"ח קונצרני / ממשלתי / להמרה ...). ני"ע מסחריים נחשבים אג"ח קונצרני בשניהם. |
| `scripts/bonds_list/enrich.py`: דירוגים (מידרוג, מעלות) | `scripts/securities/fetch_securities.py` (Phase 3, 4) | משיכת דירוגים: אתר מידרוג + דוחות הדירוג ב-Maya (אירוע 206). |
| `enrich.py`: תדירות ריבית ואג"ח לשיעורין | `fetch_securities.py` (Phase 5) | אירועי חברה ב-Maya: תשלום ריבית (7), פדיון חלקי (9). |
| `enrich.py`: `gen_coupon_times`, `solve_ytm` | `securities.html` (`genCouponTimes`, `solveYtm2`) | תשואה לפדיון ברוטו. בשניהם מוסיפים ריבית צבורה למחיר (מחיר נקי -> מלא; תוקן גם ב-Revach ב-13.10.2026). |
| `enrich.py`: `eligible_for_ytm` | `securities.html` (`tryComputeYtm`) | מתי לא מחשבים תשואה. **הבדל מכוון:** כאן רק אג"ח לא צמודות; ב-Revach גם צמודות מדד (שיטה שטרם אומתה). |
| `scripts/bonds_list/build_approved_bonds.py` (`is_goyim`, הערות "גוי") | `heter_iska_lookup` | זיהוי בעלות גוי לפי הערות החברה. |
| רשימת "מי מאושר" (`businesses.agch_approved`, `visibility`) | `NOTES_*` ב-Revach | הגדרה כפולה של "מי מאושר". |

הערות על העמודות הנוספות ברשימת האג"ח: `midroog_rating`, `maalot_rating`, `ytm_gross` (תשואה לפדיון ברוטו, לא צמוד בלבד, "המידע בבדיקה").
מצב הרצה מתמשך נשמר ב-`data/bonds_list/enrich_state.json`. בריצה הראשונה נסרקים דוחות דירוג של 400 יום (`RATINGS_LOOKBACK_DAYS`). אם משהו נכשל, העמודות נשארות ריקות והרשימה נבנית כרגיל.
