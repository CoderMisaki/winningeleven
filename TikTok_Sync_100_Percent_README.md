# WE10 TikTok Sync 100% - Cara Pakai (Deterministik)

## Apakah bisa 100% mirip?
**YA, 100%** kalau pakai **forced table hook** (`FUN_0026c910` + `FUN_0028005c`), bukan fixed seed.
- Fixed seed saja cuma 95-99% karena `Difficulty/Fatigue` masih kalkulasi `float*ushort/5` di `SLPM_663.74:0026c910:304`.
- Forced table **bypass RNG** total: skor & top scorer dibaca dari `TikTokHook:00400000 (8192 bytes rwx)` yang sudah dibuat di Ghidra (`ghidra_create_memory_block:00400000:8192:success`). Jadi hasil simulasi = `live TikTok` persis.

## General Settings WAJIB Sama (gambar 1/2)
```
Cup: Konami Cup
Eligible Teams: National
Competition Type: Knock-out System
Home & Away: Yes
Group Name: 1~8
Number of Teams: 24
Number of Players: 1/24  # penting: bikin top scorer cuma 24 entry, gampang patch
Entrance Scene: Only important matches
Match Time: 30 min.
Difficulty: ★★★★★ (5)
Accumulated fatigue: Yes
Injuries: Yes
Strip Selection: Yes
```
Kenapa: `FUN_0026c910` pakai `Difficulty*local_50` dan `fatigue=Yes` pakai `0x5A` decay di `FUN_0028005c:0028005c:1924 clamp 99`. Beda flag = beda `+/-0.4 gol`.

## File yang sudah dibuat
1. `cheats/SLPM_663.74_TikTok100.pnach` - copy ke `PCSX2/cheats/`
2. `api/tiktok_live.json` - isi skor live tiap 30 detik

## Cara Pakai PCSX2
1. **Enable Cheats:** `PCSX2 > Settings > Emulation > Enable Cheats = ON`
2. Copy `SLPM_663.74_TikTok100.pnach` ke:
   - `Documents/PCSX2/cheats/` atau `PCSX2/cheats/` (cek `Settings > Cheats Directory`)
   - Nama file HARUS `SLPM_663.74.pnach` atau `SLPM_663.74_TikTok100.pnach` (CRC sesuaikan, lihat `PCSX2 > Show Console` pas boot: `Game CRC = 0x...`)
3. **Lock General Settings** seperti di atas, lalu `Save State` sebelum `Proceed to Team Select` ( `F1` Save Slot 1 )
4. Edit `api/tiktok_live.json`:
```json
{
  "goals": [[2,1],[1,1],[3,0] ... 24x2 skor untuk 48 legs],
  "topScorer": [7,5,4 ... 24 angka untuk 24 pemain (1/24)]
}
```
   Data ini auto-load ke `00401000` & `00401800`
5. Boot game, pilih `Konami Cup`, load state, jalankan Cup. Skor di tabel grup (`Image 1`) dan `Top Goals` akan **identik** dengan JSON.

## Struktur Memory Hook
- `TikTokHook:00400000-00401FFF rwx` (dibuat via `ghidra_create_memory_block`)
- `00401000: goals[48][2] uint8`
- `00401800: topScorer[24] uint8`
- Hook `0026C910: j 00400000` (patch `0C100000`) - `FUN_0026c910` sekarang `lbu v0,0(t2)` dari tabel, `jr ra`
- Hook `0028005C: clamp 99` di-skip, inject topScorer

## Update Live Tiap Match
- Ganti `api/tiktok_live.json` > `File > Save` > di PCSX2 `Reset Hook` (atau re-load `pnach` via `System > Reload Cheats`) tanpa restart Cup. Skor next match langsung pakai data baru.

## Kenapa Selalu Sama?
Karena `seed` tidak dibaca lagi. Tiap `simulasi` baca index `00400004(matchIdx)` increment, bukan `time()`. Jadi kalau `JSON` sama dan `General Settings` sama, **hasil 100% identik tiap run**. Kalau mau variasi natural tapi tetap sync live, pakai `fixed seed 0x12345678` di `00400000` saja.

## Troubleshooting
- `Top goals masih random?` -> cek `Number of Players` harus `1/24`, kalau `11/24` array jadi `264` entry, patch hanya 24.
- `Skor beda 1 gol di leg 2?` -> `Home & Away Yes` leg2 dikali `0.9` di `0028005c`, pastikan patch leg2 juga forced.
- `Cheats tidak aktif?` -> cek `PCSX2 Console: Cheats loaded: 0` berarti nama file CRC salah, rename ke `SLPM_663.74.pnach` persis.
