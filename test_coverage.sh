#!/usr/bin/env bash
# Local-only coverage (docs/local-verification.md: tests and coverage never run in Actions).
# Builds the SDK from ../chat.handle.me like `npm test`, then measures the built package
# (lib/src/**/*.js, the code consumers load) with c8 over the SDK test suite.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT_DIR"

REPORT_FILE="$ROOT_DIR/test_coverage.report"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

THRESHOLD_LINES=90
THRESHOLD_BRANCHES=90

npm run build > "$TMP_DIR/build.out" 2>&1 || { cat "$TMP_DIR/build.out" >&2; exit 1; }

npx --yes c8@10 \
  --all \
  --src lib/src \
  --include='lib/src/**/*.js' \
  --reporter=text \
  --reporter=json-summary \
  --report-dir "$TMP_DIR/cov" \
  node --test "test/**/*.test.mjs" > "$TMP_DIR/c8.out" 2>&1 \
  || { cat "$TMP_DIR/c8.out" >&2; echo "SDK tests failed; no coverage written." >&2; exit 1; }

read -r line_pct branch_pct < <(node -e '
const t = require(process.argv[1]).total;
console.log(t.lines.pct.toFixed(2), t.branches.pct.toFixed(2));' "$TMP_DIR/cov/coverage-summary.json")

STATUS="pass"
if awk -v l="$line_pct" -v b="$branch_pct" -v tl="$THRESHOLD_LINES" -v tb="$THRESHOLD_BRANCHES" 'BEGIN { exit !((l + 0 < tl) || (b + 0 < tb)) }'; then
  STATUS="fail"
fi

{
  echo "FORMAT_VERSION=1"
  echo "REPO=handle-chat-sdk"
  echo "TIMESTAMP_UTC=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "THRESHOLD_LINES=$THRESHOLD_LINES"
  echo "THRESHOLD_BRANCHES=$THRESHOLD_BRANCHES"
  echo "TOTAL_LINES_PCT=$line_pct"
  echo "TOTAL_BRANCHES_PCT=$branch_pct"
  echo "STATUS=$STATUS"
  echo "SOURCE_PATHS=lib/src/**/*.js (built from sdk/ + chat.handle.me src/chat, src/signal)"
  echo "EXCLUDED_PATHS=lib/libsignal-wasm/**:wasm-bindgen-glue-for-the-rust-crate; test/**,examples/**:tests-and-examples"
  echo "LANGUAGE_SUMMARY=nodejs:lines=$line_pct,branches=$branch_pct,tool=c8,status=$STATUS"
  echo
  echo "=== RAW_OUTPUT_BUILD ==="
  tail -1 "$TMP_DIR/build.out"
  echo
  echo "=== RAW_OUTPUT_C8_TESTS ==="
  cat "$TMP_DIR/c8.out"
} > "$REPORT_FILE"

if [[ "$STATUS" != "pass" ]]; then
  echo "Coverage threshold not met (line=${line_pct}%, branch=${branch_pct}%)." >&2
  exit 1
fi
echo "Coverage threshold met (line=${line_pct}%, branch=${branch_pct}%)."
