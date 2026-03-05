/* ============================================
   main.js — App Entry Point
   ============================================ */

import './style.css';
import Sortable from 'sortablejs';
import { initTheme, toggleTheme } from './theme.js';
import { renderBoardsList, renderBoard, renderSearchResults, renderCategoryFilter, getFaviconUrl } from './render.js';
import { search, refreshSearchCache } from './search.js';
import { importBookmarks, exportBookmarks } from './import-export.js';
import {
  getBoards, getBoard, createBoard, updateBoard, deleteBoard,
  getCategoriesByBoard, createCategory, updateCategory, deleteCategory,
  getBookmarksByCategory, getAllBookmarks, createBookmark, updateBookmark, deleteBookmark,
  bulkImport, clearAll,
} from './db.js';
import { getUser, signIn, signUp, signOut, updateUserAuth, onAuthChange, cloudSave, cloudLoad } from './supabase.js';

// -------- State --------
let activeBoardId = null;
let searchTimeout = null;
let sortableInstances = [];
let cloudSyncTimeout = null;
let activeCategoryFilter = null; // null = show all

// -------- Auth Flow --------
function initAuth() {
  initTheme();
  const authScreen = document.getElementById('auth-screen');
  const app = document.getElementById('app');
  const authForm = document.getElementById('auth-form');
  const authError = document.getElementById('auth-error');
  const authSubmit = document.getElementById('auth-submit');

  authForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('auth-email').value.trim();
    const password = document.getElementById('auth-password').value;
    authError.textContent = '';
    authSubmit.disabled = true;
    authSubmit.textContent = 'Entrando...';

    try {
      await signIn(email, password);
    } catch (err) {
      authError.textContent = err.message || 'Error de autenticación';
      authSubmit.disabled = false;
      authSubmit.textContent = 'Iniciar Sesión';
    }
  });

  // Listen for auth state changes
  onAuthChange(async (event, user) => {
    if (user) {
      authScreen.style.display = 'none';
      app.style.display = 'flex';
      await initApp(user);
    } else {
      authScreen.style.display = 'flex';
      app.style.display = 'none';
    }
  });

  // Check if already logged in
  getUser().then(async (user) => {
    if (user) {
      authScreen.style.display = 'none';
      app.style.display = 'flex';
      await initApp(user);
    }
  });
}

// -------- Init App (after auth) --------
async function initApp(user) {
  // Show user info in sidebar
  addUserSection(user);

  // Pull data from cloud first
  await pullFromCloud();

  await loadSidebar();
  wireEvents();

  // Auto-select first board if any
  const boards = await getBoards();
  if (boards.length > 0) {
    boards.sort((a, b) => (a.order ?? 9999) - (b.order ?? 9999) || (a.createdAt ?? 0) - (b.createdAt ?? 0));
    await selectBoard(boards[0].id);
  }

  await syncDataForExtension();
}

function addUserSection(user) {
  const footer = document.querySelector('.sidebar-footer');
  // Remove old user section if any
  document.querySelector('.user-section')?.remove();
  const section = document.createElement('div');
  section.className = 'user-section';
  section.innerHTML = `
    <span class="user-email" title="${user.email}">${user.email}</span>
    <button class="icon-btn small settings-btn" id="settings-btn" title="Configuración" aria-label="Configuración">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
    </button>
    <button class="logout-btn" id="logout-btn">Salir</button>
  `;
  footer.parentNode.insertBefore(section, footer);
  document.getElementById('logout-btn').addEventListener('click', async () => {
    await signOut();
    window.location.reload();
  });
  document.getElementById('settings-btn').addEventListener('click', () => showSettings(user));
}

