import { teamsDB } from '../data/teams.js';
import { countryAliases } from '../data/countryAliases.js';

// Pre-calculate search index
const searchData = [];
const exactMatches = new Map();
const prefixMatches = new Map();
const includeMatches = new Map();

Object.keys(teamsDB).forEach((code, originalIndex) => {
    const name = teamsDB[code].name;
    const flag = teamsDB[code].flag;
    const aliases = countryAliases[code] || [];

    const entry = {
        code,
        name,
        flag,
        originalIndex
    };

    searchData.push(entry);

    const terms = [name.toLowerCase(), ...aliases.map(a => a.toLowerCase())];

    terms.forEach(term => {
        exactMatches.set(term, entry);

        // Build prefix map for fast prefix lookups
        for (let i = 1; i <= term.length; i++) {
            const prefix = term.substring(0, i);
            if (!prefixMatches.has(prefix)) {
                prefixMatches.set(prefix, new Set());
            }
            prefixMatches.get(prefix).add(entry);
        }
    });
});

function findMatches(query) {
    if (!query) return [];
    const q = query.toLowerCase().trim();
    if (!q) return [];

    let results = [];
    const seen = new Set();

    const addResult = (entry, score) => {
        if (!seen.has(entry.code)) {
            seen.add(entry.code);
            results.push({ data: entry, score, originalIndex: entry.originalIndex });
        }
    };

    // 1. Exact matches (100)
    if (exactMatches.has(q)) {
        addResult(exactMatches.get(q), 100);
    }

    // 2. Prefix matches (50)
    if (prefixMatches.has(q)) {
        for (const entry of prefixMatches.get(q)) {
            addResult(entry, 50);
        }
    }

    // 3. Includes matches (10)
    for (const entry of searchData) {
        if (seen.has(entry.code)) continue;
        const terms = [entry.name.toLowerCase()];
        const aliases = countryAliases[entry.code] || [];
        terms.push(...aliases.map(a => a.toLowerCase()));

        for (const term of terms) {
            if (term.includes(q)) {
                addResult(entry, 10);
                break;
            }
        }
    }

    results.sort((a, b) => {
        if (a.score !== b.score) {
            return b.score - a.score;
        }
        return a.originalIndex - b.originalIndex;
    });

    return results.slice(0, 8).map(r => r.data);
}


// Global click handler to close suggestions
document.addEventListener('click', (e) => {
    document.querySelectorAll('.suggestions-box').forEach(box => {
        const inputWrap = box.parentElement;
        if (inputWrap) {
            const input = inputWrap.querySelector('input');
            if (e.target !== input && e.target !== box && !box.contains(e.target)) {
                box.classList.add('hidden');
                box.innerHTML = '';
            }
        }
    });
});

export function setupCountryAutocomplete(inputElement, onSelect = null) {
    if (!inputElement) return;

    if (inputElement.dataset.acAttached) return;
    inputElement.dataset.acAttached = "true";

    let suggestionsBox = inputElement.parentElement.querySelector('.suggestions-box');
    if (!suggestionsBox) { suggestionsBox = inputElement.nextElementSibling; }

    if (!suggestionsBox) {
        return;
    }

    let activeIndex = -1;
    let currentMatches = [];
    let ignoreInput = false;

    const closeSuggestions = () => {
        suggestionsBox.classList.add('hidden');
        suggestionsBox.innerHTML = '';
        activeIndex = -1;
    };

    const renderSuggestions = (matches) => {
        suggestionsBox.innerHTML = '';
        if (matches.length === 0) {
            closeSuggestions();
            return;
        }

        matches.forEach((match, index) => {
            const div = document.createElement('div');
            div.className = 'suggestion-line';
            div.textContent = `${match.flag} ${match.name}`;

            if (index === activeIndex) {
                div.style.background = 'var(--text-light)';
                div.style.color = 'var(--bg-dark)';
            }

            div.addEventListener('click', (e) => {
                e.stopPropagation();
                selectSuggestion(match.name);
            });

            suggestionsBox.appendChild(div);
        });

        suggestionsBox.classList.remove('hidden');
    };

    const selectSuggestion = (name) => {
        ignoreInput = true;
        inputElement.value = name;
        closeSuggestions();
        if (onSelect) {
            onSelect(name);
        } else {
            // Fallback for missing callback
            const event = new Event('input', { bubbles: true });
            inputElement.dispatchEvent(event);
        }
        // Need a small timeout to let any lingering input events ignore the change before clearing flag
        setTimeout(() => { ignoreInput = false; }, 10);
    };

    inputElement.addEventListener('input', (e) => {
        if (ignoreInput) return;
        const query = e.target.value;
        currentMatches = findMatches(query);
        activeIndex = currentMatches.length > 0 ? 0 : -1;
        renderSuggestions(currentMatches);
    });

    inputElement.addEventListener('focus', (e) => {
        const query = e.target.value;
        if (query) {
            currentMatches = findMatches(query);
            if (currentMatches.length > 0) {
                activeIndex = 0;
                renderSuggestions(currentMatches);
            }
        }
    });

    inputElement.addEventListener('keydown', (e) => {
        if (suggestionsBox.classList.contains('hidden') || currentMatches.length === 0) {
            return;
        }

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            activeIndex = (activeIndex + 1) % currentMatches.length;
            renderSuggestions(currentMatches);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            activeIndex = (activeIndex - 1 + currentMatches.length) % currentMatches.length;
            renderSuggestions(currentMatches);
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (activeIndex >= 0 && activeIndex < currentMatches.length) {
                selectSuggestion(currentMatches[activeIndex].name);
            }
        } else if (e.key === 'Escape') {
            e.preventDefault();
            closeSuggestions();
        }
    });
}
