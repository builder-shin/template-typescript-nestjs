import type { EntityMetadata, ObjectLiteral, SelectQueryBuilder } from 'typeorm';

// Keep the ordinary ORM Date values for writes. Only values read in this query carry
// exact PostgreSQL microseconds; no process-wide pg parser or column precision changes.
const exactValues = new WeakMap<Date, string>();

export function serializeTimestamp(value: Date): string {
  return (
    exactValues.get(value) ??
    value
      .toISOString()
      .replace(/\.(\d{3})Z$/, '.$1000Z')
      .replace('.000000Z', 'Z')
  ).replace(/Z$/, '+00:00');
}

/** Hydrate entities and retain exact database timestamp strings from the same SELECT. */
export async function getExactEntities<T extends ObjectLiteral>(
  builder: SelectQueryBuilder<T>,
): Promise<T[]> {
  const selections = builder.expressionMap.aliases
    .filter((alias) => alias.hasMetadata)
    .map((alias, index) => {
      const metadata = alias.metadata;
      const primary = metadata.primaryColumns[0];
      if (primary === undefined) throw new TypeError('Timestamp hydration requires a primary key');
      const key = `exact_${String(index)}_id`;
      builder.addSelect(
        `${builder.escape(alias.name)}.${builder.escape(primary.databaseName)}::text`,
        key,
      );
      const columns = metadata.columns.filter(
        (column) => column.type === 'timestamptz' || column.type === 'timestamp with time zone',
      );
      const dates = columns.map((column, dateIndex) => {
        const selection = `exact_${String(index)}_${String(dateIndex)}`;
        builder.addSelect(
          `to_char(${builder.escape(alias.name)}.${builder.escape(column.databaseName)} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
          selection,
        );
        return { column, selection };
      });
      return { metadata, primary, key, dates };
    });
  const result = await builder.getRawAndEntities<Record<string, unknown>>();
  const values = new Map<EntityMetadata, Map<string, Map<string, string>>>();
  for (const { metadata, key, dates } of selections) {
    const entities = values.get(metadata) ?? new Map<string, Map<string, string>>();
    values.set(metadata, entities);
    for (const raw of result.raw) {
      const id = raw[key];
      if (typeof id !== 'string') continue;
      const timestamps = new Map<string, string>();
      for (const { column, selection } of dates) {
        const timestamp = raw[selection];
        if (typeof timestamp === 'string')
          timestamps.set(column.propertyPath, timestamp.replace('.000000Z', 'Z'));
      }
      entities.set(id, timestamps);
    }
  }
  const visited = new WeakSet<object>();
  const hydrate = (entity: ObjectLiteral, metadata: EntityMetadata): void => {
    if (visited.has(entity)) return;
    visited.add(entity);
    const primary = metadata.primaryColumns[0];
    const id: unknown = primary?.getEntityValue(entity);
    const timestamps = typeof id === 'string' ? values.get(metadata)?.get(id) : undefined;
    for (const column of metadata.columns) {
      const value: unknown = column.getEntityValue(entity);
      const timestamp = timestamps?.get(column.propertyPath);
      if (value instanceof Date && timestamp !== undefined) exactValues.set(value, timestamp);
    }
    for (const relation of metadata.relations) {
      const related: unknown = relation.getEntityValue(entity);
      const children: unknown[] = Array.isArray(related) ? related : [related];
      for (const child of children) {
        if (typeof child === 'object' && child !== null)
          hydrate(child, relation.inverseEntityMetadata);
      }
    }
  };
  const metadata = builder.expressionMap.mainAlias?.metadata;
  if (metadata !== undefined) for (const entity of result.entities) hydrate(entity, metadata);
  return result.entities;
}
