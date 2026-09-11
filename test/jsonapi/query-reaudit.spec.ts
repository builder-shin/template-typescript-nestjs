import { parseFilters } from '../../src/app/jsonapi/filter.js';
import { parseQuery } from '../../src/app/jsonapi/query.js';
import { parseRawQuery } from '../../src/app/jsonapi/query-input.js';
import { EXAMPLE_QUERY_POLICY } from '../../src/app/schemas/example.query-policy.js';

describe('query re-audit regressions', () => {
  it('preserves first-error precedence across interleaved duplicate keys', () => {
    const query = parseRawQuery('filter[score]=1&sort=bad&filter[score]=2');
    try {
      parseQuery(query, EXAMPLE_QUERY_POLICY, []);
    } catch (error) {
      expect(error).toMatchObject({ code: 'INVALID_SORT' });
      return;
    }
    throw new Error('Expected query error');
  });
  it.each(['', '2147483648', '-2147483649', '1__0', '²'])('rejects invalid score %s', (raw) => {
    expect(() => parseFilters({ 'filter[score]': raw }, EXAMPLE_QUERY_POLICY)).toThrow();
  });
  it.each([' 10 ', '1_0', '١٠', '１０', '+10'])('preserves decimal integer grammar %s', (raw) => {
    expect(parseFilters({ 'filter[score]': raw }, EXAMPLE_QUERY_POLICY)[0]?.value).toBe(10);
  });
  it.each(['filter[title]', 'filter[title][contains]'])('rejects empty %s', (key) => {
    expect(() => parseFilters({ [key]: '' }, EXAMPLE_QUERY_POLICY)).toThrow();
  });
  it('rejects equivalent duplicate filters', () => {
    expect(() =>
      parseFilters({ 'filter[score]': '1', 'filter[score][exact]': '1' }, EXAMPLE_QUERY_POLICY),
    ).toThrow();
  });
  it.each([
    '0000-01-01T00:00:00Z',
    '2026-02-30T00:00:00Z',
    '2026-01-01T24:00:00Z',
    '2026-01-01T00:00:60Z',
    '0001-01-01T00:00:00+01:00',
    '9999-12-31T23:59:59-01:00',
  ])('rejects invalid timestamp %s', (raw) => {
    expect(() => parseFilters({ 'filter[createdAt][gte]': raw }, EXAMPLE_QUERY_POLICY)).toThrow();
  });
  it.each([
    '2026-01-01 00:00:00+00:00',
    '2026-01-01T00:00:00+01:60',
    '20260101T000000Z',
    '2026-W01-4T00:00:00Z',
    '2026-01-01T00:00Z',
    '2026-01-01X00:00:00,123456789Z',
  ])('accepts ISO datetime grammar %s', (raw) => {
    expect(parseFilters({ 'filter[createdAt][gte]': raw }, EXAMPLE_QUERY_POLICY)).toHaveLength(1);
  });
  it.each([
    '00000000000040008000000000000001',
    '{00000000-0000-4000-8000-000000000001}',
    'urn:uuid:00000000-0000-4000-8000-000000000001',
  ])('normalizes UUID %s', (raw) => {
    expect(parseFilters({ 'filter[category.id]': raw }, EXAMPLE_QUERY_POLICY)[0]?.value).toBe(
      '00000000-0000-4000-8000-000000000001',
    );
  });
  it.each([
    [{ 'filter[score]': 'bad', foo: '1' }, 'INVALID_FILTER'],
    [{ 'page[size]': 'bad', sort: 'bad' }, 'INVALID_PAGE'],
    [{ sort: 'bad', 'page[size]': 'bad' }, 'INVALID_SORT'],
    [{ 'page[number]': '9223372036854775807', foo: '1' }, 'INVALID_QUERY_PARAMETER'],
  ])('reports errors in request order', (query, code) => {
    try {
      parseQuery(query, EXAMPLE_QUERY_POLICY, ['category', 'tags']);
    } catch (error) {
      expect(error).toMatchObject({ code });
      return;
    }
    throw new Error('Expected query error');
  });
});
