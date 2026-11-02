// מייצר דוגמה של מייל ה-AMP של טופס ההצטרפות (לבדיקה ב-amphtml-validator, workflow ‏amp-validate).
// הרצה: node scripts/amp/sample_join_amp.mjs > sample.html
import { buildAmp } from '../../functions/api/_shared/join-amp.js';
const names = Array.from({ length: 400 }, (_, i) => `חברה לדוגמה ${i + 1} בע"מ`);
process.stdout.write(buildAmp({ action: 'https://harav-levin.pages.dev/api/join-email-amp', token: 'abc.123.def', names, code: '1234567' }));
