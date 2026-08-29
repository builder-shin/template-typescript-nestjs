import { Controller, Get, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { JsonApiError } from '../jsonapi/errors.js';
import { SkipJsonApiNegotiation } from '../jsonapi/negotiation.js';

/** liveness 응답. */
export interface LiveStatus {
  readonly status: string;
}

/** readiness 응답. */
export interface ReadyStatus {
  readonly status: string;
  readonly database: string;
}

/**
 * 상태 확인 컨트롤러.
 *
 * JSON:API 협상 대상이 아니다. vendor 미디어 타입 없이 평문 JSON을 반환한다.
 * 이 의도를 `@SkipJsonApiNegotiation()`으로 코드에 남긴다.
 *
 * liveness는 어떤 외부 자원도 해석하지 않는다 — 프로세스가 살아 있는지만 답한다.
 * DB가 죽었을 때 liveness가 실패하면 오케스트레이터가 멀쩡한 프로세스를 재시작하는데,
 * 재시작은 DB를 되살리지 못하므로 무한 재시작 루프가 된다.
 *
 * readiness는 DB를 확인한다. 트래픽을 받을 준비가 됐는지가 곧 DB에 닿는지이기 때문이다.
 */
@SkipJsonApiNegotiation()
@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  @Get('live')
  live(): LiveStatus {
    return { status: 'ok' };
  }

  @Get('ready')
  async ready(): Promise<ReadyStatus> {
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
      throw new JsonApiError('INTERNAL_SERVER_ERROR', {
        detail: 'the database is not reachable',
      });
    }
    return { status: 'ok', database: 'ok' };
  }
}
