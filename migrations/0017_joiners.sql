-- רשימת מצטרפים להיתר עיסקא (מנהל בלבד). כל הפרטים האישיים (שם, טלפון, דוא"ל, ת.ז., כתובת IP, החברות שנבחרו, שדות נוספים) נשמרים
-- כמטען JSON מוצפן (AES-256-GCM) בעמודה pii, שמוצפן במחשב המנהל לפני הייבוא; המפתח אינו נשמר כאן (משתנה סביבה JOINERS_KEY באתר בלבד).
-- בעמודות הגלויות יש רק מזהים ותאריכים. ident_hash = HMAC של ת.ז. (לאיתור כפילויות בלי לחשוף את המספר).
CREATE TABLE IF NOT EXISTS joiners (
  id           TEXT PRIMARY KEY,
  submitted_at TEXT DEFAULT '',
  cancelled_at TEXT DEFAULT '',
  file_sha256  TEXT DEFAULT '',
  ident_hash   TEXT DEFAULT '',
  pii          TEXT NOT NULL,
  imported_at  TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_joiners_ident ON joiners(ident_hash);
CREATE INDEX IF NOT EXISTS idx_joiners_date ON joiners(submitted_at);
-- בקשות ביטול הצטרפות (טופס 118); matched_joiners = מזהי מצטרפים שהותאמו (ריק אם לא הותאם)
CREATE TABLE IF NOT EXISTS joiner_cancels (
  id              TEXT PRIMARY KEY,
  requested_at    TEXT DEFAULT '',
  matched_joiners TEXT DEFAULT '',
  pii             TEXT NOT NULL,
  imported_at     TEXT DEFAULT (datetime('now'))
);
-- קובצי אישור ההצטרפות בדלי R2 הפרטי (ללא פרטים אישיים בשורה עצמה)
CREATE TABLE IF NOT EXISTS joiner_files (
  sha256        TEXT PRIMARY KEY,
  original_name TEXT DEFAULT '',
  r2_key        TEXT NOT NULL,
  size          INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_jf_name ON joiner_files(original_name);
