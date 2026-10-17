-- מספר עמודים ותאריכים שנשלפו מהמסמך (להצגה ליד המסמך). doc_dates = מערך JSON של תאריכים בפורמט YYYY-MM-DD, מהמאוחר למוקדם. מריצים פעם אחת ב-D1.
ALTER TABLE permit_docs ADD COLUMN pages INTEGER NOT NULL DEFAULT 0;
ALTER TABLE permit_docs ADD COLUMN doc_dates TEXT NOT NULL DEFAULT '';
