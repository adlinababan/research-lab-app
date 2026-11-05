# Research Lab — Dari Judul ke Draf Paper

Aplikasi web untuk sesi **AI-Assisted Research: Dari Ide hingga Publikasi**. Setiap paper ditulis oleh **tim 1–6 penulis** lintas prodi (rumpun: Computer Science, Information Systems, Digital Business, Visual Communication Design, International Trade), dengan judul yang ditentukan sendiri oleh peserta. Lima langkah:

1. **Peserta dan judul**: Research Lab key dan key OpenAlex dengan tombol cek, judul penelitian sendiri, serta **1–6 penulis**. Satu pilihan **Departemen** sekaligus menjadi teks tercetak dan rumpun untuk referensi lintas prodi, dan fakultasnya terisi otomatis: Computer Science Department → School of Computer Science; Information Systems Department → School of Information Systems; Digital Business Department dan International Trade Department → BINUS Business School / Undergraduate Program; Visual Communication Design Department → School of Design. Pilihan **Other** diisi manual (departemen dan fakultas). Blok penulis di .docx: Nama / *Departemen* / *Fakultas* / *Universitas* / Kota, negara / email.
2. **Literatur sesuai rumpun tim**: saran kata kunci **hanya berdasar rumpun prodi yang terwakili di tim penulis**. Bila tim terdiri atas Computer Science dan Visual Communication Design, kata kunci *irisan* menggabungkan keduanya, dan setiap lensa rumpun tetap dikaitkan dengan rumpun lain. Setiap referensi OpenAlex (ber-DOI, dengan bidang ilmunya) ditandai rumpunnya; minimal 3 referensi yang mencakup minimal 2 rumpun tim (atau 1 bila tim hanya 1 rumpun).
3. **Matriks gap** (bahasa Inggris): AI menilai abstrak dari sudut pandang beberapa rumpun prodi (Yes / Partial / No) dan mengusulkan gap di irisan antardisiplin, dengan sitasi nama penulis dari data OpenAlex, misalnya *Lee et al. (2021) [3]* atau *Putri and Hadi (2023) [5]*. Draf juga memakai label yang sama saat menyebut penulis.
4. **Judul dan draf**: saran 3 judul yang lebih tajam + 5 kata kunci (judul awal tetap bisa dipakai), lalu **rencana data dan metode**: tim memilih pendekatan (kuantitatif, kualitatif, campuran, rekayasa/design science, atau belum tahu) dan data yang sudah tersedia, AI menyarankan 3 desain yang menjawab gap, tim memilih dan menyunting, lalu draf yang **hanya mengutip referensi terpilih** dengan angka hasil sebagai `[placeholder]`. Bagian IV adalah **Results and Discussion** berupa kerangka siap isi sesuai pendekatan (placeholder tabel/gambar dan pembahasan yang membandingkan dengan studi terdahulu).
4b. **Panel ketentuan IEEE**: di sebelah kanan setiap bagian draf (judul, abstrak, keywords, kelima section) ada ketentuan conference IEEE, checklist yang bisa dicentang, dan cek otomatis (jumlah kata, sitasi, placeholder). Setiap kartu AI juga punya tombol **Lihat prompt AI** untuk melihat instruksi persis yang dikirim ke AI.
5. **Integritas dan ekspor**: **Open Contributionship** (peran CRediT per penulis, bisa disarankan AI lalu disunting), **Open Data** (tiga templat: dataset terbuka pihak lain, data sendiri dibagikan, atau data tidak dapat dibagikan), pernyataan penggunaan AI, checklist, lalu unduh **.docx template IEEE Conference A4** (tiga penulis per baris).

Model AI **dikunci** ke `google/gemini-2.5-flash-lite` (US$0,10 / US$0,40 per juta token) agar hasil dan biaya seragam; model lain hanya tampil sebagai informasi. Narasumber dapat menggantinya lewat env `OPENROUTER_MODEL`.

Tidak ada dependensi npm. Backend berupa fungsi serverless Vercel di folder `api/`, frontend di `public/`.

---

## A. API key

