-- סטטוס החברה ברשם החברות (data.gov.il), נקבע ע"י scripts/registry_refresh:
--   "מחוסלת..." / "חיסול..." -> החברה לא מוצגת ברשימות וברשימת האג"ח
--   "בפרוק..." -> מוצגת עם הערה "בפירוק"
ALTER TABLE businesses ADD COLUMN registry_status TEXT DEFAULT '';
