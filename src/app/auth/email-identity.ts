import { toASCII, toUnicode } from 'tr46';
import { normalizeEmail } from './normalize-email.js';
import { EMAIL_UNICODE } from './email-unicode.js';

// Pydantic EmailStr: display-name wrapper, SMTPUTF8 dot-atom, NFC and IDNA2008.
const SPACE = '[\\p{White_Space}\\u001c-\\u001f]';
const NAME = "[\\p{L}\\p{N}_!#$%&'*+\\-/=?^`{|}~]";
const PRETTY = new RegExp(
  `^${SPACE}*(?:(?:${NAME}+${SPACE}+)*${NAME}+|"(?:[^"\\r\\n]|\\\\")+")?${SPACE}*<(.+)>${SPACE}*$`,
  'u',
);
const OPTIONS = {
  checkHyphens: true,
  checkBidi: false,
  checkJoiners: true,
  useSTD3ASCIIRules: true,
  transitionalProcessing: false,
  verifyDNSLength: true,
};
const RESERVED = /(?:^|\.)(?:arpa|invalid|local|localhost|onion|test)$/;
const LOCAL = /^[a-zA-Z0-9!#$%&'*+\-/=?^_`{|}~.\u0080-\u{10ffff}]+$/u;
const HOST = /^[a-zA-Z0-9.\-\u0080-\u{10ffff}]+$/u;
function safe(value: string): boolean {
  return (
    !Array.from(value).some((character) => inRanges(character, EMAIL_UNICODE.unsafe)) &&
    !inRanges(Array.from(value)[0] ?? '', EMAIL_UNICODE.marks)
  );
}

function inRanges(character: string, ranges: number[][]): boolean {
  const point = character.codePointAt(0);
  if (point === undefined) return false;
  let low = 0;
  let high = ranges.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    const start = ranges[mid]?.[0];
    const end = ranges[mid]?.[1];
    if (start === undefined || end === undefined) throw new Error('Invalid Unicode profile');
    if (point < start) high = mid;
    else if (point >= end) low = mid + 1;
    else return true;
  }
  return false;
}

/** Return undefined for invalid email; never turn malformed input into a different account. */
export function canonicalEmail(value: unknown): string | undefined {
  if (typeof value !== 'string' || Array.from(value).length > 2048) return undefined;
  const raw = (PRETTY.exec(value)?.[1] ?? value).replace(
    new RegExp(`^${SPACE}+|${SPACE}+$`, 'gu'),
    '',
  );
  const parts = raw.split('@');
  const local = parts[0];
  const domain = parts[1];
  if (
    parts.length !== 2 ||
    !local ||
    !domain ||
    !LOCAL.test(local) ||
    !safe(local) ||
    !HOST.test(domain) ||
    !safe(domain)
  )
    return undefined;
  if (local.startsWith('.') || local.endsWith('.') || local.includes('..')) return undefined;
  const ascii = toASCII(domain, OPTIONS);
  if (!ascii || !ascii.includes('.') || !/[a-z]$/i.test(ascii) || RESERVED.test(ascii))
    return undefined;
  const unicode = toUnicode(ascii, OPTIONS);
  if (unicode.error || !safe(unicode.domain)) return undefined;
  // UTS46 also accepts symbols that IDNA2008 excludes (for example emoji).
  if (unicode.domain.split('.').some((label) => !idnaLabel(label))) return undefined;
  const nfc = local.normalize('NFC');
  if (
    !LOCAL.test(nfc) ||
    !safe(nfc) ||
    nfc.startsWith('.') ||
    nfc.endsWith('.') ||
    nfc.includes('..')
  )
    return undefined;
  const normalized = `${nfc}@${unicode.domain}`;
  if (
    [raw, normalized, `${nfc}@${ascii}`].some((address) => Buffer.byteLength(address, 'utf8') > 254)
  )
    return undefined;
  const identity = normalizeEmail(normalized);
  return Array.from(identity).length <= 254 ? identity : undefined;
}

function idnaLabel(label: string): boolean {
  const characters = Array.from(label);
  if (!validBidi(characters)) return false;
  return characters.every((character, index) => {
    if (inRanges(character, EMAIL_UNICODE.pvalid)) return true;
    if (/^[\u0660-\u0669]$/u.test(character)) return !/[\u06f0-\u06f9]/u.test(label);
    if (/^[\u06f0-\u06f9]$/u.test(character)) return !/[\u0660-\u0669]/u.test(label);
    if (character === '·') return characters[index - 1] === 'l' && characters[index + 1] === 'l';
    if (character === '\u0375') return /\p{Script=Greek}/u.test(characters[index + 1] ?? '');
    if (/^[\u05f3\u05f4]$/u.test(character))
      return /\p{Script=Hebrew}/u.test(characters[index - 1] ?? '');
    if (character === '\u30fb')
      return /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(label);
    return false;
  });
}

// IDNA2008 checks bidi per label; UTS46's domain-wide switch rejects valid numeric sibling labels.
function validBidi(characters: string[]): boolean {
  const directions = characters.map(
    (character) =>
      Object.entries(EMAIL_UNICODE.bidi).find(([, ranges]) => inRanges(character, ranges))?.[0],
  );
  if (!directions.some((direction) => ['R', 'AL', 'AN'].includes(direction ?? ''))) return true;
  const rtl = ['R', 'AL'].includes(directions[0] ?? '');
  if (!rtl && directions[0] !== 'L') return false;
  const allowed = rtl
    ? ['R', 'AL', 'AN', 'EN', 'ES', 'CS', 'ET', 'ON', 'BN', 'NSM']
    : ['L', 'EN', 'ES', 'CS', 'ET', 'ON', 'BN', 'NSM'];
  const ending = directions.findLast((direction) => direction !== 'NSM');
  return (
    directions.every((direction) => allowed.includes(direction ?? '')) &&
    (rtl ? ['R', 'AL', 'EN', 'AN'] : ['L', 'EN']).includes(ending ?? '') &&
    !(rtl && directions.includes('AN') && directions.includes('EN'))
  );
}
