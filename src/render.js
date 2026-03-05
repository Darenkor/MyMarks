/* ============================================
   render.js — DOM Rendering Engine
   ============================================ */

import { getBoards, getCategoriesByBoard, getBookmarksByCategory, getBookmarksByBoard } from './db.js';

// Get favicon URL
export function getFaviconUrl(url) {
  try {
    const u = new URL(url);
    return `https://www.google.com/s2/favicons?domain=${u.hostname}&sz=32`;
  } catch {
    return '';
  }
}

// -------- Sidebar Boards (with category dropdowns) --------
export async function renderBoardsList(activeBoardId, onBoardClick, onBoardContext, onCategoryNav) {
  const boards = await getBoards();
  boards.sort((a, b) => (a.order ?? 9999) - (b.order ?? 9999) || (a.createdAt ?? 0) - (b.createdAt ?? 0));
  const list = document.getElementById('boards-list');
  list.innerHTML = '';

  for (const board of boards) {
    const count = (await getBookmarksByBoard(board.id)).length;
    const categories = await getCategoriesByBoard(board.id);
    categories.sort((a, b) => (a.order ?? 9999) - (b.order ?? 9999) || (a.createdAt ?? 0) - (b.createdAt ?? 0));

    const li = document.createElement('li');
    li.className = `board-item${board.id === activeBoardId ? ' active' : ''}`;
    li.dataset.boardId = board.id;

    // Board row
    const boardRow = document.createElement('div');
    boardRow.className = 'board-row';
    boardRow.innerHTML = `
      <span class="board-color" style="background:${board.color}"></span>
      <span class="board-name">${escHTML(board.name)}</span>
      <span class="board-count">${count}</span>
      ${categories.length > 0 ? `<button class="icon-btn small board-expand-btn" title="Ver categorías" aria-label="Ver categorías">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
      </button>` : ''}
      <div class="board-actions">
        <button class="icon-btn small board-ctx-btn" data-board-id="${board.id}" title="Opciones" aria-label="Opciones del tablero">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg>
        </button>
      </div>`;

    boardRow.addEventListener('click', (e) => {
      if (e.target.closest('.board-ctx-btn') || e.target.closest('.board-expand-btn')) return;
      onBoardClick(board.id);
    });

    const ctxBtn = boardRow.querySelector('.board-ctx-btn');
    ctxBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      onBoardContext(board, e);
    });

    // Expand/collapse categories
    const expandBtn = boardRow.querySelector('.board-expand-btn');
    if (expandBtn) {
      expandBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = catList.style.display !== 'none';
        catList.style.display = isOpen ? 'none' : 'block';
        expandBtn.classList.toggle('expanded', !isOpen);
      });
    }

    li.appendChild(boardRow);

    // Category sub-list
    const catList = document.createElement('ul');
    catList.className = 'board-categories-list';
    catList.style.display = 'none';
    for (const cat of categories) {
      const catLi = document.createElement('li');
      catLi.className = 'board-category-item';
      catLi.innerHTML = `<span class="cat-dot" style="background:${cat.color || board.color}"></span> ${escHTML(cat.name)}`;
      catLi.addEventListener('click', (e) => {
        e.stopPropagation();
        if (onCategoryNav) onCategoryNav(board.id, cat.id);
      });
      catList.appendChild(catLi);
    }
    li.appendChild(catList);

    list.appendChild(li);
  }

  return boards;
}

// -------- Board Content (Categories + Bookmarks) --------
export async function renderBoard(boardId, handlers, filterCategoryIds = null) {
  const grid = document.getElementById('categories-grid');
  grid.innerHTML = '';

  const categories = await getCategoriesByBoard(boardId);
  categories.sort((a, b) => (a.order ?? 9999) - (b.order ?? 9999) || (a.createdAt ?? 0) - (b.createdAt ?? 0));

  if (categories.length === 0) {
    grid.innerHTML = `
      <div class="empty-state" style="grid-column: 1/-1;">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
        <p>Este tablero está vacío.<br>Crea una categoría para empezar.</p>
      </div>`;
    return [];
  }

  // Apply filter if set
  const visibleCats = filterCategoryIds
    ? categories.filter(c => filterCategoryIds.includes(c.id))
    : categories;

  for (const cat of visibleCats) {
    const card = await renderCategoryCard(cat, handlers);
    grid.appendChild(card);
  }

  return categories; // Always return all for filter UI
}

