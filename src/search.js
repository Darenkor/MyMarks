/* ============================================
   search.js — Client-side Full-text Search
   ============================================ */

import { getAllBookmarks, getBoards, getCategoriesByBoard } from './db.js';

let boardsCache = [];
let categoriesCache = {};

export async function refreshSearchCache() {
    boardsCache = await getBoards();
    categoriesCache = {};
    for (const b of boardsCache) {
        const cats = await getCategoriesByBoard(b.id);
        for (const c of cats) {
            categoriesCache[c.id] = { ...c, boardName: b.name };
        }
    }
}

export async function search(query) {
    if (!query || query.trim().length < 2) return [];

    const q = query.toLowerCase().trim();
    const allBookmarks = await getAllBookmarks();

    const results = [];
    for (const bk of allBookmarks) {
        const titleMatch = (bk.title || '').toLowerCase().includes(q);
        const urlMatch = (bk.url || '').toLowerCase().includes(q);
        const descMatch = (bk.description || '').toLowerCase().includes(q);
        const notesMatch = (bk.notes || '').toLowerCase().includes(q);
        const tagsMatch = (bk.tags || []).some(t => t.toLowerCase().includes(q));

        if (titleMatch || urlMatch || descMatch || notesMatch || tagsMatch) {
            const catInfo = categoriesCache[bk.categoryId];
            results.push({
                ...bk,
                categoryName: catInfo ? catInfo.name : '',
                boardName: catInfo ? catInfo.boardName : '',
                _score: (titleMatch ? 10 : 0) + (urlMatch ? 5 : 0) + (descMatch ? 3 : 0) + (tagsMatch ? 4 : 0) + (notesMatch ? 1 : 0),
            });
        }
    }

    results.sort((a, b) => b._score - a._score);
    return results;
}

export function highlightText(text, query) {
    if (!text || !query) return text || '';
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(${escaped})`, 'gi');
    return text.replace(re, '<mark>$1</mark>');
}
