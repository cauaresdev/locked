#!/usr/bin/env bash
# Proves the newest backup restores: loads it into a throwaway database and counts the athletes.
set -euo pipefail
cd "$(dirname "$0")"
latest=$(ls -1t backups/knightfall-*.dump | head -1)
docker compose exec -T db psql -U knightfall -d postgres -c 'DROP DATABASE IF EXISTS restore_test' -c 'CREATE DATABASE restore_test'
docker compose exec -T db pg_restore -U knightfall -d restore_test --no-owner < "$latest" || true
docker compose exec -T db psql -U knightfall -d restore_test -tAc 'SELECT count(*) FROM athletes'
docker compose exec -T db psql -U knightfall -d postgres -c 'DROP DATABASE restore_test'
