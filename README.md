# Research Lab — Aplikasi Pelatihan Riset Lintas Prodi Berbantuan AI

Aplikasi web untuk sesi **AI-Assisted Research: Dari Ide hingga Publikasi**. Setiap kelompok berjalan melalui enam langkah:

1. **Kelompok**: tema, prodi anggota, bahasa naskah, data penulis.
2. **Pertanyaan riset**: AI mengusulkan fenomena per prodi dan 3 pertanyaan lintas prodi; kelompok memilih dan mempertajam.
3. **Literatur**: pencarian makalah **nyata** di OpenAlex (semua ber-DOI); kelompok memilih 5–15 makalah.
4. **Matriks gap**: AI menilai abstrak makalah terpilih (Ya / Sebagian / Belum) dan mengusulkan gap; kelompok mengoreksi dan memilih.
5. **Judul dan draf**: AI mengusulkan judul lalu menyusun draf paper yang **hanya mengutip makalah terpilih**. Angka hasil tidak dikarang; ditulis sebagai `[placeholder]`.
6. **Integritas dan ekspor**: pratinjau gaya IEEE, pernyataan penggunaan AI, checklist, lalu unduh **.docx dalam template IEEE Conference A4** (template asli Anda, termasuk style dan penomoran).

Tidak ada dependensi npm. Backend berupa fungsi serverless Vercel di folder `api/`, frontend di `public/`.

---

## A. Siapkan dua API key (gratis)

| Key | Cara mendapatkan | Catatan |
|---|---|---|
| **OpenAlex** | Buat akun di openalex.org, lalu buka https://openalex.org/settings/api | Gratis: 1.000 pencarian per hari dengan key. Cukup untuk 4 kelompok. |
| **Gemini** | Buka Google AI Studio (aistudio.google.com), menu *Get API key* | Free tier: konten **dipakai Google untuk mengembangkan produk**. Jangan masukkan data responden atau naskah yang belum terbit. |

Alternatif AI: Groq (format OpenAI). Isi `LLM_PROVIDER=openai` dan `OPENAI_COMPAT_API_KEY`. Batas token per menit Groq free tier kecil, jadi penyusunan draf bisa tertahan bila beberapa kelompok mengeklik bersamaan.

## B. Deploy ke Vercel (sekitar 10 menit)

1. **Upload ke GitHub**
   - Buat repositori baru (boleh *Private*) di github.com.
   - Pilih *uploading an existing file*, lalu seret **isi** folder `research-lab-app` (bukan file zip-nya). Pastikan folder `api`, `lib`, `public`, `template` ikut. Klik *Commit changes*.
2. **Import ke Vercel**
   - Masuk ke vercel.com dengan akun GitHub → *Add New… → Project* → pilih repositori tadi → *Import*.
   - *Framework Preset*: **Other**. Biarkan *Build Command* kosong.
3. **Isi Environment Variables** (sebelum klik Deploy):

   | Nama | Isi |
   |---|---|
   | `OPENALEX_API_KEY` | key OpenAlex |
   | `GEMINI_API_KEY` | key Gemini |
   | `ACCESS_CODE` | opsional, mis. `binus2026`, dibagikan ke peserta saat sesi |
   | `EVENT_NAME` | opsional, judul acara di kepala halaman |
   | `GEMINI_MODEL` | opsional; kosongkan agar dipilih otomatis |

4. Klik **Deploy**. Setelah selesai, buka alamat `https://nama-proyek.vercel.app`.
5. **Cek status** di kanan atas: harus hijau, bertuliskan *Google Gemini API · OpenAlex*. Jika merah *AI belum dikonfigurasi*, periksa env var lalu *Redeploy*.

Alternatif tanpa GitHub: pasang Node.js, lalu di folder proyek jalankan `npx vercel` dan ikuti petunjuknya. Env var bisa diisi lewat dasbor Vercel.

> Paket Vercel Hobby (gratis) ditujukan untuk penggunaan pribadi dan non-komersial. Untuk pelatihan berbayar atau resmi institusi, pertimbangkan paket Pro atau akun institusi.

## C. Uji sebelum acara (wajib, H-1)

1. Jalankan satu alur penuh untuk satu kelompok sampai unduh .docx.
2. Buka .docx di Word dan pastikan tampilannya dua kolom IEEE, bagian kuning adalah placeholder.
3. Coba dari jaringan yang akan dipakai di lokasi acara.
4. Simpan satu file *Unduh data sesi (.json)* per tema sebagai cadangan.

## D. Mencoba di komputer sendiri

```bash
cp .env.example .env.local    # isi key di dalamnya
npm run dev                   # buka http://localhost:3000
npm run dev:mock              # tanpa key: memakai data uji berlabel "DATA UJI"
```

Membutuhkan Node.js 20 ke atas. Tidak perlu `npm install`.

## E. Batas pemakaian dan perilaku penting

- **Data per kelompok tersimpan di browser** perangkat masing-masing (localStorage). Tombol *Mulai baru* menghapusnya. Gunakan *Unduh data sesi (.json)* untuk arsip.
- **Kuota AI**: free tier punya batas per menit. Jika muncul pesan kuota, tunggu sekitar satu menit lalu klik lagi. Dengan 4 kelompok, ini jarang terjadi.
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
| Status merah *AI belum dikonfigurasi* | `GEMINI_API_KEY` kosong atau salah nama. Perbaiki di Vercel → Settings → Environment Variables → Redeploy. |
| *Gemini mengembalikan status 404* | Nama model tidak tersedia. Kosongkan `GEMINI_MODEL` agar dipilih otomatis, atau isi nama model dari AI Studio. |
| *Kuota … tercapai* | Tunggu satu menit. Untuk OpenAlex, kuota harian di-reset pukul 07.00 WIB (tengah malam UTC). |
| Pencarian kosong | Kata kunci terlalu panjang. Gunakan 3–6 kata bahasa Inggris tanpa AND/OR. |
| Peserta diminta kode akses | `ACCESS_CODE` aktif. Bagikan kodenya di layar. |
