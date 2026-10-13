-- אג"ח שנבחרו ידנית בדף הניהול (אישור "בחירת אג"ח מסוימים"), לפי מספר נייר (security_id של הבורסה).
-- scope: private | general | both. שורה נשארת גם אם האג"ח כבר לא קיימת במאיה (לא מוצגת, לא נמחקת).
CREATE TABLE IF NOT EXISTS approved_bonds (
  security_id INTEGER PRIMARY KEY,
  chp_number  TEXT NOT NULL,
  bond_name   TEXT DEFAULT '',
  symbol      TEXT DEFAULT '',
  scope       TEXT NOT NULL CHECK (scope IN ('private','general','both')),
  created_at  TEXT DEFAULT (datetime('now')),
  updated_at  TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_approved_bonds_chp ON approved_bonds(chp_number);