**Cara utama: setiap peserta memakai dua key miliknya sendiri.** Di langkah 1 aplikasi ada dua kolom beserta panduan daftarnya:

| Key | Untuk | Cara mendapatkan |
|---|---|---|
| **Research Lab key** (key OpenRouter `sk-or-…` yang dibagikan narasumber) | AI (kata kunci, matriks gap, draf) | Narasumber membuatnya di openrouter.ai → **Keys** → **Create Key** (beri limit kredit per key), lalu membagikannya ke peserta. Di aplikasi tidak ada panduan pendaftaran untuk key ini. |
| **OpenAlex** | Pencarian literatur | Buat akun gratis di openalex.org → buka openalex.org/settings/api → salin key (US$1 per hari gratis, ±1.000 pencarian) |

Setelah menempel keduanya, peserta mengeklik **Cek kedua key**: aplikasi memastikan key OpenRouter valid dan menampilkan saldonya, lalu memastikan key OpenAlex diterima. Tombol **Lanjut** baru aktif setelah judul dan kedua key terisi. Key hanya disimpan di browser peserta dan tidak disimpan di server.

**Alternatif: key milik narasumber di server.** Isi `OPENROUTER_API_KEY` dan `OPENALEX_API_KEY` (environment **Production**) di Vercel lalu Redeploy; kolom key peserta menjadi opsional.

### Detail OpenRouter

1. Masuk ke https://openrouter.ai → menu **Keys** → **Create Key**. Salin key yang diawali `sk-or-`.
2. Menu **Credits** → isi kredit minimal US$5. **Tanpa saldo, semua model berbayar ditolak** dengan pesan "kredit tidak cukup", dan model gratis pun bisa ikut ditolak bila saldo 0 atau minus.
   Model terkunci `google/gemini-2.5-flash-lite` (US$0,10 / US$0,40 per juta token input/output) menghabiskan kurang dari **US$0,01 per alur penuh**. Daftar model lain (hanya informasi):

   | Model | Harga per 1 juta token (input / output) | Catatan |
   |---|---|---|
   | `google/gemini-2.5-flash-lite` | $0,10 / $0,40 | **Dipakai (dikunci)** |
   | `anthropic/claude-haiku-5.5` | $0,10 / $0,50 | Paling patuh aturan sitasi dan placeholder |
   | `deepseek/deepseek-v4-flash` | $0,09 / $0,18 | Paling hemat |
   | `openai/gpt-6-luna` | $0,10 / $0,50 | Murah, serbaguna |
   | `google/gemini-3.6-flash` | $0,75 / $3,75 | Lebih mahal |

3. (Hanya bila memakai key narasumber di server) Vercel → **Settings → Environment Variables** → `OPENROUTER_API_KEY`, centang **Production**, lalu **Redeploy**.

Model gratis OpenRouter (`:free`) dibatasi 20 permintaan per menit dan 50 per hari untuk akun yang belum pernah membeli kredit (1.000 per hari setelah total pembelian US$10). Itu tidak cukup untuk 20 peserta, jadi model berbayar yang murah lebih aman. Model bawaan server bisa diganti lewat `OPENROUTER_MODEL`. Aplikasi selalu membatasi panjang jawaban (`max_tokens`) agar saldo kecil tetap cukup.

Kolom key AI juga menerima key Gemini (`AIza…`, dari aistudio.google.com/apikey) sebagai alternatif; jenis key dikenali otomatis.

> Jangan pernah menulis API key di dalam kode atau di repositori GitHub, apalagi repositori publik.

## B. Deploy ke Vercel (sekitar 10 menit)

1. **Upload ke GitHub**
   - Buat repositori baru (boleh *Private*) di github.com.
   - Pilih *uploading an existing file*, lalu seret **isi** folder `research-lab-app` (bukan file zip-nya). Pastikan folder `api`, `lib`, `public`, `template` ikut. Klik *Commit changes*.
2. **Import ke Vercel**
   - Masuk ke vercel.com dengan akun GitHub → *Add New… → Project* → pilih repositori tadi → *Import*.
   - *Framework Preset*: **Other**. Biarkan *Build Command* kosong.
