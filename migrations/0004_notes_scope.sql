-- באיזו רשימה מוצגת ההערה של החברה: '' (ברירת מחדל) / 'companies' = רק ברשימת החברות, 'bonds' = רק ברשימת האג"ח, 'both' = בשתיהן.
-- (הערה "בעלות גוי" ו"בפירוק" נשארות ברשימת האג"ח תמיד.) מריצים פעם אחת ב-D1:
ALTER TABLE businesses ADD COLUMN notes_scope TEXT DEFAULT '';
