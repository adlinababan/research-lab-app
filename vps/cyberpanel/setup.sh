#!/usr/bin/env bash
# =====================================================================================
# Pemasangan Research Lab di server CyberPanel (OpenLiteSpeed + lsphp 8.3 + MariaDB).
# Website dan database dibuat lebih dulu dari panel CyberPanel; skrip ini memakai keduanya.
#
#   DOMAIN=research-lab.my.id bash setup.sh
#
# Yang dilakukan (aman dijalankan ulang; .env dan token yang sudah ada tidak ditimpa):
#  1. mencari kode aplikasi (hasil ekstrak ZIP) dan memindahkannya ke luar public_html: /home/DOMAIN/app
#  2. memeriksa ekstensi lsphp83 dan menjalankan Composer
#  3. menanyakan nama, pengguna, dan password database (tidak tampil di layar), lalu membuat .env
#  4. menjalankan migrasi (tidak membuat ulang tabel bila research_lab.sql sudah diimpor)
#  5. menyalin tampilan web ke public_html dan meneruskan /api dan /admin ke CodeIgniter
#  6. memasang Node.js dan layanan AI internal (systemd, hanya 127.0.0.1)
#  7. membuat akun admin dan menjalankan pemeriksaan
# =====================================================================================
set -euo pipefail
DOMAIN=${DOMAIN:?Isi DOMAIN, mis. DOMAIN=research-lab.my.id}
SITE=${SITE:-/home/$DOMAIN}
DOCROOT=${DOCROOT:-$SITE/public_html}
APP=${APP:-$SITE/app}
CI=$APP/vps/ci4
PHPBIN=${PHPBIN:-/usr/local/lsws/lsphp83/bin/php}
REPO=${REPO:-https://github.com/adlinababan/research-lab-app.git}
BRANCH=${BRANCH:-ci4-mysql}
ADMIN_USER=${ADMIN_USER:-admin}
STAMP=$(date +%Y%m%d-%H%M%S)
say() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31mBERHENTI: %s\033[0m\n' "$*"; exit 1; }

[ "$(id -u)" = 0 ] || die "Jalankan sebagai root (sudo -i)."
[ -d "$DOCROOT" ] || die "$DOCROOT tidak ada. Buat dulu website $DOMAIN di CyberPanel (Websites › Create Website, PHP 8.3)."
[ -x "$PHPBIN" ] || die "$PHPBIN tidak ada. Pilih PHP 8.3 untuk website ini di CyberPanel, atau isi PHPBIN=/usr/local/lsws/lsphpXX/bin/php (minimal 8.2)."
OWNER=$(stat -c %U "$DOCROOT"); GROUP=$(stat -c %G "$DOCROOT")
echo "Website: $DOMAIN · pemilik berkas: $OWNER · PHP: $($PHPBIN -r 'echo PHP_VERSION;')"

# -------------------------------------------------------------------------------------
say "1/7 Mencari kode aplikasi"
mkdir -p "$SITE/arsip"
if [ ! -f "$CI/composer.json" ]; then
  FOUND=""
  for d in "$DOCROOT/research-lab-app" "$SITE/research-lab-app" "$DOCROOT"; do
    [ -f "$d/vps/ci4/composer.json" ] && { FOUND=$d; break; }
  done
  if [ -z "$FOUND" ]; then
    ZIP=$(ls -t "$DOCROOT"/*.zip "$SITE"/*.zip /root/*.zip 2>/dev/null | head -1 || true)
    if [ -n "$ZIP" ] && unzip -l "$ZIP" 2>/dev/null | grep -q 'vps/ci4/composer.json'; then
      echo "Mengekstrak $ZIP"
      TMPX=$(mktemp -d); unzip -q "$ZIP" -d "$TMPX"
      FOUND=$(dirname "$(dirname "$(dirname "$(find "$TMPX" -path '*/vps/ci4/composer.json' | head -1)")")")
    fi
  fi
  if [ -n "$FOUND" ]; then
    if [ "$FOUND" = "$DOCROOT" ]; then
      # Kode diekstrak langsung ke public_html: pindahkan isinya ke APP
      mkdir -p "$APP"; shopt -s dotglob
      for f in "$DOCROOT"/*; do case "$(basename "$f")" in .well-known|cgi-bin) ;; *) mv "$f" "$APP/";; esac; done
      shopt -u dotglob
    else
      if [ -e "$APP" ]; then mv "$APP" "$SITE/arsip/app-lama-$STAMP"; fi
      mv "$FOUND" "$APP"
    fi
    echo "Kode dipindahkan ke $APP (di luar public_html)."
  else
    echo "Kode tidak ditemukan; mengambil dari GitHub ($BRANCH)."
    command -v git >/dev/null || apt-get install -y -q git
    git clone -q --branch "$BRANCH" "$REPO" "$APP"
  fi
fi
[ -f "$CI/composer.json" ] || die "Kode aplikasi tidak lengkap di $APP."
# Berkas ZIP/SQL yang terlanjur diunggah ke public_html dipindahkan agar tidak bisa diunduh orang lain.
for f in "$DOCROOT"/*.zip "$DOCROOT"/*.sql; do
  if [ -e "$f" ]; then mv "$f" "$SITE/arsip/"; echo "Dipindahkan ke $SITE/arsip: $(basename "$f")"; fi
done
if [ -d "$DOCROOT/research-lab-app" ]; then mv "$DOCROOT/research-lab-app" "$SITE/arsip/research-lab-app-$STAMP"; fi

# -------------------------------------------------------------------------------------
say "2/7 Ekstensi PHP dan Composer"
need=()
for e in intl mbstring curl mysqli json; do $PHPBIN -m | grep -qix "$e" || need+=("$e"); done
if [ ${#need[@]} -gt 0 ]; then
  echo "Memasang ekstensi lsphp83: ${need[*]}"
  apt-get update -q || true
  apt-get install -y -q lsphp83-intl lsphp83-curl lsphp83-mysql lsphp83-common || true
  for e in "${need[@]}"; do $PHPBIN -m | grep -qix "$e" || die "Ekstensi PHP $e belum ada. Pasang lewat CyberPanel › PHP › Install Extensions (lsphp83), lalu jalankan ulang."; done
fi
COMPOSER=$(command -v composer || true)
if [ -z "$COMPOSER" ]; then
  echo "Memasang Composer"
  $PHPBIN -r "copy('https://getcomposer.org/installer', '/tmp/composer-setup.php');"
  $PHPBIN /tmp/composer-setup.php --quiet --install-dir=/usr/local/bin --filename=composer && rm -f /tmp/composer-setup.php
  COMPOSER=/usr/local/bin/composer
fi
(cd "$CI" && COMPOSER_ALLOW_SUPERUSER=1 $PHPBIN "$COMPOSER" install -q --no-dev --optimize-autoloader --no-interaction)

# -------------------------------------------------------------------------------------
say "3/7 Database dan rahasia"
# Akses root MariaDB: soket unix, atau password root yang disimpan CyberPanel
sqlq() { printf '%s' "$1" | sed -e "s/\\\\/\\\\\\\\/g" -e "s/'/\\\\'/g"; }
# Tes koneksi lewat PHP mysqli, sama seperti aplikasi (tidak terpengaruh /root/.my.cnf milik CyberPanel)
dbtest() {
  DBP="$DBPASS" $PHPBIN -r 'mysqli_report(MYSQLI_REPORT_OFF); $m = @new mysqli($argv[1], $argv[2], getenv("DBP"), $argv[3]);
    if ($m->connect_errno) { fwrite(STDERR, $m->connect_error . "\n"); exit(1); }' "$1" "$DBUSER" "$DBNAME"
}
rootsql() {
  if mysql -u root -e "SELECT 1" >/dev/null 2>&1; then mysql -u root "$@"; return; fi
  local f=/etc/cyberpanel/mysqlPassword pw=""
  [ -f "$f" ] || return 1
  pw=$($PHPBIN -r '$s=trim(file_get_contents($argv[1])); $j=json_decode($s,true); echo is_array($j)?($j["mysqlpassword"]??""):$s;' "$f")
  MYSQL_PWD="$pw" mysql -u root "$@"
}
mkdir -p /etc/research-lab && chmod 750 /etc/research-lab
if [ -f /etc/research-lab/node.env ]; then
  TOKEN=$(grep '^INTERNAL_TOKEN=' /etc/research-lab/node.env | cut -d= -f2-)
else
  TOKEN=$(openssl rand -hex 32)
  sed "s/GANTI_DENGAN_TOKEN_ACAK_64_KARAKTER/$TOKEN/" "$APP/vps/deploy/node.env.example" > /etc/research-lab/node.env
fi
if [ -n "${HTTPS:-}" ]; then :; elif [ "$(curl -s -o /dev/null -m 10 -w '%{http_code}' "https://$DOMAIN/" || true)" != "000" ]; then HTTPS=1; else HTTPS=0; fi
SCHEME=$([ "$HTTPS" = 1 ] && echo https || echo http)
echo "Akses web: $SCHEME://$DOMAIN"
if [ ! -f "$CI/.env" ]; then
  echo "Masukkan data database yang dibuat di CyberPanel (Databases › Create Database)."
  DBHOST=""
  for try in 1 2 3; do
    read -rp "  Nama database   : " DBNAME
    read -rp "  Pengguna (user) : " DBUSER
    read -rsp "  Password        : " DBPASS; echo
    DBNAME=$(printf '%s' "$DBNAME" | tr -d '[:space:]'); DBUSER=$(printf '%s' "$DBUSER" | tr -d '[:space:]')
    for h in localhost 127.0.0.1; do
      if ERR=$(dbtest "$h" 2>&1 >/dev/null); then DBHOST=$h; break; fi
      echo "  [$h] $ERR"
    done
    [ -n "$DBHOST" ] && { echo "  Terhubung ke database $DBNAME lewat $DBHOST."; break; }
    if rootsql -e "SELECT 1" >/dev/null 2>&1; then
      echo "  Akun yang terdaftar untuk $DBUSER di MariaDB:"
      rootsql -N -e "SELECT CONCAT('    ', User, '@', Host) FROM mysql.user WHERE User='$(sqlq "$DBUSER")'" || true
      [ -n "$(rootsql -N -e "SHOW DATABASES LIKE '$(sqlq "$DBNAME")'" 2>/dev/null)" ] || echo "    (database $DBNAME tidak ditemukan; cek ejaannya di CyberPanel)"
      read -rp "  Setel ulang password $DBUSER@localhost menjadi password yang baru Anda ketik, dan beri akses ke $DBNAME? [y/N] " yn
      if [ "${yn,,}" = y ]; then
        rootsql -e "CREATE USER IF NOT EXISTS '$(sqlq "$DBUSER")'@'localhost' IDENTIFIED BY '$(sqlq "$DBPASS")';
                    ALTER USER '$(sqlq "$DBUSER")'@'localhost' IDENTIFIED BY '$(sqlq "$DBPASS")';
                    GRANT ALL PRIVILEGES ON \`$(sqlq "$DBNAME")\`.* TO '$(sqlq "$DBUSER")'@'localhost';
                    FLUSH PRIVILEGES;" && echo "  Password disetel ulang."
        if ERR=$(dbtest localhost 2>&1 >/dev/null); then
          DBHOST=localhost; echo "  Terhubung ke database $DBNAME."; break
        fi
        echo "  Masih gagal: $ERR"
      fi
    fi
    echo "  Belum bisa masuk (percobaan $try dari 3). Password peka huruf besar/kecil; ketik ulang dengan teliti."
  done
  [ -n "$DBHOST" ] || die "Tidak bisa masuk ke database $DBNAME dengan pengguna $DBUSER. Kirim pesan error di atas (tanpa password) untuk dibantu."
  esc() { printf '%s' "$1" | sed -e 's/[\/&|]/\\&/g'; }
  sed -e "s|https://research-lab.example.ac.id/|$SCHEME://$DOMAIN/|" \
      -e "s|^database.default.hostname = .*|database.default.hostname = $DBHOST|" \
      -e "s|^database.default.database = .*|database.default.database = $(esc "$DBNAME")|" \
      -e "s|^database.default.username = .*|database.default.username = $(esc "$DBUSER")|" \
      -e "s|^database.default.password = .*|database.default.password = '$(esc "$DBPASS")'|" \
      -e "s|GANTI_DENGAN_TOKEN_ACAK_64_KARAKTER|$TOKEN|" "$CI/.env.example" > "$CI/.env"
  if [ "$HTTPS" != 1 ]; then
    sed -i -e 's/^app.forceGlobalSecureRequests = true/app.forceGlobalSecureRequests = false/' -e 's/^cookie.secure = true/cookie.secure = false/' "$CI/.env"
  fi
  printf '[client]\nhost=%s\nuser=%s\npassword="%s"\n' "$DBHOST" "$DBUSER" "$DBPASS" > /etc/research-lab/mysql-backup.cnf
  echo "$DBNAME" > /etc/research-lab/dbname
  chmod 600 /etc/research-lab/mysql-backup.cnf
  (cd "$CI" && $PHPBIN spark key:generate --force >/dev/null)
elif [ "$HTTPS" = 1 ] && grep -q '^cookie.secure = false' "$CI/.env"; then
  echo "HTTPS sudah aktif: cookie aman dan alamat https diaktifkan."
  sed -i -e "s|^app.baseURL = .*|app.baseURL = 'https://$DOMAIN/'|" -e 's/^app.forceGlobalSecureRequests = false/app.forceGlobalSecureRequests = true/' -e 's/^cookie.secure = false/cookie.secure = true/' "$CI/.env"
fi

# -------------------------------------------------------------------------------------
say "4/7 Tabel database (migrasi)"
chown -R "$OWNER:$GROUP" "$APP"
chmod 640 "$CI/.env"
sudo -u "$OWNER" $PHPBIN "$CI/spark" migrate --no-interaction

# -------------------------------------------------------------------------------------
say "5/7 Tampilan web dan pengalihan /api, /admin"
if [ -n "$(ls -A "$DOCROOT" 2>/dev/null)" ]; then
  tar -czf "$SITE/arsip/public_html-$STAMP.tar.gz" -C "$DOCROOT" . && echo "Cadangan public_html lama: $SITE/arsip/public_html-$STAMP.tar.gz"
fi
cp -a "$APP/public/." "$DOCROOT/"
cat > "$DOCROOT/rl.php" <<PHP
<?php
// Research Lab: meneruskan /api/* dan /admin* ke CodeIgniter 4 (kode di luar public_html).
\$ci = '$CI/public';
\$_SERVER['SCRIPT_NAME'] = '/index.php';
\$_SERVER['SCRIPT_FILENAME'] = \$ci . '/index.php';
chdir(\$ci);
require \$ci . '/index.php';
PHP
if [ -f "$DOCROOT/.htaccess" ] && ! grep -q 'Research Lab' "$DOCROOT/.htaccess"; then cp "$DOCROOT/.htaccess" "$SITE/arsip/htaccess-$STAMP"; fi
cat > "$DOCROOT/.htaccess" <<'HT'
# Research Lab
RewriteEngine On
RewriteRule ^(api|admin)(/.*)?$ rl.php [L,QSA]
HT
chown -R "$OWNER:$GROUP" "$DOCROOT"
# Batas unggah dan waktu proses untuk lsphp (draf dan review AI bisa 30–120 detik)
INI=$($PHPBIN --ini | awk -F': *' '/Loaded Configuration File/{print $2}')
if [ -f "$INI" ]; then
  sed -i -e 's/^max_execution_time = .*/max_execution_time = 300/' -e 's/^post_max_size = .*/post_max_size = 32M/' \
         -e 's/^upload_max_filesize = .*/upload_max_filesize = 32M/' -e 's/^memory_limit = .*/memory_limit = 256M/' "$INI"
fi
VH=/usr/local/lsws/conf/vhosts/$DOMAIN/vhost.conf
if [ -f "$VH" ] && ! grep -q 'autoLoadHtaccess *1' "$VH"; then
  echo "PERINGATAN: .htaccess belum dibaca otomatis untuk situs ini. Di CyberPanel › Websites › $DOMAIN › Rewrite Rules, tempel:"
  echo "  RewriteRule ^(api|admin)(/.*)?\$ rl.php [L,QSA]"
fi

# -------------------------------------------------------------------------------------
say "6/7 Layanan AI internal (Node)"
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -q nodejs
fi
chown root:"$GROUP" /etc/research-lab /etc/research-lab/node.env && chmod 640 /etc/research-lab/node.env
cat > /etc/systemd/system/research-lab-node.service <<UNIT
[Unit]
Description=Research Lab - layanan AI internal (Node)
After=network.target

[Service]
Type=simple
User=$OWNER
Group=$GROUP
WorkingDirectory=$APP
EnvironmentFile=/etc/research-lab/node.env
ExecStart=$(command -v node) dev-server.js
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=read-only
MemoryMax=1G

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload && systemctl enable -q --now research-lab-node && systemctl restart research-lab-node
cat > /etc/cron.daily/research-lab-backup <<'BK'
#!/usr/bin/env bash
# Cadangan harian database Research Lab (disimpan 14 hari)
set -euo pipefail
DIR=/var/backups/research-lab; mkdir -p "$DIR"; chmod 700 "$DIR"
HOME=/nonexistent mysqldump --defaults-extra-file=/etc/research-lab/mysql-backup.cnf --single-transaction "$(cat /etc/research-lab/dbname)" | gzip > "$DIR/research_lab-$(date +%Y%m%d-%H%M).sql.gz"
find "$DIR" -name 'research_lab-*.sql.gz' -mtime +14 -delete
BK
chmod 755 /etc/cron.daily/research-lab-backup
/usr/local/lsws/bin/lswsctrl restart >/dev/null 2>&1 || systemctl restart lsws || true

# -------------------------------------------------------------------------------------
say "7/7 Akun admin dan pemeriksaan"
cd "$CI"
ADMINS=$(mysql --defaults-extra-file=/etc/research-lab/mysql-backup.cnf -N -e "SELECT COUNT(*) FROM users WHERE role='admin' AND active=1" "$(cat /etc/research-lab/dbname)" 2>/dev/null || echo 0)
if [ "$ADMINS" = 0 ] || [ "${RESET_ADMIN:-0}" = 1 ]; then
  sudo -u "$OWNER" $PHPBIN spark rl:admin "$ADMIN_USER"
fi
sleep 3
sudo -u "$OWNER" $PHPBIN spark rl:check || true
CODE=$(curl -s -o /tmp/rl-config.json -m 15 -w '%{http_code}' "$SCHEME://$DOMAIN/api/config" || true)
if [ "$CODE" = 200 ] && grep -q '"ci4"' /tmp/rl-config.json; then
  echo "[OK]   $SCHEME://$DOMAIN/api/config diteruskan ke CodeIgniter"
else
  echo "[GAGAL] $SCHEME://$DOMAIN/api/config menjawab $CODE (cek Rewrite Rules situs di CyberPanel)"
fi
rm -f /tmp/rl-config.json
printf '\n\033[1;32mSelesai.\033[0m Buka %s://%s dan masuk dengan akun %s. Panel admin: %s://%s/admin\n' "$SCHEME" "$DOMAIN" "$ADMIN_USER" "$SCHEME" "$DOMAIN"
[ "$HTTPS" = 1 ] || echo "HTTPS belum aktif. Terbitkan di CyberPanel › SSL › Manage SSL, lalu jalankan skrip ini sekali lagi."
