#!/usr/bin/env bash
# =====================================================================================
# Pemasangan Research Lab di VPS Ubuntu 24.04 (Nginx + PHP 8.3-FPM + MySQL 8 + Node).
# Jalankan sebagai root di VPS yang baru:
#
#   DOMAIN=research-lab.contoh.ac.id EMAIL=admin@contoh.ac.id ADMIN_USER=admin bash install.sh
#
# DOMAIN    : nama domain yang sudah diarahkan (A record) ke IP VPS
# EMAIL     : email untuk sertifikat HTTPS Let's Encrypt (kosongkan untuk menunda HTTPS)
# ADMIN_USER: username admin pertama (password ditanyakan saat pemasangan)
# Skrip aman dijalankan ulang; rahasia yang sudah ada tidak ditimpa.
# =====================================================================================
set -euo pipefail
DOMAIN=${DOMAIN:?Isi DOMAIN, mis. DOMAIN=research-lab.contoh.ac.id}
EMAIL=${EMAIL:-}
ADMIN_USER=${ADMIN_USER:-admin}
REPO=${REPO:-https://github.com/adlinababan/research-lab-app.git}
BRANCH=${BRANCH:-ci4-mysql}
APP=/var/www/research-lab
CI=$APP/vps/ci4
say() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }

[ "$(id -u)" = 0 ] || { echo "Jalankan sebagai root (sudo -i)."; exit 1; }

say "1/9 Memasang paket sistem"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q nginx mysql-server git curl unzip openssl composer certbot python3-certbot-nginx \
  php8.3-fpm php8.3-cli php8.3-mysql php8.3-intl php8.3-mbstring php8.3-curl php8.3-xml php8.3-zip
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  say "Memasang Node.js 22 (NodeSource)"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -q nodejs
fi

say "2/9 Mengambil kode aplikasi ($BRANCH)"
id researchlab >/dev/null 2>&1 || useradd --system --home-dir "$APP" --shell /usr/sbin/nologin researchlab
if [ -d "$APP/.git" ]; then
  git -C "$APP" fetch -q origin && git -C "$APP" checkout -q "$BRANCH" && git -C "$APP" pull -q --ff-only
elif [ -f "$APP/vps/ci4/composer.json" ]; then
  echo "Memakai kode yang sudah ada di $APP (dari file ZIP, tanpa git)."
else
  git clone -q --branch "$BRANCH" "$REPO" "$APP"
fi
git config --global --add safe.directory "$APP"

say "3/9 Memasang dependensi PHP (Composer)"
cd "$CI" && COMPOSER_ALLOW_SUPERUSER=1 composer install -q --no-dev --optimize-autoloader --no-interaction

say "4/9 Menyiapkan rahasia dan database"
mkdir -p /etc/research-lab && chmod 750 /etc/research-lab
if [ -f /etc/research-lab/node.env ]; then
  TOKEN=$(grep '^INTERNAL_TOKEN=' /etc/research-lab/node.env | cut -d= -f2-)
else
  TOKEN=$(openssl rand -hex 32)
  sed "s/GANTI_DENGAN_TOKEN_ACAK_64_KARAKTER/$TOKEN/" "$APP/vps/deploy/node.env.example" > /etc/research-lab/node.env
