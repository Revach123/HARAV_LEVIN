// functions/api/index-companies.js
// רשימת חברות במדד בורסה (מתוך revach: data/indices/components/<מזהה>.json) - ח.פ. ושם בלבד, מאוחד לפי חברה.
//   /api/index-companies?id=147   (147 = ת"א-SME60, 142 = ת"א-35, 143 = ת"א-90, 137 = ת"א-125)
const ALLOWED = { "147": 'ת"א-SME60', "142": 'ת"א-35', "143": 'ת"א-90', "137": 'ת"א-125' };
const REVACH = "https://revach.pages.dev/data/indices/components/";
const CORS = { "Access-Control-Allow-Origin": "*" };

export async function onRequestGet({ request }) {
  const id = new URL(request.url).searchParams.get("id") || "147";
  if (!ALLOWED[id]) return new Response(JSON.stringify({ error: "מדד לא נתמך" }), { status: 400, headers: { ...CORS, "Content-Type": "application/json" } });
  try {
    const r = await fetch(REVACH + id + ".json", { cf: { cacheTtl: 3600, cacheEverything: true } });
    if (!r.ok) throw new Error("revach " + r.status);
    const d = await r.json();
    const seen = new Map();
    for (const it of d.items || []) {
      const hp = String(it.hp || "").replace(/\D/g, "").replace(/^0+/, "");
      const key = hp || "n:" + (it.fullName || it.name);
      if (!seen.has(key)) seen.set(key, { hp, name: it.fullName || it.name || "" });
    }
    return new Response(JSON.stringify({ id, name: ALLOWED[id], tradeDate: d.tradeDate || "", companies: [...seen.values()] }),
      { headers: { ...CORS, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: "שגיאה בטעינת רשימת המדד: " + e.message }), { status: 502, headers: { ...CORS, "Content-Type": "application/json" } });
  }
}
