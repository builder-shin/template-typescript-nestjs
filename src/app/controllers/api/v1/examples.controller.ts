import { Controller } from '@nestjs/common';
import { JwtActiveUserGuard } from '../../../auth/current-user.guard.js';
import { CrudActions } from '../../concerns/crud-actions.js';
import { Example } from '../../../models/example.entity.js';
import { EXAMPLE_QUERY_POLICY } from '../../../schemas/example.query-policy.js';
import {
  EXAMPLE_RELATIONSHIPS,
  ExampleCreate,
  ExampleReplace,
  ExampleUpdate,
} from '../../../schemas/example.schemas.js';
import { EXAMPLE_SERIALIZER } from '../../../serializers/example.serializer.js';

/**
 * Example 자원.
 *
 * 이 파일에는 선언만 있다 — 모델·시리얼라이저·쓰기 스키마·조회 정책이 전부이고
 * CRUD 구현은 `CrudActions`가 소유한다. 자원별 service 계층을 만들지 않는다는
 * 스펙 4장의 규칙이 여기서 눈에 보인다.
 *
 * `@Controller` 경로는 시리얼라이저의 `resourcePath`와 문자열까지 같아야 한다.
 * 어긋나면 부트스트랩에서 터진다(`jsonapi-controller.ts` 참고).
 *
 * `writeGuards`가 `JwtActiveUserGuard`를 쓴다. 스펙 16장은 쓰기(및 관계 변경)에
 * 활성 사용자의 Bearer 토큰을 요구하고, Phase 6이 그 가드를 만들었다. 읽기
 * (`index`/`show`, 관계 `GET`)에는 붙지 않는다 — `writeGuards`가 `route-registrar.ts`의
 * `writeMethods`(create/update/destroy/replace와 관계 쓰기 라우트)에만 적용되기 때문이다.
 */
@Controller('api/v1/examples')
export class ExamplesController extends CrudActions({
  model: Example,
  serializer: EXAMPLE_SERIALIZER,
  createSchema: ExampleCreate,
  updateSchema: ExampleUpdate,
  relationshipsSchema: EXAMPLE_RELATIONSHIPS,
  queryPolicy: EXAMPLE_QUERY_POLICY,
  replaceSchema: ExampleReplace,
  enableUpsert: true,
  writeGuards: [JwtActiveUserGuard],
}) {}
