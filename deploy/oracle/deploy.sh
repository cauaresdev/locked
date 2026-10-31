#!/usr/bin/env bash
# Ships the code to the VM and (re)starts the stack. Run from the repo root on your machine:
#   deploy/oracle/deploy.sh ubuntu@<vm-ip> knightfall-bruce.duckdns.org
# The repository is private, so the VM never clones it: this copies backend/ and deploy/ over SSH.
# On the first run it writes .env on the VM with a database password generated there (never in Git).
set -euo pipefail
host=${1:?usage: deploy/oracle/deploy.sh user@host public-hostname}
name=${2:?usage: deploy/oracle/deploy.sh user@host public-hostname}
cd "$(dirname "$0")/../.."
rsync -az --delete --exclude '.venv' --exclude '__pycache__' --exclude '*.db' --exclude 'knightfall.egg-info' \
  --exclude '.env' --exclude 'backups' backend deploy "$host:/opt/knightfall/"
ssh "$host" "cd /opt/knightfall/deploy/oracle \
  && { test -f .env || printf 'POSTGRES_PASSWORD=%s\nKNIGHTFALL_HOST=%s\nSENTRY_DSN=\n' \"\$(openssl rand -hex 24)\" '$name' > .env; } \
  && chmod 600 .env && chmod +x backup.sh restore-test.sh \
  && docker compose up -d --build && docker compose ps"
