-- מונה קצב לכתובת IP עבור /api/bonds-export, אותו דפוס שימוש (upsert על
-- חלון זמן) כמו טבלת rate_limit ב-functions/api/_shared/guard.js ברפו
-- revach. לא כוללת את שאר guard() (בדיקת Origin, אתגר Turnstile, התראת
-- מייל) — אלה מיועדים להגנה על endpoints ציבוריים לא-מאומתים; bonds-export
-- כבר מוגן ב-Bearer token, וקריאה חיצונית לגיטימית (server-to-server)
-- בדרך כלל לא שולחת Origin/Referer בכלל. מה שחסר כאן הוא רק תקרה קשיחה
-- למקרה שה-token ידלוף/יינוצל לרעה.

CREATE TABLE IF NOT EXISTS bonds_export_rate_limit (
  ip           TEXT PRIMARY KEY,
  count        INTEGER NOT NULL DEFAULT 1,
  window_start INTEGER NOT NULL
);
