// הודעה ל-Revach אחרי שינוי ברשימת העסקים, כדי שרשימת היתרי העסקה שם
// (data/indices/heter-iska.json - חיפוש התאגידים, דפי המדדים וכו') תתעדכן מיד
// ולא רק בריצה היומית. שולח repository_dispatch מסוג heter-changed, שמפעיל את
// .github/workflows/heter-refresh.yml בריפו Revach.
//
// דרישה: env.REVACH_DISPATCH_TOKEN - מפתח GitHub fine-grained לריפו Revach123/Revach בלבד,
// הרשאה Contents: Read and write (זו ההרשאה ש-repository_dispatch דורש).
//   wrangler pages secret put REVACH_DISPATCH_TOKEN --project-name harav-levin   (ואז פריסה מחדש)
// בלי המפתח - לא נשלח כלום והשינוי ייכנס בריצה היומית, כמו קודם.
//
// רץ ברקע (waitUntil) ולא מעכב את תשובת השמירה; כשל נרשם ללוג בלבד.
const REPO = "Revach123/Revach";

export function notifyRevach(env, waitUntil, reason) {
  if (!env.REVACH_DISPATCH_TOKEN || !waitUntil) return;
  waitUntil(
    fetch(`https://api.github.com/repos/${REPO}/dispatches`, {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${env.REVACH_DISPATCH_TOKEN}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "harav-levin-admin",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ event_type: "heter-changed", client_payload: { reason: String(reason || "").slice(0, 100) } }),
    })
      .then(async (r) => { if (r.status !== 204) console.log(`revach-notify: GitHub ${r.status} ${(await r.text()).slice(0, 200)}`); })
      .catch((e) => console.log(`revach-notify: ${e && e.message}`))
  );
}
