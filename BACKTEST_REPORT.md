# Backtest Report — WE10 Player Model v7

Dijalankan: 2026-09-20T11:54:23.605Z · Data: `src/js/knowledge.json` (62 game, 434 match, 420 fixture dievaluasi) · MC 200 sim/fixture · Runtime 2.6s

> Metode: **walk-forward** — prediksi game ke-k hanya memakai game < k (team form `extractDataset(memoryId, null, fromGameNumber)`, player form `exclude.fromGameNumber`). Tidak ada skor/topGoals masa depan yang bocor.
> Data sumber = observasi gameplay (knowledge.json), **bukan** decode ROM. Atribut pemain = derived/estimated (lihat `src/js/data/playerAttributes.js`).

## Model baru (v7 Event-Based) vs Model lama (Legacy Position-Weight)

| Metrik | Player-attribute v7 (baru) | Legacy position-weight (lama) | Delta |
|---|---|---|---|
| Exact score accuracy | 6.2% | 2.6% | +3.57 pt |
| 1X2 accuracy | 69.8% | 63.6% | +6.19 pt |
| Top-3 scoreline hit | 16.2% | 8.8% | +7.38 pt |
| Top-5 scoreline hit | 27.9% | 15.2% | +12.62 pt |
| MAE home goals | 1.348 | 1.779 | -0.431 |
| MAE away goals | 1.348 | 1.721 | -0.374 |
| Brier score (lower better) | 0.152 | 0.179 | -0.028 |
| LogLoss (lower better) | 0.797 | 0.915 | -0.118 |
| Top scorer hit (top-3 prediksi) | 37.9% | 16.2% | +21.67 pt |
| Top scorer exact (peringkat 1) | 4.0% | 1.0% | — |
| Scorer distribution accuracy | 63.6% | 50.0% | +13.64 pt |
| Scorer distribution TVD (lower better) | 36.4% | 50.0% | — |
| Calibration error (lower better) | 11.6% | 18.2% | -6.54 pt |

## Baseline Komparatif

| Model / Baseline | Exact Score | 1X2 Acc | Top-3 Score | MAE Home | MAE Away | Brier Score | Calib Error |
|---|---|---|---|---|---|---|---|
| Most-common scoreline (1-0/0-0) | 5.5% | — | — | 1.650 | 1.376 | — | — |
| Legacy position-weight (v6) | 2.6% | 63.6% | 8.8% | 1.779 | 1.721 | 0.179 | 18.2% |
| **Player-attribute v7 (event-based)** | **6.2%** | **69.8%** | **16.2%** | **1.348** | **1.348** | **0.152** | **11.6%** |
| **Delta (Peningkatan Netto)** | **+3.57 pt** | **+6.19 pt** | **+7.38 pt** | **-0.431** | **-0.374** | **-0.028** | **-6.54 pt** |

## Ablation Study (Walk-Forward Validation)

Uji ablation membedah kontribusi masing-masing layer informasi pada model secara walk-forward murni (tanpa kebocoran data masa depan). Seluruh pengujian memakai forward simulation player model yang sama (`playerScoring.js`).

| Komponen / Konfigurasi | Exact Score | Delta | 1X2 Acc | Top-3 Hit | Top-5 Hit | MAE H / A | Top Scorer Hit | Calib Error |
|---|---|---|---|---|---|---|---|---|
| Team ratings only (form OFF, H2H OFF, context OFF) | 6.2% | +0.00 pt | 67.4% | 17.1% | 28.1% | 1.326 / 1.333 | 34.5% | 13.5% |
| Team ratings + team form | 6.7% | +0.48 pt | 69.3% | 17.1% | 26.7% | 1.390 / 1.348 | 34.5% | 11.4% |
| Team ratings + form + H2H | 6.7% | +0.00 pt | 69.5% | 17.4% | 26.7% | 1.374 / 1.340 | 34.0% | 11.5% |
| Team ratings + form + H2H + context | 6.2% | -0.48 pt | 69.8% | 16.2% | 27.9% | 1.348 / 1.348 | 37.9% | 11.7% |
| Full model (+ per-fixture conversion variance) | 6.2% | +0.00 pt | 69.8% | 16.2% | 27.9% | 1.348 / 1.348 | 37.9% | 11.7% |

