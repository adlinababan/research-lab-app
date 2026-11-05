# Research Lab — Dari Judul ke Draf Paper

Aplikasi web untuk sesi **AI-Assisted Research: Dari Ide hingga Publikasi**. Setiap peserta bekerja **mandiri dengan judulnya sendiri** melalui lima langkah:

1. **Peserta dan judul**: peserta menulis judul penelitiannya sendiri (wajib), tujuan dan rencana metode (opsional), bahasa naskah, dan data penulis. AI tidak menentukan atau mengganti judul.
2. **Literatur**: AI mengubah judul menjadi kata kunci bahasa Inggris, lalu peserta mencari makalah **nyata** di OpenAlex (semua ber-DOI) dan memilih 5–15 makalah.
3. **Matriks gap**: AI menilai abstrak makalah terpilih terhadap aspek-aspek judul (Ya / Sebagian / Belum) dan mengusulkan gap; peserta mengoreksi dan memilih.
4. **Judul dan draf**: berdasarkan gap yang dipilih, AI menyarankan 3 versi judul yang lebih tajam (topik tetap sama) beserta 5 kata kunci; peserta boleh memilih salah satu, menyunting, atau tetap memakai judul awal. Lalu AI menyusun draf yang **hanya mengutip makalah terpilih**. Angka hasil tidak dikarang; ditulis sebagai `[placeholder]`.
5. **Integritas dan ekspor**: pratinjau gaya IEEE, pernyataan penggunaan AI, checklist, lalu unduh **.docx dalam template IEEE Conference A4**.

Tidak ada dependensi npm. Backend berupa fungsi serverless Vercel di folder `api/`, frontend di `public/`.

---

## A. API key

**Cara utama: setiap peserta memakai dua key miliknya sendiri.** Di langkah 1 aplikasi ada dua kolom beserta panduan daftarnya:

| Key | Untuk | Cara mendapatkan |
|---|---|---|
| **OpenRouter** (`sk-or-…`) | AI (kata kunci, matriks gap, draf) | openrouter.ai → Sign in → **Credits**: isi minimal US$5 → **Keys** → **Create Key** |
| **OpenAlex** | Pencarian literatur | Buat akun gratis di openalex.org → buka openalex.org/settings/api → salin key (US$1 per hari gratis, ±1.000 pencarian) |

Setelah menempel keduanya, peserta mengeklik **Cek kedua key**: aplikasi memastikan key OpenRouter valid dan menampilkan saldonya, lalu memastikan key OpenAlex diterima. Tombol **Lanjut** baru aktif setelah judul dan kedua key terisi. Key hanya disimpan di browser peserta dan tidak disimpan di server.

**Alternatif: key milik narasumber di server.** Isi `OPENROUTER_API_KEY` dan `OPENALEX_API_KEY` (environment **Production**) di Vercel lalu Redeploy; kolom key peserta menjadi opsional.

### Detail OpenRouter

1. Masuk ke https://openrouter.ai → menu **Keys** → **Create Key**. Salin key yang diawali `sk-or-`.
2. Menu **Credits** → isi kredit minimal US$5. **Tanpa saldo, semua model berbayar ditolak** dengan pesan "kredit tidak cukup", dan model gratis pun bisa ikut ditolak bila saldo 0 atau minus.
   Model bawaan `anthropic/claude-haiku-5.5` (US$0,10 / US$0,50 per juta token input/output) menghabiskan kurang dari **US$0,01 per peserta** untuk satu alur penuh. Peserta bisa memilih model lain di langkah 1:

   | Model | Harga per 1 juta token (input / output) | Catatan |
   |---|---|---|
   | `anthropic/claude-haiku-5.5` | $0,10 / $0,50 | Bawaan; paling patuh aturan sitasi dan placeholder |
   | `deepseek/deepseek-v4-flash` | $0,09 / $0,18 | Paling hemat |
   | `openai/gpt-6-luna` | $0,10 / $0,50 | Murah, serbaguna |
   | `google/gemini-2.5-flash-lite` | $0,10 / $0,40 | Murah, cepat |
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
