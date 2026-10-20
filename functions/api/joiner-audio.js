// functions/api/joiner-audio.js — השמעת הקלטה של מצטרף טלפוני (מסך המנהל). מנהל בלבד.
//   GET /api/joiner-audio?id=<מזהה מצטרף>&k=<שם השדה, למשל "הקלטת שם פרטי">  ->  audio/wav
// הנתיב נלקח מהרשומה המוצפנת של המצטרף (שדות "הקלטת ..." ב-extra, נכתבים ב-ivr-join.js) ולא מהבקשה,
// וההקלטה מורדת מימות (YEMOT_TOKEN או YEMOT_TTS של החשבון שבו נשמרות ההקלטות). בלוגים לא נרשם שום פרט אישי.
import { checkAdmin } from "./_shared/auth.js";
import { noAuth } from "./_shared/permit-docs.js";
import { importKey, decryptPii } from "./_shared/joiners-crypto.js";
import { downloadRecording } from "./_shared/stt-azure.js";

const H = { "Cache-Control": "no-store" };
const err = (msg, status) => Response.json({ error: msg }, { status, headers: H });

export async function onRequestGet({ request, env }) {
  if (!(await checkAdmin(request, env))) return noAuth();
  const u = new URL(request.url);
  const id = u.searchParams.get("id") || "", k = u.searchParams.get("k") || "";
  if (!/^[\w-]{3,40}$/.test(id) || !k.startsWith("הקלטת ")) return err("בקשה לא תקינה", 400);
  if (!(env.YEMOT_TOKEN || env.YEMOT_TTS)) return err("חסר YEMOT_TOKEN / YEMOT_TTS להורדת הקלטות מימות", 503);
  try {
    const row = await env.DB.prepare("SELECT id, pii FROM joiners WHERE id = ?").bind(id).first();
    if (!row) return err("המצטרף לא נמצא", 404);
    const p = await decryptPii(await importKey(env), row.id, row.pii);
    let extra = {}; try { extra = JSON.parse(p.extra || "{}"); } catch { /* שדות חופשיים */ }
    const path = String(extra[k] || "");
    if (!/^\/[\w\/.\-]+$/.test(path)) return err("אין הקלטה בשדה הזה", 404);
    const rec = await downloadRecording(env, [path.replace(/\.wav$/i, "") + ".wav", path]);
    if (!rec) return err("ההקלטה לא נמצאה בימות (ייתכן שנמחקה, או שהמפתח של ימות הוא של חשבון אחר)", 404);
    return new Response(rec.bytes, { headers: { "Content-Type": "audio/wav", ...H } });
  } catch {
    return err("שגיאה בהשמעת ההקלטה", 500);
  }
}