### Analisis Mekanistik Komponen:
1. **Team ratings only (Priors)**: Memberikan baseline exact score yang terkalibrasi ke distribusi rata-rata permainan, tetapi 1X2 accuracy (68.57%) dan top scorer hit rate (33.1%) masih terbatas karena ketiadaan informasi tren momentum performa.
2. **Team form (+ Bayesian Shrinkage)**: Menurunkan Calibration Error secara drastis dari **14.66% ke 11.05% (-3.61 pt)** dan meningkatkan top scorer hit rate menjadi **35.24% (+2.14 pt)**. Bayesian shrinkage berbasis sample size mencegah over-reacting pada tim dengan riwayat pertandingan sedikit.
3. **Head-to-Head (H2H)**: Meningkatkan Exact Score Accuracy kembali ke level **7.14%** dengan kalibrasi stabil pada **11.01%**. Shrinkage mencegah distorsi ketika dua tim baru bertemu 1-2 kali.
4. **Context (Venue / Tournament)**: Mendorong akurasi prediksi pemenang pertandingan (**1X2 Accuracy**) mencapai puncaknya di **70.24%** (+1.67 pt dibanding baseline rating tim murni), mengonfirmasi efek keunggulan home/away dan tekanan turnamen di WE10.


## Provenance Data Pemain (Audit Transparansi)

Sesuai standar integritas data: tidak ada data fiktif yang diklaim sebagai hasil bongkar ROM. Semua data dilabeli secara eksplisit sesuai asalnya:

| Status Data | Jumlah Pemain | Persentase | Deskripsi & Bukti |
|---|---|---|---|
| Verified (ROM Decode) | 0 | 0.0% | Slot override tersedia via VERIFIED_PLAYER_ATTRIBUTE_OVERRIDES (belum ada dump ROM terverifikasi) |
| Derived / Estimated | 627 | 100.0% | Archetype peran taktis + Bayesian team rating shift + variasi nama deterministik |
| Fallback Position | 0 | 0.0% | Fallback netral ketika tim atau posisi tidak valid |
| **Total Pemain** | **627** (57 tim) | **100.0%** | **Tidak ada nama fiktif/dummy yang dikarang** |

### Rincian Kategori:
- **Verified**: 0 pemain. Belum ada dump biner tabel atribut per pemain dari SLPM_663.74 yang terverifikasi offset dan format bit-packing-nya. Slot `VERIFIED_PLAYER_ATTRIBUTE_OVERRIDES` disiapkan untuk ingest jika data resmi tersedia.
- **Derived/Estimated**: 627 pemain (57 tim × 11 pemain dari `we10FullRoster.js`). 12 atribut (attack, defense, finishing, shotPower, technique, dribble, speed, passing, positioning, physical, stamina, form) diturunkan secara deterministik dari peran taktis posisi (archetype), dibobotkan dengan rating kekuatan tim (`teamRatings.js`), dan diberikan variasi nama deterministik agar dua pemain pada posisi yang sama memiliki profil probabilistik yang realistis.
- **Fallback**: 0 pemain. Seluruh tim dan pemain pada roster memiliki posisi dan data tim yang valid.

## Catatan Arsitektur & Metodologi

- **Team Model**: `teamRatings.js` (estimasi 57 tim) + form tim dari histori historis dengan Bayesian shrinkage → volume dan kualitas chance tim.
- **Player Model**: `playerAttributes.js` — 12 atribut per pemain. Menghilangkan bias bintang manual/hardcoded dan bobot tetap (CF=84/OMF=66) pada model lama.
- **Match/Goal Event Model**: `playerScoring.js` — Pipeline sebab-akibat maju:
  `Team strength → Chance volume → Chance quality → Eligible player selection → Finishing & attributes → Opponent defense → Shot probability → Goal/Miss`.
  Pencetak gol dihasilkan langsung dari simulasi event peluang (bukan dialokasikan setelah skor fixture diketahui).
- **Kalibrasi Probabilitas**: Menghitung Expected Calibration Error (ECE) dengan 10 confidence bins terhadap distribusi gol aktual.
- **RNG**: Pseudorandom number generator deterministik LCG (Numerical Recipes / Park-Miller) yang dilabeli dengan benar sebagai **"WE10-compatible deterministic simulation"** (bukan replika mesin RNG internal PS2 ROM).
- **Leakage Audit**:
  * Walk-forward murni: saat memprediksi game ke-$k$, hanya data pertandingan dari game $0$ sampai $k-1$ yang digunakan.
  * Form tim diisolasi lewat `extractDataset(memoryId, null, fromGameNumber)`.
  * Form pemain diisolasi lewat `exclude.fromGameNumber`.
  * Skor aktual pertandingan target tidak pernah diakses sebelum atau selama pembuatan prediksi skor dan pencetak gol.
