/* ============================================
   popup.js — Extension Popup Logic
   
   Data flow:
   1. Web app stores data in IndexedDB + localStorage
   2. Content script reads localStorage and syncs to chrome.storage.local
   3. This popup reads from chrome.storage.local
   4. When saving a bookmark, it writes to chrome.storage.local
   5. Next time the web app opens, the content script can push updates
   ============================================ */

const boardSelect = document.getElementById('board-select');
const categorySelect = document.getElementById('category-select');
const titleInput = document.getElementById('bookmark-title');
const notesInput = document.getElementById('bookmark-notes');
const saveBtn = document.getElementById('save-btn');
const statusMsg = document.getElementById('status-msg');
const pageTitleEl = document.getElementById('page-title');
const pageUrlEl = document.getElementById('page-url');
const pageFavicon = document.getElementById('page-favicon');

let currentUrl = '';
let currentPageTitle = '';
let boards = [];
let categories = {};
let bookmarks = [];

// Init
document.addEventListener('DOMContentLoaded', async () => {
    // Notify background
    chrome.runtime.sendMessage({ type: 'popup-opened' });

    // Get current tab info
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
        currentUrl = tab.url || '';
        currentPageTitle = tab.title || '';

        pageTitleEl.textContent = currentPageTitle;
        pageUrlEl.textContent = currentUrl;
        titleInput.value = currentPageTitle;

        try {
            const u = new URL(currentUrl);
            pageFavicon.src = `https://www.google.com/s2/favicons?domain=${u.hostname}&sz=32`;
        } catch {
            pageFavicon.style.display = 'none';
        }
    }

    // Check for pending bookmark from context menu
    const data = await chrome.storage.local.get('mymarks_pending');
    if (data.mymarks_pending && Date.now() - data.mymarks_pending.timestamp < 60000) {
        currentUrl = data.mymarks_pending.url;
        currentPageTitle = data.mymarks_pending.title;
        titleInput.value = currentPageTitle;
        pageUrlEl.textContent = currentUrl;
        pageTitleEl.textContent = currentPageTitle;
        await chrome.storage.local.remove('mymarks_pending');
    }

    // Load boards/categories from chrome.storage
    await loadData();

    // If no data found, try to sync from a MyMarks tab
    if (boards.length === 0) {
        await trySyncFromMyMarksTab();
        await loadData();
    }

    populateBoards();
});

async function loadData() {
    const data = await chrome.storage.local.get(['mymarks_boards', 'mymarks_categories', 'mymarks_bookmarks']);
    boards = data.mymarks_boards || [];
    const allCats = data.mymarks_categories || [];
    bookmarks = data.mymarks_bookmarks || [];

    categories = {};
    for (const c of allCats) {
        if (!categories[c.boardId]) categories[c.boardId] = [];
        categories[c.boardId].push(c);
    }
}

// Try to inject script into a MyMarks tab to sync data
async function trySyncFromMyMarksTab() {
    try {
        const tabs = await chrome.tabs.query({});
        const mymarksTab = tabs.find(t =>
            t.url && (
                t.url.includes('localhost') ||
                t.url.includes('.netlify.app') ||
                t.url.includes('.vercel.app') ||
                t.url.includes('.github.io')
            ) && t.url.includes('MyMarks') || t.title?.includes('MyMarks')
        );

        if (mymarksTab) {
            const results = await chrome.scripting.executeScript({
                target: { tabId: mymarksTab.id },
                func: () => {
                    return {
                        boards: localStorage.getItem('mymarks_boards'),
                        categories: localStorage.getItem('mymarks_categories'),
                        bookmarks: localStorage.getItem('mymarks_bookmarks'),
                    };
                },
            });

            if (results && results[0]?.result?.boards) {
                const r = results[0].result;
                await chrome.storage.local.set({
                    mymarks_boards: JSON.parse(r.boards),
                    mymarks_categories: JSON.parse(r.categories || '[]'),
                    mymarks_bookmarks: JSON.parse(r.bookmarks || '[]'),
                    mymarks_last_sync: Date.now(),
                });
            }
        }
    } catch (e) {
        console.warn('[MyMarks] Could not sync from tab:', e);
    }
}

