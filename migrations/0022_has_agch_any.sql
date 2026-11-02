-- "יש אג"ח כולל לא סחיר" (יש / אין; ריק = טרם נבדק): אג"ח סחירה (כמו tase_has_agch או רשימת האג"ח) או אג"ח לא סחירה פעילה.
-- נפרד בכוונה מ-tase_has_agch: רשימות החברות ממשיכות להבחין בין סחיר ללא סחיר. משמש לקטגוריה "חברות מנפיקות אג"ח" ברשימת השטרות.
-- מתעדכן בשמירת עסק (functions/api/_shared/bond-pcat.js) ובריצה הלילית (scripts/registry_refresh/refresh_businesses.py).
ALTER TABLE businesses ADD COLUMN has_agch_any TEXT DEFAULT '';
