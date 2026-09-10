#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
api_root="$(cd "$script_dir/.." && pwd)"
compose_file="$api_root/docker-compose.test.yml"
test_project_name="template-typescript-nestjs-test-$$-$RANDOM"
compose_args=(-f "$compose_file" -p "$test_project_name")
# db든 redis든 하나라도 컴포즈로 띄웠으면 정리해야 한다. `down -v`는 프로젝트 전체를
# 내리는 명령이라(서비스별로 나뉘지 않는다) 서비스마다 플래그를 따로 둘 이유가 없다 —
# "무엇이든 하나라도 띄웠는가"만 알면 충분하다. 그래서 이름도 db 전용이 아니라 두
# 서비스를 함께 가리키도록 `started_test_services`로 둔다.
started_test_services=false

cleanup() {
  if [[ "$started_test_services" == true ]]; then
    docker compose "${compose_args[@]}" down -v
  fi
}

trap cleanup EXIT
cd "$api_root"

if [[ -z "${TEST_DATABASE_URL:-}" ]]; then
  started_test_services=true
  TEST_DB_PORT=0 docker compose "${compose_args[@]}" up -d --wait db
  test_database_endpoint="$(docker compose "${compose_args[@]}" port db 5432)"
  test_database_port="${test_database_endpoint##*:}"
  export TEST_DATABASE_URL="postgres://nestjs:nestjs@127.0.0.1:${test_database_port}/nestjs_template_test"
fi

# db와 독립적으로 판단한다 — TEST_DATABASE_URL만 주어져도, TEST_REDIS_URL만 주어져도
# 각각 올바르게 동작해야 한다(둘을 한 조건으로 묶으면 한쪽만 준 경우 나머지 하나가
# 빠지거나 불필요하게 뜬다).
if [[ -z "${TEST_REDIS_URL:-}" ]]; then
  started_test_services=true
  TEST_REDIS_PORT=0 docker compose "${compose_args[@]}" up -d --wait redis
  test_redis_endpoint="$(docker compose "${compose_args[@]}" port redis 6379)"
  test_redis_port="${test_redis_endpoint##*:}"
  export TEST_REDIS_URL="redis://127.0.0.1:${test_redis_port}"
fi

pnpm exec eslint .
pnpm exec prettier --check .
pnpm exec tsc --noEmit -p tsconfig.json
pnpm run test
pnpm exec secretlint --secretlintignore .gitignore "**/*"
