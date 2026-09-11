import { normalizeUuid } from '../jsonapi/scalar-grammar.js';

/** Python UUID string forms, canonicalized before any UUID SQL lookup. */
export function uuidClaim(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    return normalizeUuid(value);
  } catch {
    return undefined;
  }
}