// -------- Category Filter Bar --------
export function renderCategoryFilter(categories, activeBoardColor, onFilterChange) {
  let existing = document.getElementById('category-filter-bar');
  if (existing) existing.remove();

  if (!categories || categories.length < 2) return;

  const bar = document.createElement('div');
  bar.id = 'category-filter-bar';
  bar.className = 'category-filter-bar';

  const filterBtn = document.createElement('button');
  filterBtn.className = 'filter-toggle-btn';
  filterBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg> Filtrar`;
  filterBtn.addEventListener('click', () => {
    filterPanel.style.display = filterPanel.style.display === 'none' ? 'flex' : 'none';
  });
  bar.appendChild(filterBtn);

  const filterPanel = document.createElement('div');
  filterPanel.className = 'filter-panel';
  filterPanel.style.display = 'none';

  for (const cat of categories) {
    const label = document.createElement('label');
    label.className = 'filter-chip';
    label.innerHTML = `
      <input type="checkbox" value="${cat.id}" checked />
      <span class="filter-chip-dot" style="background:${cat.color || activeBoardColor || '#6366f1'}"></span>
      <span>${escHTML(cat.name)}</span>`;
    filterPanel.appendChild(label);
  }

  const applyBtn = document.createElement('button');
  applyBtn.className = 'btn btn-primary btn-sm filter-apply';
  applyBtn.textContent = 'Aplicar';
  applyBtn.addEventListener('click', () => {
    const checked = filterPanel.querySelectorAll('input:checked');
    if (checked.length === categories.length) {
      onFilterChange(null); // show all
    } else {
      onFilterChange(Array.from(checked).map(cb => cb.value));
    }
  });
  filterPanel.appendChild(applyBtn);

  const clearBtn = document.createElement('button');
  clearBtn.className = 'btn btn-ghost btn-sm';
  clearBtn.textContent = 'Todas';
  clearBtn.addEventListener('click', () => {
    filterPanel.querySelectorAll('input').forEach(cb => cb.checked = true);
    onFilterChange(null);
  });
  filterPanel.appendChild(clearBtn);

  const noneBtn = document.createElement('button');
  noneBtn.className = 'btn btn-ghost btn-sm';
  noneBtn.textContent = 'Ninguna';
  noneBtn.addEventListener('click', () => {
    filterPanel.querySelectorAll('input').forEach(cb => cb.checked = false);
  });
  filterPanel.appendChild(noneBtn);

  bar.appendChild(filterPanel);

  // Insert before the categories grid
  const grid = document.getElementById('categories-grid');
  grid.parentNode.insertBefore(bar, grid);
}

async function renderCategoryCard(category, handlers) {
  const bookmarks = await getBookmarksByCategory(category.id);
  bookmarks.sort((a, b) => (a.order ?? 9999) - (b.order ?? 9999) || (a.createdAt ?? 0) - (b.createdAt ?? 0));

  const card = document.createElement('div');
  card.className = 'category-card';
  card.dataset.categoryId = category.id;
  card.id = `cat-${category.id}`;

  // Header with inline add button
  const header = document.createElement('div');
  header.className = 'category-header';
  if (category.color) {
    header.style.background = `linear-gradient(135deg, ${category.color} 0%, ${adjustColor(category.color, -30)} 100%)`;
  }
  header.innerHTML = `
    <div class="category-header-left">
      <span class="category-name">${escHTML(category.name)}</span>
      <span class="category-count">(${bookmarks.length})</span>
    </div>
    <div class="category-actions">
      <button class="icon-btn small on-gradient cat-add-btn" title="Añadir marcador" aria-label="Añadir marcador">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      </button>
      <button class="icon-btn small on-gradient cat-edit-btn" title="Editar categoría" aria-label="Editar categoría">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
      </button>
      <button class="icon-btn small on-gradient cat-del-btn" title="Eliminar categoría" aria-label="Eliminar categoría">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
      </button>
    </div>`;

  header.querySelector('.cat-add-btn').addEventListener('click', () => {
    const form = card.querySelector('.inline-bookmark-form');
    form.style.display = form.style.display === 'flex' ? 'none' : 'flex';
    if (form.style.display === 'flex') form.querySelector('.inline-bk-title').focus();
  });
  header.querySelector('.cat-edit-btn').addEventListener('click', () => handlers.onEditCategory(category));
  header.querySelector('.cat-del-btn').addEventListener('click', () => handlers.onDeleteCategory(category));
  card.appendChild(header);

  // Inline form (below header, above bookmarks)
  const inlineForm = document.createElement('div');
  inlineForm.className = 'inline-bookmark-form';
  inlineForm.style.display = 'none';
  inlineForm.innerHTML = `
    <input type="text" class="inline-bk-title" placeholder="Nombre" />
    <input type="url" class="inline-bk-url" placeholder="https://..." />
    <div class="inline-bk-actions">
      <button class="btn btn-primary btn-sm inline-bk-save">Guardar</button>
      <button class="btn btn-ghost btn-sm inline-bk-cancel">✕</button>
    </div>`;

  const saveInline = async () => {
    const titleEl = inlineForm.querySelector('.inline-bk-title');
    const urlEl = inlineForm.querySelector('.inline-bk-url');
    const url = urlEl.value.trim();
    if (!url) { urlEl.focus(); return; }
    let title = titleEl.value.trim();
    if (!title) {
      try { title = new URL(url).hostname.replace('www.', ''); } catch { title = url; }
    }
    if (handlers.onAddBookmarkInline) {
      await handlers.onAddBookmarkInline(category, { url, title });
    }
    titleEl.value = '';
    urlEl.value = '';
    titleEl.focus();
  };

  inlineForm.querySelector('.inline-bk-save').addEventListener('click', saveInline);
  inlineForm.querySelector('.inline-bk-cancel').addEventListener('click', () => {
    inlineForm.style.display = 'none';
  });
  inlineForm.querySelector('.inline-bk-url').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveInline();
  });
  inlineForm.querySelector('.inline-bk-title').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') inlineForm.querySelector('.inline-bk-url').focus();
  });
  card.appendChild(inlineForm);

  // Body (bookmark list)
  const body = document.createElement('div');
  body.className = 'category-body';
  body.dataset.categoryId = category.id;

  for (const bk of bookmarks) {
    const item = renderBookmarkItem(bk, handlers);
    body.appendChild(item);
  }

  card.appendChild(body);
  return card;
}

// Darken/lighten a hex color
function adjustColor(hex, amount) {
  hex = hex.replace('#', '');
  const num = parseInt(hex, 16);
  let r = Math.min(255, Math.max(0, (num >> 16) + amount));
  let g = Math.min(255, Math.max(0, ((num >> 8) & 0x00FF) + amount));
  let b = Math.min(255, Math.max(0, (num & 0x0000FF) + amount));
  return '#' + (r << 16 | g << 8 | b).toString(16).padStart(6, '0');
}

function renderBookmarkItem(bk, handlers) {
  const item = document.createElement('a');
  item.className = 'bookmark-item';
  item.href = bk.url;
  item.target = '_blank';
  item.rel = 'noopener';
  item.dataset.bookmarkId = bk.id;
  item.draggable = true;

  const faviconSrc = bk.favicon || getFaviconUrl(bk.url);

  item.innerHTML = `
    <img class="bookmark-favicon" src="${escHTML(faviconSrc)}" alt="" loading="lazy" onerror="this.style.display='none'" />
    <div class="bookmark-info">
      <div class="bookmark-title">${escHTML(bk.title)}</div>
      <div class="bookmark-url">${escHTML(truncateUrl(bk.url))}</div>
    </div>
    <div class="bookmark-item-actions">
      <button class="icon-btn small on-light bk-edit-btn" title="Editar" aria-label="Editar marcador">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
      </button>
      <button class="icon-btn small on-light bk-del-btn" title="Eliminar" aria-label="Eliminar marcador">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
      </button>
    </div>`;

  // Prevent link navigation when clicking action buttons
  item.addEventListener('click', (e) => {
    if (e.target.closest('.bk-edit-btn') || e.target.closest('.bk-del-btn')) {
      e.preventDefault();
      e.stopPropagation();
    }
  });

  item.querySelector('.bk-edit-btn').addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    handlers.onEditBookmark(bk);
  });

  item.querySelector('.bk-del-btn').addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    handlers.onDeleteBookmark(bk);
  });

  return item;
}

// -------- Search Results --------
export function renderSearchResults(results, query) {
  const container = document.getElementById('search-results-list');
  const title = document.getElementById('search-results-title');
  container.innerHTML = '';
  title.textContent = `${results.length} resultado${results.length !== 1 ? 's' : ''} para "${query}"`;

  for (const r of results) {
    const faviconSrc = r.favicon || getFaviconUrl(r.url);
    const a = document.createElement('a');
    a.className = 'search-result-item';
    a.href = r.url;
    a.target = '_blank';
    a.rel = 'noopener';
    a.innerHTML = `
      <img class="sr-favicon" src="${escHTML(faviconSrc)}" alt="" loading="lazy" onerror="this.style.display='none'" />
      <div class="sr-info">
        <div class="sr-title">${highlightInline(r.title, query)}</div>
        <div class="sr-path">${escHTML(r.boardName)} → ${escHTML(r.categoryName)}</div>
      </div>`;
    container.appendChild(a);
  }
}

function highlightInline(text, query) {
  if (!text || !query) return escHTML(text || '');
  const safe = escHTML(text);
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(${escaped})`, 'gi');
  return safe.replace(re, '<mark>$1</mark>');
}

// -------- Helpers --------
function escHTML(str) {
  const d = document.createElement('div');
  d.textContent = str || '';
  return d.innerHTML;
}

function truncateUrl(url) {
  try {
    const u = new URL(url);
    let path = u.pathname;
    if (path.length > 30) path = path.substring(0, 30) + '…';
    return u.hostname + path;
  } catch {
    return (url || '').substring(0, 50);
  }
}
