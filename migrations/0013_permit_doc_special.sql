-- מסמכים ראשיים מיוחדים: מסמך שמופיע באתר הסופי של החברה תחת כותרת משלו, בנוסף להת"ע הראשי הפרטי והכללי. מריצים פעם אחת ב-D1.
CREATE TABLE IF NOT EXISTS permit_doc_special (
  doc_id TEXT NOT NULL,
  business_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (doc_id, business_id)
);
