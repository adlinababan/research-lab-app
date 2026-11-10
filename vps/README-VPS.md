# Research Lab di VPS (CodeIgniter 4 + MySQL)

Versi ini memindahkan Research Lab dari Vercel ke VPS sendiri, dengan **data tersimpan di server**. Tampilan web (8 langkah, Fase A dan B) tetap sama.

## Yang berbeda dari versi Vercel

| | Vercel | VPS (CI4 + MySQL) |
|---|---|---|
| Login | Akun di env `APP_USERS` | Tabel `users`, dikelola dari **panel admin** |
| Data draf, rencana, log | Browser (localStorage) | **MySQL per proyek**, simpan otomatis |
| Tim penulis | Tidak bisa berbagi | **Anggota proyek** (penyunting / hanya baca) |
| Riwayat | Tidak ada | **Riwayat versi** + pulihkan |
| Kunci Rencana Hasil | Waktu perangkat | **Waktu server** + riwayat kunci |
| Gambar hasil | IndexedDB browser | Tabel `project_files` |
| Batas pemakaian | Memori server | Tabel `ai_logs` per akun |
| Admin | Tidak ada | `/admin`: akun, proyek, pemakaian AI |

## Arsitektur

```
Browser ──HTTPS──▶ Nginx
                    ├─ /            → berkas tampilan (public/index.html, app.js, …)
                    ├─ /api/*       → CodeIgniter 4 (PHP-FPM)  ──▶ MySQL 8
                    │                   │  login sesi, proyek, versi, tim, kunci, batas pemakaian, log
                    │                   └─ /api/llm, search, docx, check ──▶ Node 127.0.0.1:3311 (token internal)
                    └─ /admin       → CodeIgniter 4 (panel admin)
```

Logika AI yang sudah teruji (prompt, kunci angka dan kutipan, pembaca ZIP, pembuat .docx) tetap berjalan sebagai **layanan Node internal** yang hanya mendengar di `127.0.0.1`. Layanan itu menolak setiap permintaan tanpa token internal, jadi semua akses wajib lewat CodeIgniter.

## Kebutuhan

- VPS Ubuntu 24.04, minimal 2 vCPU, 2 GB RAM, 20 GB disk
- Domain atau subdomain yang **A record**-nya sudah mengarah ke IP VPS
- Akses root (SSH)

## Pemasangan otomatis (sekitar 10 menit)

```bash
ssh root@IP_VPS
curl -fsSLo install.sh https://raw.githubusercontent.com/adlinababan/research-lab-app/ci4-mysql/vps/deploy/install.sh
DOMAIN=research-lab.contoh.ac.id EMAIL=email@contoh.ac.id ADMIN_USER=admin bash install.sh
```

Skrip ini:
1. memasang Nginx, PHP 8.3-FPM, MySQL 8, Node 22, Composer, dan Certbot;
2. mengambil kode dari branch `ci4-mysql`;
3. membuat database, pengguna database, token internal, dan kunci enkripsi secara acak;
4. menjalankan migrasi tabel;
5. memasang layanan `research-lab-node` (systemd), Nginx, HTTPS, dan cadangan database harian;
6. meminta password admin pertama;
7. menjalankan pemeriksaan `php spark rl:check`.

Kalau `EMAIL` dikosongkan, HTTPS ditunda dan cookie sementara diizinkan lewat HTTP. Pasang HTTPS secepatnya dengan `certbot --nginx -d DOMAIN`, lalu kembalikan `cookie.secure = true` dan `app.forceGlobalSecureRequests = true` di `vps/ci4/.env`.

## Database

Database tidak perlu diunduh terpisah. `install.sh` sudah membuat database `research_lab`, pengguna database `research_lab` dengan password acak (tersimpan di `vps/ci4/.env`), dan seluruh tabelnya lewat `php spark migrate`.

Bila Ibu/Bapak memasang manual atau lebih suka phpMyAdmin, gunakan [`vps/database/research_lab.sql`](database/research_lab.sql). File itu berisi 8 tabel ditambah catatan migrasi, sehingga `php spark migrate` setelahnya tidak membuat ulang tabel.

```bash
mysql -u root -p -e "CREATE DATABASE research_lab CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
  CREATE USER 'research_lab'@'localhost' IDENTIFIED BY 'GANTI_PASSWORD_KUAT';
  GRANT ALL PRIVILEGES ON research_lab.* TO 'research_lab'@'localhost';"
mysql -u root -p research_lab < vps/database/research_lab.sql
# isi database.default.* di vps/ci4/.env, lalu:
cd vps/ci4 && php spark rl:admin admin && php spark rl:check
```

