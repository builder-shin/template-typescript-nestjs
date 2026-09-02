import { Controller } from '@nestjs/common';
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
 * `writeGuards`는 아직 비어 있다. 스펙 16장은 쓰기에 활성 사용자의 Bearer 토큰을
 * 요구하는데, 그 가드는 Phase 6이 만든다 — 없는 가드를 미리 적어 두면 지금 부팅이
 * 안 된다.
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
}) {}
