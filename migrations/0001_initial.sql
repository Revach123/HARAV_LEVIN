CREATE TABLE IF NOT EXISTS businesses (
  id            TEXT PRIMARY KEY,
  chp_number    TEXT    DEFAULT '',
  registrar_name TEXT   DEFAULT '',
  permit_name   TEXT    DEFAULT '',
  category      TEXT    DEFAULT '',
  region        TEXT    DEFAULT '',
  notes         TEXT    DEFAULT '',
  has_details   INTEGER DEFAULT 0,
  created_at    TEXT    DEFAULT (datetime('now')),
  updated_at    TEXT    DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_registrar_name ON businesses(registrar_name);
CREATE INDEX IF NOT EXISTS idx_category ON businesses(category);
