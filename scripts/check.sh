#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
api_root="$(cd "$script_dir/.." && pwd)"
compose_file="$api_root/docker-compose.test.yml"
test_project_name="template-typescript-nestjs-test-$$-$RANDOM"
compose_args=(-f "$compose_file" -p "$test_project_name")
started_test_database=false

cleanup() {
  if [[ "$started_test_database" == true ]]; then
    docker compose "${compose_args[@]}" down -v
  fi
}

trap cleanup EXIT
cd "$api_root"

if [[ -z "${TEST_DATABASE_URL:-}" ]]; then
  started_test_database=true
  TEST_DB_PORT=0 docker compose "${compose_args[@]}" up -d --wait db
  test_database_endpoint="$(docker compose "${compose_args[@]}" port db 5432)"
  test_database_port="${test_database_endpoint##*:}"
  export TEST_DATABASE_URL="postgres://nestjs:nestjs@127.0.0.1:${test_database_port}/nestjs_template_test"
fi

pnpm exec eslint .
pnpm exec prettier --check .
pnpm exec tsc --noEmit -p tsconfig.json
pnpm run test
pnpm exec secretlint --secretlintignore .gitignore "**/*"
