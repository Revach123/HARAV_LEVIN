-- חברות שאינן במאגר העסקים (מחוקות / מוזגו / לא מופיעות במאגר) שאליהן משויכים מסמכי היתר, כדי שהמסמך לא יישאר "לא משויך".
-- status: deleted (מחוקה) | merged (מוזגה) | not_in_db (אינה מופיעה במאגר). מריצים פעם אחת ב-D1.
CREATE TABLE IF NOT EXISTS permit_ext_companies (
  id          TEXT PRIMARY KEY,
  chp         TEXT NOT NULL DEFAULT '',
  name        TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'not_in_db',
  note        TEXT NOT NULL DEFAULT '',
  created_at  TEXT DEFAULT (datetime('now')),
  updated_at  TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_pext_chp ON permit_ext_companies(chp);

CREATE TABLE IF NOT EXISTS permit_doc_ext (
  doc_id  TEXT NOT NULL REFERENCES permit_docs(id) ON DELETE CASCADE,
  ext_id  TEXT NOT NULL REFERENCES permit_ext_companies(id) ON DELETE CASCADE,
  PRIMARY KEY (doc_id, ext_id)
);
CREATE INDEX IF NOT EXISTS idx_pdext_ext ON permit_doc_ext(ext_id);
