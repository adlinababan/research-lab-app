# Research Lab — panduan untuk Claude

Aplikasi web pendamping dosen untuk menyusun paper IEEE dengan bantuan AI, dari topik sampai review. Pemilik: dosen (bahasa kerja: **Bahasa Indonesia**). Prinsip utama: **AI merencanakan dan menyunting, tetapi data dan analisis dikerjakan sendiri oleh peneliti**. Angka hasil tidak boleh dikarang AI.

## Dua versi, satu tampilan

| | Branch `main` | Branch `ci4-mysql` |
|---|---|---|
| Hosting | Vercel (https://research-lab-app.vercel.app) | VPS sendiri (https://research-lab.my.id, CyberPanel) |
| Backend | Fungsi serverless Node `api/*.js` | CodeIgniter 4 + MariaDB, plus layanan Node internal |
| Data | localStorage browser | Database per proyek |
| Login | env `APP_USERS` (token HMAC) | Tabel `users`, sesi PHP, panel `/admin` |

Tampilan di `public/` sama untuk keduanya. Mode server aktif bila `/api/config` mengembalikan `server: "ci4"` (lihat `serverMode()` di `public/app.js`).

## Alur aplikasi (8 langkah, 2 fase)

Fase A, perencanaan:
1. Peserta dan judul
2. Literatur (OpenAlex, pilih 15 dari 30)
3. Matriks gap
4. Judul, metode, dan **Rencana Hasil** (blueprint), yang bisa dikunci dengan SHA-256 dan waktu server. Draf kerangka paper dibuat di sini.

Fase B, setelah peneliti mengumpulkan dan menganalisis data sendiri:

5. Pelaksanaan: etik, uji coba, log data, fakta pelaksanaan.
6. Hasil dan sinkronisasi. Peneliti mengunggah ZIP output (Python, SPSS, SmartPLS, kualitatif, folder proyek aplikasi). AI mengisi Hasil, Simpulan, dan Abstrak dengan **kunci angka**, lalu menyinkronkan Judul, Pendahuluan, dan Metode serta mengungkap penyimpangan dari rencana. Pada tahap ini juga ada pembaruan literatur.
7. Integritas dan ekspor .docx IEEE.
8. Review IEEE: reviewer AI dan perbaikan.

## Peta kode

- **`public/app.js`**: seluruh UI (± 2.700 baris).
  - `STEPS`/`views`, state di localStorage (`stepsV: 2`), serta mode server (`srv`, `serverSave` dengan `baseVersion` → 409 konflik).
  - Fungsi kartu: `blueprintCard`, `resultsCard`, `syncCard`, `litRefreshCard`.
- **`public/results-files.js`**: pembaca ZIP/CSV/XLSX/DOCX/HTML/JUnit/ipynb di browser, dan pemindai proyek aplikasi.
- **`public/standards.js`**: standar minimum IEEE per profil.
  - Profil yang ada: ml, sem, stats, qual, mixed, dsr.
  - Butir standar: C1–C7, S\*, Q\*, K\*, L\*, R\*. Butir pelaksanaan: E\*.
- **`lib/prompts.js`**: prompt draf dan review, termasuk `LANG`, `ROLE_SETS`, dan `sanitizeCitations`.
- **`lib/results.js`**: prompt hasil, `cleanResults`, kunci angka (`sourceNumbers`, `unmatchedNumbers`, `diffsOf` dalam baris/kolom tabel yang sama), dan `autoChecks` (ambang loading 0,70, AVE 0,50, CR 0,70, HTMT 0,90, VIF 5).
- **Prompt lain di `lib/`:**
  - `blueprint.js`: Rencana Hasil, berisi struktur tanpa angka dan tanpa dugaan hasil.
  - `sync.js`
  - `litrefresh.js`
  - `openalex.js`
  - `docx.js`: OOXML ditulis langsung, tanpa dependensi.
  - `zip.js`
  - `llm.js`: OpenRouter, pengguna bisa membawa key sendiri lewat header `x-ai-key`.
- **`api/*.js`**: endpoint Vercel. `api/llm.js` memetakan `task` ke prompt: keywords, gap, titles, contrib, method, review, draft, results, blueprint, sync, litq, discuss.
- **`dev-server.js`**: server lokal, dan sekaligus **layanan Node internal** di VPS. Bila `INTERNAL_TOKEN` diisi, setiap permintaan wajib membawa header `x-internal-token` (lihat `lib/http.js`).
- **`vps/ci4/`**: CodeIgniter 4.7.
  - `Controllers/Api/Auth.php`: login, dengan pembatasan 12 per IP dan 8 per username tiap 15 menit.
  - `Controllers/Api/Projects.php`: proyek, versi, anggota, kunci rencana, dan gambar. Memakai JSON *object mode* supaya `{}` tidak berubah menjadi `[]`.
  - `Controllers/Api/Proxy.php`: meneruskan permintaan ke Node, dengan batas pemakaian dan pencatatan di `ai_logs`.
  - `Admin.php`
  - `Commands/RlAdmin.php` dan `RlCheck.php`
  - Migrasi di `app/Database/Migrations`.
- **`vps/database/research_lab.sql`**: skema MariaDB/MySQL yang setara dengan migrasi.
- **`vps/deploy/install.sh`**: pemasang untuk server Nginx biasa. **Jangan dipakai di server CyberPanel.**
- **`vps/cyberpanel/setup.sh`**: pemasang CyberPanel. Aman dijalankan ulang.

## Server produksi (CyberPanel, OpenLiteSpeed, lsphp83, MariaDB 10.11)

- **Kode:** `/home/research-lab.my.id/app`, di luar web root.
- **Web root:** `/home/research-lab.my.id/public_html`, berisi salinan `public/`, `rl.php`, dan `.htaccess`.
  - `.htaccess` mengandung `RewriteRule ^(api|admin)(/.*)?$ rl.php [L,QSA]`.
  - `rl.php` memanggil `app/vps/ci4/public/index.php`.
- **PHP:** `/usr/local/lsws/lsphp83/bin/php`. Semua perintah `spark` dijalankan dengan binari ini, sebagai pemilik situs, contoh: `sudo -u <pemilik public_html> /usr/local/lsws/lsphp83/bin/php spark rl:check`.
- **Database:** `rese_research`, pengguna `rese_research@localhost`. Kredensial ada di `app/vps/ci4/.env`. **Catatan:** `/root/.my.cnf` milik CyberPanel menimpa password klien `mysql` saat dijalankan sebagai root. Untuk menguji akun aplikasi, pakai PHP mysqli atau `HOME=/nonexistent mysql ...`.
- **Layanan Node:** systemd `research-lab-node` di 127.0.0.1:3311. Konfigurasi di `/etc/research-lab/node.env`, berisi `INTERNAL_TOKEN` yang harus sama dengan `RL_INTERNAL_TOKEN` di `.env`, serta `OPENROUTER_API_KEY` yang opsional.
- **Cadangan:** `/etc/cron.daily/research-lab-backup` menyimpan ke `/var/backups/research-lab/` selama 14 hari.
- **Arsip:** ZIP dan SQL unggahan serta isi `public_html` lama ada di `/home/research-lab.my.id/arsip`.
- **Memperbarui tampilan:** setelah `public/` berubah, salin ulang `public/.` ke `public_html/`, atau jalankan ulang `setup.sh`.

## Perintah penting

```bash
cd /home/research-lab.my.id/app/vps/ci4
sudo -u $(stat -c %U ../../../public_html) /usr/local/lsws/lsphp83/bin/php spark rl:check   # pemeriksaan menyeluruh
sudo -u $(stat -c %U ../../../public_html) /usr/local/lsws/lsphp83/bin/php spark rl:admin admin   # reset admin
systemctl status research-lab-node; journalctl -u research-lab-node -n 100
tail -n 100 writable/logs/log-$(date +%F).log                      # error CodeIgniter
/usr/local/lsws/bin/lswsctrl restart                                # muat ulang OpenLiteSpeed (.htaccess)
```

## Aturan kerja

- **Jangan pernah** menampilkan, menyalin ke chat, atau meng-commit isi `.env`, `/etc/research-lab/*`, password, atau API key. Repo GitHub `adlinababan/research-lab-app` bersifat **publik**.
- Jangan memasang Nginx atau Apache, dan jangan mengubah konfigurasi CyberPanel atau situs lain di server ini.
- Mintalah izin sebelum menjalankan perintah `sudo`, mengubah database, atau me-restart layanan.
- Sebelum mengubah database, cadangkan dulu dengan `/etc/cron.daily/research-lab-backup`.
- Prinsip yang harus dijaga saat mengubah prompt atau logika:
  - AI tidak mengarang angka hasil; kunci angka dan kunci kutipan harus tetap berjalan.
  - Rencana Hasil tidak boleh berisi dugaan hasil.
  - Referensi hanya dari daftar bernomor yang ada.
- Pemilik lebih dulu meminta **rekomendasi**. Jangan langsung mengimplementasikan kecuali diminta ("implementasikan", "kerjakan").
- Tulisan untuk pengguna dalam Bahasa Indonesia yang jelas, tanpa jargon yang tidak perlu.
- Uji lokal (tanpa key AI): `MOCK=1 node dev-server.js`. Versi CI4 dengan SQLite dijelaskan di `vps/README-VPS.md`.
