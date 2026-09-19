# Predictor Upgrade Documentation

This repository has been updated to use a new hybrid prediction model for the WE10 Memory Analyzer.

## Rationale
The previous predictor acted like a lookup dataset. If a fixture existed in memory, it took the memory as absolute truth with 100% confidence. If it did not exist, it used a basic fallback.

The new model treats the memory database as a training dataset rather than just a lookup table. The new flow is:

1. Base rating (from teamRatings)
2. Historical Team Form (overall goals for/against)
3. H2H Ensemble (all previous meetings, not just the "best" match)
4. Similar Contexts
5. Poisson Distribution generation

This results in a predicted score, win/draw/loss probabilities, top score distributions, and a dynamically calculated confidence.

## Files changed:
1. `src/js/services/predictor.js` - Completely rewritten to use the hybrid model.
2. `src/js/main.js` - UI handler for the `btnPredict` button was replaced to parse and render the new prediction object correctly.

---

## Update v7 (2026-09-19) — Player-Level Scoring Model

Model tim (rating, form tim, H2H, konteks) sekarang **hanya** menentukan
kualitas/jumlah chance. Penentuan **siapa yang mencetak gol** dipindah ke model
level-pemain di `src/js/services/playerScoring.js`:

```
kekuatan tim → jumlah chance → kualitas chance → pilih pemain penembak
             → shot probability (atribut pemain vs defense lawan) → GOAL / MISS
```

Detail lengkap (provenance data, cara jalanin test & backtest, apa yang masih
estimated): lihat **[`PLAYER_MODEL_README.md`](PLAYER_MODEL_README.md)**.

Yang DIHAPUS di v7:
- `STAR_OVERRIDES` (Ronaldo=94, Henry=90, dst) dan semua daftar bintang manual.
- Fallback nama dummy (`BRA_FW9`, `TEAM_CF`, ...).
- `weight` posisi (CF=84, OMF=66, CB=10) sebagai dasar undian pencetak gol.
- Alokasi nama pemain berdasarkan skor yang sudah ditentukan lebih dulu.

Yang DITAMBAH:
- `src/js/data/playerAttributes.js` — 12 atribut per pemain (derived/estimated + slot override ROM).
- `src/js/services/playerScoring.js` — match engine berbasis event.
- `src/js/services/scoringDataset.js` — kalibrasi + form pemain dari data historis (shrinkage).
- `src/js/services/backtestEngine.js` — walk-forward backtest + perbandingan model lama vs baru.
- `tests/playerScoring.test.mjs` — 10 acceptance test model level-pemain.
