/**
 * הצטרפות במייל, בלי העברה ובלי CloudMailin: סקריפט בתוך חשבון ה-Gmail של כתובת ההצטרפות.
 * כל דקה: מיילים חדשים שיש בכותרת שלהם "הצטרפות" נשלחים לאתר (/api/join-email), באותו מבנה ש-CloudMailin שולח.
 * האתר עונה למצטרף (טופס / תיקונים / אישור) דרך וורדפרס, עם Reply-To לכתובת הזו.
 *
 * התקנה (פעם אחת), כשמחוברים לחשבון ה-Gmail של כתובת ההצטרפות:
 *  1. script.google.com -> פרויקט חדש -> מדביקים את כל הקובץ הזה במקום מה שיש -> שמירה.
 *  2. ⚙ הגדרות הפרויקט -> מאפייני סקריפט -> הוספה: שם JOIN_EMAIL_SECRET, ערך = אותה סיסמה שב-Cloudflare.
 *  3. בוחרים למעלה את הפונקציה setup ולוחצים "הפעלה". מאשרים את ההרשאות (אם מופיע "Google לא אימתה את האפליקציה":
 *     מתקדם -> מעבר לפרויקט). זהו - מעכשיו הסקריפט רץ לבד כל דקה.
 */
const JOIN_URL = 'https://harav-levin.pages.dev/api/join-email';

function setup() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('checkJoin').timeBased().everyMinutes(1).create();
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('LAST')) props.setProperty('LAST', String(Date.now()));          // מטפלים רק במיילים שיגיעו מעכשיו
  if (!props.getProperty('JOIN_EMAIL_SECRET')) throw new Error('חסר מאפיין סקריפט JOIN_EMAIL_SECRET (שלב 2)');
}

function checkJoin() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;
  try {
    const props = PropertiesService.getScriptProperties();
    const secret = props.getProperty('JOIN_EMAIL_SECRET');
    let last = Number(props.getProperty('LAST') || Date.now());
    const me = Session.getActiveUser().getEmail().toLowerCase();
    const msgs = [];
    GmailApp.search('subject:הצטרפות newer_than:2d', 0, 30).forEach(function (t) {
      t.getMessages().forEach(function (m) {
        if (m.getDate().getTime() > last && m.getFrom().toLowerCase().indexOf(me) < 0) msgs.push(m);
      });
    });
    msgs.sort(function (a, b) { return a.getDate() - b.getDate(); });
    for (let i = 0; i < msgs.length; i++) {
      const m = msgs[i];
      const res = UrlFetchApp.fetch(JOIN_URL, {
        method: 'post', contentType: 'application/json', muteHttpExceptions: true,
        headers: { Authorization: 'Bearer ' + secret },
        payload: JSON.stringify({
          headers: { from: m.getFrom(), to: me, reply_to: m.getReplyTo(), subject: m.getSubject(), message_id: m.getHeader('Message-ID') },
          plain: m.getPlainBody(), html: m.getBody(),
        }),
      });
      if (res.getResponseCode() !== 200) break;                // תקלה (או סיסמה שגויה): לא מסמנים כטופל, ננסה שוב בדקה הבאה
      last = m.getDate().getTime();
      props.setProperty('LAST', String(last));
    }
  } finally { lock.releaseLock(); }
}
