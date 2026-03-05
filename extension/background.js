/* ============================================
   background.js — Extension Service Worker
   ============================================ */

// Context menu for right-click "Save to MyMarks"
chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus?.create({
        id: 'save-to-mymarks',
        title: 'Guardar en MyMarks',
        contexts: ['page', 'link'],
    });
});

chrome.contextMenus?.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId === 'save-to-mymarks') {
        const url = info.linkUrl || info.pageUrl || tab?.url;
        const title = tab?.title || url;

        // Store as pending bookmark for the popup to pick up
        await chrome.storage.local.set({
            mymarks_pending: { url, title, timestamp: Date.now() },
        });

        // Open the popup (can't programmatically open popup, so badge the icon)
        chrome.action.setBadgeText({ text: '1' });
        chrome.action.setBadgeBackgroundColor({ color: '#6366f1' });
    }
});

// Clear badge when popup opens
chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'popup-opened') {
        chrome.action.setBadgeText({ text: '' });
    }
});
