# WE10 TikTok Sync — Biar Skor & Top Goals 100% Sama (Simple)

> **Goal:** Skor `Schedule table` `Konami Cup Round 1 Match 1~8` (Image 2) + `Top Goals` di PCSX2 **persis sama** kayak `live TikTok`. Cukup 1 klik `Load State .p2s`.

---

## Step 0 — Jalankan Web (Sekali)

```bash
cd winningeleven-main
npm install
npm run dev
# buka http://localhost:3000
```

Web sudah auto-save ke `localStorage` — isi `B1-B8` tidak hilang kalau refresh.

---

## Step 1 — Samakan General Settings di Game (Wajib Sama)

Di **WE10** `General Settings` `1/2` `Konami Cup`:

```
Cup: Konami Cup
Eligible Teams: National
Competition Type: Knock-out System
Home & Away: Yes
Group Name: 1~8
Number of Teams: 24
Number of Players: 1/24
Entrance Scene: Only important matches
Match Time: 30 min.
Difficulty: ★★★★★ (5)
Accumulated fatigue: Yes
Injuries: Yes
Strip Selection: Yes
```

Kenapa? `FUN_0026c910` hitung `skor = teamRating * factor(Difficulty+fatigue) /5`. Beda setting = beda skor.

---

## Step 2 — Buat Template Sekali (Biar .p2s Valid)

1. Di PCSX2, dengan setting Step 1, pilih **`Konami Cup > Proceed to Team Select > pilih 24 negara > OK`**
2. Sampai di **Schedule table** `Konami Cup Round 1 - Match 1~8` (Image 2, yang ada `Czech 3-2 Portugal` dll)
3. **JANGAN random dulu.** Tekan `F1` (PCSX2 > System > Save State) → file `sstates/SLPM-66374 (9337F97).00.p2s` (±11 MB).
4. Copy file itu jadi `template-schedule.p2s` — ini **template bersih**, cukup bikin **1x**.

> Upload `ARGN SWE (1).p2s` yang kemarin itu posisi `Argentina vs Swedia`, kalau dipakai hasilnya tetap di situ, bukan di Schedule table. Jadi pakai template Schedule table.

---

## Step 3 — Isi Skor Live di Web

1. Buka web `http://localhost:3000`
2. Di **B1-B8** isi `Home` `Skor` `Away` samain **live TikTok**:
   - `B1: Czech   3:2 Portugal`
   - `B2: Chile   1:4 France`
   - `B3: England 5:0 Wales`
   - dst sampai `B8`
3. Di **Top Goals G1-G16** isi `Country | Player | Goals` samain live (contoh `G1: Czech | Koller | 3`)
4. Otomatis ke-save, refresh aman.

---

## Step 4 — Generate File

Di panel **TIKTOK SAVE SYNC — .p2s / .pnach GENERATOR**:

- **Upload template** → `📁 UPLOAD TEMPLATE.P2S` pilih `template-schedule.p2s` (sekali). Status jadi `✓ Template loaded`.
- Klik **`⬇ GENERATE .P2S (PATCHED)`** → download `WE10_TikTok_Patched.p2s` (±11 MB, format ZIP valid).
  - Kalau belum upload template, yang ke-download malah `9337F97.pnach` (bukan .p2s).
- Alternatif tanpa template: klik **`⬇ GENERATE .PNACH (9337F97)`** → download `9337F97.pnach` (copy ke `PCSX2/cheats/`).

**Cek file bener:** `Recent download` harus `*.p2s` **11 MB**, bukan `*.bin 8KB` / `*.pnach 2KB`.

---

## Step 5 — Load di PCSX2

**Cara A — .p2s (paling gampang, tidak perlu Enable Cheats):**
```
PCSX2 > System > Load State > pilih WE10_TikTok_Patched.p2s
```
Langsung di **Schedule table Image 2** skor sudah **100% sama** live. Top goals nama juga ikut.

**Cara B — .pnach:**
```
Copy 9337F97.pnach ke Documents\PCSX2\cheats\9337F97.pnach
PCSX2 > Settings > Enable Cheats ON > Reload Cheats > Reboot
```
Masuk `Konami Cup` lagi, skor auto sama.

---

## Step 6 — Verifikasi 100%

- Bandingkan `PCS` `Czech 3 1/2 - 1 2 Portugal` dengan `live TikTok` — harus identik.
- `Exit > Konami Cup > Random` lagi **tanpa load ulang** hasilnya **tetap sama** selama file `p2s/pnach` masih aktif.
- Kalau **live TikTok reset game** (bikin cup baru, skor B1-B8 ganti) → di web **ganti B1-B8** lagi → `GENERATE .P2S` baru → `Load State` lagi.

---

## Troubleshooting

| Masalah | Solusi |
|---------|--------|
| Download malah `.pnach` pas pencet `.p2s` | Belum upload `template.p2s` ZIP. Upload dulu `template-schedule.p2s` 11 MB. |
| `.p2s` dibuka jadi `þ€` `32k chars` di Notepad | Normal, `.p2s` itu ZIP binary. Jangan buka pakai Notepad. Load via `PCSX2 > Load State`. |
| `Cheats` kosong `Enable Cheats` checked | File harus `9337F97.pnach` (CRC dari `SLPM-66374 9337F97`), bukan `SLPM_663.74.pnach`. `Reload Cheats`. |
| Top goals nama tidak ikut | Isi `G1-G16` `Country | Player | Goals` di web, bukan cuma angka. Patch `00401900 768B` include nama. |
| Next bagan beda | `live` reset → generate baru. Atau `matchIdx 00400004` belum reset → `Load State` lagi. |

---

**Ghidra:** `SLPM_663.74` `TikTokHook 00400000-00401FFF rwx` `FUN_0026c910 j 00400000` `FUN_0028005c clamp 99` `eeMemory.bin 33554432` `team DB 003c0220` — `.p2s` patch di `eeMemory.bin` offset `00401000` valid.

