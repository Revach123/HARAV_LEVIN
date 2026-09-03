-- טבלת אגרות חוב, ממולאת מרשימת הניירות הכללית של הבורסה (datawise
-- trade-securities-list — אותו מקור ש-sync-tase.js כבר משתמש בו לדגל
-- yes/no, לא משיכת "דפי חברה" פרטניים ממאיה). כל שורה מקושרת לחברה דרך
-- corporate_id = businesses.chp_number.
--
-- שדות המסחר (last_price, change_pct, interest, maturity_date, linkage,
-- base_index, turnover_kils, market_cap_kils) לא קיימים במשיכה הכללית
-- ונשארים ריקים עד לשלב הבא שימלא אותם ממקור נפרד — הטבלה כבר כוללת
-- אותם כדי ש-lists.js/index.html (שכבר תלויים בהם) לא יישברו.

CREATE TABLE IF NOT EXISTS bonds (
  security_id         TEXT PRIMARY KEY,
  bond_name            TEXT    DEFAULT '',
  symbol               TEXT    DEFAULT '',
  isin                 TEXT    DEFAULT '',
  corporate_id         TEXT    DEFAULT '',
  company_full_name    TEXT    DEFAULT '',
  security_type_code   TEXT    DEFAULT '',
  last_price           REAL,
  change_pct           REAL,
  interest             TEXT    DEFAULT '',
  maturity_date         TEXT    DEFAULT '',
  linkage              TEXT    DEFAULT '',
  base_index           TEXT    DEFAULT '',
  turnover_kils        REAL,
  market_cap_kils      REAL,
  trade_date           TEXT    DEFAULT '',
  last_seen_active     INTEGER DEFAULT 1,
  first_seen_at        TEXT    DEFAULT (datetime('now')),
  last_seen_at         TEXT    DEFAULT (datetime('now')),
  removed_at           TEXT
);

CREATE INDEX IF NOT EXISTS idx_bonds_corporate_id ON bonds(corporate_id);