function populateBoards() {
    boardSelect.innerHTML = '<option value="">-- Seleccionar tablero --</option>';
    boards.sort((a, b) => a.order - b.order);

    for (const b of boards) {
        const opt = document.createElement('option');
        opt.value = b.id;
        opt.textContent = b.name;
        boardSelect.appendChild(opt);
    }

    if (boards.length === 0) {
        boardSelect.innerHTML = '<option value="">No hay tableros — abre MyMarks y vuelve a intentarlo</option>';
        showStatus('Abre MyMarks en una pestaña y recarga esta ventana para sincronizar los tableros.', 'error');
    }
}

boardSelect.addEventListener('change', () => {
    const boardId = boardSelect.value;
    categorySelect.innerHTML = '';
    categorySelect.disabled = true;
    saveBtn.disabled = true;

    if (!boardId) {
        categorySelect.innerHTML = '<option value="">-- Selecciona un tablero primero --</option>';
        return;
    }

    const cats = (categories[boardId] || []).sort((a, b) => a.order - b.order);
    if (cats.length === 0) {
        categorySelect.innerHTML = '<option value="">No hay categorías en este tablero</option>';
        return;
    }

    categorySelect.disabled = false;
    categorySelect.innerHTML = '<option value="">-- Seleccionar categoría --</option>';
    for (const c of cats) {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = c.name;
        categorySelect.appendChild(opt);
    }
});

categorySelect.addEventListener('change', () => {
    saveBtn.disabled = !categorySelect.value;
});

saveBtn.addEventListener('click', async () => {
    const boardId = boardSelect.value;
    const categoryId = categorySelect.value;
    const title = titleInput.value.trim() || currentPageTitle;
    const notes = notesInput.value.trim();

    if (!boardId || !categoryId || !currentUrl) return;

    let favicon = '';
    try {
        const u = new URL(currentUrl);
        favicon = `https://www.google.com/s2/favicons?domain=${u.hostname}&sz=32`;
    } catch { /* ignore */ }

    // Create bookmark in chrome.storage
    const newBookmark = {
        id: Date.now().toString(36) + Math.random().toString(36).substr(2, 9),
        categoryId,
        boardId,
        url: currentUrl,
        title,
        description: '',
        favicon,
        tags: [],
        notes,
        order: bookmarks.filter(b => b.categoryId === categoryId).length,
        createdAt: Date.now(),
    };

    bookmarks.push(newBookmark);
    await chrome.storage.local.set({ mymarks_bookmarks: bookmarks });

    // Also try to push the bookmark to the web app via a MyMarks tab
    try {
        const tabs = await chrome.tabs.query({});
        const mymarksTab = tabs.find(t =>
            t.url && (t.url.includes('localhost') || t.url.includes('MyMarks')) || t.title?.includes('MyMarks')
        );
        if (mymarksTab) {
            await chrome.scripting.executeScript({
                target: { tabId: mymarksTab.id },
                func: (bookmark) => {
                    // Store the pending bookmark for the web app to import
                    const pending = JSON.parse(localStorage.getItem('mymarks_pending_imports') || '[]');
                    pending.push(bookmark);
                    localStorage.setItem('mymarks_pending_imports', JSON.stringify(pending));
                    window.dispatchEvent(new CustomEvent('mymarks-extension-bookmark'));
                },
                args: [newBookmark],
            });
        }
    } catch (e) {
        console.warn('[MyMarks] Could not push to web app:', e);
    }

    // Show success
    saveBtn.textContent = '✓ ¡Guardado!';
    saveBtn.classList.add('saved');
    saveBtn.disabled = true;

    showStatus(`Guardado en "${boardSelect.options[boardSelect.selectedIndex].text} → ${categorySelect.options[categorySelect.selectedIndex].text}"`, 'success');

    // Close popup after 1.5s
    setTimeout(() => window.close(), 1500);
});

function showStatus(msg, type) {
    statusMsg.textContent = msg;
    statusMsg.className = `status-msg ${type}`;
    statusMsg.style.display = 'block';
}

// Open app link
document.getElementById('open-app-link').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: 'http://localhost:5173' });
});
