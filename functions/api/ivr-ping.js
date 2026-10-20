// בדיקת חיבור מימות המשיח: מחזיר תשובה תקינה קבועה בלי סוד ובלי גישה לנתונים.
// ext.ini לבדיקה:  type=api  /  api_link=https://harav-levin.pages.dev/api/ivr-ping
export async function onRequest({ request }) {
  console.log(`ivr-ping ${request.method} ${new URL(request.url).search.slice(0, 120)}`);
  return new Response("id_list_message=t-החיבור לשרת תקין&hangup=yes", { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}
