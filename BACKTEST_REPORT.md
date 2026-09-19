# Backtest Report — WE10 Player Model v7

Dijalankan: 2026-09-19T05:47:47.160Z · Data: `src/js/knowledge.json` (62 game, 434 match, 420 fixture dievaluasi) · MC 200 sim/fixture · Runtime 4.6s

> Metode: **walk-forward** — prediksi game ke-k hanya memakai game < k (team form `extractDataset(memoryId, null, fromGameNumber)`, player form `exclude.fromGameNumber`). Tidak ada skor/topGoals masa depan yang bocor.
> Data sumber = observasi gameplay (knowledge.json), **bukan** decode ROM. Atribut pemain = derived/estimated (lihat `src/js/data/playerAttributes.js`).

## Model baru vs model lama

| Metrik | Player-attribute v7 (baru) | Legacy position-weight (lama) | Delta |
|---|---|---|---|
| Exact score accuracy | 5.7% | 2.6% | +3.10 pt |
| 1X2 accuracy | 69.0% | 63.6% | +5.48 pt |
| Top-3 scoreline hit | 16.2% | 8.8% | +7.38 pt |
| Top-5 scoreline hit | 26.0% | 15.2% | +10.71 pt |
| MAE home goals | 1.488 | 1.779 | -0.290 |
| MAE away goals | 1.498 | 1.724 | -0.226 |
| Brier score (lower better) | 0.151 | 0.179 | -0.029 |
| LogLoss (lower better) | 0.792 | 0.915 | -0.123 |
| Top scorer hit (top-3 prediksi) | 40.0% | 16.2% | +23.81 pt |
| Top scorer exact (peringkat 1) | 3.3% | 1.0% | — |
| Scorer distribution accuracy | 63.7% | 50.0% | +13.73 pt |
| Scorer distribution TVD (lower better) | 36.3% | 50.0% | — |

## Baseline

| Baseline | Exact score | MAE H | MAE A |
|---|---|---|---|
| Most-common scoreline | 5.5% | 1.650 | 1.376 |
| Legacy position-weight | 2.6% | 1.779 | 1.724 |
| **Player-attribute v7** | **5.7%** | **1.488** | **1.498** |

## Catatan metodologi

- **Team Model**: `teamRatings.js` (estimasi 57 tim) + form tim dari histori → jumlah/ kualitas chance.
- **Player Model**: `playerAttributes.js` — 12 atribut per pemain (derived/estimated, slot override untuk data ROM terverifikasi); tidak ada STAR_OVERRIDES, tidak ada nama dummy.
- **Match/Goal Event Model**: `playerScoring.js` — chance → pemilihan pemain (role posisi × atribut × form × stamina) → shot probability vs defense lawan → goal/miss. Skor adalah konsekuensi event, bukan alokasi nama acak.
- **Kalibrasi**: skala konversi dari dataset (shrinkage), bukan tuning manual per pemain.
- **RNG**: LCG deterministik (Numerical Recipes) — implementasi sendiri, **bukan** replika RNG ROM WE10.
- **Yang masih estimated/unverified**: seluruh nilai atribut pemain (derived), rating tim (rekap eksternal), dan kalibrasi skala global. Tidak ada klaim identik 100% dengan WE10 tanpa bukti reverse-engineering.

## Leakage audit

PASS: walk-forward — prediksi game ke-k hanya memakai game < k (team form via extractDataset(memoryId, null, fromGameNumber) dan player form via exclude.fromGameNumber). Game target & game setelahnya tidak pernah dipakai.
