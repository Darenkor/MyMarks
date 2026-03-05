/* ============================================
   db.js — IndexedDB Storage Layer
   ============================================ */

const DB_NAME = 'MyMarksDB';
const DB_VERSION = 1;

let db = null;

function openDB() {
  return new Promise((resolve, reject) => {
    if (db) return resolve(db);
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onupgradeneeded = (e) => {
      const database = e.target.result;
      if (!database.objectStoreNames.contains('boards')) {
        const boards = database.createObjectStore('boards', { keyPath: 'id' });
        boards.createIndex('order', 'order');
      }
      if (!database.objectStoreNames.contains('categories')) {
        const cats = database.createObjectStore('categories', { keyPath: 'id' });
        cats.createIndex('boardId', 'boardId');
        cats.createIndex('order', 'order');
      }
      if (!database.objectStoreNames.contains('bookmarks')) {
        const bk = database.createObjectStore('bookmarks', { keyPath: 'id' });
        bk.createIndex('categoryId', 'categoryId');
        bk.createIndex('boardId', 'boardId');
        bk.createIndex('order', 'order');
      }
    };
    req.onsuccess = (e) => {
      db = e.target.result;
      normalizeOrders().then(() => resolve(db));
    };
  });
}

// Ensure all items have sequential order values (fixes imports and legacy data)
async function normalizeOrders() {
  const stores = ['boards', 'categories', 'bookmarks'];
  const t = db.transaction(stores, 'readwrite');

  // Boards
  const allBoards = await promisifyTx(t.objectStore('boards').getAll());
  allBoards.sort((a, b) => (a.order ?? 9999) - (b.order ?? 9999) || (a.createdAt ?? 0) - (b.createdAt ?? 0));
  let needsFix = allBoards.some((b, i) => b.order !== i);
  if (needsFix) {
    allBoards.forEach((b, i) => { b.order = i; t.objectStore('boards').put(b); });
  }

  // Categories — per board
  const allCats = await promisifyTx(t.objectStore('categories').getAll());
  const catsByBoard = {};
  for (const c of allCats) {
    (catsByBoard[c.boardId] = catsByBoard[c.boardId] || []).push(c);
  }
  for (const boardId in catsByBoard) {
    const cats = catsByBoard[boardId];
    cats.sort((a, b) => (a.order ?? 9999) - (b.order ?? 9999) || (a.createdAt ?? 0) - (b.createdAt ?? 0));
    let catNeedsFix = cats.some((c, i) => c.order !== i);
    if (catNeedsFix) {
      cats.forEach((c, i) => { c.order = i; t.objectStore('categories').put(c); });
    }
  }

  // Bookmarks — per category
  const allBks = await promisifyTx(t.objectStore('bookmarks').getAll());
  const bksByCat = {};
  for (const bk of allBks) {
    (bksByCat[bk.categoryId] = bksByCat[bk.categoryId] || []).push(bk);
  }
  for (const catId in bksByCat) {
    const bks = bksByCat[catId];
    bks.sort((a, b) => (a.order ?? 9999) - (b.order ?? 9999) || (a.createdAt ?? 0) - (b.createdAt ?? 0));
    let bkNeedsFix = bks.some((bk, i) => bk.order !== i);
    if (bkNeedsFix) {
      bks.forEach((bk, i) => { bk.order = i; t.objectStore('bookmarks').put(bk); });
    }
  }

  return new Promise(resolve => { t.oncomplete = () => resolve(); t.onerror = () => resolve(); });
}