fi
if [ ! -f "$CI/.env" ]; then
  DBPASS=$(openssl rand -hex 18)
  mysql -e "CREATE DATABASE IF NOT EXISTS research_lab CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
            CREATE USER IF NOT EXISTS 'research_lab'@'localhost' IDENTIFIED BY '$DBPASS';
            ALTER USER 'research_lab'@'localhost' IDENTIFIED BY '$DBPASS';
            GRANT ALL PRIVILEGES ON research_lab.* TO 'research_lab'@'localhost'; FLUSH PRIVILEGES;"
  sed -e "s#https://research-lab.example.ac.id/#https://$DOMAIN/#" -e "s/GANTI_PASSWORD_DB/$DBPASS/" \
      -e "s/GANTI_DENGAN_TOKEN_ACAK_64_KARAKTER/$TOKEN/" "$CI/.env.example" > "$CI/.env"
  if [ -z "$EMAIL" ]; then
    # Tanpa HTTPS, cookie "secure" tidak terkirim; sementara dimatikan sampai sertifikat dipasang.
    sed -i -e 's#^app.baseURL = .*#app.baseURL = '"'"'http://'"$DOMAIN"'/'"'"'#' -e 's/^app.forceGlobalSecureRequests = true/app.forceGlobalSecureRequests = false/' -e 's/^cookie.secure = true/cookie.secure = false/' "$CI/.env"
  fi
  printf '[client]\nuser=research_lab\npassword=%s\n' "$DBPASS" > /etc/research-lab/mysql-backup.cnf
  chmod 600 /etc/research-lab/mysql-backup.cnf
  (cd "$CI" && php spark key:generate --force >/dev/null)
fi

say "5/9 Membuat tabel (migrasi)"
cd "$CI" && php spark migrate --no-interaction

say "6/9 Mengatur izin berkas dan PHP-FPM"
chown -R researchlab:researchlab "$APP"
chown -R www-data:www-data "$CI/writable"
chown root:www-data "$CI/.env" && chmod 640 "$CI/.env"
chown root:researchlab /etc/research-lab /etc/research-lab/node.env && chmod 640 /etc/research-lab/node.env
INI=/etc/php/8.3/fpm/php.ini
sed -i -e 's/^max_execution_time = .*/max_execution_time = 300/' -e 's/^post_max_size = .*/post_max_size = 32M/' \
       -e 's/^upload_max_filesize = .*/upload_max_filesize = 32M/' -e 's/^memory_limit = .*/memory_limit = 256M/' "$INI"
grep -q '^request_terminate_timeout' /etc/php/8.3/fpm/pool.d/www.conf || echo 'request_terminate_timeout = 310' >> /etc/php/8.3/fpm/pool.d/www.conf
systemctl restart php8.3-fpm

say "7/9 Menjalankan layanan Node internal"
cp "$APP/vps/deploy/research-lab-node.service" /etc/systemd/system/
systemctl daemon-reload && systemctl enable -q --now research-lab-node && systemctl restart research-lab-node

say "8/9 Mengatur Nginx dan HTTPS"
sed "s/DOMAIN_ANDA/$DOMAIN/" "$APP/vps/deploy/nginx-research-lab.conf" > /etc/nginx/sites-available/research-lab
ln -sf /etc/nginx/sites-available/research-lab /etc/nginx/sites-enabled/research-lab
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
if command -v ufw >/dev/null && ufw status | grep -q active; then ufw allow 'Nginx Full' >/dev/null; ufw allow OpenSSH >/dev/null; fi
if [ -n "$EMAIL" ]; then
  certbot --nginx -d "$DOMAIN" -m "$EMAIL" --agree-tos --redirect -n || echo "HTTPS gagal dipasang. Pastikan domain sudah mengarah ke VPS, lalu jalankan: certbot --nginx -d $DOMAIN"
fi
install -m 755 "$APP/vps/deploy/backup.sh" /etc/cron.daily/research-lab-backup

say "9/9 Akun admin dan pemeriksaan"
cd "$CI" && sudo -u www-data php spark rl:admin "$ADMIN_USER"
sleep 2
sudo -u www-data php spark rl:check || true

printf '\n\033[1;32mSelesai.\033[0m Buka %s dan masuk dengan akun %s.\nPanel admin: %s/admin\n' \
  "$( [ -n "$EMAIL" ] && echo "https://$DOMAIN" || echo "http://$DOMAIN" )" "$ADMIN_USER" "$( [ -n "$EMAIL" ] && echo "https://$DOMAIN" || echo "http://$DOMAIN" )"
