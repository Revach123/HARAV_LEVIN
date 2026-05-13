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
