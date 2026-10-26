-- העברה חד-פעמית: מסמכים שמשויכים ישירות לעסק של תת-שורה עוברים לחברה הראשית, עם תיוג תת-השורה (permit_doc_subs).
-- תת-שורה = עסק עם שם בהיתר שונה מהשם ברשם, שיש לו עסק אחר עם אותו ח.פ. שהשם בהיתר שלו ריק או כמו ברשם (הראשי).
-- מריצים אחרי 0020. בטוח להרצה חוזרת (אחרי ההעברה אין יותר שיוכים ישירים לתת-שורות). בלי טבלה זמנית (D1 חוסם CREATE TEMP).

-- 1. התיוג: המסמך ותפקידו בתת-השורה
WITH sm AS (
  SELECT s.id AS sub_id, (SELECT m.id FROM businesses m WHERE m.chp_number = s.chp_number AND m.id != s.id
           AND (TRIM(m.permit_name) = '' OR REPLACE(m.permit_name, ' ', '') = REPLACE(m.registrar_name, ' ', '')) LIMIT 1) AS main_id
  FROM businesses s
  WHERE TRIM(COALESCE(s.chp_number, '')) != '' AND TRIM(s.permit_name) != '' AND REPLACE(s.permit_name, ' ', '') != REPLACE(s.registrar_name, ' ', ''))
INSERT OR IGNORE INTO permit_doc_subs (doc_id, sub_id, slot)
  SELECT c.doc_id, c.business_id, COALESCE(c.slot, '') FROM permit_doc_companies c JOIN sm ON sm.sub_id = c.business_id WHERE sm.main_id IS NOT NULL;

-- 2. המסמך משויך לחברה הראשית (בלי הת"ע של הראשית; אם כבר משויך - נשאר כמו שהוא)
WITH sm AS (
  SELECT s.id AS sub_id, (SELECT m.id FROM businesses m WHERE m.chp_number = s.chp_number AND m.id != s.id
           AND (TRIM(m.permit_name) = '' OR REPLACE(m.permit_name, ' ', '') = REPLACE(m.registrar_name, ' ', '')) LIMIT 1) AS main_id
  FROM businesses s
  WHERE TRIM(COALESCE(s.chp_number, '')) != '' AND TRIM(s.permit_name) != '' AND REPLACE(s.permit_name, ' ', '') != REPLACE(s.registrar_name, ' ', ''))
INSERT OR IGNORE INTO permit_doc_companies (doc_id, business_id, slot)
  SELECT c.doc_id, sm.main_id, '' FROM permit_doc_companies c JOIN sm ON sm.sub_id = c.business_id WHERE sm.main_id IS NOT NULL;

-- 3. "אחר" (עם כותרת) שהיה על תת-השורה עובר לחברה הראשית
WITH sm AS (
  SELECT s.id AS sub_id, (SELECT m.id FROM businesses m WHERE m.chp_number = s.chp_number AND m.id != s.id
           AND (TRIM(m.permit_name) = '' OR REPLACE(m.permit_name, ' ', '') = REPLACE(m.registrar_name, ' ', '')) LIMIT 1) AS main_id
  FROM businesses s
  WHERE TRIM(COALESCE(s.chp_number, '')) != '' AND TRIM(s.permit_name) != '' AND REPLACE(s.permit_name, ' ', '') != REPLACE(s.registrar_name, ' ', ''))
INSERT OR IGNORE INTO permit_doc_special (doc_id, business_id, title, detail)
  SELECT p.doc_id, sm.main_id, p.title, p.detail FROM permit_doc_special p JOIN sm ON sm.sub_id = p.business_id WHERE sm.main_id IS NOT NULL;

WITH sm AS (
  SELECT s.id AS sub_id, (SELECT m.id FROM businesses m WHERE m.chp_number = s.chp_number AND m.id != s.id
           AND (TRIM(m.permit_name) = '' OR REPLACE(m.permit_name, ' ', '') = REPLACE(m.registrar_name, ' ', '')) LIMIT 1) AS main_id
  FROM businesses s
  WHERE TRIM(COALESCE(s.chp_number, '')) != '' AND TRIM(s.permit_name) != '' AND REPLACE(s.permit_name, ' ', '') != REPLACE(s.registrar_name, ' ', ''))
DELETE FROM permit_doc_special WHERE business_id IN (SELECT sub_id FROM sm WHERE main_id IS NOT NULL);

-- 4. הסרת השיוך הישיר לתת-השורה
WITH sm AS (
  SELECT s.id AS sub_id, (SELECT m.id FROM businesses m WHERE m.chp_number = s.chp_number AND m.id != s.id
           AND (TRIM(m.permit_name) = '' OR REPLACE(m.permit_name, ' ', '') = REPLACE(m.registrar_name, ' ', '')) LIMIT 1) AS main_id
  FROM businesses s
  WHERE TRIM(COALESCE(s.chp_number, '')) != '' AND TRIM(s.permit_name) != '' AND REPLACE(s.permit_name, ' ', '') != REPLACE(s.registrar_name, ' ', ''))
DELETE FROM permit_doc_companies WHERE business_id IN (SELECT sub_id FROM sm WHERE main_id IS NOT NULL);
