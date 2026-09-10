import { IsIn, IsInt, IsOptional, IsString, Length, Max, Min, ValidateIf } from 'class-validator';
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
 * - nullable 컬럼(`description`)은 `@IsOptional()`. `null`은 "비운다"는 뜻이다.
 * - NOT NULL 컬럼(`title`·`status`·`score`)은 `@ValidateIf(isPresent)`. 보내지 않은 것만
 *   건너뛰고 `null`은 검증기에 그대로 넘겨 422로 거절한다.
 *
 * 이 스키마를 복사해 새 자원을 만든다면 필드마다 이 대응부터 맞춘다.
 */

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
  description?: string | null;

  // 정본이 생성에서 `status`를 필수로 받는다. 컬럼에 DB 기본값이 있지만 그것에
  // 도달하는 경로를 열면 `status`를 생략한 같은 요청이 정본에서는 422, 여기서는
  // 201이 되어 wire가 갈라진다.
  @IsIn(EXAMPLE_STATUSES)
  status!: ExampleStatus;

  // 범위 검증을 스키마에도 건다. DB의 CHECK 제약만 있으면 위반이 500으로 나간다.
  @IsInt()
  @Min(0)
  @Max(100)
  score!: number;
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
  description?: string | null;

  @ValidateIf(isPresent)
  @IsIn(EXAMPLE_STATUSES)
  status?: ExampleStatus;

  // `score`도 NOT NULL이므로 `@IsOptional()`이 아니라 `@ValidateIf(isPresent)`다.
  // `{"score": null}`은 사용자가 명시적으로 보낸 값이고 422로 거절해야 한다.
  @ValidateIf(isPresent)
  @IsInt()
  @Min(0)
  @Max(100)
  score?: number;
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
  description?: string | null;

  @IsIn(EXAMPLE_STATUSES)
  status!: ExampleStatus;

  @IsInt()
  @Min(0)
  @Max(100)
  score!: number;
}

/**
 * 쓰기로 여는 관계.
 *
 * 여기 없는 관계는 읽기 전용이 된다 — 시리얼라이저가 선언한 관계라면 `GET` 두 개는
 * 그대로 열리고 `PATCH`/`POST`/`DELETE`만 생기지 않는다(`route-registrar.ts` 참고).
 */
export const EXAMPLE_RELATIONSHIPS: RelationshipWriteSchema = {
  category: { cardinality: 'one', type: 'exampleCategories', model: Category },
  tags: { cardinality: 'many', type: 'exampleTags', model: Tag },
};
