import { parse } from 'node:querystring';

export type QueryInput = Readonly<Record<string, string | readonly string[] | undefined>>;
const orderedPairs = new WeakMap<object, readonly (readonly [string, string])[]>();

/** Keep the flat Express query representation and its original pair order. */
export function parseRawQuery(raw: string | null | undefined): QueryInput {
  const input = raw ?? '';
  const query = parse(input, undefined, undefined, { maxKeys: 0 });
  orderedPairs.set(query, [...new URLSearchParams(input)]);
  return query;
}

export function queryPairs(query: QueryInput): readonly (readonly [string, string | undefined])[] {
  return (
    orderedPairs.get(query) ??
    Object.entries(query).flatMap(([key, value]) =>
      typeof value === 'string' || value === undefined
        ? [[key, value] as const]
        : value.map((entry) => [key, entry] as const),
    )
  );
}
