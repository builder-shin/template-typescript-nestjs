import { isDirectRun } from '../../src/db/seeds.js';

describe('isDirectRun', () => {
  it('POSIX 스타일 경로 쌍이 같은 파일을 가리키면 true', () => {
    const path = '/home/user/project/dist/db/seeds.js';
    expect(isDirectRun(`file://${path}`, path)).toBe(true);
  });

  it('Windows 스타일 경로 쌍이 같은 파일을 가리키면 true', () => {
    // 예전 `` `file://${argv1}` `` 비교는 이 쌍에서 항상 false였다 — 드라이브 문자
    // 뒤 콜론과 백슬래시가 이어붙인 문자열을 유효한 file:// URL로 만들지 않았다.
    // 이 값들은 리뷰가 이 저장소의 Windows 개발 머신에서 재현한 실측값이다.
    expect(isDirectRun('file:///C:/x/seeds.js', 'C:\\x\\seeds.js')).toBe(true);
  });

  it('argv1이 없으면 false다 (import된 경우)', () => {
    expect(isDirectRun('file:///home/user/project/dist/db/seeds.js', undefined)).toBe(false);
  });

  it('metaUrl과 argv1이 다른 파일을 가리키면 false다', () => {
    expect(
      isDirectRun('file:///home/user/project/dist/db/seeds.js', '/home/user/project/dist/other.js'),
    ).toBe(false);
  });
});
