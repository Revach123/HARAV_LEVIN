-- קטגוריה עבור רשימת השטרות: קטגוריה נפרדת מ-category (קטגוריית החברה ברשימות החברות), לפי הדף "שטרות היתר עסקה" שבאתר הישן.
ALTER TABLE businesses ADD COLUMN permits_category TEXT DEFAULT '';
