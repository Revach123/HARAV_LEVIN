-- מספר מנפיק בבורסה (המזהה של החברה במאיה) לעסק בלי מספר תאגיד. מוסיפים פעם אחת ב-D1.
ALTER TABLE businesses ADD COLUMN issuer_id TEXT DEFAULT '';
