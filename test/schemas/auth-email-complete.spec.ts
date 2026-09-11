import { readFileSync } from 'node:fs';
import { validateAttributes } from '../../src/app/schemas/write-schema.js';
import { UserRegister } from '../../src/app/schemas/auth.schemas.js';

const vectors = JSON.parse(
  readFileSync(new URL('../fixtures/auth-email-vectors.json', import.meta.url), 'utf8'),
) as { input: unknown; normalized: string | null }[];
describe('complete email contract', () => {
  it.each(vectors)('validates and normalizes $input', async ({ input, normalized }) => {
    const result = validateAttributes(UserRegister, {
      email: input,
      password: 'a-secure-password',
    });
    if (normalized === null) await expect(result).rejects.toBeDefined();
    else expect((await result).email).toBe(normalized);
  });
});
