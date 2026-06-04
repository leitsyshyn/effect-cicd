#!/usr/bin/env bash
DIR="$(cd "$(dirname "$(readlink "$0" || echo "$0")")/.." && pwd)"
exec bun run "$DIR/index.local.ts" -- "$@"
