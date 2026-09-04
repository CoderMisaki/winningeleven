# Winning Eleven 10 - WE10 Memory Research System

> Sistem analisa & sinkronisasi skor **Winning Eleven 10 (WE10 / SLPM-66374)** agar hasil simulasi di PCSX2 bisa **100% sama persis dengan Live TikTok**.

Web ini bisa generate file `.p2s` (Save State) dan `.pnach` (Cheats) supaya skor `Konami Cup - Schedule Table Round 1 Match 1~8` + `Top Goals` di game kamu sama dengan yang tampil di live TikTok.

---

## 📋 Daftar Isi
- [Fitur Utama](#-fitur-utama)
- [Cara Install & Jalankan Web](#-cara-install--jalankan-web)
- [Cara Sinkron Dengan TikTok LIVE (Panduan Lengkap)](#-cara-sinkron-dengan-tiktok-live-panduan-lengkap)
- [2 Cara Load di PCSX2](#-2-cara-load-di-pcsx2)
- [Wajib: General Settings Harus Sama](#-wajib-general-settings-harus-sama)
- [Cara Update Skor Kalau Live Ganti](#-cara-update-skor-kalau-live-ganti)
- [Troubleshooting (Masalah Umum)](#-troubleshooting-masalah-umum)
- [Struktur File Penting](#-struktur-file-penting)
- [FAQ](#-faq)

---

## ✨ Fitur Utama

| Fitur | Keterangan |
|-------|------------|
| **Matching Center** | Cari kecocokan data histori pertandingan |
| **Predict** | Prediksi skor pakai model Hybrid + Poisson (rating, H2H, form) |
| **What If** | Simulasi manual `Home 2 : 1 Away` -> lihat Top Goals otomatis (pakai RNG asli `FUN_0016e8d8`) |
| **TikTok Save Sync** | **FITUR UTAMA:** Generate `.p2s` / `.pnach` biar skor game 100% sinkron dengan live TikTok |
| **RNG Bagan** | Generate bagan/bracket deterministik pakai seed yang sama dengan overlay TikTok |

---

## 🚀 Cara Install & Jalankan Web

### Syarat
- Node.js versi 18+ terinstall
- PCSX2 versi terbaru

### Langkah

```bash
# 1. Masuk ke folder project
cd winningeleven-main

# 2. Install dependency (cukup sekali)
npm install

# 3. Jalankan web
npm run dev
# akan buka otomatis di http://localhost:3000
```

> **Catatan:** Web otomatis menyimpan data ke `localStorage` browser. Jadi kalau kamu isi skor B1-B8, lalu refresh browser, data **tidak hilang**.

---

## 🔴 Cara Sinkron Dengan TikTok LIVE (Panduan Lengkap)

Tujuan: Skor di `Schedule Table` + `Top Goals` di PCSX2 kamu **persis sama** dengan skor yang ada di Live TikTok. Cukup **1 klik Load State**.

Ikuti 6 langkah ini secara urut. Wajib urut biar 100% berhasil.

### STEP 0 - Jalankan Web
Buka `http://localhost:3000` setelah `npm run dev` seperti di atas.

### STEP 1 - Samakan Setting di Dalam Game WE10 (WAJIB SAMA PERSIS)

Masuk ke `General Settings 1/2` di menu `Konami Cup` dan samakan seperti ini:

```
Cup                  : Konami Cup
Eligible Teams       : National
Competition Type     : Knock-out System
Home & Away          : Yes
Group Name           : 1~8
Number of Teams      : 24
Number of Players    : 1/24  (PENTING! Jangan 11/24)
Entrance Scene       : Only important matches
Match Time           : 30 min.
Difficulty           : ★★★★★ (5 bintang)
Accumulated fatigue  : Yes
Injuries             : Yes
Strip Selection      : Yes
```

**Kenapa harus sama?**
Game menghitung skor pakai rumus `teamRating * Difficulty * fatigue / 5` (`FUN_0026c910`). Kalau setting beda, skor akan meleset 1-2 gol.

### STEP 2 - Buat File Template Sekali Saja (Biar .p2s Valid)

Ini cuma perlu dilakukan **1x seumur hidup**.

1. Di PCSX2, dengan setting STEP 1, masuk ke `Konami Cup > Proceed to Team Select`
2. Pilih **24 negara** (bebas negara apa saja) > Tekan `OK`
3. Tunggu sampai masuk ke layar **Schedule Table `Konami Cup Round 1 - Match 1~8`** (layar yang ada jadwal `Czech vs Portugal` dll - Gambar 2)
4. **JANGAN mainkan match dulu.** Langsung tekan `F1` di keyboard (atau `PCSX2 > System > Save State > Slot 1`)
5. Akan tercipta file `SLPM-66374 (9337F97).00.p2s` ukuran sekitar **11 MB** di folder `PCSX2/sstates/`
6. Copy file itu dan rename jadi `template-schedule.p2s` simpan di Desktop.

> ⚠️ Jangan pakai file `.p2s` yang posisinya sudah di dalam pertandingan (misal `ARGN SWE (1).p2s` yang ada di posisi Argentina vs Swedia). Harus yang posisi di **Schedule Table**.

### STEP 3 - Isi Skor Live TikTok di Web

1. Buka web `http://localhost:3000`
2. Di bagian **B1 sampai B8** isi nama negara + skor sesuai Live TikTok:
   - Contoh: `B1: Czech 3 : 2 Portugal`
   - Contoh: `B2: Chile 1 : 4 France`
   - Contoh: `B3: England 5 : 0 Wales`
   - Isi sampai `B8`
3. Di bagian **Top Goals G1-G16** isi juga `Negara | Pemain | Jumlah Gol` sesuai live:
   - Contoh: `G1: Czech | Koller | 3`
   - Contoh: `G2: France | Henry | 2`
4. Data otomatis tersimpan, aman kalau refresh.

### STEP 4 - Generate File (.p2s atau .pnach)

Scroll ke panel paling bawah yang judulnya **`TIKTOK SAVE SYNC — .p2s / .pnach GENERATOR`**

1. Klik tombol **`📁 UPLOAD TEMPLATE.P2S`** -> pilih file `template-schedule.p2s` yang kamu buat di STEP 2. Kalau berhasil, tulisan akan jadi `✓ Template loaded`.
2. Klik **`⬇ GENERATE .P2S (PATCHED)`** -> akan download file `WE10_TikTok_Patched.p2s` (ukuran 11 MB).

> **Cek file benar:** File yang ter-download harus `*.p2s` dan ukuran **11 MB**. Kalau yang ke-download malah `*.pnach` ukuran 2 KB atau `*.bin` 8 KB berarti kamu belum upload template.

**Alternatif tanpa template:**
Kalau tidak mau repot buat template, klik **`⬇ GENERATE .PNACH (9337F97)`** -> akan download `9337F97.pnach`. Cara pakainya beda (lihat di bawah).

### STEP 5 - Load di PCSX2

Pilih salah satu cara:

#### Cara A — Pakai .p2s (PALING GAMPANG, Recommended)

```
Buka PCSX2 > System > Load State > Pilih file WE10_TikTok_Patched.p2s
```
Langsung masuk ke **Schedule Table** dan skor sudah **100% sama** dengan Live TikTok. Top Goals nama pemain juga ikut.

> Tidak perlu `Enable Cheats`.

#### Cara B — Pakai .pnach (Alternatif)

```
1. Copy file 9337F97.pnach ke folder:
   Documents\PCSX2\cheats\  ATAU  PCSX2\cheats\

2. Di PCSX2: Settings > Enable Cheats = ON
3. PCSX2 > System > Reload Cheats
4. Restart game / Reboot PCSX2
5. Masuk lagi ke Konami Cup, skor akan otomatis sinkron
```

> Nama file harus persis `9337F97.pnach` (ini CRC dari `SLPM-66374`). Kalau salah nama, cheats tidak akan kebaca.

### STEP 6 - Verifikasi Berhasil 100%

- Bandingkan skor di layar PCSX2 dengan Live TikTok, harus identik byte-per-byte.
- Coba tekan `Exit > Konami Cup > Random` tanpa load ulang, hasilnya akan **tetap sama** selama file patch masih aktif.
- Kalau di Live TikTok skornya di-reset (bikin cup baru), kamu tinggal **ganti skor B1-B8 di web -> GENERATE .P2S baru -> Load State lagi**.

---

## 🔄 Cara Update Skor Kalau Live Ganti

Live TikTok sering reset cup / ganti skor. Caranya:

1. Ganti isi `B1-B8` & `G1-G16` di web sesuai live terbaru
2. Klik `GENERATE .P2S (PATCHED)` lagi (tidak perlu upload template lagi kalau sudah pernah)
3. Di PCSX2 `Load State` file yang baru

Selesai. Tidak perlu buat template baru.

---

## ⚠️ Troubleshooting (Masalah Umum)

| Masalah | Penyebab & Solusi |
|---------|-------------------|
| **Klik GENERATE .P2S malah download .pnach** | Kamu belum upload `template-schedule.p2s` 11 MB. Upload dulu baru generate. |
| **File .p2s dibuka jadi tulisan aneh `þ€` di Notepad** | NORMAL. `.p2s` itu file ZIP binary, jangan dibuka pakai Notepad. Load lewat `PCSX2 > Load State` saja. |
| **Cheats tidak aktif padahal sudah copy .pnach** | 1. Cek `Enable Cheats = ON` 2. Nama file harus `9337F97.pnach` 3. Klik `Reload Cheats` 4. Lihat `PCSX2 > Show Console` harus ada `Cheats loaded: 1` |
| **Top Goals nama tidak ikut, cuma angka** | Kamu cuma isi angka gol. Harus isi lengkap `Negara | Pemain | Gol` di `G1-G16`. Patch ada di `00401900`. |
| **Skor beda 1 gol di leg 2** | Pastikan `Home & Away = Yes`. Leg 2 memang dikali 0.9 di engine `0028005c`. |
| **Skor Next Bagan / Round 2 beda** | Live TikTok sudah reset cup. Kamu harus generate file baru sesuai skor live terbaru. Atau `matchIdx 00400004` belum ke-reset, coba `Load State` ulang. |
| **Template .p2s tidak kebaca** | Pastikan template dibuat di posisi `Schedule Table Round 1` (sebelum match dimulai), bukan di dalam match. Ukuran harus 11 MB, bukan 8 KB. |

---

## 📁 Struktur File Penting

```
winningeleven-main/
├── index.html                  # Halaman utama web
├── vite.config.js              # Config dev server (host 0.0.0.0 + allowedHosts untuk preview/LAN)
├── src/js/main.js              # Logic utama web + generator .p2s/.pnach
├── src/js/services/            # predictor, baganRng, bulkRunner, p2sZstdPatcher, similarity, dll
├── src/js/ui/                  # uiRenderer, navigation, autocomplete
├── tests/                      # logic.test.mjs | konami_pairing_test.mjs | smoke.test.mjs (jsdom)
├── forensic-fixtures/          # Contoh save state .p2s untuk pengujian patch
├── api/tiktok_live.json        # File JSON skor live (bisa diedit manual tiap 30 detik)
├── api/chat.js                 # Serverless endpoint AI Assistant (butuh NVIDIA_API_KEY)
├── cheats/SLPM_663.74_TikTok100.pnach  # Template pnach deterministik (hook 00400000)
├── README_TIKTOK_SYNC.md       # Panduan detail versi teknis (Ghidra)
├── TikTok_Sync_100_Percent_README.md   # Panduan deterministik 100%
└── package.json                # Config npm
```

**Memory Hook (untuk yang paham Ghidra):**
- `TikTokHook: 00400000 - 00401FFF (8192 bytes, rwx)`
- `00401000 = goals[48][2] uint8` (skor 24 tim, 48 leg)
- `00401800 = topScorer[24] uint8` (top scorer 24 pemain karena 1/24)
- Hook `0026C910: j 00400000` dan `0028005C: clamp 99 bypass` -> `.p2s` patch di `eeMemory.bin` offset `00401000`

---

## ❓ FAQ

**Q: Apakah bisa 100% mirip live TikTok?**
A: **YA, 100%** kalau pakai **forced table hook** (`FUN_0026c910` + `FUN_0028005c`), bukan fixed seed. Fixed seed cuma 95-99% karena masih ada kalkulasi `Difficulty/Fatigue`.

**Q: Harus pakai .p2s atau .pnach?**
A: Pakai **.p2s paling gampang** (1 klik Load State, tidak perlu Enable Cheats). Pakai **.pnach** kalau kamu tidak mau repot buat template.

**Q: Number of Players harus 1/24?**
A: Ya. Kalau `11/24` nanti array top scorer jadi 264 entry, patch hanya support 24 entry jadi nama tidak sinkron.

**Q: Bisa via HP?**
A: Web bisa dibuka di HP, tapi untuk Load State tetap butuh PCSX2 di PC/Laptop.

**Q: Web error / offline?**
A: Cek panel `AI Assistant` di bawah, ada indikator `OFFLINE` kalau koneksi putus. Refresh browser atau cek `localStorage`.

---

## 🧪 Testing

```bash
npm test              # semua suite: logic + p2s pairing + UI smoke (jsdom)
npm run test:logic    # engine murni (predictor, bagan, similarity, import parser, pnach)
npm run test:p2s      # patch .p2s / Konami Cup pairing (pakai forensic-fixtures)
npm run test:ui       # smoke test UI: render B1-B8, G1-G16, PREDICT, bagan, dll (jsdom)
```

Suite memverifikasi:
- Tabel `SKOR & PEMENANG PER MATCH` dan `GLOBAL TOP GOALS` benar-benar muncul setelah **PREDICT**.
- Tabel **Schedule Round 1 (B1-B8)** + **Bagan Knockout R1 → R2 → Semi → Final** muncul & deterministik.
- Alokasi gol **tepat** sebanyak skor (tidak pernah melebihi), GK terfilter, hanya pemain dari 2 tim yang main.
- Validasi `.p2s` end-to-end: output ZIP valid (`PK`), goals/top/pairing terbaca ulang dengan benar.

---

## 🛠️ Catatan Audit & Perbaikan

Audit menyeluruh terhadap seluruh kode (`src/js/**`, `index.html`, `api/`) menemukan dan
memperbaiki bug berikut:

### Bug kritikal
| # | Bug | Dampak | Perbaikan |
|---|-----|--------|-----------|
| 1 | `UIRenderer.renderPredictionDashboard()` **tidak pernah dipanggil** di handler PREDICT | Tabel skor per match & **GLOBAL TOP GOALS tidak pernah muncul** | Dashboard dirender sebelum kotak 200x |
| 2 | `renderBagan()` hanya dipanggil kalau ada `?tiktok_seed=` di URL | **Tabel bagan kosong** walau B1-B8 terisi | Auto-render saat ada data; re-render setiap grid berubah |
| 3 | `BaganRngService.generateBracket()` cuma membuat 4 pasang quarter-final dari 8 tim unik | Bagan tidak utuh (tidak ada R2/Semi/Final) | Dibuat `generateBracketFromMatches()`: R1(8) → R2(4) → Semi(2) → Final(1) + juara |
| 4 | Panel hasil tidak punya CSS (`.results-panel/.results-header/.results-body/.section-title`) | Panel & judul **TOP GOALS** tampil tanpa wadah → terlihat hilang | Ditambahkan style lengkap |
| 5 | `index.html` memakai `.modal-content` tapi CSS hanya punya `.modal-box` | Modal MEMORY DATABASE / KONFIRMASI tanpa latar & border | Kedua kelas kini berbagi style + `.modal-body`, `.close-modal` |

### Bug fungsional
| # | Bug | Perbaikan |
|---|-----|-----------|
| 6 | Similarity hanya menilai **7** top goals, padahal skema G1-**G16** | Loop jadi 16; baris target yang tidak ada dihitung 0 |
| 7 | Import JSON menolak `topGoals` selain tepat 7 → **export → import selalu gagal** | Terima 7–16, otomatis dipadatkan ke 16 |
| 8 | Worker similarity di-cache global & `onmessage` ditimpa | Pencarian ke-2 menimpa hasil ke-1; worker rusak = selamanya gagal. Sekarang worker baru per pencarian + timeout 15s + fallback main-thread |
| 9 | `StateManager.save()` tidak menyimpan `homeQuery` | Hasil **APPLY SCORES / APPLY TOP GOALS** hilang saat refresh | Ditambah `persistState(isEditor)` |
| 10 | Baris prediksi tanpa `prediction` masuk cabang sukses | `pred.probs` undefined → seluruh render gagal | Guard `p.error \|\| !p.prediction` |
| 11 | `backtestEngine` mengisi ulang seluruh game tiap iterasi (O(n²)) | Baseline "most common" bias ke game awal | Training set inkremental |
| 12 | 3 konfigurasi ablation identik (`{}`) | Kolom delta selalu 0, ablation tidak mengukur apa-apa | Dibuat bertingkat & berbeda |
| 13 | Label bukti mencampur *posBoost* dengan *histBoost* | Tertulis `histBoost 116.7% (0 gol/0 app)` | Keduanya dipisah |
| 14 | `getHistoricalScorerMap()` dipanggil ulang per iterasi bulk (1600×) | Boros O(1600 × game × 16) | Di-memoize berdasar fingerprint database |
| 15 | `resolveTeam()` memberi "kode" ke negara tak dikenal | Teks bebas keluar sebagai kode tim | Kode dikosongkan bila bukan 57-fix |
| 16 | `Toast.show()` cuma `console.log` | User tidak pernah lihat pesan error/sukses | Toast UI sungguhan (info/success/error) |
| 17 | Chat input di-disable total saat offline | Tidak bisa mengetik pesan | Input tetap aktif, hanya tombol kirim yang off |
| 18 | `hljs` diakses tanpa cek saat CDN gagal | Render markdown ikut error | Dijaga `typeof hljs !== "undefined"` |
| 19 | `parseZipEntries` tidak menangani *data descriptor* (flag bit 3) | ZIP PCSX2 tertentu gagal diparsing | Rekonsiliasi dengan Central Directory |
| 20 | `\u26A1` tertulis literal di `index.html` | Label opsi model tampil `\u26A1 Random / Fallback` | Diganti karakter ⚡ |
| 21 | Impor chat JSON tanpa validasi | Sesi rusak bisa menggantikan data | Validasi & sanitasi struktur sesi |
| 22 | `githubAgentUI` mengisi `innerHTML` tanpa escape | Potensi XSS dari payload GitHub | Semua output di-escape |
| 23 | RESET FORM langsung menghapus tanpa konfirmasi | Data hilang tak sengaja | Pakai dialog konfirmasi + bersihkan panel turunan |

### Catatan minor / tidak diubah
- `GHA` punya dua pemain bernama **Kingston** (SMF 52 & CMF 44) di `we10FullRoster.js`.
  Tidak mengganggu alokasi gol, tapi hanya satu yang muncul di autocomplete.
  Tidak diubah karena menggantinya berarti menebak nama pemain asli.
- `api/chat.js` adalah serverless function (Vercel). Saat jalan lewat `vite dev`,
  endpoint `/api/chat` tidak tersedia — chat akan menampilkan error di tab **LOGS**.
  Deploy ke Vercel (atau platform sejenis) untuk mengaktifkannya.

---

## 💡 Tips Agar 100% Sinkron

1. Selalu samakan `General Settings` sebelum `Save State` template
2. Isi `B1-B8` dan `G1-G16` **lengkap** jangan setengah-setengah
3. Generate file baru **setiap kali live TikTok ganti skor**
4. Simpan `template-schedule.p2s` baik-baik, jangan dihapus (cukup bikin 1x)

---

Dibuat untuk komunitas WE10 Indonesia | `WE10 Memory Research System` | `SLPM-66374 (9337F97)`
