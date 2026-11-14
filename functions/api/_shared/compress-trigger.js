// הפעלה מיידית של דחיסת השטרות החדשים (GitHub Actions: compress-new-permits.yml) אחרי העלאת מסמך גדול.
// משתמש בסוד הקיים GITHUB_DISPATCH_TOKEN (אותו אחד של sync-tase.js ו-approved-bonds.js: טוקן מוגבל לריפו הזה עם הרשאת Actions: write). בלעדיו - לא עושה כלום, והריצה המתוזמנת (כל חצי שעה) מטפלת במסמך.
// כמה העלאות ברצף: GitHub שומר לכל היותר ריצה אחת פעילה ואחת ממתינה (concurrency), והממתינה דוחסת את כולם.
export const MIN_LITE_BYTES = 400000;
export function triggerCompress(env, waitUntil, size) {
  const token = env && (env.GITHUB_DISPATCH_TOKEN || env.GH_DISPATCH_TOKEN);
  if (!token || !(size > MIN_LITE_BYTES)) return null;
  const repo = env.GH_DISPATCH_REPO || "Revach123/HARAV_LEVIN";
  const p = fetch(`https://api.github.com/repos/${repo}/actions/workflows/compress-new-permits.yml/dispatches`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "harav-levin-permits", "Content-Type": "application/json" },
    body: JSON.stringify({ ref: env.GH_DISPATCH_REF || "main" }),
  }).catch(() => null);
  if (typeof waitUntil === "function") waitUntil(p);
  return p;
}

// גרסת הפקס של השטר (GitHub Actions: fax-permit-pdfs.yml) - מופעלת רק מכאן, בכל העלאת שטר (בלי ריצה מתוזמנת).
// אותו סוד GITHUB_DISPATCH_TOKEN. בלעדיו - אפשר להפעיל את ה-workflow ידנית (Run workflow) והוא משלים את כל מה שחסר מ-3 הימים האחרונים.
export function triggerFaxPdf(env, waitUntil) {
  const token = env && (env.GITHUB_DISPATCH_TOKEN || env.GH_DISPATCH_TOKEN);
  if (!token) { console.log("fax-permit-pdfs: GITHUB_DISPATCH_TOKEN missing - fax version not triggered"); return null; }
  const repo = env.GH_DISPATCH_REPO || "Revach123/HARAV_LEVIN";
  const p = fetch(`https://api.github.com/repos/${repo}/actions/workflows/fax-permit-pdfs.yml/dispatches`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "harav-levin-permits", "Content-Type": "application/json" },
    body: JSON.stringify({ ref: env.GH_DISPATCH_REF || "main" }),
  }).then((r) => { if (!r.ok) console.log(`fax-permit-pdfs dispatch failed: HTTP ${r.status}`); return r; }).catch(() => null);
  if (typeof waitUntil === "function") waitUntil(p);
  return p;
}
