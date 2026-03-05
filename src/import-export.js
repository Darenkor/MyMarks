/* ============================================
   import-export.js — Netscape HTML Bookmark Import/Export
   ============================================ */

import { generateId, bulkImport, getBoards, getCategoriesByBoard, getBookmarksByCategory } from './db.js';

/**
 * Parse a Netscape Bookmark HTML file into boards, categories, and bookmarks.
 * The Papaly export format uses:
 *   <DL> = folder container
 *   <DT><H3> = folder (board or category)
 *   <DT><A>  = bookmark link
 * Top-level H3 = boards. Nested H3 = categories within a board.
 */
export function parseBookmarksHTML(html) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    const boards = [];
    const categories = [];
    const bookmarks = [];

    const BOARD_COLORS = [
        '#6366f1', '#ec4899', '#14b8a6', '#f59e0b', '#ef4444',
        '#8b5cf6', '#06b6d4', '#10b981', '#f97316', '#3b82f6',
        '#d946ef', '#84cc16', '#e11d48', '#0ea5e9', '#a855f7',
    ];

    // Find the top-level DL
    const topDL = doc.querySelector('DL');
    if (!topDL) return { boards, categories, bookmarks };

    let boardOrder = 0;

    function processFolder(dlElement, parentBoardId, depth) {
        const children = dlElement.children;
        let catOrder = 0;
        let bkOrder = 0;
        let currentCategoryId = null;

        for (let i = 0; i < children.length; i++) {
            const dt = children[i];
            if (dt.tagName !== 'DT') continue;

            const h3 = dt.querySelector(':scope > H3');
            const a = dt.querySelector(':scope > A');
            const subDL = dt.querySelector(':scope > DL');

            if (h3) {
                const name = h3.textContent.trim();

                if (depth === 0) {
                    // Top-level folder = Board
                    const board = {
                        id: generateId(),
                        name,
                        color: BOARD_COLORS[boardOrder % BOARD_COLORS.length],
                        order: boardOrder++,
                        createdAt: Date.now(),
                    };
                    boards.push(board);

                    if (subDL) {
                        processFolder(subDL, board.id, 1);
                    }
                } else {
                    // Nested folder = Category
                    const cat = {
                        id: generateId(),
                        boardId: parentBoardId,
                        name,
                        color: null,
                        order: catOrder++,
                        createdAt: Date.now(),
                    };
                    categories.push(cat);
                    currentCategoryId = cat.id;

                    if (subDL) {
                        // Process bookmarks inside this category
                        processCategoryContent(subDL, parentBoardId, cat.id);
                    }
                }
            } else if (a && parentBoardId) {
                // Bookmark at current level — ensure it has a category
                if (!currentCategoryId && depth >= 1) {
                    // Create a default category for loose bookmarks
                    const cat = {
                        id: generateId(),
                        boardId: parentBoardId,
                        name: 'Sin categoría',
                        color: null,
                        order: catOrder++,
                        createdAt: Date.now(),
                    };
                    categories.push(cat);
                    currentCategoryId = cat.id;
                }

                if (currentCategoryId) {
                    addBookmark(a, parentBoardId, currentCategoryId, bkOrder++);
                }
            }
        }
    }

    function processCategoryContent(dlElement, boardId, categoryId) {
        const children = dlElement.children;
        let bkOrder = 0;

        for (let i = 0; i < children.length; i++) {
            const dt = children[i];
            if (dt.tagName !== 'DT') continue;

            const a = dt.querySelector(':scope > A');
            const h3 = dt.querySelector(':scope > H3');
            const subDL = dt.querySelector(':scope > DL');

            if (a) {
                addBookmark(a, boardId, categoryId, bkOrder++);
            } else if (h3 && subDL) {
                // Sub-subcategory: flatten into parent category
                processCategoryContent(subDL, boardId, categoryId);
            }
        }
    }

    function addBookmark(aElement, boardId, categoryId, order) {
        const url = aElement.getAttribute('HREF') || '';
        const title = aElement.textContent.trim() || url;
        let favicon = '';
        try {
            const u = new URL(url);
            favicon = `https://www.google.com/s2/favicons?domain=${u.hostname}&sz=32`;
        } catch (e) { /* ignore */ }

        bookmarks.push({
            id: generateId(),
            categoryId,
            boardId,
            url,
            title,
            description: '',
            favicon,
            tags: [],
            notes: '',
            order,
            createdAt: Date.now(),
        });
    }

    processFolder(topDL, null, 0);

    return { boards, categories, bookmarks };
}

/**
 * Import bookmarks from an HTML file.
 */
export async function importBookmarks(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const html = e.target.result;
                const data = parseBookmarksHTML(html);
                await bulkImport(data.boards, data.categories, data.bookmarks);
                resolve({
                    boards: data.boards.length,
                    categories: data.categories.length,
                    bookmarks: data.bookmarks.length,
                });
            } catch (err) {
                reject(err);
            }
        };
        reader.onerror = () => reject(reader.error);
        reader.readAsText(file);
    });
}

/**
 * Export all bookmarks to Netscape HTML format.
 */
export async function exportBookmarks() {
    const boards = await getBoards();
    boards.sort((a, b) => (a.order ?? 9999) - (b.order ?? 9999) || (a.createdAt ?? 0) - (b.createdAt ?? 0));

    let html = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<!-- This is an automatically generated file.
     It will be read and overwritten.
     DO NOT EDIT! -->
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>

<DL><p>
`;

    for (const board of boards) {
        const ts = Math.floor(board.createdAt / 1000);
        html += `    <DT><H3 ADD_DATE=${ts}>${escapeHTML(board.name)}</H3>\n`;
        html += `    <DL><p>\n`;

        const categories = await getCategoriesByBoard(board.id);
        categories.sort((a, b) => (a.order ?? 9999) - (b.order ?? 9999) || (a.createdAt ?? 0) - (b.createdAt ?? 0));

        for (const cat of categories) {
            const cts = Math.floor(cat.createdAt / 1000);
            html += `        <DT><H3 ADD_DATE=${cts}>${escapeHTML(cat.name)}</H3>\n`;
            html += `        <DL><p>\n`;

            const bookmarks = await getBookmarksByCategory(cat.id);
            bookmarks.sort((a, b) => (a.order ?? 9999) - (b.order ?? 9999) || (a.createdAt ?? 0) - (b.createdAt ?? 0));

            for (const bk of bookmarks) {
                const bts = Math.floor(bk.createdAt / 1000);
                html += `            <DT><A HREF="${escapeHTML(bk.url)}" ADD_DATE="${bts}">${escapeHTML(bk.title)}</A>\n`;
            }

            html += `        </DL><p>\n`;
        }

        html += `    </DL><p>\n`;
    }

    html += `</DL><p>\n`;
    return html;
}

function escapeHTML(str) {
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
    return (str || '').replace(/[&<>"]/g, c => map[c]);
}
