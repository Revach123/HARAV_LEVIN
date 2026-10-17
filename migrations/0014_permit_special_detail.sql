-- פירוט לכל מסמך המסווג "אחר": הסבר על מהות המסמך. מריצים פעם אחת ב-D1 (אחרי 0013).
ALTER TABLE permit_doc_special ADD COLUMN detail TEXT NOT NULL DEFAULT '';
