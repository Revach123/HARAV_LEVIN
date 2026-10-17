-- מידע מהסריקה המקומית לכל מסמך: מקור באתר הישן (כללי / פרטי / נוסף), שם הפוסט, חברה לפי שם הפוסט, ממצאים לבדיקה והצעות שיוך. JSON קטן. מריצים פעם אחת ב-D1.
ALTER TABLE permit_docs ADD COLUMN intel TEXT NOT NULL DEFAULT '';
