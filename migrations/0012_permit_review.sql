-- מצב בדיקה לכל פריט בדשבורד "בדיקת מאגר המסמכים": אושר / שאלת מנהל. המפתח: "review:<מזהה חברה>", "manage:<מזהה חברה>" או "post:<מזהה מסמך>". מריצים פעם אחת ב-D1.
CREATE TABLE IF NOT EXISTS permit_review (
  key TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
