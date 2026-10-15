-- קישור מסמך לרישום של החברה: "slot" = לאיזו רשימה (כללי / פרטי) המסמך הוא המסמך הראשי של החברה.
-- ערכים: ריק (מסמך נוסף, לא מקושר לרשימה) | general | private | general,private (מסמך משולב ששייך לשתי הרשימות).
-- לכל חברה מסמך אחד לכל רשימה. מריצים פעם אחת ב-D1.
ALTER TABLE permit_doc_companies ADD COLUMN slot TEXT NOT NULL DEFAULT '';
