import { Controller } from '@nestjs/common';
import { CrudActions } from '../../concerns/crud-actions.js';
import { Category } from '../../../models/category.entity.js';
import { EXAMPLE_CATEGORY_QUERY_POLICY } from '../../../schemas/category.query-policy.js';
import { CATEGORY_SERIALIZER } from '../../../serializers/category.serializer.js';

/**
 * 분류 자원. 읽기 전용이다.
 *
 * 분류는 서버가 관리하는 참조 데이터다. 쓰기 라우트를 열지 않으므로
 * `createSchema`·`updateSchema`·`relationshipsSchema`를 선언하지 않는다 —
 * `enableWrites: false`가 그 셋을 요구하지 않게 한다.
 *
 * 이 자원이 존재하는 이유는 관계 선택기다. 분류는 Example의 관계로만 노출되어
 * 있어서, 폼이 고를 목록을 가져올 곳이 없었다. `?include=`로 긁는 방식은
 * 불완전하다 — 어떤 Example에도 붙지 않은 분류는 영원히 나타나지 않는다.
 *
 * `@Controller` 경로가 `api/v1/categories`이고 JSON:API `type`은
 * `exampleCategories`다. 둘이 다른 것은 의도된 결정이다.
 *
 * `writeGuards`가 없다. 쓰기 라우트 자체가 없으므로 붙을 자리가 없다.
 */
@Controller('api/v1/categories')
export class CategoriesController extends CrudActions({
  model: Category,
  serializer: CATEGORY_SERIALIZER,
  queryPolicy: EXAMPLE_CATEGORY_QUERY_POLICY,
  enableWrites: false,
}) {}
