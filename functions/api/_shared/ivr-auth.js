// אימות שלוחות ימות: הפרמטר sk (api_add_0=sk=<סוד>) חייב להתאים ל-IVR_SECRET (הקו הישן) או ל-IVR_SECRET_NEW (הקו החדש).
// trim: רווח/שורה חדשה בסוף הסוד (הדבקה בדשבורד או ב-ext.ini) לא אמור לשבור את ההשוואה.
export function secretOk(env, sent) {
  const s = String(sent || '').trim();
  if (!s) return false;
  return [env.IVR_SECRET, env.IVR_SECRET_NEW].some((x) => String(x || '').trim() === s);
}

// GET query / POST form / POST json. כפילויות -> ערך אחרון.
export async function parseYemot(request) {
  const out = {};
  const url = new URL(request.url);
  for (const [k, val] of url.searchParams) out[k] = val;
  if (request.method === 'POST') {
    const ct = request.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      Object.assign(out, await request.json().catch(() => ({})));
    } else {
      const body = await request.text();
      for (const [k, val] of new URLSearchParams(body)) out[k] = val;
    }
  }
  return out;
}

// תיקיית יעד (go_to_folder) מהפרמטר שמגדירה השלוחה, למשל api_add_1=bk=/ ; רק נתיב תקין של ימות, אחרת ברירת המחדל.
export const folderParam = (v, key, dflt) => (/^\/[\w\/]*$/.test(String(v[key] || '')) ? v[key] : dflt);

// פקודת read של ימות להקשת ספרות (אותו סדר פרמטרים כמו readTapRaw ב-ivr-company.js).
export function readTap(msgParts, valName, digitsAllowed, { max = 1, min = 1, wait = 7, empty = 'NONE' } = {}) {
  const ops = [valName, 'no', max, min, wait, 'No', 'no', 'no', '', digitsAllowed ? digitsAllowed.join('.') : '', '', 'Ok', empty, ''];
  return `read=${msgParts}=${ops.join(',')}`;
}

// פקודת read של ימות להקלטה לקובץ (אותו זנב כמו readSpeech ב-ivr-company.js).
export const readRecord = (msgParts, valName, folder, file, min, max) =>
  `read=${msgParts}=${valName},no,record,${folder},${file},no,yes,no,${min},${max}`;
