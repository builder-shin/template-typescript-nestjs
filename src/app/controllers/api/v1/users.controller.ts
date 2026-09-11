import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { CurrentUser, JwtUserGuard } from '../../../auth/current-user.guard.js';
import { JsonApiNegotiationGuard } from '../../../jsonapi/negotiation.js';
import { USER_SERIALIZER } from '../../../serializers/index.js';
import { User } from '../../../models/user.entity.js';
import { serializeResource } from '../../../serializers/serializer.js';
import { singleDocument } from '../../concerns/documents.js';
import type { SingleDocument } from '../../concerns/documents.js';

/** Authenticated users can inspect their own profile, including inactive accounts. */
@Controller('api/v1/users')
@UseGuards(JsonApiNegotiationGuard)
export class UsersController {
  @Get('me')
  @UseGuards(JwtUserGuard)
  @ApiBearerAuth()
  me(@CurrentUser() user: User): SingleDocument {
    return singleDocument(serializeResource(USER_SERIALIZER, user), []);
  }
}
