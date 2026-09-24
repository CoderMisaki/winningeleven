# Player-Level Scoring Model (v7) — Dokumentasi & Status Data

> Audit 2026-09-19. Semua klaim di dokumen ini sudah dipisah tegas antara
> **VERIFIED** (ada bukti), **DERIVED** (dihitung dengan rumus terdokumentasi),
> dan **ESTIMATED** (placeholder yang belum terverifikasi). Tidak ada klaim
> "decode ROM" kecuali memang ada buktinya.

---

## 1. Kenapa model lama diganti

Model lama (`weight` + `STAR_OVERRIDES`) bukan model pemain:

| Masalah lama | Contoh | Status |
|---|---|---|
| `weight` hanya duplikat posisi | semua CF = 84, semua OMF = 66, semua CB = 10 | **dihapus** dari `we10FullRoster.js` |
| Daftar bintang manual | `STAR_OVERRIDES`: Ronaldo 94, Henry 90, ... | **dihapus** |
| Pemain dummy | fallback `BRA_FW9`, `TEAM_CF` | **dihapus** (tanpa roster → tidak ada scorer) |
| Skor dulu, nama belakangan | skor diundi → nama dibagikan proporsional weight | **diganti** dengan event-level |

Akibatnya dulu: pemain yang sama selalu menang undian, striker cadangan punya
angka identik dengan striker utama, dan tidak ada pengaruh defense lawan.

---

## 2. Arsitektur baru (4 model terpisah)

```
TEAM MODEL        src/js/data/teamRatings.js (estimasi) + form tim dari histori
                  → menentukan JUMLAH & KUALITAS CHANCE
PLAYER MODEL      src/js/data/playerAttributes.js (12 atribut per pemain, derived)
                  → menentukan SIAPA yang berpeluang mencetak gol
MATCH MODEL       src/js/services/playerScoring.js
                  chance → kualitas chance → pemilihan pemain → shot probability
GOAL EVENT MODEL  setiap gol = event { tim, pemain, kualitas, pGoal, scored }
                  → skor dan pencetak gol lahir dari event yang sama
```

Jalur satu pertandingan:

1. `buildMatchContext()` — profil kedua tim (attack/defense index, mid, form, kalibrasi skala konversi dari dataset).
2. `generateChances()` — jumlah chance per tim (4–20) dari attack index lawan + dominasi midfield.
3. `drawChanceQuality()` — kualitas tiap chance (0..1).
4. `selectAttackingPlayer()` — roulette deterministik dengan bobot
   `role posisi × (0.45 + 0.55 × involvement/100) × stamina × form`.
5. `shotProbability()` — `0.38 + 0.0042·(finishing−65) + 0.0028·(attack−65) + 0.0028·(positioning−65) + 0.0024·(technique−65) + 0.0019·(power−70) + 0.42·(quality−0.5) − 0.005·(defense_lawan−65) + 0.20·(form−1)`, dikali skala kalibrasi dataset.
6. `rng.nextFloat() < p` → goal/miss, dicatat sebagai event.

Urutan role posisi (natural): `CF 1.00 > ST 0.95 > WG/WF 0.90 > OMF 0.60 > SMF 0.38 > CMF 0.32 > DMF 0.20 > WB/SB 0.13 > CB 0.10 > SW 0.08 > GK 0.00`.
GK **dikeluarkan dari pool penembak** (`selectAttackingPlayer` filter posisi) — kalau tidak, sisa probabilitas kecil bisa membuat GK "menembak" sesekali dan gol itu hilang dari daftar scorer (GK difilter UI) sehingga skor dan daftar pencetak gol tidak konsisten.
Pemain dengan posisi sama tetap berbeda karena atribut, stamina, dan form-nya berbeda.

---

## 3. Status data (jujur)

### VERIFIED
- `name` + `pos` 57 tim × 11 pemain — rekaman manual dari layar game (`we10FullRoster.js`). **Bukan** decode struktur ROM.
- Bukti Ghidra yang valid dan tidak dihapus (`ghidraTeamAbility.js`):
  - `FUN_0016e8d8` = ceiling-div helper (`addiu/daddu/lw/div/mflo/mult`) — **bukan RNG**.
  - `FUN_00216ef0` = table lookup (`slti 0x75`, load `0x3C2100/0x3C2104 + idx*8`).
  - `003bd800` = pointer table; `003be000` = string tim; `003bd400` = dump yang **belum terpetakan** ke 57 tim.
  - 0 hits untuk 7 konstanta RNG standar di `SLPM_663.74`.

