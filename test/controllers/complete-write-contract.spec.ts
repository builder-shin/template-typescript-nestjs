import { parseWriteDocument } from '../../src/app/controllers/concerns/document-parsing.js';
import { UserRegister } from '../../src/app/schemas/auth.schemas.js';
import { JsonApiError, JsonApiErrors } from '../../src/app/jsonapi/errors.js';
import {
  ExampleCreate,
  ExampleReplace,
  ExampleUpdate,
} from '../../src/app/schemas/example.schemas.js';

async function pointers(work: Promise<unknown>): Promise<(string | undefined)[]> {
  try {
    await work;
  } catch (error) {
    const errors =
      error instanceof JsonApiErrors ? error.errors : error instanceof JsonApiError ? [error] : [];
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.every((item) => item.code === 'VALIDATION_ERROR' && item.status === 422)).toBe(
      true,
    );
    return errors.map((item) => item.source?.pointer).sort();
  }
  throw new Error('Expected validation failure');
}

const attributes = { title: ' ', status: 'active', score: 42 };

describe('complete write document validation', () => {
  it.each(['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'prototype'])(
    'rejects unknown attribute %s before DTO transformation',
    async (key) => {
      const extra: Record<string, unknown> = JSON.parse(`{"${key}": 1}`) as Record<string, unknown>;
      for (const schema of [ExampleCreate, ExampleReplace]) {
        expect(
          await pointers(
            parseWriteDocument(
              { data: { type: 'examples', attributes: { ...attributes, ...extra } } },
              schema,
              { expectedType: 'examples' },
            ),
          ),
        ).toEqual([`/data/attributes/${key}`]);
        expect(
          await pointers(
            parseWriteDocument({ data: { type: 'examples', attributes: extra } }, schema, {
              expectedType: 'examples',
            }),
          ),
        ).toEqual(
          [
            `/data/attributes/${key}`,
            '/data/attributes/score',
            '/data/attributes/status',
            '/data/attributes/title',
          ].sort(),
        );
      }
      expect(
        await pointers(
          parseWriteDocument(
            {
              data: {
                type: 'users',
                attributes: { email: 'test@example.com', password: 'password-123456', ...extra },
              },
            },
            UserRegister,
            { expectedType: 'users' },
          ),
        ),
      ).toEqual([`/data/attributes/${key}`]);
    },
  );
  it.each(['bogus', 'meta', 'links', 'included', 'jsonapi'])(
    'rejects top-level %s',
    async (key) => {
      expect(
        await pointers(
          parseWriteDocument({ data: { type: 'examples', attributes }, [key]: {} }, ExampleCreate, {
            expectedType: 'examples',
          }),
        ),
      ).toEqual([`/${key}`]);
    },
  );
  it.each(['bogus', 'meta', 'links'])('rejects resource %s', async (key) => {
    expect(
      await pointers(
        parseWriteDocument({ data: { type: 'examples', attributes, [key]: {} } }, ExampleCreate, {
          expectedType: 'examples',
        }),
      ),
    ).toEqual([`/data/${key}`]);
  });
  it('aggregates missing type, id and all required attributes', async () => {
    expect(
      await pointers(
        parseWriteDocument({ data: { attributes: {} } }, ExampleReplace, {
          expectedType: 'examples',
          expectedId: 'x',
          requireId: true,
        }),
      ),
    ).toEqual([
      '/data/attributes/score',
      '/data/attributes/status',
      '/data/attributes/title',
      '/data/id',
      '/data/type',
    ]);
  });
  it('requires PATCH attributes or relationships', async () => {
    expect(
      await pointers(
        parseWriteDocument({ data: { type: 'examples', id: 'x' } }, ExampleUpdate, {
          expectedType: 'examples',
          expectedId: 'x',
        }),
      ),
    ).toEqual(['/data']);
  });
  it('rejects extra embedded relationship members', async () => {
    expect(
      await pointers(
        parseWriteDocument(
          {
            data: {
              type: 'examples',
              attributes,
              relationships: { category: { data: null, meta: {} } },
            },
          },
          ExampleCreate,
          { expectedType: 'examples' },
        ),
      ),
    ).toEqual(['/data/relationships/category/meta']);
  });
  it('escapes unknown attribute pointers', async () => {
    expect(
      await pointers(
        parseWriteDocument(
          { data: { type: 'examples', attributes: { ...attributes, 'a~/b': 1 } } },
          ExampleCreate,
          { expectedType: 'examples' },
        ),
      ),
    ).toEqual(['/data/attributes/a~0~1b']);
  });
});
