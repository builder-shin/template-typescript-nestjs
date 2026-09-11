/** Python-compatible scalar grammar; SQL receives only normalized bounded values. */
function decimalDigits(raw: string): string {
  return raw.replace(/\p{Decimal_Number}/gu, (character) => {
    const code = character.codePointAt(0) ?? 0;
    let start = code;
    while (/\p{Decimal_Number}/u.test(String.fromCodePoint(start - 1))) start -= 1;
    return String((code - start) % 10);
  });
}

export function decimalInteger(raw: string): bigint {
  const ascii = decimalDigits(raw).replace(/^\p{White_Space}+|\p{White_Space}+$/gu, '');
  if (!/^[+-]?[0-9](?:_?[0-9])*$/.test(ascii)) throw new Error('Invalid integer');
  return BigInt(ascii.replaceAll('_', ''));
}

export function normalizeUuid(raw: string): string {
  const candidate = decimalDigits(
    raw
      .replaceAll('urn:', '')
      .replaceAll('uuid:', '')
      .replace(/^[{}]+|[{}]+$/g, '')
      .replaceAll('-', ''),
  );
  if (candidate.length !== 32) throw new Error('Invalid UUID');
  const integer = candidate.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, '');
  if (!/^[+]?(?:0x_?)?[0-9a-f](?:_?[0-9a-f])*$/i.test(integer)) throw new Error('Invalid UUID');
  const digits = integer.replace(/^\+/, '').replace(/^0x/i, '').replaceAll('_', '');
  const hex = BigInt(`0x${digits}`).toString(16).padStart(32, '0');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`.toLowerCase();
}

function calendar(year: number, month: number, day: number): Date {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  if (
    year < 1 ||
    year > 9999 ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  )
    throw new Error('Invalid calendar date');
  return date;
}

function clock(raw: string): { seconds: number; micros: number } {
  const match = /^(\d{2})(?:(:?)(\d{2})(?:\2(\d{2}))?)?(?:[.,](\d+))?$/.exec(raw);
  if (match === null) throw new Error('Invalid clock');
  return {
    seconds: Number(match[1]) * 3600 + Number(match[3] ?? 0) * 60 + Number(match[4] ?? 0),
    micros: Number((match[5] ?? '').slice(0, 6).padEnd(6, '0')),
  };
}

/** ISO basic/extended calendar and week dates; timezone and subsecond precision retained. */
export function normalizeTimestamp(raw: string): string {
  const match =
    /^(?:(\d{4})(-?)(\d{2})\2(\d{2})|(\d{4})(-?)W(\d{2})(?:\6([1-7]))?)([\s\S])(.+)$/u.exec(raw);
  if (match === null) throw new Error('Invalid ISO timestamp');
  let date: Date;
  if (match[1] !== undefined) date = calendar(Number(match[1]), Number(match[3]), Number(match[4]));
  else {
    const year = Number(match[5]);
    const week = Number(match[7]);
    date = calendar(year, 1, 4);
    date.setUTCDate(
      date.getUTCDate() - ((date.getUTCDay() + 6) % 7) + (week - 1) * 7 + Number(match[8] ?? 1) - 1,
    );
    const thursday = new Date(date);
    thursday.setUTCDate(date.getUTCDate() + 3 - ((date.getUTCDay() + 6) % 7));
    if (week < 1 || week > 53 || thursday.getUTCFullYear() !== year)
      throw new Error('Invalid ISO week');
  }
  const time = /^(.*?)(Z|[+-].+)$/.exec(match[10] ?? '');
  if (time === null) throw new Error('Timezone required');
  const local = clock(time[1] ?? '');
  const localParts = /^(\d{2})(?::?(\d{2}))?(?::?(\d{2}))?/.exec(time[1] ?? '');
  if (localParts === null) throw new Error('Invalid local time');
  if (
    Number(localParts[1]) > 23 ||
    Number(localParts[2] ?? 0) > 59 ||
    Number(localParts[3] ?? 0) > 59
  )
    throw new Error('Invalid local time');
  const zone = time[2] ?? '';
  const offset = zone === 'Z' ? { seconds: 0, micros: 0 } : clock(zone.slice(1));
  if (offset.seconds >= 86400) throw new Error('Invalid UTC offset');
  const offsetMicros = BigInt(offset.seconds) * 1000000n + BigInt(offset.micros);
  const micros =
    BigInt(date.getTime()) * 1000n +
    BigInt(local.seconds) * 1000000n +
    BigInt(local.micros) -
    (zone.startsWith('-') ? -offsetMicros : offsetMicros);
  // Floor division is required for timestamps before 1970.
  const seconds = micros >= 0n ? micros / 1000000n : (micros - 999999n) / 1000000n;
  const remainder = micros - seconds * 1000000n;
  const utc = new Date(Number(seconds) * 1000);
  if (utc.getUTCFullYear() < 1 || utc.getUTCFullYear() > 9999)
    throw new Error('UTC calendar out of range');
  return `${utc.toISOString().slice(0, 19)}.${String(remainder).padStart(6, '0')}Z`;
}