// -------- Settings Modal --------
async function showSettings(user) {
  document.getElementById('modal-title').textContent = 'Configuración';

  const boards = await getBoards();
  const allCats = [];
  for (const b of boards) {
    const cats = await getCategoriesByBoard(b.id);
    allCats.push(...cats.map(c => ({ ...c, boardName: b.name })));
  }

  document.getElementById('modal-body').innerHTML = `
    <div class="settings-section">
      <h4>🔑 Cuenta</h4>
      <div class="form-group">
        <label for="settings-email">Email</label>
        <input type="email" id="settings-email" value="${user.email}" />
      </div>
      <div class="form-group">
        <label for="settings-pass">Nueva contraseña (dejar vacío para no cambiar)</label>
        <input type="password" id="settings-pass" placeholder="Nueva contraseña" />
      </div>
      <button class="btn btn-primary btn-sm" id="save-account">Guardar cuenta</button>
    </div>

    <hr class="settings-divider" />

    <div class="settings-section">
      <h4>🗑️ Eliminar datos</h4>

      <div class="settings-group">
        <label>Tablero específico:</label>
        <div class="settings-row">
          <select id="del-board-select">
            ${boards.map(b => `<option value="${b.id}">${b.name}</option>`).join('')}
          </select>
          <button class="btn btn-danger btn-sm" id="del-board-btn">Eliminar tablero</button>
        </div>
      </div>

      <div class="settings-group">
        <label>Categoría específica:</label>
        <div class="settings-row">
          <select id="del-cat-select">
            ${allCats.map(c => `<option value="${c.id}">${c.boardName} → ${c.name}</option>`).join('')}
          </select>
          <button class="btn btn-danger btn-sm" id="del-cat-btn">Eliminar categoría</button>
        </div>
      </div>

      <hr class="settings-divider" />

      <div class="settings-group">
        <button class="btn btn-danger btn-sm" id="del-all-bookmarks">🗑 Eliminar TODOS los marcadores</button>
        <button class="btn btn-danger btn-sm" id="del-all-cats">🗑 Eliminar TODAS las categorías</button>
        <button class="btn btn-danger btn-sm" id="del-all-boards">🗑 Eliminar TODOS los tableros</button>
      </div>
    </div>
  `;

  document.getElementById('modal-footer').innerHTML = `
    <button class="btn btn-ghost" id="modal-cancel">Cerrar</button>`;

  openModal();

  document.getElementById('modal-cancel').addEventListener('click', closeModal);

  // Account update
  document.getElementById('save-account').addEventListener('click', async () => {
    const newEmail = document.getElementById('settings-email').value.trim();
    const newPass = document.getElementById('settings-pass').value;
    const updates = {};
    if (newEmail && newEmail !== user.email) updates.email = newEmail;
    if (newPass) updates.password = newPass;
    if (Object.keys(updates).length === 0) { showToast('Sin cambios', 'info'); return; }
    try {
      await updateUserAuth(updates);
      showToast('Cuenta actualizada', 'success');
      if (updates.email) {
        showToast('Verifica tu nuevo email para completar el cambio', 'info');
      }
      closeModal();
    } catch (e) {
      showToast(`Error: ${e.message}`, 'error');
    }
  });

  // Delete specific board
  document.getElementById('del-board-btn').addEventListener('click', async () => {
    const boardId = document.getElementById('del-board-select').value;
    const boardName = document.getElementById('del-board-select').selectedOptions[0]?.textContent;
    if (!confirm(`¿Eliminar el tablero "${boardName}" y todo su contenido?`)) return;
    await deleteBoard(boardId);
    if (activeBoardId === boardId) activeBoardId = null;
    showToast('Tablero eliminado', 'success');
    closeModal();
    await loadSidebar();
    const remaining = await getBoards();
    if (remaining.length > 0) {
      remaining.sort((a, b) => (a.order ?? 9999) - (b.order ?? 9999));
      await selectBoard(remaining[0].id);
    } else {
      document.getElementById('board-title').textContent = 'Selecciona un tablero';
      document.getElementById('categories-grid').style.display = 'none';
      document.getElementById('welcome-screen').style.display = 'flex';
    }
    syncDataForExtension();
  });

  // Delete specific category
  document.getElementById('del-cat-btn').addEventListener('click', async () => {
    const catId = document.getElementById('del-cat-select').value;
    const catName = document.getElementById('del-cat-select').selectedOptions[0]?.textContent;
    if (!confirm(`¿Eliminar la categoría "${catName}" y sus marcadores?`)) return;
    await deleteCategory(catId);
    showToast('Categoría eliminada', 'success');
    closeModal();
    if (activeBoardId) {
      const categories = await renderBoard(activeBoardId, getBookmarkHandlers());
      initSortables(categories);
    }
    await loadSidebar();
    syncDataForExtension();
  });

  // Delete all bookmarks
  document.getElementById('del-all-bookmarks').addEventListener('click', async () => {
    if (!confirm('¿Eliminar TODOS los marcadores de TODOS los tableros? Las categorías y tableros se conservarán.')) return;
    const allBks = await getAllBookmarks();
    for (const bk of allBks) await deleteBookmark(bk.id);
    showToast(`${allBks.length} marcadores eliminados`, 'success');
    closeModal();
    if (activeBoardId) {
      const categories = await renderBoard(activeBoardId, getBookmarkHandlers());
      initSortables(categories);
    }
    await loadSidebar();
    syncDataForExtension();
  });

  // Delete all categories
  document.getElementById('del-all-cats').addEventListener('click', async () => {
    if (!confirm('¿Eliminar TODAS las categorías y marcadores de TODOS los tableros? Los tableros se conservarán.')) return;
    const bds = await getBoards();
    for (const b of bds) {
      const cats = await getCategoriesByBoard(b.id);
      for (const c of cats) await deleteCategory(c.id);
    }
    showToast('Todas las categorías eliminadas', 'success');
    closeModal();
    if (activeBoardId) {
      const categories = await renderBoard(activeBoardId, getBookmarkHandlers());
      initSortables(categories);
    }
    await loadSidebar();
    syncDataForExtension();
  });

  // Delete all boards
  document.getElementById('del-all-boards').addEventListener('click', async () => {
    if (!confirm('¿Eliminar TODO? Se borrarán todos los tableros, categorías y marcadores.')) return;
    await clearAll();
    activeBoardId = null;
    showToast('Todo eliminado', 'success');
    closeModal();
    document.getElementById('board-title').textContent = 'Selecciona un tablero';
    document.getElementById('categories-grid').style.display = 'none';
    document.getElementById('welcome-screen').style.display = 'flex';
    await loadSidebar();
    syncDataForExtension();
  });
}

