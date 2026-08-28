import { Controller, Get } from '@nestjs/common';

/** 상태 확인 응답. */
export interface HealthStatus {
  readonly status: string;
}

/**
 * 상태 확인 컨트롤러.
 *
 * JSON:API 협상 대상이 아니다. vendor 미디어 타입 없이 평문 JSON을 반환한다.
 * liveness는 어떤 외부 자원도 해석하지 않는다.
 * readiness의 데이터베이스 확인은 Phase 2에서 추가한다.
 */
@Controller('health')
export class HealthController {
  @Get('live')
  live(): HealthStatus {
    return { status: 'ok' };
  }

  @Get('ready')
  ready(): HealthStatus {
    return { status: 'ok' };
  }
}
