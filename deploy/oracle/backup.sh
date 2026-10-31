#!/usr/bin/env bash
# Daily dump of the database, 14 days kept (cron: see cloud-init.yaml). Copy the folder off the VM
# now and then (scp, or the free Object Storage bucket): a backup on the same disk dies with it.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p backups
docker compose exec -T db pg_dump -U knightfall --format=custom knightfall > "backups/knightfall-$(date +%F).dump"
find backups -name 'knightfall-*.dump' -mtime +14 -delete
echo "$(date -Is) ok $(ls -1 backups | wc -l) backups"
