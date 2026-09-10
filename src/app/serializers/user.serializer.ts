import type { ResourceSerializer } from './serializer.js';
import type { User } from '../models/user.entity.js';

/**
 * 사용자의 공개 표현.
 *
 * `passwordHash`가 여기 없는 것이 이 파일의 요점이다. attributes는 열거된 것만
 * 나가므로, 필드를 추가하는 사람이 실수로 해시를 넣지 않는 한 새어 나갈 길이 없다 —
 * `test/serializers/auth.serializers.spec.ts`가 그것을 고정한다.
 *
 * `resourcePath`가 없다. 스펙 16장에 `GET /api/v1/users/{id}`가 없어서 가리킬 URL이
 * 없다. `GET /api/v1/users/me`는 있지만 그것은 id로 가리키는 자리가 아니다.
 */
export const USER_SERIALIZER: ResourceSerializer<User> = {
  type: 'users',
  attributes: {
    email: (user) => user.email,
    isActive: (user) => user.isActive,
    createdAt: (user) => user.createdAt.toISOString(),
    updatedAt: (user) => user.updatedAt.toISOString(),
  },
  relationships: {},
};
