-- שיוך מסמך היתר לאג"ח (בנוסף לשיוך לחברה). security_id = מספר נייר ערך. מריצים פעם אחת ב-D1.
CREATE TABLE IF NOT EXISTS permit_doc_bonds (
  doc_id       TEXT NOT NULL REFERENCES permit_docs(id) ON DELETE CASCADE,
  security_id  TEXT NOT NULL,
  name         TEXT NOT NULL DEFAULT '',
  symbol       TEXT NOT NULL DEFAULT '',
  company      TEXT NOT NULL DEFAULT '',
  chp          TEXT NOT NULL DEFAULT '',
  created_at   TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (doc_id, security_id)
);
CREATE INDEX IF NOT EXISTS idx_pdbond_sec ON permit_doc_bonds(security_id);
