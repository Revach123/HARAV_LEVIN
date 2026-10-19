-- טקסט, ח.פ. ושמות שנמצאו במסמכי ההיתר (נבנה בהרצה מקומית ומיובא): לחיפוש מסמך ולהצעות שיוך. מנהל בלבד.
-- הקישור למסמך הוא לפי sha256 (אותו מזהה תוכן של permit_docs), כך שאפשר לייבא גם לפני שהמסמך הועלה.
CREATE TABLE IF NOT EXISTS permit_doc_text (
  sha256     TEXT PRIMARY KEY,
  pages      INTEGER DEFAULT 0,
  chars      INTEGER DEFAULT 0,
  ocr        INTEGER DEFAULT 0,
  indexed_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS permit_doc_page (
  sha256 TEXT NOT NULL,
  page   INTEGER NOT NULL,
  text   TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (sha256, page)
);
-- מספרי תאגיד שנמצאו: src = text (טקסט המסמך) | stamp (חותמת / עט צבעוני) | hand (כתב יד); status = תקין | קרוב (לחותמת וכתב יד)
CREATE TABLE IF NOT EXISTS permit_doc_hp (
  sha256 TEXT NOT NULL,
  hp     TEXT NOT NULL,
  n      INTEGER DEFAULT 1,
  pages  TEXT DEFAULT '',
  src    TEXT NOT NULL DEFAULT 'text',
  status TEXT DEFAULT '',
  PRIMARY KEY (sha256, hp, src)
);
CREATE INDEX IF NOT EXISTS idx_pdh_hp ON permit_doc_hp(hp);
CREATE TABLE IF NOT EXISTS permit_doc_name (
  sha256 TEXT NOT NULL,
  name   TEXT NOT NULL,
  src    TEXT NOT NULL DEFAULT 'text',
  PRIMARY KEY (sha256, name, src)
);
CREATE INDEX IF NOT EXISTS idx_pdn_name ON permit_doc_name(name);
