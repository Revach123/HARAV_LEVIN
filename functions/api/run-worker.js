// POST /api/run-worker  — proxies to registry-updater Worker (no timeout limit)

const WORKER_URL = "https://registry-updater.revachvekalkala.workers.dev/run";

function isAuthed(request, env) {
  return (request.headers.get("Authorization") || "").replace("Bearer ", "").trim() === env.ADMIN_PASSWORD;
}

export async function onRequestPost({ request, env }) {
  if (!isAuthed(request, env)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const secret = env.ADMIN_PASSWORD || "sync-trigger-2024";
    const res = await fetch(`${WORKER_URL}?secret=${encodeURIComponent(secret)}`, {
      method: "GET",
    });

    if (!res.ok) {
      return Response.json({ error: `Worker returned ${res.status}` }, { status: 502 });
    }

    const text = await res.text();
    return Response.json({ triggered: true, message: text });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 502 });
  }
}
