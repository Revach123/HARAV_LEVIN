// POST /api/sync-tase — הכפתור "עדכן אג"ח מבורסה" בדף הניהול.
//
// לא מחשב כלום בעצמו (היה כאן עותק של הלוגיקה, בלי החרגת ני"ע מסחריים, שסתר את הריצה היומית).
// מפעיל את אותה ריצה בדיוק של הריצה היומית: workflow "registry-refresh" ב-GitHub Actions
// (scripts/registry_refresh/refresh_businesses.py), עם כתיבה ל-D1 (apply=true). כל שינוי בלוגיקה נעשה
// במקום אחד, ומשפיע על הריצה היומית ועל הכפתור בשווה.
//
// דרישות:
//   env.ADMIN_PASSWORD         - כמו שאר נתיבי הניהול
//   env.GITHUB_DISPATCH_TOKEN  - מפתח GitHub (fine-grained, רק הריפו הזה, הרשאה Actions: Read and write)
//     wrangler pages secret put GITHUB_DISPATCH_TOKEN --project-name harav-levin   (ואז פריסה מחדש)

const GH = { owner: "Revach123", repo: "HARAV_LEVIN", workflow: "registry-refresh.yml", ref: "main" };
const RUNS_URL = `https://github.com/${GH.owner}/${GH.repo}/actions/workflows/${GH.workflow}`;

function isAuthed(request, env) {
  return (request.headers.get("Authorization") || "").replace("Bearer ", "").trim() === env.ADMIN_PASSWORD;
}

export async function onRequestPost({ request, env }) {
  if (!isAuthed(request, env)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!env.GITHUB_DISPATCH_TOKEN) {
    // הממשק מציג את השדה error כטקסט (apiFetch), לכן ההסבר בעברית נמצא בו
    return Response.json({
      code: "missing_secret",
      error: "לא הוגדר GITHUB_DISPATCH_TOKEN ב-Cloudflare Pages (ר' הערה בראש functions/api/sync-tase.js). הריצה היומית ממשיכה כרגיל.",
    }, { status: 500 });
  }

  let res;
  try {
    res = await fetch(`https://api.github.com/repos/${GH.owner}/${GH.repo}/actions/workflows/${GH.workflow}/dispatches`, {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${env.GITHUB_DISPATCH_TOKEN}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "harav-levin-admin",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ref: GH.ref, inputs: { apply: "true" } }),
    });
  } catch (e) {
    return Response.json({ code: "github_unreachable", error: `לא ניתן להגיע ל-GitHub: ${e.message}` }, { status: 502 });
  }

  if (res.status !== 204) {
    const text = (await res.text()).slice(0, 200);
    return Response.json({ code: "github_rejected", status: res.status, error: `GitHub דחה את ההפעלה (${res.status}): ${text}` }, { status: 502 });
  }
  return Response.json({
    triggered: true,
    message: "הופעלה אותה ריצה של הריצה היומית. היא נמשכת כ-6 דקות; אחריה רענן את הרשימה.",
    runsUrl: RUNS_URL,
  });
}
