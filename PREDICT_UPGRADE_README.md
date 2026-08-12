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
