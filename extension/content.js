/* ============================================
   content.js — Content Script for MyMarks Extension
   Runs on the MyMarks web app page to sync data 
   from localStorage to chrome.storage.local
   ============================================ */

function syncToExtension() {
    try {
        const boards = localStorage.getItem('mymarks_boards');
        const categories = localStorage.getItem('mymarks_categories');
        const bookmarks = localStorage.getItem('mymarks_bookmarks');

        if (boards) {
            chrome.storage.local.set({
                mymarks_boards: JSON.parse(boards),
                mymarks_categories: JSON.parse(categories || '[]'),
                mymarks_bookmarks: JSON.parse(bookmarks || '[]'),
                mymarks_last_sync: Date.now(),
            });
        }
    } catch (e) {
        console.warn('[MyMarks Extension] Sync failed:', e);
    }
}

// Sync on page load
syncToExtension();

// Listen for updates from the web app
window.addEventListener('mymarks-data-updated', syncToExtension);

// Also sync periodically (every 5 seconds when the tab is active)
setInterval(syncToExtension, 5000);
