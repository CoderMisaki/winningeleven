import { teamsDB } from '../data/teams.js';
import { countryAliases } from '../data/countryAliases.js';

const searchData = Object.keys(teamsDB).map((code, originalIndex) => {
    const name = teamsDB[code].name;
    const flag = teamsDB[code].flag;
    const aliases = countryAliases[code] || [];
    return {
        code,
        name,
        flag,
        searchTerms: [name.toLowerCase(), ...aliases.map(a => a.toLowerCase())],
        originalIndex
    };
});

function findMatches(query) {
    if (!query) return [];
    const q = query.toLowerCase().trim();
    if (!q) return [];

    let results = [];

    for (const data of searchData) {
        let bestScore = -1;
        for (const term of data.searchTerms) {
            if (term === q) {
                bestScore = 100;
                break;
            } else if (term.startsWith(q)) {
                bestScore = Math.max(bestScore, 50);
            } else if (term.includes(q)) {
                bestScore = Math.max(bestScore, 10);
            }
        }

        if (bestScore > 0) {
            results.push({
                data,
                score: bestScore,
                originalIndex: data.originalIndex
            });
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

export function setupCountryAutocomplete(inputElement) {
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
        const event = new Event('input', { bubbles: true });
        inputElement.dispatchEvent(event);
        ignoreInput = false;
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
