-- תת-שורה של חברה (אותו ח.פ., למשל "מסלול הלכה") כתיוג על המסמך, כמו שיוך לאג"ח:
-- המסמך משויך תמיד לחברה הראשית (permit_doc_companies), ובטבלה הזו מסומן לאיזו תת-שורה הוא שייך ובאיזה תפקיד.
-- slot: 'general' / 'private' / 'general,private' (משותף); ריק = מסמך נוסף של תת-השורה (בלי הת"ע). לכל תת-שורה מסמך אחד לכל תפקיד.
-- הטבלה נוצרת גם אוטומטית בשמירה הראשונה מהממשק; העברת הנתונים הקיימים: 0021_permit_doc_subs_move.sql
CREATE TABLE IF NOT EXISTS permit_doc_subs (
  doc_id  TEXT NOT NULL,
  sub_id  TEXT NOT NULL,
  slot    TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (doc_id, sub_id)
);
CREATE INDEX IF NOT EXISTS idx_pdsub_sub ON permit_doc_subs(sub_id);
