#!/bin/sh
# Backs up the SQLite database and all uploaded photos into backups/ (NFR-4).
set -eu
cd "$(dirname "$0")/.."
DATA_DIR="${DATA_DIR:-./data}"
mkdir -p backups
STAMP=$(date +%Y-%m-%d_%H%M%S)
tar -czf "backups/hbm-backup-$STAMP.tar.gz" -C "$DATA_DIR" .
echo "Backup written to backups/hbm-backup-$STAMP.tar.gz"
