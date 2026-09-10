<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-11 | Updated: 2026-09-11 -->

# src/app/serializers 안내

## 목적

엔티티와 발급 응답 객체의 JSON:API 공개 표현을 선언합니다. 응답 필드·관계 링크·
linkage·included를 소유하며 입력 검증이나 SQL 필터 해석은 하지 않습니다.

## 주요 파일

| 파일                        | 설명                                                                             |
| --------------------------- | -------------------------------------------------------------------------------- |
| `serializer.ts`             | 시리얼라이저 인터페이스, 명시적 필드 직렬화와 `(type, id)`별 included 중복 제거. |
| `example.serializer.ts`     | Example의 공개 attributes와 category·tags 관계·eager-load 선언.                  |
| `category.serializer.ts`    | `exampleCategories` 타입, categories 경로와 `name` 공개 표현.                    |
| `tag.serializer.ts`         | `exampleTags` 타입, tags 경로와 `name` 공개 표현.                                |
| `user.serializer.ts`        | 비밀번호 해시를 제외한 사용자 표현과 ID 기반 self 링크 생략.                     |
| `auth-tokens.serializer.ts` | access·refresh 토큰과 각 수명을 초 단위로 반환하는 발급 응답.                    |
| `index.ts`                  | 공개 export와 테스트가 구성을 고정하는 `SERIALIZERS` 목록.                       |

## AI 에이전트 지침

- attributes에 명시한 값만 공개합니다. 내부 FK와 `passwordHash`를 추가하지 않습니다.
- 관계의 `undefined`는 미로드, `null`은 대상 없음입니다. 미로드를 빈 관계로 바꾸지
  않습니다. `eagerLoad` 경로·cardinality·`target()`은 모델과 쓰기 스키마에 맞춥니다.
- 분류·라벨 attributes는 `name`만 내보냅니다. `createdAt`이 정렬 가능하다는 사실은
  공개 attributes에 포함되어야 한다는 뜻이 아닙니다.
- `expiresIn`과 `refreshExpiresIn`은 초 단위 수명입니다. 발급 컨트롤러가 전달하는
  설정값을 그대로 직렬화하며 ISO 만료 시각으로 바꾸지 않습니다.
- `resourcePath`와 `SERIALIZERS`의 역할은 아래 수동 계약을 따릅니다. 관계 대상 선택은
  목록 탐색이 아니라 `target()` 참조로 결정됩니다.

## 테스트

저장소 루트에서 `pnpm typecheck`와 `pnpm test:quick --runInBand test/serializers`를
실행합니다. 공개 응답 변경은 PostgreSQL과 `TEST_DATABASE_URL`을 준비한 뒤 관련 자원의
`test/integration/examples-api.spec.ts`, `reference-resources.spec.ts`, `auth-api.spec.ts`,
`users-me.spec.ts`도 검사합니다.

## 의존성

`../models/`의 엔티티와 `../jsonapi/document.ts`의 자원 식별자 타입을 사용합니다.
조회 정책·쿼리 컴파일러와 컨트롤러 concern이 이 선언을 소비합니다.

<!-- MANUAL: 기존 main의 공개 표현 계약을 보존합니다. 이 줄 아래는 자동 재생성하지 않습니다. -->

# src/app/serializers/ — 공개 표현

이 디렉터리는 "엔티티의 어떤 부분을 밖으로 보여주는가"만 소유한다. 요청 값을
검증하지 않고(`src/app/schemas/`의 일), SQL filter를 해석하지 않는다
(`src/app/jsonapi/`의 일) — 시리얼라이저가 아는 것은 엔티티 인스턴스 하나와
그것을 JSON:API 자원 객체로 바꾸는 규칙뿐이다.

## attributes에 열거된 것만 나간다 — 이것이 안전장치다

`ResourceSerializer.attributes`는 이름 → 읽기 함수의 명시적 맵이다
(`src/app/serializers/serializer.ts`). 엔티티에 컬럼을 추가해도 이 맵에
올리지 않으면 응답에 나가지 않는다 — 화이트리스트이지 블랙리스트가 아니다.
`src/app/serializers/user.serializer.ts`가 이 규칙이 왜 존재하는지 그 자체로
보여준다. `User` 엔티티는 `passwordHash` 컬럼을 갖지만
(`src/app/models/user.entity.ts`), 시리얼라이저의 `attributes`에 그 이름을
올리지 않는 한 새어 나갈 길이 없다. 새 컬럼을 추가하는 사람이 "attributes에
올리는 것을 잊는" 실수는 안전한 방향(응답에서 빠짐)으로만 실패한다 — 반대
방향(깜빡 올려서 새는 것)은 리뷰가 봐야 한다.

## `resourcePath`가 선택인 이유

