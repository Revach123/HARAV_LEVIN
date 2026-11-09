-- תיבת העדכונים באתר (functions/api/news.js, news-embed.js): עדכונים ידניים מדף הניהול news-admin.html.
-- לא חובה להריץ: הטבלה נוצרת לבד בפעם הראשונה ששומרים עדכון.
CREATE TABLE IF NOT EXISTS site_news (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cat TEXT NOT NULL DEFAULT 'other',      -- companies | bonds | other
  title TEXT DEFAULT '',                  -- השורה הראשונה בפס (ריק = לפי הנושא)
  text TEXT NOT NULL,
  link TEXT DEFAULT '',
  start_date TEXT DEFAULT '',             -- YYYY-MM-DD, ריק = מיד
  end_date TEXT DEFAULT '',               -- YYYY-MM-DD, ריק = בלי תפוגה
  pinned INTEGER DEFAULT 0,               -- 1 = מוצג ראשון
  active INTEGER DEFAULT 1,
  pending INTEGER DEFAULT 0,             -- 1 = נשלח מהאתר וממתין לאישור (לא מוצג)
  submitter TEXT DEFAULT '',              -- שם השולח (משליחה מהאתר)
  contact TEXT DEFAULT '',                -- טלפון / מייל של השולח
  ip_hash TEXT DEFAULT '',                -- להגבלת שליחות (לא הכתובת עצמה)
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