### DERIVED
- 12 atribut pemain: `attack, defense, finishing, shotPower, technique, dribble, speed, passing, positioning, physical, stamina, form`
  ```
  value = clamp(archetype[pos][attr]
              + sensitivity[attr] × teamShift[attr]      // teamRatings (ESTIMATED)
              + latent × LATENT_WEIGHT[attr]             // kualitas umum (ESTIMATED)
              + noise[attr] × (hash01(...)−0.5) × 2,     // variasi antar atribut (ESTIMATED)
              1, 99)
  ```
- Kalibrasi skala konversi (`getCalibration`) dari statistik dataset (gol rata-rata per tim, rasio home) dengan shrinkage — **bukan** tuning manual per pemain.
- Form level-pemain dengan shrinkage Bayesian: `(observedGoals + K·priorShare)/(teamGoals + K)`, `K = 6` gol tim, clamp `0.72 – 1.45`, netral bila data < 2 game / < 4 gol tim.

### BATASAN MODEL (jujur)
- **Fatigue/akumulasi menit tidak dimodelkan** — kebugaran diwakili atribut `stamina` statis per pemain, bukan menit bermain kumulatif.
- Tidak ada kartu, cedera, taktik formasi, atau perubahan pemain; line-up = 11 pemain roster.
- Kalibrasi skala konversi bersifat global (satu skala + rasio home), belum per-tim/per-liga.

### ESTIMATED (belum terverifikasi)
- Seluruh **nilai absolut** atribut pemain. Angka 0–99 di sini adalah model, bukan hasil baca ROM.
- Rating tim di `teamRatings.js` (rekap eksternal, bukan bukti Ghidra).
- Variasi individual antar pemain (latent + noise deterministik) — placeholder untuk kualitas individu yang belum diketahui; **tidak** memihak pemain terkenal tertentu (Ronaldo tidak diberi boost khusus).
- Prior kalibrasi `DATASET_PRIOR`: 427 match `knowledge.json` (observasi gameplay) → 2.43 gol/tim, home share 0.512.

### TIDAK DIKLAIM
- Model ini **bukan** replika matematis resmi RNG WE10.
- Atribut pemain **bukan** hasil decode `SLPM_663.74` / `eeMemory.bin`.
- Tidak ada klaim "100% identik dengan WE10" — belum ada bukti reverse-engineering untuk itu.

### Jalur data ROM terverifikasi
Bila suatu saat ada atribut asli yang bisa dipetakan dari ROM, daftarkan lewat:

```js
import { registerVerifiedPlayerAttributes, getVerifiedOverrideCount } from "./src/js/data/playerAttributes.js";
registerVerifiedPlayerAttributes({
  BRA: { ronaldo: { finishing: 88, shotPower: 90, _source: "SLPM_663.74 offset 0x...: tabel XXX" } }
});
```

Override akan menandai pemain tersebut `attributesSource: "verified"` dan menimpa hasil derivasi.
Selama registry kosong, semua pemain berstatus `derived-estimated`.

---

## 4. Anti-leakage (walk-forward)

- `extractDataset(memoryId, null, fromGameNumber)` — game ≥ N dibuang dari fitur tim.
- `getObservedStats({ memoryId, fromGameNumber })` — kontribusi game ≥ N dikurangi O(1) dari index (tim & pemain).
- Backtest memprediksi game ke-k **hanya** dengan game < k; `leakageAudit` selalu diisi `PASS: walk-forward ...`.
- Uji regresi: `tests/playerScoring.test.mjs` — mengubah skor game masa depan tidak boleh mengubah fitur untuk game sebelumnya.

---

## 5. Cara menjalankan

```bash
npm install
npm test          # logic + playerScoring + konami + smoke (jsdom)
npm run build     # produksi (vite)
npm run backtest  # walk-forward vs model lama, tulis BACKTEST_REPORT.md
```

Parameter backtest:

```bash
node tools/backtest.mjs --sims=400
node tools/backtest.mjs --file=path/ke/memory.json
node tools/backtest.mjs --json
```

---

## 6. Output yang tetap kompatibel dengan UI

`hybridPredict()` tetap mengembalikan field lama: `homeGoals, awayGoals, winner,
confidence, stability, xgHome, xgAway, probs, markets, distribution,
scorelineDistribution, evidence, topScorers, keyIndicators, rngProof, debug`.

Tiap baris `topScorers` sekarang berisi **Player, Team, Goals, Probability,
Position** (plus xG, share, form, finishing) — dan tetap menyediakan alias
`weight`/`totalWeight`/`pickProb` untuk komponen lama, tetapi `weight` di sini
adalah **indeks turunan untuk tampilan**, bukan angka manual dan bukan dasar
tunggal pemilihan pemain.
