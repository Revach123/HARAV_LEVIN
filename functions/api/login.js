// functions/api/login.js
//   GET  /api/login            -> { trusted }  האם ה-IP הזה מורשה להיכנס בלי סיסמה
//   POST /api/login {password} -> בודק סיסמה; שני הראשונים שמקלידים סיסמה נכונה נרשמים (נכנס בלי סיסמה בפעמים הבאות)
import { checkPassword, isTrustedIp, registerFirstIp } from "./_shared/auth.js";

export async function onRequestGet({ request, env }) {
  return Response.json({ trusted: await isTrustedIp(request, env) }, { headers: { "Cache-Control": "no-store" } });
}

export async function onRequestPost({ request, env }) {
  let b; try { b = await request.json(); } catch { b = {}; }
  if (!(await checkPassword(b.password, env))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return Response.json({ ok: true, registered: await registerFirstIp(request, env) });
}
