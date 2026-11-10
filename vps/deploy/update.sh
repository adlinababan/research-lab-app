#!/usr/bin/env bash
# Memperbarui Research Lab ke versi terbaru di branch yang sama. Jalankan sebagai root.
set -euo pipefail
APP=/var/www/research-lab; CI=$APP/vps/ci4
/etc/cron.daily/research-lab-backup && echo "Cadangan database dibuat sebelum pembaruan."
git -C "$APP" pull --ff-only
cd "$CI" && COMPOSER_ALLOW_SUPERUSER=1 composer install -q --no-dev --optimize-autoloader --no-interaction
php spark migrate --no-interaction
chown -R researchlab:researchlab "$APP"; chown -R www-data:www-data "$CI/writable"; chown root:www-data "$CI/.env"
systemctl restart research-lab-node php8.3-fpm
sudo -u www-data php spark rl:check
