import { Controller, Get, Logger, Res } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { JsonApiError } from '../jsonapi/errors.js';
import { SkipJsonApiNegotiation } from '../jsonapi/negotiation.js';
import { JSONAPI_MEDIA_TYPE, pinJsonApiContentType } from '../jsonapi/media-type.js';
import type { HeaderWritableResponse } from '../jsonapi/media-type.js';

/** liveness 응답. */
export interface LiveStatus {
  readonly data: null;
  readonly meta: { readonly status: 'ok' };
  readonly jsonapi: { readonly version: '1.1' };
}

/** readiness 응답. */
export type ReadyStatus = LiveStatus;

function healthDocument(response?: HeaderWritableResponse): LiveStatus {
  if (response !== undefined) {
    pinJsonApiContentType(response);
    response.setHeader('Content-Type', JSONAPI_MEDIA_TYPE);
  }
  return { data: null, meta: { status: 'ok' }, jsonapi: { version: '1.1' } };
}

/** Health probes bypass Accept negotiation and return JSON:API documents. */
@SkipJsonApiNegotiation()
@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  @Get('live')
  live(@Res({ passthrough: true }) response?: HeaderWritableResponse): LiveStatus {
    return healthDocument(response);
  }

  @Get('ready')
  async ready(@Res({ passthrough: true }) response?: HeaderWritableResponse): Promise<ReadyStatus> {
    try {
      await this.dataSource.query('SELECT 1');
    } catch (error) {
      // 원인은 서버 로그로만 보낸다: 운영자는 자격 증명·네트워크·타임아웃 등 실패 원인을
      // 구분할 수 있어야 하지만, 클라이언트는 고정된 코드/detail만 받는다 — 드라이버
      // 메시지가 그대로 새면 내부 정보 노출이 된다.
      this.logger.error(
        'readiness check failed: database unreachable',
        error instanceof Error ? error.stack : String(error),
      );
      throw new JsonApiError('INTERNAL_SERVER_ERROR', { status: 503 });
    }
    return healthDocument(response);
  }
}
