import { Transform } from 'class-transformer';
import { IsDate, IsIn, IsOptional, IsString, Length } from 'class-validator';
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
 */

/** ISO 8601 문자열을 `Date`로 바꾼다. 저장 계층이 받는 형식이다. */
function toDate({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? new Date(value) : value;
}

/** `POST /api/v1/examples`의 본문 attributes. */
export class ExampleCreate {
  @IsString()
  @Length(1, 200)
  title!: string;

  @IsOptional()
  @IsString()
  body?: string | null;

  @IsOptional()
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
  @IsOptional()
  @IsString()
  @Length(1, 200)
  title?: string;

  @IsOptional()
  @IsString()
  body?: string | null;

  @IsOptional()
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

  @IsOptional()
  @IsIn(EXAMPLE_STATUSES)
  status?: ExampleStatus;

  @IsOptional()
  @Transform(toDate)
  @IsDate()
  publishedAt?: Date | null;
}

/** 쓰기로 여는 관계. 여기 없는 관계는 읽기 전용이 된다. */
export const EXAMPLE_RELATIONSHIPS: RelationshipWriteSchema = {
  category: { cardinality: 'one', type: 'categories', model: Category },
  tags: { cardinality: 'many', type: 'tags', model: Tag },
};
