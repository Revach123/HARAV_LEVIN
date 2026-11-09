// הפעלת בניית רשימת האג"ח (workflow bonds-list) מיד אחרי שינוי שמשפיע עליה: בנייה מהירה (כדקה), על בסיס מאגר האג"ח.
// דורש env.GITHUB_DISPATCH_TOKEN (אותו סוד של sync-tase.js). בלעדיו - השינוי נשמר והרשימה תתעדכן בריצה היומית.
export async function triggerBondsBuild(env, chp) {
  if (!env.GITHUB_DISPATCH_TOKEN) return { triggered: false, reason: "missing_secret" };
  try {
    const res = await fetch("https://api.github.com/repos/Revach123/HARAV_LEVIN/actions/workflows/bonds-list.yml/dispatches", {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${env.GITHUB_DISPATCH_TOKEN}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "harav-levin-admin",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ref: "main", inputs: { mode: "fast", chp: String(chp || "") } }),
    });
    return res.status === 204 ? { triggered: true } : { triggered: false, reason: `github_${res.status}` };
  } catch { return { triggered: false, reason: "github_unreachable" }; }
}

export const APPROVED_AGCH = ["כן", "רק פרטי", "רק כללי"];
// האם שמירת עסק משפיעה על הרשימה: העסק מאושר (לפני או אחרי), ושונה שדה שמשפיע (אישור, פרטי/כללי, מספר, שם, הערה)
export function affectsBondsList(oldRow, newRow) {
  const ap = r => APPROVED_AGCH.includes(String((r && r.agch_approved) || "").trim());
  if (!ap(oldRow) && !ap(newRow)) return false;
  if (!oldRow) return true;
  return ["agch_approved", "visibility", "chp_number", "registrar_name", "permit_name", "notes", "notes_scope", "registry_status"]
    .some(k => String(oldRow[k] ?? "").trim() !== String((newRow && newRow[k]) ?? "").trim());
}
