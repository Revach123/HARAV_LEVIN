// ============================================================================
//  functions/api/name-keyterms-download.js — זמני, להורדה חד-פעמית: רשימות השמות הנפוצים (פרטי / משפחה) של זיהוי הדיבור, כ-CSV.
//
//  https://harav-levin.pages.dev/api/name-keyterms-download : מנהל בלבד (מכשיר מורשה מוריד מיד; אחרת סיסמת הניהול).
//  קורא את מה שנשמר מוצפן ב-ivr_keyterms (נבנה ב-POST /api/name-keyterms). לא נרשם ללוג. למחוק את הקובץ אחרי ההורדה.
// ============================================================================
import { checkAdmin, checkPassword } from './_shared/auth.js';
import { loadNameKeyterms } from './_shared/name-keyterms.js';

const NO_STORE = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' };

const formPage = (msg = '') => new Response(`<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>הורדת רשימת השמות</title><style>body{font-family:Arial,sans-serif;max-width:480px;margin:24px auto;padding:0 16px;color:#1f2d2d;line-height:1.6}
h1{color:#1b6b52;font-size:22px}input{box-sizing:border-box;width:100%;padding:9px;font-size:16px;border:1px solid #b7c9c4;border-radius:6px}
button{margin-top:16px;background:#1b6b52;color:#fff;border:0;border-radius:8px;padding:12px 20px;font-size:17px;font-weight:bold}.bad{background:#fdecea;border:1px solid #e0a39c;border-radius:8px;padding:10px}</style></head><body>
<h1>הורדת רשימת השמות (זיהוי דיבור)</h1>${msg}
<form method="post"><label>סיסמת הניהול</label><input type="password" name="pw" autocomplete="current-password"><button type="submit">הורדה (CSV)</button></form></body></html>`,
  { headers: { 'Content-Type': 'text/html; charset=utf-8', ...NO_STORE } });

async function csv(env) {
  const [first, last] = await Promise.all([loadNameKeyterms(env, 'first'), loadNameKeyterms(env, 'last')]);
  if (!first.length && !last.length) return formPage('<p class="bad">הרשימה ריקה: עוד לא נבנתה (POST /api/name-keyterms), או שלא ניתן לפענח אותה.</p>');
  const q = (s) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const rows = [['מקום', 'שם פרטי', 'שם משפחה']];
  for (let i = 0; i < Math.max(first.length, last.length); i++) rows.push([String(i + 1), first[i] || '', last[i] || '']);
  const body = '﻿' + rows.map((r) => r.map(q).join(',')).join('\r\n') + '\r\n';
  return new Response(body, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="name-keyterms.csv"', ...NO_STORE } });
}

export async function onRequestGet({ request, env }) {
  return (await checkAdmin(request, env)) ? csv(env) : formPage();
}

export async function onRequestPost({ request, env }) {
  const fd = await request.formData().catch(() => null);
  const ok = (await checkAdmin(request, env)) || (fd && (await checkPassword(String(fd.get('pw') || ''), env)));
  return ok ? csv(env) : formPage('<p class="bad">סיסמת הניהול שגויה</p>');
}
