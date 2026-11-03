// functions/api/agreement.js
// GET  (ציבורי)  -> { ok, long:[פסקאות], short:[פסקאות], version, custom }   נוסח השטר הנוכחי (טופס ההצטרפות קורא אותו בכל טעינה)
// POST (מנהל)    { long: "טקסט", short: "טקסט" }  או  { reset: true }  -> שומר / מחזיר לברירת המחדל
import { checkAdmin } from "./_shared/auth.js";
import { getAgreement, saveAgreement, resetAgreement, parseParas } from "./_shared/agreement.js";

const H = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
const reply = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: H });

export async function onRequestGet({ env }) {
  const a = await getAgreement(env);
  return reply({ ok: true, long: a.long, short: a.short, version: a.version, custom: a.custom, updated: a.updated });
}

export async function onRequestPost({ request, env }) {
  if (!(await checkAdmin(request, env))) return reply({ error: "Unauthorized" }, 401);
  let b; try { b = await request.json(); } catch { return reply({ error: "בקשה לא תקינה" }, 400); }
  try {
    if (b.reset) await resetAgreement(env);
    else {
      const long = parseParas(b.long), short = parseParas(b.short);
      if (!long.length || !short.length) return reply({ error: "שני הנוסחים (הארוך והמקוצר) חייבים להכיל טקסט" }, 400);
      if (long.join("").length > 20000 || short.join("").length > 20000) return reply({ error: "הנוסח ארוך מדי" }, 400);
      await saveAgreement(env, long, short);
    }
  } catch (e) { return reply({ error: "השמירה נכשלה: " + e.message }, 500); }
  const a = await getAgreement(env);
  return reply({ ok: true, long: a.long, short: a.short, version: a.version, custom: a.custom, updated: a.updated });
}
