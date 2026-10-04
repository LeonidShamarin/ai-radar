#!/usr/bin/env bash
# Publishes AI Radar on a Semalt workspace (nginx + php-fpm, web root /var/www/html).
# Run from the cloned repo:  bash deploy/semalt/install.sh
# Static files go to the web root as is; the Vercel function is replaced by freeserp.php.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
WEB=/var/www/html
BACKUP="$HOME/projects/web-root-backup-$(date +%Y%m%d-%H%M%S)"

# Keep whatever was in the web root (the stock index.php) instead of deleting it.
mkdir -p "$BACKUP"
cp -a "$WEB"/. "$BACKUP"/ 2>/dev/null || true
rm -f "$WEB/index.php"

cp -a "$REPO/index.html" "$REPO/favicon.svg" "$REPO/og.png" "$WEB"/
rm -rf "$WEB/css" "$WEB/js"
cp -a "$REPO/css" "$REPO/js" "$WEB"/
mkdir -p "$WEB/api/freeserp"
cp "$REPO/deploy/semalt/freeserp.php" "$WEB/api/freeserp/index.php"

echo "Backup of the old web root: $BACKUP"
echo "Done. Open your workspace website and check that the cards load."
