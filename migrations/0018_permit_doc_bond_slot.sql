-- תפקיד המסמך לאג"ח: 'private' / 'general' / 'general,private' (משותף), כמו הת"ע של חברה. ריק = טרם סווג.
-- לכל אג"ח מסמך אחד לכל תפקיד. מריצים פעם אחת ב-D1.
ALTER TABLE permit_doc_bonds ADD COLUMN slot TEXT NOT NULL DEFAULT '';
