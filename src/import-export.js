/* ============================================
   import-export.js — Netscape HTML Bookmark Import/Export
   ============================================ */

import {
  generateId, bulkImport, getBoards, getCategoriesByBoard,
  getBookmarksByCategory, getAllCategories, getAllBookmarks,
  createBoard, createCategory, createBookmark, updateBookmark,
} from './db.js';

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
 * Import bookmarks from an HTML file with smart merge.
 * - Boards: matched by name (case-insensitive). If exists, reuse; otherwise create.
 * - Categories: matched by name + board. If exists, reuse; otherwise create.
 * - Bookmarks: matched by URL + category. If exists, update title; otherwise create.
 */
export async function importBookmarks(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const html = e.target.result;
                const parsed = parseBookmarksHTML(html);

                // Load existing data for matching
                const existingBoards = await getBoards();
                const existingCats = await getAllCategories();
                const existingBks = await getAllBookmarks();

                // Build lookup maps (case-insensitive, trimmed)
                const boardMap = {}; // lowercase name -> board
                for (const b of existingBoards) {
                    boardMap[b.name.trim().toLowerCase()] = b;
                }

                const catMap = {}; // "boardId::lowercase name" -> category
                for (const c of existingCats) {
                    catMap[`${c.boardId}::${c.name.trim().toLowerCase()}`] = c;
                }

                const bkMap = {}; // "categoryId::normalized url" -> bookmark
                for (const bk of existingBks) {
                    const url = (bk.url || '').trim().toLowerCase().replace(/\/+$/, '');
                    if (url) bkMap[`${bk.categoryId}::${url}`] = bk;
                }

                let created = { boards: 0, categories: 0, bookmarks: 0 };
                let updated = { bookmarks: 0 };
                let skipped = { bookmarks: 0 };

                // Map from parsed board IDs to actual board IDs
                const boardIdRemap = {};

                // --- Process boards ---
                for (const parsedBoard of parsed.boards) {
                    const key = parsedBoard.name.trim().toLowerCase();
                    if (boardMap[key]) {
                        // Board exists, reuse its ID
                        boardIdRemap[parsedBoard.id] = boardMap[key].id;
                    } else {
                        // Create new board
                        const newBoard = await createBoard({
                            name: parsedBoard.name,
                            color: parsedBoard.color,
                        });
                        boardIdRemap[parsedBoard.id] = newBoard.id;
                        boardMap[key] = newBoard;
                        created.boards++;
                    }
                }

                // Map from parsed category IDs to actual category IDs
                const catIdRemap = {};

                // --- Process categories ---
                for (const parsedCat of parsed.categories) {
                    const actualBoardId = boardIdRemap[parsedCat.boardId] || parsedCat.boardId;
                    const key = `${actualBoardId}::${parsedCat.name.trim().toLowerCase()}`;

                    if (catMap[key]) {
                        // Category exists, reuse its ID
                        catIdRemap[parsedCat.id] = catMap[key].id;
                    } else {
                        // Create new category
                        const newCat = await createCategory({
                            boardId: actualBoardId,
                            name: parsedCat.name,
                            color: parsedCat.color,
                        });
                        catIdRemap[parsedCat.id] = newCat.id;
                        catMap[key] = newCat;
                        created.categories++;
                    }
                }

                // --- Process bookmarks ---
                for (const parsedBk of parsed.bookmarks) {
                    const actualBoardId = boardIdRemap[parsedBk.boardId] || parsedBk.boardId;
                    const actualCatId = catIdRemap[parsedBk.categoryId] || parsedBk.categoryId;
                    const url = (parsedBk.url || '').trim().toLowerCase().replace(/\/+$/, '');

                    if (!url) continue; // Skip empty URLs

                    const key = `${actualCatId}::${url}`;

                    if (bkMap[key]) {
                        // Bookmark exists — update title if it changed
                        const existing = bkMap[key];
                        if (parsedBk.title && parsedBk.title !== existing.title) {
                            await updateBookmark(existing.id, { title: parsedBk.title });
                            updated.bookmarks++;
                        } else {
                            skipped.bookmarks++;
                        }
                    } else {
                        // Create new bookmark
                        const newBk = await createBookmark({
                            categoryId: actualCatId,
                            boardId: actualBoardId,
                            url: parsedBk.url,
                            title: parsedBk.title,
                            description: parsedBk.description || '',
                            favicon: parsedBk.favicon || '',
                            tags: parsedBk.tags || [],
                            notes: parsedBk.notes || '',
                        });
                        bkMap[key] = newBk;
                        created.bookmarks++;
                    }
                }

                resolve({
                    boards: created.boards,
                    categories: created.categories,
                    bookmarks: created.bookmarks,
                    updatedBookmarks: updated.bookmarks,
                    skippedBookmarks: skipped.bookmarks,
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
