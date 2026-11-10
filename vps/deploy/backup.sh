#!/usr/bin/env bash
# Cadangan harian database Research Lab. Dipasang otomatis oleh install.sh di /etc/cron.daily.
set -euo pipefail
DIR=/var/backups/research-lab
mkdir -p "$DIR"; chmod 700 "$DIR"
STAMP=$(date +%Y%m%d-%H%M)
mysqldump --defaults-extra-file=/etc/research-lab/mysql-backup.cnf --single-transaction --routines research_lab | gzip > "$DIR/research_lab-$STAMP.sql.gz"
find "$DIR" -name 'research_lab-*.sql.gz' -mtime +14 -delete
