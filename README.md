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

## חיפוש עסק בקול – שלוחת ימות 6

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

**Secrets בפרויקט Cloudflare Pages** (`wrangler pages secret put <שם>`):

| שם | תפקיד |
|---|---|
| `IVR_SECRET` | חובה. אותו ערך כמו ב-`api_add_0=sk=` |
| `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION` | זיהוי דיבור (Azure, he-IL). אזור ברירת מחדל `eastus` |
| `YEMOT_TOKEN` | `<מספר-מערכת>:<סיסמה>`, להורדת ההקלטה מימות (או `YEMOT_TTS` = API KEY) |

**איך זה עובד:** השלוחה מקליטה את הקורא לקובץ (בתיקיית `IVR_REC_FOLDER`, ברירת מחדל `/6`), מורידה אותו, שולחת ל-Azure, מוחקת את ההקלטה, ומחפשת בטבלת `businesses`. מועמדים מוקראים לאישור (1 = כן, 2 = הבא). אחרי שלושה ניסיונות — הקשת ח.פ. בלי Azure/ימות-API השלוחה עובדת במצב ח.פ. בלבד.

**אפשרויות:** `IVR_VOICE_READ_OPTS` – דריסת זנב פקודת ה-`read` (`{folder}` ו-`{file}` מוחלפים); בלי Azure, אם ימות מחזירה טקסט מזוהה, זה המצב. `IVR_BACK_FOLDER` – לאן חוזרים בסיום (ברירת מחדל `/5`).

בדיקות מקומיות (בלי ימות): `node scripts/voice_search/simulate_ivr.mjs` ו-`node scripts/voice_search/test_voice_match.mjs`.