// -------- Cloud Sync --------
async function pullFromCloud() {
  try {
    const cloudData = await cloudLoad();
    if (cloudData && cloudData.boards && cloudData.boards.length > 0) {
      // Check if local is empty
      const localBoards = await getBoards();
      if (localBoards.length === 0) {
        // Import cloud data to local
        await bulkImport(cloudData.boards, cloudData.categories, cloudData.bookmarks);
      }
    }
  } catch (e) {
    console.warn('Cloud pull failed:', e);
  }
}

function scheduleCloudSync() {
  clearTimeout(cloudSyncTimeout);
  cloudSyncTimeout = setTimeout(async () => {
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
      await cloudSave(boards, allCats, allBks);
    } catch (e) {
      console.warn('Cloud sync failed:', e);
    }
  }, 2000); // Debounce 2 seconds
}

// -------- Sidebar --------
async function loadSidebar() {
  await renderBoardsList(activeBoardId, selectBoard, showBoardContextMenu, handleCategoryNav);
}

async function handleCategoryNav(boardId, categoryId) {
  if (activeBoardId !== boardId) {
    await selectBoard(boardId);
  }
  // Scroll to category
  setTimeout(() => {
    const el = document.getElementById(`cat-${categoryId}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 100);
}

async function selectBoard(boardId) {
  activeBoardId = boardId;
  activeCategoryFilter = null; // Reset filter on board switch
  const board = await getBoard(boardId);
  if (!board) return;

  document.getElementById('board-title').textContent = board.name;
  document.getElementById('welcome-screen').style.display = 'none';
  document.getElementById('search-results').style.display = 'none';
  document.getElementById('categories-grid').style.display = 'block';
  document.getElementById('add-category-btn').style.display = 'inline-flex';

  await renderBoardsList(activeBoardId, selectBoard, showBoardContextMenu, handleCategoryNav);
  const allCategories = await renderBoard(boardId, getBookmarkHandlers(), activeCategoryFilter);
  initSortables(allCategories);

  // Render filter bar
  renderCategoryFilter(allCategories, board.color, async (filterIds) => {
    activeCategoryFilter = filterIds;
    const cats = await renderBoard(boardId, getBookmarkHandlers(), activeCategoryFilter);
    initSortables(cats);
  });

  await refreshSearchCache();
}

// -------- Drag & Drop with SortableJS --------
function initSortables(categories) {
  // Destroy previous instances
  sortableInstances.forEach(s => s.destroy());
  sortableInstances = [];

  // Make categories grid sortable
  const grid = document.getElementById('categories-grid');
  if (grid && grid.children.length > 0) {
    sortableInstances.push(
      new Sortable(grid, {
        animation: 200,
        handle: '.category-header',
        ghostClass: 'sortable-ghost',
        dragClass: 'sortable-drag',
        onEnd: async (evt) => {
          const cards = grid.querySelectorAll('.category-card');
          for (let i = 0; i < cards.length; i++) {
            const catId = cards[i].dataset.categoryId;
            if (catId) await updateCategory(catId, { order: i });
          }
          syncDataForExtension();
        },
      })
    );
  }

  // Make each category body sortable for bookmarks
  document.querySelectorAll('.category-body').forEach(body => {
    sortableInstances.push(
      new Sortable(body, {
        group: 'bookmarks',
        animation: 200,
        draggable: '.bookmark-item',
        ghostClass: 'sortable-ghost',
        dragClass: 'sortable-drag',
        filter: '.add-bookmark-container,.inline-bookmark-form',
        onEnd: async (evt) => {
          const targetCatId = evt.to.dataset.categoryId;
          const bookmarkId = evt.item.dataset.bookmarkId;

          if (!bookmarkId || !targetCatId) return;

          // Update category if moved across
          const sourceCatId = evt.from.dataset.categoryId;
          if (sourceCatId !== targetCatId) {
            // Find board ID for the target category
            const board = await getBoard(activeBoardId);
            await updateBookmark(bookmarkId, {
              categoryId: targetCatId,
              boardId: board?.id || activeBoardId,
            });
          }

          // Update order for all bookmarks in target
          const items = evt.to.querySelectorAll('.bookmark-item');
          for (let i = 0; i < items.length; i++) {
            const bId = items[i].dataset.bookmarkId;
            if (bId) await updateBookmark(bId, { order: i });
          }

          // Also update order in source if different
          if (sourceCatId !== targetCatId) {
            const srcItems = evt.from.querySelectorAll('.bookmark-item');
            for (let i = 0; i < srcItems.length; i++) {
              const bId = srcItems[i].dataset.bookmarkId;
              if (bId) await updateBookmark(bId, { order: i });
            }
          }

          await loadSidebar();
          syncDataForExtension();
        },
      })
    );
  });
}

// -------- Event Wiring --------
function wireEvents() {
  // Theme toggle
  document.getElementById('theme-toggle').addEventListener('click', toggleTheme);

  // Sidebar toggle (mobile)
  document.getElementById('sidebar-toggle')?.addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('open');
  });

  // Close sidebar on main click (mobile)
  document.getElementById('main-content').addEventListener('click', () => {
    document.getElementById('sidebar').classList.remove('open');
  });

  // Add board buttons
  document.getElementById('add-board-btn').addEventListener('click', () => showBoardModal());
  document.getElementById('welcome-add-board')?.addEventListener('click', () => showBoardModal());

  // Add category
  document.getElementById('add-category-btn').addEventListener('click', () => {
    if (activeBoardId) showCategoryModal();
  });

  // Search
  document.getElementById('search-input').addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    const q = e.target.value.trim();
    if (q.length < 2) {
      if (activeBoardId) {
        document.getElementById('search-results').style.display = 'none';
        document.getElementById('categories-grid').style.display = 'block';
      }
      return;
    }
    searchTimeout = setTimeout(async () => {
      await refreshSearchCache();
      const results = await search(q);
      document.getElementById('search-results').style.display = 'block';
      document.getElementById('categories-grid').style.display = 'none';
      document.getElementById('welcome-screen').style.display = 'none';
      renderSearchResults(results, q);
    }, 250);
  });

  // Import
  document.getElementById('import-btn').addEventListener('click', triggerImport);
  document.getElementById('welcome-import')?.addEventListener('click', triggerImport);
  document.getElementById('import-file-input').addEventListener('change', handleImportFile);

  // Export
  document.getElementById('export-btn').addEventListener('click', handleExport);

  // Close context menu on click outside
  document.addEventListener('click', () => {
    document.getElementById('context-menu').style.display = 'none';
  });

  // Modal close
  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('modal-overlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeModal();
  });

  // Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeModal();
      document.getElementById('context-menu').style.display = 'none';
    }
  });
}

// -------- Handlers Factory --------
function getBookmarkHandlers() {
  return {
    onAddBookmark: (category) => showBookmarkModal(null, category),
    onAddBookmarkInline: async (category, { url, title }) => {
      const favicon = getFaviconUrl(url);
      await createBookmark({
        categoryId: category.id,
        boardId: activeBoardId,
        url, title, favicon,
      });
      showToast('Marcador añadido', 'success');
      if (activeBoardId) {
        const categories = await renderBoard(activeBoardId, getBookmarkHandlers());
        initSortables(categories);
      }
      await loadSidebar();
      syncDataForExtension();
    },
    onEditBookmark: (bookmark) => showBookmarkModal(bookmark),
    onDeleteBookmark: handleDeleteBookmark,
    onEditCategory: (category) => showCategoryModal(category),
    onDeleteCategory: handleDeleteCategory,
  };
}

// -------- Board Context Menu --------
function showBoardContextMenu(board, event) {
  event.stopPropagation();
  const menu = document.getElementById('context-menu');
  menu.innerHTML = `
    <button class="context-menu-item" id="ctx-edit-board">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
      Editar tablero
    </button>
    <div class="context-menu-divider"></div>
    <button class="context-menu-item danger" id="ctx-delete-board">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
      Eliminar tablero
    </button>`;

  const rect = event.target.closest('.board-item').getBoundingClientRect();
  menu.style.top = rect.bottom + 4 + 'px';
  menu.style.left = rect.right - 160 + 'px';
  menu.style.display = 'block';

  document.getElementById('ctx-edit-board').addEventListener('click', (e) => {
    e.stopPropagation();
    menu.style.display = 'none';
    showBoardModal(board);
  });

  document.getElementById('ctx-delete-board').addEventListener('click', async (e) => {
    e.stopPropagation();
    menu.style.display = 'none';
    if (confirm(`¿Eliminar el tablero "${board.name}" y todos sus marcadores?`)) {
      await deleteBoard(board.id);
      if (activeBoardId === board.id) {
        activeBoardId = null;
        document.getElementById('board-title').textContent = 'Selecciona un tablero';
        document.getElementById('categories-grid').style.display = 'none';
        document.getElementById('add-category-btn').style.display = 'none';
        document.getElementById('welcome-screen').style.display = 'flex';
      }
      await loadSidebar();
      // Select first board if any
      const boards = await getBoards();
      if (boards.length > 0) {
        boards.sort((a, b) => (a.order ?? 9999) - (b.order ?? 9999) || (a.createdAt ?? 0) - (b.createdAt ?? 0));
        await selectBoard(boards[0].id);
      }
      showToast('Tablero eliminado', 'success');
      syncDataForExtension();
    }
  });
}

// -------- Modal: Board --------
function showBoardModal(board = null) {
  const isEdit = !!board;
  document.getElementById('modal-title').textContent = isEdit ? 'Editar Tablero' : 'Nuevo Tablero';

  const COLORS = ['#6366f1', '#ec4899', '#14b8a6', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#10b981', '#f97316', '#3b82f6', '#d946ef', '#84cc16'];
  const selectedColor = board?.color || COLORS[0];

  document.getElementById('modal-body').innerHTML = `
    <div class="form-group">
      <label for="board-name-input">Nombre</label>
      <input type="text" id="board-name-input" value="${board?.name || ''}" placeholder="Ej: Trabajo, Personal..." autofocus />
    </div>
    <div class="form-group">
      <label>Color</label>
      <div class="color-options">
        ${COLORS.map(c => `<div class="color-option${c === selectedColor ? ' selected' : ''}" data-color="${c}" style="background:${c}"></div>`).join('')}
      </div>
    </div>`;

  document.getElementById('modal-footer').innerHTML = `
    <button class="btn btn-ghost" id="modal-cancel">Cancelar</button>
    <button class="btn btn-primary" id="modal-save">${isEdit ? 'Guardar' : 'Crear'}</button>`;

  // Color selection
  let chosenColor = selectedColor;
  document.querySelectorAll('.color-option').forEach(el => {
    el.addEventListener('click', () => {
      document.querySelectorAll('.color-option').forEach(o => o.classList.remove('selected'));
      el.classList.add('selected');
      chosenColor = el.dataset.color;
    });
  });

  openModal();

  document.getElementById('modal-cancel').addEventListener('click', closeModal);
  document.getElementById('modal-save').addEventListener('click', async () => {
    const name = document.getElementById('board-name-input').value.trim();
    if (!name) { document.getElementById('board-name-input').focus(); return; }

    if (isEdit) {
      await updateBoard(board.id, { name, color: chosenColor });
      showToast('Tablero actualizado', 'success');
    } else {
      const newBoard = await createBoard({ name, color: chosenColor });
      await selectBoard(newBoard.id);
      showToast('Tablero creado', 'success');
    }

    closeModal();
    await loadSidebar();
    if (isEdit && activeBoardId === board.id) {
      document.getElementById('board-title').textContent = name;
    }
    syncDataForExtension();
  });

  // Enter key to submit
  document.getElementById('board-name-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('modal-save').click();
  });
}

// -------- Modal: Category --------
function showCategoryModal(category = null) {
  const isEdit = !!category;
  document.getElementById('modal-title').textContent = isEdit ? 'Editar Categoría' : 'Nueva Categoría';

  const CAT_COLORS = [
    '#6366f1', '#ec4899', '#14b8a6', '#f59e0b', '#ef4444',
    '#8b5cf6', '#06b6d4', '#10b981', '#f97316', '#3b82f6',
    '#d946ef', '#84cc16', '#0ea5e9', '#f43f5e', '#a855f7',
    '#22d3ee', '#fbbf24', '#34d399',
  ];
  const selectedColor = category?.color || CAT_COLORS[0];

  document.getElementById('modal-body').innerHTML = `
    <div class="form-group">
      <label for="cat-name-input">Nombre</label>
      <input type="text" id="cat-name-input" value="${category?.name || ''}" placeholder="Ej: IA, SEO, Servidores..." autofocus />
    </div>
    <div class="form-group">
      <label>Color de cabecera</label>
      <div class="color-options">
        ${CAT_COLORS.map(c => `<div class="color-option${c === selectedColor ? ' selected' : ''}" data-color="${c}" style="background:${c}"></div>`).join('')}
      </div>
    </div>`;

  document.getElementById('modal-footer').innerHTML = `
    <button class="btn btn-ghost" id="modal-cancel">Cancelar</button>
    <button class="btn btn-primary" id="modal-save">${isEdit ? 'Guardar' : 'Crear'}</button>`;

  // Color selection
  let chosenColor = selectedColor;
  document.querySelectorAll('.color-option').forEach(el => {
    el.addEventListener('click', () => {
      document.querySelectorAll('.color-option').forEach(o => o.classList.remove('selected'));
      el.classList.add('selected');
      chosenColor = el.dataset.color;
    });
  });

  openModal();

  document.getElementById('modal-cancel').addEventListener('click', closeModal);
  document.getElementById('modal-save').addEventListener('click', async () => {
    const name = document.getElementById('cat-name-input').value.trim();
    if (!name) { document.getElementById('cat-name-input').focus(); return; }

    if (isEdit) {
      await updateCategory(category.id, { name, color: chosenColor });
      showToast('Categoría actualizada', 'success');
    } else {
      await createCategory({ boardId: activeBoardId, name, color: chosenColor });
      showToast('Categoría creada', 'success');
    }

    closeModal();
    if (activeBoardId) {
      const categories = await renderBoard(activeBoardId, getBookmarkHandlers());
      initSortables(categories);
    }
    await loadSidebar();
    syncDataForExtension();
  });

  document.getElementById('cat-name-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('modal-save').click();
  });
}

async function handleDeleteCategory(category) {
  if (confirm(`¿Eliminar la categoría "${category.name}" y todos sus marcadores?`)) {
    await deleteCategory(category.id);
    if (activeBoardId) {
      const categories = await renderBoard(activeBoardId, getBookmarkHandlers());
      initSortables(categories);
    }
    await loadSidebar();
    showToast('Categoría eliminada', 'success');
    syncDataForExtension();
  }
}

// -------- Modal: Bookmark --------
function showBookmarkModal(bookmark = null, category = null) {
  const isEdit = !!bookmark;
  document.getElementById('modal-title').textContent = isEdit ? 'Editar Marcador' : 'Nuevo Marcador';

  document.getElementById('modal-body').innerHTML = `
    <div class="form-group">
      <label for="bk-url-input">URL</label>
      <input type="url" id="bk-url-input" value="${bookmark?.url || ''}" placeholder="https://ejemplo.com" autofocus />
    </div>
    <div class="form-group">
      <label for="bk-title-input">Título</label>
      <input type="text" id="bk-title-input" value="${bookmark?.title || ''}" placeholder="Nombre del sitio" />
    </div>
    <div class="form-group">
      <label for="bk-notes-input">Notas (opcional)</label>
      <textarea id="bk-notes-input" placeholder="Notas privadas sobre este marcador...">${bookmark?.notes || ''}</textarea>
    </div>`;

  document.getElementById('modal-footer').innerHTML = `
    <button class="btn btn-ghost" id="modal-cancel">Cancelar</button>
    <button class="btn btn-primary" id="modal-save">${isEdit ? 'Guardar' : 'Añadir'}</button>`;

  openModal();

  // Auto-fill title from URL
  const urlInput = document.getElementById('bk-url-input');
  const titleInput = document.getElementById('bk-title-input');
  urlInput.addEventListener('blur', () => {
    if (!titleInput.value && urlInput.value) {
      try {
        const u = new URL(urlInput.value);
        titleInput.value = u.hostname.replace('www.', '');
      } catch { /* ignore */ }
    }
  });

  document.getElementById('modal-cancel').addEventListener('click', closeModal);
  document.getElementById('modal-save').addEventListener('click', async () => {
    const url = urlInput.value.trim();
    let title = titleInput.value.trim();
    const notes = document.getElementById('bk-notes-input').value.trim();

    if (!url) { urlInput.focus(); return; }
    if (!title) {
      try { title = new URL(url).hostname.replace('www.', ''); } catch { title = url; }
    }

    const favicon = getFaviconUrl(url);

    if (isEdit) {
      await updateBookmark(bookmark.id, { url, title, notes, favicon });
      showToast('Marcador actualizado', 'success');
    } else {
      await createBookmark({
        categoryId: category.id,
        boardId: activeBoardId,
        url, title, notes, favicon,
      });
      showToast('Marcador añadido', 'success');
    }

    closeModal();
    if (activeBoardId) {
      const categories = await renderBoard(activeBoardId, getBookmarkHandlers());
      initSortables(categories);
    }
    await loadSidebar();
    syncDataForExtension();
  });

  urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') titleInput.focus();
  });
  titleInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('modal-save').click();
  });
}

async function handleDeleteBookmark(bookmark) {
  if (confirm(`¿Eliminar el marcador "${bookmark.title}"?`)) {
    await deleteBookmark(bookmark.id);
    if (activeBoardId) {
      const categories = await renderBoard(activeBoardId, getBookmarkHandlers());
      initSortables(categories);
    }
    await loadSidebar();
    showToast('Marcador eliminado', 'success');
    syncDataForExtension();
  }
}

// -------- Import / Export --------
function triggerImport() {
  document.getElementById('import-file-input').click();
}

async function handleImportFile(e) {
  const file = e.target.files?.[0];
  if (!file) return;

  // Show import modal
  document.getElementById('modal-title').textContent = 'Importando marcadores...';
  document.getElementById('modal-body').innerHTML = `
    <div class="import-progress">
      <div class="spinner"></div>
      <p>Procesando <strong>${file.name}</strong>...</p>
    </div>`;
  document.getElementById('modal-footer').innerHTML = '';
  openModal();

  try {
    const result = await importBookmarks(file);
    document.getElementById('modal-body').innerHTML = `
      <div class="import-progress">
        <svg viewBox="0 0 24 24" fill="none" stroke="var(--success)" stroke-width="2" style="width:48px;height:48px;margin-bottom:16px"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
        <p><strong>¡Importación completada!</strong></p>
        <p style="color:var(--text-secondary);margin-top:8px;">
          ${result.boards} tableros · ${result.categories} categorías · ${result.bookmarks} marcadores
        </p>
      </div>`;
    document.getElementById('modal-footer').innerHTML = `
      <button class="btn btn-primary" id="modal-done">Aceptar</button>`;
    document.getElementById('modal-done').addEventListener('click', closeModal);

    // Refresh
    await loadSidebar();
    const boards = await getBoards();
    if (boards.length > 0) {
      boards.sort((a, b) => (a.order ?? 9999) - (b.order ?? 9999) || (a.createdAt ?? 0) - (b.createdAt ?? 0));
      await selectBoard(boards[0].id);
    }
    await refreshSearchCache();
    syncDataForExtension();
  } catch (err) {
    document.getElementById('modal-body').innerHTML = `
      <div class="import-progress">
        <svg viewBox="0 0 24 24" fill="none" stroke="var(--danger)" stroke-width="2" style="width:48px;height:48px;margin-bottom:16px"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
        <p><strong>Error al importar</strong></p>
        <p style="color:var(--text-secondary);margin-top:8px;">${err.message}</p>
      </div>`;
    document.getElementById('modal-footer').innerHTML = `
      <button class="btn btn-ghost" id="modal-done">Cerrar</button>`;
    document.getElementById('modal-done').addEventListener('click', closeModal);
  }

  // Reset file input
  e.target.value = '';
}

async function handleExport() {
  try {
    const html = await exportBookmarks();
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `MyMarks_export_${new Date().toISOString().slice(0, 10)}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('Marcadores exportados', 'success');
  } catch (err) {
    showToast('Error al exportar: ' + err.message, 'error');
  }
}

// -------- Modal helpers --------
function openModal() {
  document.getElementById('modal-overlay').style.display = 'flex';
  // Focus first input
  setTimeout(() => {
    const firstInput = document.querySelector('#modal-body input, #modal-body textarea');
    if (firstInput) firstInput.focus();
  }, 100);
}

function closeModal() {
  document.getElementById('modal-overlay').style.display = 'none';
}

// -------- Toast --------
function showToast(message, type = 'info') {
  let container = document.querySelector('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(30px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 2500);
}

// -------- Sync data to localStorage for the extension --------
async function syncDataForExtension() {
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
    localStorage.setItem('mymarks_boards', JSON.stringify(boards));
    localStorage.setItem('mymarks_categories', JSON.stringify(allCats));
    localStorage.setItem('mymarks_bookmarks', JSON.stringify(allBks));
    // Dispatch event so content script can pick it up
    window.dispatchEvent(new CustomEvent('mymarks-data-updated'));
    // Also schedule cloud sync
    scheduleCloudSync();
  } catch (e) {
    console.warn('Sync to localStorage failed:', e);
  }
}

// -------- Start --------
initAuth();

// Listen for bookmarks pushed from the extension via content script
window.addEventListener('mymarks-extension-bookmark', async () => {
  try {
    const pending = JSON.parse(localStorage.getItem('mymarks_pending_imports') || '[]');
    if (pending.length === 0) return;

    for (const bk of pending) {
      await createBookmark(bk);
    }
    localStorage.removeItem('mymarks_pending_imports');

    // Refresh the current view
    if (activeBoardId) {
      const categories = await renderBoard(activeBoardId, getBookmarkHandlers());
      initSortables(categories);
      await loadSidebar();
    }
    showToast(`${pending.length} marcador(es) añadido(s) desde la extensión`, 'success');
    await syncDataForExtension();
  } catch (e) {
    console.warn('Error importing extension bookmarks:', e);
  }
});

