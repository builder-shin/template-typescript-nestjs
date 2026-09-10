import { Controller } from '@nestjs/common';
import { CrudActions } from '../../concerns/crud-actions.js';
import { Tag } from '../../../models/tag.entity.js';
import { EXAMPLE_TAG_QUERY_POLICY } from '../../../schemas/tag.query-policy.js';
import { TAG_SERIALIZER } from '../../../serializers/tag.serializer.js';

/**
 * 라벨 자원. 읽기 전용이다.
 *
 * 라벨이 서버가 관리하는 참조 데이터라는 것, 쓰기 라우트를 열지 않는 이유,
 * 이 자원이 존재하는 이유는 `CategoriesController`와 같다.
 *
 * `@Controller` 경로가 `api/v1/tags`이고 JSON:API `type`은 `exampleTags`다.
 */
@Controller('api/v1/tags')
export class TagsController extends CrudActions({
  model: Tag,
  serializer: TAG_SERIALIZER,
  queryPolicy: EXAMPLE_TAG_QUERY_POLICY,
  enableWrites: false,
}) {}
