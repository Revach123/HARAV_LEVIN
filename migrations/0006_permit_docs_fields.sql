-- שדות נוספים למאגר מסמכי היתר עסקה: כותרת הפוסט באתר הישן, והצעות שיוך (JSON) שחושבו בבדיקה המקומית. מריצים פעם אחת ב-D1.
ALTER TABLE permit_docs ADD COLUMN source_title TEXT DEFAULT '';
ALTER TABLE permit_docs ADD COLUMN suggest TEXT DEFAULT '';
