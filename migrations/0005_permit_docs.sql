-- מאגר מסמכי היתר עסקה (בשלב זה מוצג רק בדף הניהול, לא באתר הציבורי). מריצים פעם אחת ב-D1.
-- מסמך אחד יכול להיות משויך לכמה חברות (מסמך משותף) וחברה יכולה להיות משויכת לכמה מסמכים.
-- הקובץ עצמו נשמר ב-R2 (המפתח docs/<sha256>.pdf); קובץ זהה בתוכן לא נכנס פעמיים (sha256 ייחודי).
CREATE TABLE IF NOT EXISTS permit_docs (
  id             TEXT PRIMARY KEY,
  sha256         TEXT NOT NULL UNIQUE,
  file_key       TEXT NOT NULL,
  original_name  TEXT DEFAULT '',
  size           INTEGER DEFAULT 0,
  doc_type       TEXT NOT NULL DEFAULT 'unknown',     -- general | private | both | unknown
  note           TEXT DEFAULT '',
  source         TEXT DEFAULT 'upload',               -- upload | import
  source_ref     TEXT DEFAULT '',                     -- למשל מזהה הקובץ באתר הישן
  created_at     TEXT DEFAULT (datetime('now')),
  updated_at     TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS permit_doc_companies (
  doc_id       TEXT NOT NULL REFERENCES permit_docs(id) ON DELETE CASCADE,
  business_id  TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  created_at   TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (doc_id, business_id)
);

CREATE INDEX IF NOT EXISTS idx_pdc_business ON permit_doc_companies(business_id);
