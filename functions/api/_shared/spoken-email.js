// אימייל מדובר -> כתובת. משמש את ivr-join.js אחרי זיהוי דיבור (Azure) של הקלטת אימייל.
//
// המתקשר יכול לומר את הכתובת: כמילים ("moshe שטרודל גימייל נקודה קום"), או אות אחר אות - במבטא אנגלי / אמריקאי
// ("em oh ess aitch ee"), או במבטא ישראלי ("אם או אס אייץ' אי"). לכן ההקלטה מזוהה כמה פעמים (he-IL, en-US, en-GB)
// ולכל זיהוי מפעילים spokenEmail; pickEmail בוחר את הכתובת התקינה.
//
// ידוע: "איי" בעברית יכול להיות A או I (נקרא A; I נקרא "אייי"), ו"אי" הוא E.
import { validEmail } from './join-common.js';

// שמות אותיות באנגלית (בריטי + אמריקאי), בכתיב שזיהוי הדיבור מחזיר
const EN_LETTERS = {
  ay: 'a', ei: 'a', bee: 'b', be: 'b', see: 'c', sea: 'c', cee: 'c', dee: 'd', ee: 'e', eff: 'f', ef: 'f', gee: 'g', aitch: 'h', haitch: 'h',
  eye: 'i', jay: 'j', kay: 'k', el: 'l', ell: 'l', em: 'm', en: 'n', oh: 'o', pee: 'p', cue: 'q', queue: 'q', kew: 'q', are: 'r', ar: 'r',
  ess: 's', es: 's', tee: 't', tea: 't', you: 'u', yu: 'u', vee: 'v', ex: 'x', why: 'y', wye: 'y', zee: 'z', zed: 'z',
  'double-u': 'w', doubleu: 'w', 'double-you': 'w', doubleyou: 'w',
};
// שמות אותיות כפי שמבטאים בישראל (כפי שזיהוי דיבור בעברית כותב אותם)
const HE_LETTERS = {
  'איי': 'a', 'אי': 'e', 'בי': 'b', 'ביי': 'b', 'סי': 'c', 'סיי': 'c', 'די': 'd', 'דיי': 'd', 'אף': 'f', 'אפ': 'f',
  "ג'י": 'g', 'גי': 'g', 'ג׳י': 'g', "ג'יי": 'j', 'ג׳יי': 'j', 'גיי': 'j',
  "אייץ'": 'h', 'אייץ': 'h', "איץ'": 'h', "אץ'": 'h', 'אייי': 'i',
  'קיי': 'k', 'קי': 'k', 'אל': 'l', 'אם': 'm', 'אן': 'n', 'או': 'o', 'אוו': 'o', 'פי': 'p', 'פיי': 'p', 'קיו': 'q', 'קיוי': 'q',
  'אר': 'r', 'אס': 's', 'טי': 't', 'טיי': 't', 'יו': 'u', 'וי': 'v', 'ויי': 'v',
  'דאבליו': 'w', 'דבליו': 'w', 'דאבלו': 'w', 'אקס': 'x', 'אקז': 'x', 'וואי': 'y', 'זד': 'z', 'זי': 'z',
};
// זיהוי דיבור בעברית מדביק לפעמים כמה אותיות למילה אחת ("איי זד" -> "איזה"): מפרקים אסימון עברי לשמות אותיות.
// וריאנטים נוספים של זיהוי (זה / זט = Z). אסימון שמתחיל ב"אי" (ולא "איי") ויש אחריו עוד - ה"איי" של האות A שאיבדה יוד.
const HE_PIECES = { ...HE_LETTERS, 'זה': 'z', 'זט': 'z', 'זת': 'z' };
function segmentHebrew(tok) {
  const t = /^אי(?!י)./.test(tok) ? 'איי' + tok.slice(2) : tok;
  const memo = new Map();
  const go = (i) => {
    if (i === t.length) return [];
    if (memo.has(i)) return memo.get(i);
    let best = null;
    for (const [name, letter] of Object.entries(HE_PIECES).sort((a, b) => b[0].length - a[0].length)) {
      if (!t.startsWith(name, i)) continue;
      const rest = go(i + name.length);
      if (rest) { best = [letter, ...rest]; break; }
    }
    memo.set(i, best);
    return best;
  };
  const r = /^[א-ת'׳]+$/.test(tok) ? go(0) : null;
  return r && r.length ? r.join('') : '';
}
const DIGITS = {
  zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9',
  'אפס': '0', 'אחד': '1', 'שתיים': '2', 'שניים': '2', 'שלוש': '3', 'ארבע': '4', 'חמש': '5', 'שש': '6', 'שבע': '7', 'שמונה': '8', 'תשע': '9',
};

export function spokenEmail(t) {
  let e = String(t || '').toLowerCase().trim()
    .replace(/דאבל\s?יו|דבל\s?יו|double\s?[-]?\s?(u|you)\b/g, (m) => (/[א-ת]/.test(m) ? 'דאבליו' : 'double-u'))
    .replace(/ג['׳’]?י\s?מ?ייל|ג['׳’]?ימל|\bg\s?mail\b|\bgee\s?mail\b/g, 'gmail')
    .replace(/הוטמייל|הוטמיל|\bhot\s?mail\b/g, 'hotmail').replace(/יאהו|\byahoo\b/g, 'yahoo').replace(/אאוטלוק|אוטלוק|\boutlook\b/g, 'outlook')
    .replace(/שטרודל|\bat sign\b|\bat\b/g, '@').replace(/נקודה|דוט|\bdot\b|\bpoint\b/g, '.')
    .replace(/קו תחתון|\bunder\s?score\b/g, '_').replace(/מקף|\bdash\b|\bhyphen\b/g, '-');
  e = e.split(/[\s,;:]+/).filter(Boolean).map((tok) => {
    const bare = tok.replace(/[.]+$/, '').replace(/^[.]+/, (m) => m);      // נקודה בסוף אסימון היא פיסוק של הזיהוי
    if (/^[a-z]$/.test(bare)) return bare;
    return EN_LETTERS[bare] || HE_LETTERS[bare] || DIGITS[bare] || segmentHebrew(bare) || tok;
  }).join('');
  e = e.replace(/(^|[^א-ת])קום(?![א-ת])/g, '$1com').replace(/\.{2,}/g, '.').replace(/\.$/, '');
  e = e.replace(/@(gmail|hotmail|yahoo|outlook|walla|icloud)(com)$/, '@$1.$2');       // "גימייל קום" בלי "נקודה"
  const at = e.indexOf('@');
  if (at > 0 && at === e.lastIndexOf('@') && !e.slice(at + 1).includes('.')) e += '.com';
  return validEmail(e) ? e : '';
}

const KNOWN_DOMAIN = /@(gmail|hotmail|yahoo|outlook|walla|icloud|live|msn)\./;

/** מכמה זיהויים של אותה הקלטה (שפות שונות) בוחר כתובת תקינה; עדיפות לדומיין מוכר. */
export function pickEmail(texts) {
  const found = texts.map(spokenEmail).filter(Boolean);
  return found.find((x) => KNOWN_DOMAIN.test(x)) || found[0] || '';
}
