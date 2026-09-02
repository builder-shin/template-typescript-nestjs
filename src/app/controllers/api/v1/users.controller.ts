import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { CurrentUser, JwtActiveUserGuard } from '../../../auth/current-user.guard.js';
import { JsonApiNegotiationGuard } from '../../../jsonapi/negotiation.js';
import { USER_SERIALIZER } from '../../../serializers/index.js';
import { User } from '../../../models/user.entity.js';
import { serializeResource } from '../../../serializers/serializer.js';
import { singleDocument } from '../../concerns/documents.js';
import type { SingleDocument } from '../../concerns/documents.js';

/**
 * 자기 자신 조회.
 *
 * 경로가 `:id`가 아니라 `me`인 이유는 스펙 16장이 그렇게 정했기 때문이다. 다른
 * 사용자를 id로 읽는 라우트가 없으므로 `users` 시리얼라이저에도 `resourcePath`가 없다.
 *
 * 가드를 여기서는 손으로 붙인다. `writeGuards`는 `CrudActions`가 만든 컨트롤러의
 * 쓰기 라우트에만 걸리는 장치이고, 이것은 읽기 라우트다.
 */
@Controller('api/v1/users')
@UseGuards(JsonApiNegotiationGuard)
export class UsersController {
  @Get('me')
  @UseGuards(JwtActiveUserGuard)
  @ApiBearerAuth()
  me(@CurrentUser() user: User): SingleDocument {
    return singleDocument(serializeResource(USER_SERIALIZER, user), []);
  }
}