| Tabel | Isi |
|---|---|
| `users` | Akun (admin/user), password bcrypt |
| `projects` | Proyek penelitian; kolom `data` berisi seluruh sesi aplikasi (JSON) |
| `project_members` | Anggota tim: owner, editor, viewer |
| `project_versions` | Riwayat versi untuk dipulihkan |
| `plan_locks` | Kunci Rencana Hasil (SHA-256 + waktu server) |
| `project_files` | Gambar hasil analisis |
| `ai_logs` | Log panggilan AI, pencarian, dan .docx |
| `login_attempts` | Percobaan login (pembatasan tebak password) |

Akun admin sengaja tidak disertakan dalam file SQL agar tidak ada password bawaan.

## Setelah terpasang

1. **Key AI.** Isi `OPENROUTER_API_KEY` dan, bila ada, `OPENALEX_API_KEY` di `/etc/research-lab/node.env`, lalu jalankan `systemctl restart research-lab-node`. Bila dikosongkan, setiap pengguna mengisi key sendiri di aplikasi.
2. **Buat akun pengguna.** Buka `https://DOMAIN/admin` → **Akun** → Tambah akun. Password minimal 10 karakter.
3. **Proyek dan tim.** Pengguna masuk di `https://DOMAIN`. Proyek pertama dibuat otomatis; draf lama di browser ditawarkan untuk dipindahkan. Lewat tombol **📁 Proyek** di kanan atas, pemilik bisa menambah anggota tim (username), membuka riwayat versi, dan membuat proyek baru.

## Perintah penting

| Keperluan | Perintah |
|---|---|
| Pemeriksaan menyeluruh | `cd /var/www/research-lab/vps/ci4 && sudo -u www-data php spark rl:check` |
| Buat/reset admin | `sudo -u www-data php spark rl:admin <username>` |
| Status layanan AI | `systemctl status research-lab-node` · log: `journalctl -u research-lab-node -n 100` |
| Log CodeIgniter | `/var/www/research-lab/vps/ci4/writable/logs/` |
| Perbarui aplikasi | `bash /var/www/research-lab/vps/deploy/update.sh` (otomatis mencadangkan database dulu) |
| Cadangan manual | `/etc/cron.daily/research-lab-backup` → `/var/backups/research-lab/` (disimpan 14 hari) |
| Pulihkan cadangan | `gunzip -c research_lab-TANGGAL.sql.gz \| mysql research_lab` |

## Keamanan yang sudah diterapkan

- Password disimpan dengan `password_hash` (bcrypt). Setelah 12 percobaan gagal per IP, atau 8 per username, dalam 15 menit, login diblokir sementara.
- Sesi berlaku 7 hari, dengan cookie `HttpOnly`, `SameSite=Lax`, dan `Secure` (HTTPS).
- **CSRF:**
  - API hanya menerima `Content-Type: application/json`, yang tidak bisa dikirim formulir lintas situs;
  - formulir admin memakai token CSRF CodeIgniter.
- Hak akses proyek diperiksa di setiap permintaan: pemilik, penyunting, dan hanya baca. Admin tidak otomatis bisa membuka isi proyek orang lain.
- Simpan bersamaan dideteksi lewat nomor versi. Bila dua orang menyunting bersamaan, yang menyimpan belakangan diberi pilihan memuat versi terbaru atau menimpa. Versi lama tetap ada di riwayat.
- Batas pemakaian per akun per menit: AI 15, pencarian 60, .docx 20, cek key 10. Semua panggilan dicatat di `ai_logs`.
- Layanan Node hanya di `127.0.0.1` dan wajib token internal. Systemd menjalankannya dengan `ProtectSystem=strict`.
- `.env`, `node.env`, dan kredensial cadangan hanya bisa dibaca pemilik layanannya.

## Uji di komputer sendiri (tanpa Nginx/MySQL)

```bash
cd vps/ci4 && composer install
cp .env.example .env   # lalu ganti database ke SQLite: database.default.DBDriver = SQLite3, database.default.database = writable/uji.db
php spark migrate && php spark rl:admin admin
# Terminal 1: layanan Node mode uji
MOCK=1 PORT=3311 HOST=127.0.0.1 INTERNAL_TOKEN=<sama dengan RL_INTERNAL_TOKEN> node ../../dev-server.js
# Terminal 2: router PHP menggantikan Nginx
cd .. && php -S 127.0.0.1:8099 -t ../public dev-router.php
```

Buka `http://127.0.0.1:8099`.

## Catatan

- Versi ini sudah diuji menyeluruh dengan **SQLite** dan PHP 8.3, mencakup login, admin, proyek, tim, konflik, versi, kunci rencana, dan alur penelitian lengkap sampai .docx dan review. Di **MySQL 8**, jalankan `php spark rl:check` setelah pemasangan. Pemeriksaan itu juga menguji simpan dan baca data proyek 300 KB.
- Versi Vercel (branch `main`) tetap berjalan seperti biasa. Kedua versi memakai tampilan yang sama; mode server aktif otomatis bila `/api/config` menyatakan `server: "ci4"`.