3. **Environment Variables** (lihat bagian A):

   | Nama | Isi |
   |---|---|
   | `OPENROUTER_API_KEY` | key OpenRouter narasumber (disarankan) |
   | `OPENALEX_API_KEY` | opsional, key OpenAlex narasumber |
   | `GEMINI_API_KEY` | opsional, alternatif bila tidak memakai OpenRouter |
   | `ACCESS_CODE` | opsional, mis. `binus2026`, dibagikan ke peserta saat sesi |
   | `EVENT_NAME` | opsional, judul acara di kepala halaman |
   | `GEMINI_MODEL` | opsional; kosongkan agar dipilih otomatis |

   Setiap variabel harus dicentang untuk environment **Production**. Setelah mengubah env, lakukan **Redeploy**.
4. Klik **Deploy**. Setelah selesai, buka alamat `https://nama-proyek.vercel.app`.
5. **Cek status** di kanan atas: hijau *OpenRouter · OpenAlex* berarti key server terbaca. Merah *Isi API key AI* berarti key server belum terbaca (cek environment Production lalu Redeploy) dan peserta harus menempelkan key sendiri.

Alternatif tanpa GitHub: pasang Node.js, lalu di folder proyek jalankan `npx vercel` dan ikuti petunjuknya. Env var bisa diisi lewat dasbor Vercel.

> Paket Vercel Hobby (gratis) ditujukan untuk penggunaan pribadi dan non-komersial. Untuk pelatihan berbayar atau resmi institusi, pertimbangkan paket Pro atau akun institusi.

### Pilihan model AI

Peserta bisa memilih salah satu dari empat model di kartu API key: **Gemini 2.5 Flash-Lite** (bawaan, berbayar sangat murah), **NVIDIA Nemotron 3 Ultra (free)**, **Gemma 4 31B (free)**, dan **Gemma 4 26B A4B (free)**. Model lain tampil tetapi nonaktif. Server hanya menerima model dari daftar ini; pilihan lain otomatis diganti model bawaan.

Catatan model gratis OpenRouter: dibatasi sekitar 20 permintaan per menit per akun dan ada kuota harian (lebih besar bila akun pernah membeli kredit minimal US$10). Bila 20+ peserta memakai satu Research Lab key bersama, model gratis cepat terkena batas, jadi pakai Gemini 2.5 Flash-Lite sebagai pilihan utama dan model gratis sebagai cadangan. Model gratis juga mensyaratkan izin di openrouter.ai/settings/privacy.

## Checklist hari H (20+ peserta serentak)

Aplikasi sudah diuji beban dengan **30 peserta simulasi yang menjalankan alur penuh bersamaan** (cek key, kata kunci, 2× pencarian, matriks gap, judul, draf, kontribusi, ekspor .docx), dengan 10–15% penolakan sementara (429) yang disuntikkan dari penyedia AI dan OpenAlex: **30/30 berhasil**, draf terlama 44 detik. Kunci ketahanannya: coba ulang otomatis dengan jeda acak, batas waktu per panggilan, dan pembatas laju per perangkat (bukan per IP, karena peserta berbagi Wi-Fi kampus).

**H-1 (malam ini)**
1. Vercel → **Deployments**: deployment teratas berstatus **Ready**.
2. Buka alamat produksi di **jendela penyamaran** (incognito): halaman harus terbuka tanpa diminta login Vercel. Bila diminta login, matikan *Deployment Protection* untuk Production di Settings.
3. Jalankan satu alur penuh dengan Research Lab key dan key OpenAlex sungguhan sampai unduh .docx.
4. OpenRouter: pastikan saldo cukup (perkiraan < US$0,05 per peserta per alur, termasuk coba ulang). Bila memakai satu key untuk semua peserta, jangan beri limit kredit yang terlalu kecil pada key itu.
5. OpenAlex: idealnya setiap peserta memakai key sendiri (1.000 pencarian/hari per key). Bila satu key dipakai bersama, 20 peserta × ±10 pencarian masih aman.

