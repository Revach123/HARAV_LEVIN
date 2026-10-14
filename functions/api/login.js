// functions/api/login.js
//   GET  /api/login            -> { trusted }  האם המכשיר הזה מורשה להיכנס בלי סיסמה (עוגיית מכשיר)
//   POST /api/login {password} -> בודק סיסמה; שני הראשונים שמקלידים סיסמה נכונה נרשמים (המכשיר מקבל עוגייה) ונכנסים אחר כך בלי סיסמה
import { checkPassword, isTrustedDevice, registerDevice } from "./_shared/auth.js";

export async function onRequestGet({ request, env }) {
  return Response.json({ trusted: await isTrustedDevice(request, env) }, { headers: { "Cache-Control": "no-store" } });
}

export async function onRequestPost({ request, env }) {
  let b; try { b = await request.json(); } catch { b = {}; }
  if (!(await checkPassword(b.password, env))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const cookie = await registerDevice(request, env);
  return new Response(JSON.stringify({ ok: true, registered: !!cookie }), { headers: { "Content-Type": "application/json", ...(cookie ? { "Set-Cookie": cookie } : {}) } });
}