function promisifyTx(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(stores, mode = 'readonly') {
  const t = db.transaction(stores, mode);
  return stores.length === 1 ? t.objectStore(stores[0]) : stores.map(s => t.objectStore(s));
}

function promisify(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

// -------- Board CRUD --------
export async function getBoards() {
  await openDB();
  return promisify(tx(['boards']).getAll());
}

export async function getBoard(id) {
  await openDB();
  return promisify(tx(['boards']).get(id));
}

export async function createBoard(data) {
  await openDB();
  const boards = await getBoards();
  const board = {
    id: generateId(),
    name: data.name || 'Nuevo Tablero',
    color: data.color || '#6366f1',
    order: boards.length,
    createdAt: Date.now(),
  };
  await promisify(tx(['boards'], 'readwrite').put(board));
  return board;
}

export async function updateBoard(id, updates) {
  await openDB();
  const board = await getBoard(id);
  if (!board) return null;
  Object.assign(board, updates);
  await promisify(tx(['boards'], 'readwrite').put(board));
  return board;
}

export async function deleteBoard(id) {
  await openDB();
  // Delete all bookmarks in this board
  const bookmarks = await getBookmarksByBoard(id);
  const categories = await getCategoriesByBoard(id);
  const t = db.transaction(['boards', 'categories', 'bookmarks'], 'readwrite');
  for (const b of bookmarks) t.objectStore('bookmarks').delete(b.id);
  for (const c of categories) t.objectStore('categories').delete(c.id);
  t.objectStore('boards').delete(id);
  return new Promise((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

// -------- Category CRUD --------
export async function getCategoriesByBoard(boardId) {
  await openDB();
  const all = await promisify(tx(['categories']).index('boardId').getAll(boardId));
  return all.sort((a, b) => (a.order ?? 9999) - (b.order ?? 9999) || (a.createdAt ?? 0) - (b.createdAt ?? 0));
}

export async function getCategory(id) {
  await openDB();
  return promisify(tx(['categories']).get(id));
}

export async function createCategory(data) {
  await openDB();
  const cats = await getCategoriesByBoard(data.boardId);
  const cat = {
    id: generateId(),
    boardId: data.boardId,
    name: data.name || 'Nueva Categoría',
    color: data.color || null,
    order: cats.length,
    createdAt: Date.now(),
  };
  await promisify(tx(['categories'], 'readwrite').put(cat));
  return cat;
}

export async function updateCategory(id, updates) {
  await openDB();
  const cat = await getCategory(id);
  if (!cat) return null;
  Object.assign(cat, updates);
  await promisify(tx(['categories'], 'readwrite').put(cat));
  return cat;
}

export async function deleteCategory(id) {
  await openDB();
  const bookmarks = await getBookmarksByCategory(id);
  const t = db.transaction(['categories', 'bookmarks'], 'readwrite');
  for (const b of bookmarks) t.objectStore('bookmarks').delete(b.id);
  t.objectStore('categories').delete(id);
  return new Promise((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

// -------- Bookmark CRUD --------
export async function getBookmarksByCategory(categoryId) {
  await openDB();
  const all = await promisify(tx(['bookmarks']).index('categoryId').getAll(categoryId));
  return all.sort((a, b) => (a.order ?? 9999) - (b.order ?? 9999) || (a.createdAt ?? 0) - (b.createdAt ?? 0));
}

export async function getBookmarksByBoard(boardId) {
  await openDB();
  return promisify(tx(['bookmarks']).index('boardId').getAll(boardId));
}

export async function getAllBookmarks() {
  await openDB();
  return promisify(tx(['bookmarks']).getAll());
}

export async function getBookmark(id) {
  await openDB();
  return promisify(tx(['bookmarks']).get(id));
}

export async function createBookmark(data) {
  await openDB();
  const siblings = await getBookmarksByCategory(data.categoryId);
  const bookmark = {
    id: generateId(),
    categoryId: data.categoryId,
    boardId: data.boardId,
    url: data.url || '',
    title: data.title || data.url || 'Sin título',
    description: data.description || '',
    favicon: data.favicon || '',
    tags: data.tags || [],
    notes: data.notes || '',
    order: siblings.length,
    createdAt: Date.now(),
  };
  await promisify(tx(['bookmarks'], 'readwrite').put(bookmark));
  return bookmark;
}

export async function updateBookmark(id, updates) {
  await openDB();
  const bk = await getBookmark(id);
  if (!bk) return null;
  Object.assign(bk, updates);
  await promisify(tx(['bookmarks'], 'readwrite').put(bk));
  return bk;
}

export async function deleteBookmark(id) {
  await openDB();
  return promisify(tx(['bookmarks'], 'readwrite').delete(id));
}

// -------- Bulk operations (for import) --------
export async function bulkImport(boards, categories, bookmarks) {
  await openDB();
  const t = db.transaction(['boards', 'categories', 'bookmarks'], 'readwrite');
  for (const b of boards) t.objectStore('boards').put(b);
  for (const c of categories) t.objectStore('categories').put(c);
  for (const bk of bookmarks) t.objectStore('bookmarks').put(bk);
  return new Promise((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

export async function clearAll() {
  await openDB();
  const t = db.transaction(['boards', 'categories', 'bookmarks'], 'readwrite');
  t.objectStore('boards').clear();
  t.objectStore('categories').clear();
  t.objectStore('bookmarks').clear();
  return new Promise((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

// Sync to chrome.storage for the extension
export async function syncToExtensionStorage() {
  if (typeof chrome === 'undefined' || !chrome.storage) return;
  try {
    const boards = await getBoards();
    const allCats = [];
    const allBks = [];
    for (const b of boards) {
      const cats = await getCategoriesByBoard(b.id);
      allCats.push(...cats);
      for (const c of cats) {
        const bks = await getBookmarksByCategory(c.id);
        allBks.push(...bks);
      }
    }
    chrome.storage.local.set({ mymarks_boards: boards, mymarks_categories: allCats, mymarks_bookmarks: allBks });
  } catch (e) {
    // Ignore errors when not in extension context
  }
}

export { generateId };
