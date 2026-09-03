# src/app/ — 모델·스키마·시리얼라이저·컨트롤러

계층별로 무엇을 소유하고 무엇을 소유하지 않는지의 표는 루트 `AGENTS.md`의
"아키텍처" 절에 있다. 이 문서는 그 표를 반복하지 않고, 표만으로는 보이지 않는
두 규칙 — 필드 하나의 표기가 요청의 성패를 가르는 규칙과, 같은 컬럼을 입출력
양쪽에서 두 갈래로 열지 않는 규칙 — 을 적는다.

## 선택 필드 표기는 컬럼의 nullable 여부를 따라간다

`class-validator`의 `@IsOptional()`은 `undefined`뿐 아니라 **`null`에도**
뒤따르는 모든 검증기를 건너뛴다. NOT NULL 컬럼에 이 데코레이터를 달면
`{"title": null}`이 검증을 그대로 통과해 PostgreSQL까지 내려가고, 사용자 입력
오류로 응답해야 할 422가 제약 위반 500으로 나간다 — 이 저장소가 실제로 이
버그를 만들었다가 고쳤다.

`src/app/schemas/example.schemas.ts`가 지금 쓰는 대응 관계가 정본이다.

- 컬럼이 nullable이면(`body`, `publishedAt`) `@IsOptional()`을 쓴다 — `null`이
  "비운다"는 유효한 의미를 갖는다.
- 컬럼이 NOT NULL이면(`title`, `status`) `@ValidateIf`로 "아예 보내지 않았다"만
  건너뛰고, 명시적으로 보낸 `null`은 검증기에 그대로 넘겨 422로 거절한다.

새 쓰기 스키마를 만들 때는 필드마다 "엔티티(`src/app/models/`)에서 이 컬럼이
nullable인가"부터 확인하고 표기를 고른다 — 취향이 아니라 컬럼 정의에서
기계적으로 정해지는 값이다.

## 내부 FK는 공개 입력도 공개 출력도 아니다

`categoryId`처럼 관계를 구현하는 FK 컬럼은 어떤 쓰기 스키마(`src/app/schemas/`)의
필드도, 어떤 시리얼라이저(`src/app/serializers/`)의 attribute도 아니다. 관계는
오직 JSON:API의 `relationships`로만 읽고 쓴다. 이유는 입출력 양쪽에서 같다 —
FK를 필드로 열면 같은 관계를 바꾸는 길이 두 개가 되고(attribute 직접 쓰기 vs.
relationships linkage), 두 경로의 검증 규칙과 오류 코드가 갈라진다.
`src/app/schemas/example.schemas.ts`와 `src/app/serializers/example.serializer.ts`가
이 규칙을 입력과 출력 양쪽에서 각자 독립적으로 적는다 — 관계를 새로 추가할
때는 두 파일 모두에서 FK 컬럼이 아니라 관계 이름으로만 다뤄지는지 확인한다.

## 함께 고쳐야 하는 파일

새 자원을 추가할 때 어떤 파일을 어떤 순서로 만드는지는 루트 `AGENTS.md`의
"조립점과 변경 순서"가 여섯 단계로 정한다. 여기서는 그 순서 밖에서, 같은
계층을 손볼 때 놓치기 쉬운 짝만 적는다.

- **엔티티 컬럼의 nullable을 바꿀 때.** `src/app/models/`의 컬럼 정의와, 그
  컬럼을 다루는 모든 쓰기 스키마의 `@IsOptional()`/`@ValidateIf` 선택을 같은
  커밋에서 맞춘다. 하나만 바꾸면 위 규칙이 깨지는데, 그 실패는 "유효한
  요청"도 "명백히 무효한 요청"도 아닌 값(명시적 `null`)에서만 드러나 테스트가
  우연히 놓치기 쉽다.
- **관계를 추가하거나 cardinality를 바꿀 때.** 엔티티의 관계 데코레이터
  (`src/app/models/`), 쓰기 스키마의 `RelationshipWriteSchema` 항목
  (`src/app/schemas/write-schema.ts`), 시리얼라이저의 `relationships` 선언
  (`src/app/serializers/`) 세 곳이 같은 cardinality와 같은 대상 타입을
  가리켜야 한다. 스키마와 시리얼라이저 사이의 cardinality 불일치는
  `src/app/controllers/concerns/crud-actions.ts`의 `CrudActions`가 조립
  시점에 `TypeError`로 잡아 주지만, 그 검사는 어긋났다는 사실만 알려줄 뿐 세
  곳 중 무엇이 맞는 값인지는 알려주지 않는다.
- **쓰기 스키마의 길이·형식 제약을 바꿀 때.** 스키마 쪽 제약은 엔티티 컬럼의
  실제 제약(`varchar(200)` 등)보다 항상 같거나 더 엄격해야 한다 — 스키마가
  더 느슨하면 DB가 거절해 400이어야 할 요청이 500으로 나간다.
