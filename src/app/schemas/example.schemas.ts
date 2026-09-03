import { Transform } from 'class-transformer';
import { IsDate, IsIn, IsOptional, IsString, Length, ValidateIf } from 'class-validator';
import { Category } from '../models/category.entity.js';
import { EXAMPLE_STATUSES } from '../models/example.entity.js';
import type { ExampleStatus } from '../models/example.entity.js';
import { Tag } from '../models/tag.entity.js';
import type { RelationshipWriteSchema } from './write-schema.js';

/**
 * Example의 쓰기 계약.
 *
 * `categoryId`는 어느 스키마에도 없다. 내부 FK를 공개 입력으로 만들지 않는다는
 * 스펙 7.3의 규칙이고, 관계는 `relationships`로만 바꾼다. FK를 열면 같은 것을
 * 바꾸는 길이 두 개가 되고 둘의 검증 규칙이 갈라진다.
 *
 * 길이 제한은 엔티티 컬럼과 같은 값을 쓴다. 스키마가 더 느슨하면 DB가 거절해
 * 400이어야 할 것이 500으로 나간다.
 *
 * **선택 필드를 여는 표기가 두 가지인 이유.** `@IsOptional()`은 `undefined`뿐 아니라
 * `null`에도 **모든** 검증기를 건너뛴다. NOT NULL 컬럼에 그것을 달면 `{"title": null}`이
 * 검증을 통과해 PostgreSQL까지 내려가고, 사용자 입력 오류가 422가 아니라 500으로 나간다.
 * 그래서 표기는 컬럼의 nullable 여부를 따라간다 — 취향이 아니라 대응 관계다.
 *
 * - nullable 컬럼(`body`·`published_at`)은 `@IsOptional()`. `null`은 "비운다"는 뜻이다.
 * - NOT NULL 컬럼(`title`·`status`)은 `@ValidateIf(isPresent)`. 보내지 않은 것만
 *   건너뛰고 `null`은 검증기에 그대로 넘겨 422로 거절한다.
 *
 * 이 스키마를 복사해 새 자원을 만든다면 필드마다 이 대응부터 맞춘다.
 */

/** ISO 8601 문자열을 `Date`로 바꾼다. 저장 계층이 받는 형식이다. */
function toDate({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? new Date(value) : value;
}

/**
 * "아예 보내지 않았다"만 검증을 건너뛰게 하는 `@ValidateIf` 조건.
 *
 * 부분 갱신은 필드를 **보내지 않는 것**으로 표현되므로 `undefined`는 건너뛴다.
 * `null`은 사용자가 명시적으로 보낸 값이라 뒤따르는 검증기가 봐야 한다.
 */
function isPresent(_object: unknown, value: unknown): boolean {
  return value !== undefined;
}

/** `POST /api/v1/examples`의 본문 attributes. */
export class ExampleCreate {
  @IsString()
  @Length(1, 200)
  title!: string;

  @IsOptional()
  @IsString()
  body?: string | null;

  // 컬럼이 NOT NULL이고 기본값이 있다. 보내지 않으면 DB 기본값(`draft`)이 되지만
  // `null`은 그 기본값을 뜻하지 않으므로 여기서 거절한다.
  @ValidateIf(isPresent)
  @IsIn(EXAMPLE_STATUSES)
  status?: ExampleStatus;

  // `@Transform`이 `plainToInstance` 단계에서 돌아 검증기는 이미 `Date`를 본다.
  // 그래서 `@IsISO8601`이 아니라 `@IsDate`다 — `new Date('어제')`는 Invalid Date라
  // `@IsDate`가 잡는다.
  @IsOptional()
  @Transform(toDate)
  @IsDate()
  publishedAt?: Date | null;
}

/**
 * `PATCH /api/v1/examples/{id}`의 본문 attributes.
 *
 * 모든 필드가 선택이다. 무엇을 실제로 바꿀지는 이 스키마가 아니라 요청이 보낸 키
 * 집합(`presentKeys`)이 정한다 — 스펙 7.1.
 */
export class ExampleUpdate {
  // 선택이지만 `null`은 아니다. 파일 머리의 대응 관계 참고 — `title` 컬럼이 NOT NULL이라
  // `@IsOptional()`을 쓰면 `{"title": null}`이 DB까지 내려가 500이 된다.
  @ValidateIf(isPresent)
  @IsString()
  @Length(1, 200)
  title?: string;

  @IsOptional()
  @IsString()
  body?: string | null;

  @ValidateIf(isPresent)
  @IsIn(EXAMPLE_STATUSES)
  status?: ExampleStatus;

  @IsOptional()
  @Transform(toDate)
  @IsDate()
  publishedAt?: Date | null;
}

/**
 * `PUT /api/v1/examples/{id}`의 본문 attributes.
 *
 * 전체 교체이므로 생성과 같은 필수 조건을 건다 — 보내지 않은 필드는 기본값으로
 * 돌아가고, 그것이 PATCH와 갈리는 지점이다.
 */
export class ExampleReplace {
  @IsString()
  @Length(1, 200)
  title!: string;

  @IsOptional()
  @IsString()
  body?: string | null;

  @ValidateIf(isPresent)
  @IsIn(EXAMPLE_STATUSES)
  status?: ExampleStatus;

  @IsOptional()
  @Transform(toDate)
  @IsDate()
  publishedAt?: Date | null;
}

/**
 * 쓰기로 여는 관계.
 *
 * 여기 없는 관계는 읽기 전용이 된다 — 시리얼라이저가 선언한 관계라면 `GET` 두 개는
 * 그대로 열리고 `PATCH`/`POST`/`DELETE`만 생기지 않는다(`route-registrar.ts` 참고).
 */
export const EXAMPLE_RELATIONSHIPS: RelationshipWriteSchema = {
  category: { cardinality: 'one', type: 'categories', model: Category },
  tags: { cardinality: 'many', type: 'tags', model: Tag },
};