**Hari H**
1. 10 menit sebelum mulai, buka aplikasi dan klik **Cek kedua key** sekali (memanaskan server).
2. Bagikan Research Lab key; peserta menempelkannya lalu klik **Cek kedua key** sampai keduanya **Ready!**.
3. Bila muncul pesan "server model AI sedang padat", minta peserta menunggu 30–60 detik lalu klik lagi; aplikasi sudah mencoba ulang 3 kali secara otomatis.
4. Isian peserta tersimpan di browser masing-masing; menyegarkan halaman tidak menghapus pekerjaan.

## C. Uji sebelum acara (wajib, H-1)

1. Jalankan satu alur penuh dengan satu judul sampai unduh .docx.
2. Buka .docx di Word dan pastikan tampilannya dua kolom IEEE, bagian kuning adalah placeholder.
3. Coba dari jaringan yang akan dipakai di lokasi acara.
4. Simpan satu file *Unduh data sesi (.json)* sebagai contoh cadangan.

## D. Mencoba di komputer sendiri

```bash
cp .env.example .env.local    # isi key di dalamnya
npm run dev                   # buka http://localhost:3000
npm run dev:mock              # tanpa key: memakai data uji berlabel "DATA UJI"
```

Membutuhkan Node.js 20 ke atas. Tidak perlu `npm install`.

## E. Batas pemakaian dan perilaku penting

- **Data setiap peserta tersimpan di browser** perangkat masing-masing (localStorage). Tombol *Mulai baru* menghapusnya. Gunakan *Unduh data sesi (.json)* untuk arsip.
- **Kuota AI**: dengan key OpenRouter berkredit, 20 peserta bersamaan tidak bermasalah. Jika muncul pesan *saldo tidak cukup*, isi kredit OpenRouter. Jika muncul pesan batas permintaan, tunggu sekitar satu menit.
- **Sitasi**: server membuang sitasi ke nomor yang tidak ada di daftar makalah terpilih, lalu menomori ulang sesuai urutan kemunculan (aturan IEEE). Makalah yang tidak dikutip tidak masuk daftar referensi.
- **Abstrak tanpa sitasi**: sesuai gaya IEEE, sitasi di abstrak dihapus otomatis.
- **Pernyataan AI**: teks Acknowledgment otomatis menyebut sistem AI dan bagian yang dibantu (kebijakan IEEE). Peserta wajib menyesuaikannya.
- **Template**: `template/ieee-conference-a4.docx` adalah template yang Anda berikan. Untuk mengganti template lain, struktur section-nya harus sama (judul 1 kolom, penulis 3 kolom, isi 2 kolom).

## F. Struktur proyek

```
api/        fungsi serverless: config, search (OpenAlex), llm (AI), docx (ekspor)
lib/        logika bersama: prompt, OpenAlex, pemanggil AI, pengisi template, zip
public/     antarmuka (index.html, app.js, styles.css)
template/   template IEEE Conference A4
dev-server.js  server lokal untuk uji coba
```

## G. Masalah umum

| Gejala | Penyebab dan solusi |
|---|---|
| Status merah *Isi API key AI* | `OPENROUTER_API_KEY` belum terbaca. Pastikan environment **Production** dicentang, lalu Redeploy. Sementara itu peserta bisa menempelkan key di langkah 1. |
| *API key ditolak* | Key salah salin, ada spasi, atau sudah dihapus. Buat key baru. |
| *Saldo OpenRouter tidak cukup* | Isi kredit di openrouter.ai → Credits, atau ganti `OPENROUTER_MODEL`. |
| *… mengembalikan status 404* | Nama model tidak tersedia. Kosongkan `OPENROUTER_MODEL` / `GEMINI_MODEL` agar memakai bawaan. |
| *Kuota … tercapai* | Tunggu satu menit. Untuk OpenAlex, kuota harian di-reset pukul 07.00 WIB (tengah malam UTC). |
| Pencarian kosong | Kata kunci terlalu panjang. Gunakan 3–6 kata bahasa Inggris tanpa AND/OR. |
| Peserta diminta kode akses | `ACCESS_CODE` aktif. Bagikan kodenya di layar. |
