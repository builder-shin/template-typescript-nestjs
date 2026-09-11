import { createHmac } from 'node:crypto';
import { TokenService } from '../../src/app/auth/tokens.js';
const settings = {
  secret: 'test-key'.repeat(8),
  issuer: 'test',
  audience: 'test',
  accessExpiresSeconds: 900,
  refreshExpiresSeconds: 3600,
  leewaySeconds: 0,
};
const id = '12345678-1234-5678-9012-123456789012';
function signed(overrides: Record<string, unknown>): string {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub: id,
    jti: id,
    iat: now,
    exp: now + 3600,
    type: 'refresh',
    iss: 'test',
    aud: 'test',
    ...overrides,
  };
  const unsigned = [{ alg: 'HS256', typ: 'JWT' }, payload]
    .map((p) => Buffer.from(JSON.stringify(p)).toString('base64url'))
    .join('.');
  return (
    unsigned + '.' + createHmac('sha256', settings.secret).update(unsigned).digest('base64url')
  );
}
describe('complete signed claim boundaries', () => {
  it.each([id.replaceAll('-', ''), '{' + id + '}', 'urn:uuid:' + id, id.toUpperCase()])(
    'normalizes UUID form %s',
    (jti) => {
      expect(new TokenService(settings).verifyRefreshToken(signed({ jti, sub: jti }))).toEqual({
        userId: id,
        sessionId: id,
      });
    },
  );
  it.each([-62135596800, -1, 0])('accepts historical iat %s', (iat) => {
    expect(new TokenService(settings).verifyRefreshToken(signed({ iat })).sessionId).toBe(id);
  });
  it('accepts fractional final year second', () => {
    expect(
      new TokenService(settings).verifyRefreshToken(signed({ exp: 253402300799.5 })).sessionId,
    ).toBe(id);
  });
  it.each([
    { iat: 253402300800 },
    { exp: 253402300800 },
    { iat: -62135596801 },
    { iat: true },
    { exp: true },
    { nbf: true },
    { nbf: '1' },
    { iat: Math.floor(Date.now() / 1000) + 3600, exp: 0 },
    { exp: 0, jti: 'bad' },
  ])('rejects invalid claims %p before expiration', (overrides) => {
    try {
      new TokenService(settings).verifyRefreshToken(signed(overrides));
      throw new Error('Expected invalid token');
    } catch (error: unknown) {
      expect(error).toMatchObject({ code: 'INVALID_TOKEN' });
    }
  });
});
