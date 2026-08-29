import { Controller, Get } from '@nestjs/common';
import { SkipJsonApiNegotiation } from '../jsonapi/negotiation.js';

/** 상태 확인 응답. */
export interface HealthStatus {
  readonly status: string;
}

/**
 * 상태 확인 컨트롤러.
 *
 * JSON:API 협상 대상이 아니다. vendor 미디어 타입 없이 평문 JSON을 반환한다.
 * 이 의도를 `@SkipJsonApiNegotiation()`으로 코드에 남긴다 — 가드를 붙이지 않는 것과
 * 결과는 같지만, 빠뜨린 것인지 뺀 것인지가 드러난다.
 *
 * liveness는 어떤 외부 자원도 해석하지 않는다.
 * readiness의 데이터베이스 확인은 Task 9에서 추가한다.
 */
@SkipJsonApiNegotiation()
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
