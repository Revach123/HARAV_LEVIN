// functions/api/change-password.js
// POST { current, next }  - מחליף את סיסמת הניהול (דורש את הסיסמה הנוכחית).
import { checkPassword, isTrustedDevice, setPassword } from "./_shared/auth.js";

export async function onRequestPost({ request, env }) {
  let b; try { b = await request.json(); } catch { return Response.json({ error: "בקשה לא תקינה" }, { status: 400 }); }
  if (!(await checkPassword(b.current, env)) && !(await isTrustedDevice(request, env))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const next = String(b.next || "").trim();
  if (next.length < 4) return Response.json({ error: "הסיסמה החדשה קצרה מדי (לפחות 4 תווים)" }, { status: 400 });
  try { await setPassword(env, next); } catch (e) { return Response.json({ error: "שמירת הסיסמה נכשלה: " + e.message }, { status: 500 }); }
  return Response.json({ success: true });
}