`resourcePath`는 `self` 링크와 관계 링크(`links.self`·`links.related`)의
기준 경로다. 스펙 16장의 공개 API 표면에 자신을 다시 가리키는 라우트가 없는
자원 — `AuthTokens`(발급 응답 전용이라 다시 가리킬 라우트가 없다)와
`User`(`GET /api/v1/users/{id}`가 없다) — 은 가리킬 URL이 애초에 없다.
`resourcePath`를 억지로 채우면 존재하지 않는 라우트를 가리키는 링크를 응답에
실어 보내게 되고, 그 링크를 따라간 클라이언트는 404를 받는다. 그래서
`src/app/serializers/auth-tokens.serializer.ts`와
`src/app/serializers/user.serializer.ts`는 이 필드를 아예 생략한다 —
`serializeResource`(`src/app/serializers/serializer.ts`)는 `resourcePath`가
없으면 `links` 자체를 응답에서 뺀다. 새 자원이 전용 라우트 없이 `include`
대상으로만 시작한다면, `resourcePath`를 빈 문자열이나 추측값으로 채우지
않는다.

`Category`·`Tag`는 한때 이 규칙의 예시였다 — `Example`의 `include`로만
노출되고 전용 라우트가 없었을 때는. 참조 자원 라우트(`GET
/api/v1/categories`·`GET /api/v1/tags`)가 생기면서 그 둘은 규칙의 반대편으로
옮겨 갔다 — 라우트가 생긴 바로 그 변경에서 `resourcePath`도 함께 선언됐다.
"라우트가 생기면 `resourcePath`도 같은 변경에서 생긴다"가 이 규칙의 대우다.

## `SERIALIZERS` 배열은 "저장소가 아는 시리얼라이저 전부"가 아니다

`src/app/serializers/index.ts`의 `SERIALIZERS`는 관계 대상이 되거나
`included`에 실릴 수 있는, `ErasedSerializer`를 구현한 시리얼라이저만 담는다 —
타입 자체가 `readonly ErasedSerializer[]`라서 그 인터페이스를 만족하지 않는
것은 애초에 들어갈 수 없다. `USER_SERIALIZER`나 `AUTH_TOKENS_SERIALIZER`처럼
관계 대상이 아니고 `serializeUnknown`을 구현하지 않는 시리얼라이저는 이 배열
밖에 있어도 정상이다 — 이 배열에 없다는 것이 "이 저장소가 이런 시리얼라이저를
모른다"는 뜻이 아니다. 이 배열을 설명하는 주석에 "이 저장소가 아는
시리얼라이저의 유일한 목록"처럼 전칭 표현을 쓰지 않는다 — 실제로 그렇게
적혀 있다가 관계 대상이 아닌 새 시리얼라이저 둘이 추가되면서 사실보다 넓게
말하게 된 적이 있다.

이 배열 자체는 관계 해석 코드가 참조하지 않는다는 것도 함께 알아 둔다 —
어떤 시리얼라이저가 관계 대상이 되는가는 `collectIncluded`가 이 배열을 보고
정하는 것이 아니라, 소유 시리얼라이저의 `relationships.<name>.target()`
클로저가 무엇을 가리키는가로 정해진다(`src/app/serializers/example.serializer.ts`가
`ERASED_CATEGORY_SERIALIZER`를 직접 참조하는 것이 그 예다). `SERIALIZERS`는
그 구성이 조용히 흔들리지 않도록
`test/serializers/example.serializer.spec.ts`의 "SERIALIZERS 등록" 테스트가
고정하는 목록일 뿐이다 — 여기 추가하는 것을 잊어도 관계 해석이나 `included`
조립 자체는 깨지지 않는다.

## 함께 고쳐야 하는 파일

- **새 자원의 시리얼라이저를 추가할 때.** export 위치와 `SERIALIZERS` 등록
  여부를 가르는 기준(관계 대상인가, `include`로 노출되는가)은 루트
  `AGENTS.md`의 "조립점과 변경 순서" 4번이 정한다. 이 디렉터리에서 실수가
  나는 지점은 등록 그 자체가 아니라 무엇을 등록해야 하는가의 판단이다 —
  `test/serializers/example.serializer.spec.ts`의 "SERIALIZERS 등록" 테스트가
  배열의 정확한 구성을 고정하므로, 관계 대상이 아닌 시리얼라이저를 잘못
  추가하거나 관계 대상인 시리얼라이저를 빠뜨리면 여기서 드러난다.
- **`resourcePath`를 정하거나 바꿀 때.** 그 값이 컨트롤러 경로와 글자까지
  같아야 한다는 규칙은 루트 `AGENTS.md`의 "조립점과 변경 순서" 4번이 정한다.
  `src/app/controllers/concerns/crud-actions.ts`의 `CrudActions`가 이 둘의
  불일치를 조립 시점에 잡아 주지만, 애초에 두 값을 한 커밋에서 함께 정하는
  편이 그 오류를 마주치는 것보다 낫다.
- **attributes에 필드를 추가할 때.** 그 필드가 엔티티의 민감한 컬럼(비밀번호
  해시, 내부 FK 등)을 그대로 옮기는 것은 아닌지 확인한다 — 이 계층에는
  "실수로 값을 계산했지만 응답에는 안 나감" 같은 중간 상태가 없다. attributes
  맵에 올리는 순간 그 값은 공개된다.
