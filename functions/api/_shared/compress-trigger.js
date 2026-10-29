// הפעלה מיידית של דחיסת השטרות החדשים (GitHub Actions: compress-new-permits.yml) אחרי העלאת מסמך גדול.
// דורש סוד GH_DISPATCH_TOKEN (טוקן מוגבל לריפו הזה עם הרשאת Actions: write). בלעדיו - לא עושה כלום, והריצה המתוזמנת (כל חצי שעה) מטפלת במסמך.
// כמה העלאות ברצף: GitHub שומר לכל היותר ריצה אחת פעילה ואחת ממתינה (concurrency), והממתינה דוחסת את כולם.
export const MIN_LITE_BYTES = 400000;
export function triggerCompress(env, waitUntil, size) {
  if (!env || !env.GH_DISPATCH_TOKEN || !(size > MIN_LITE_BYTES)) return null;
  const repo = env.GH_DISPATCH_REPO || "Revach123/HARAV_LEVIN";
  const p = fetch(`https://api.github.com/repos/${repo}/actions/workflows/compress-new-permits.yml/dispatches`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.GH_DISPATCH_TOKEN}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "harav-levin-permits", "Content-Type": "application/json" },
    body: JSON.stringify({ ref: env.GH_DISPATCH_REF || "main" }),
  }).catch(() => null);
  if (typeof waitUntil === "function") waitUntil(p);
  return p;
}
