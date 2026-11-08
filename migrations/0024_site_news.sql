-- תיבת העדכונים באתר (functions/api/news.js, news-embed.js): עדכונים ידניים מדף הניהול news-admin.html.
-- לא חובה להריץ: הטבלה נוצרת לבד בפעם הראשונה ששומרים עדכון.
CREATE TABLE IF NOT EXISTS site_news (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cat TEXT NOT NULL DEFAULT 'other',      -- companies | bonds | other
  text TEXT NOT NULL,
  link TEXT DEFAULT '',
  start_date TEXT DEFAULT '',             -- YYYY-MM-DD, ריק = מיד
  end_date TEXT DEFAULT '',               -- YYYY-MM-DD, ריק = בלי תפוגה
  pinned INTEGER DEFAULT 0,               -- 1 = מוצג ראשון
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
