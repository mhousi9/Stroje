// ===================== DB LAYER =====================
const DB_NAME = 'udrzba-db';
const DB_VERSION = 3;
let db;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const _db = e.target.result;
      if (!_db.objectStoreNames.contains('categories')) {
        const s = _db.createObjectStore('categories', { keyPath: 'id' });
        s.createIndex('order', 'order');
      }
      if (!_db.objectStoreNames.contains('entries')) {
        const s = _db.createObjectStore('entries', { keyPath: 'id' });
        s.createIndex('categoryId', 'categoryId');
      }
      if (!_db.objectStoreNames.contains('items')) {
        const s = _db.createObjectStore('items', { keyPath: 'id' });
        s.createIndex('categoryId', 'categoryId');
      }
      if (!_db.objectStoreNames.contains('halls')) {
        _db.createObjectStore('halls', { keyPath: 'id' });
      }
      if (!_db.objectStoreNames.contains('media')) {
        _db.createObjectStore('media', { keyPath: 'id' });
      }
      if (!_db.objectStoreNames.contains('meta')) {
        _db.createObjectStore('meta', { keyPath: 'key' });
      }
    };
    req.onsuccess = (e) => { db = e.target.result; resolve(db); };
    req.onerror = (e) => reject(e);
  });
}

function tx(storeNames, mode = 'readonly') {
  return db.transaction(storeNames, mode);
}

function idbGetAll(storeName) {
  return new Promise((resolve, reject) => {
    const req = tx([storeName]).objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = (e) => reject(e);
  });
}

function idbGet(storeName, key) {
  return new Promise((resolve, reject) => {
    const req = tx([storeName]).objectStore(storeName).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = (e) => reject(e);
  });
}

function idbPut(storeName, value) {
  return new Promise((resolve, reject) => {
    const t = tx([storeName], 'readwrite');
    t.objectStore(storeName).put(value);
    t.oncomplete = () => resolve();
    t.onerror = (e) => reject(e);
  });
}

function idbPutMany(storeName, values) {
  return new Promise((resolve, reject) => {
    const t = tx([storeName], 'readwrite');
    const s = t.objectStore(storeName);
    values.forEach(v => s.put(v));
    t.oncomplete = () => resolve();
    t.onerror = (e) => reject(e);
  });
}

function idbDelete(storeName, key) {
  return new Promise((resolve, reject) => {
    const t = tx([storeName], 'readwrite');
    t.objectStore(storeName).delete(key);
    t.oncomplete = () => resolve();
    t.onerror = (e) => reject(e);
  });
}

function idbClear(storeName) {
  return new Promise((resolve, reject) => {
    const t = tx([storeName], 'readwrite');
    t.objectStore(storeName).clear();
    t.oncomplete = () => resolve();
    t.onerror = (e) => reject(e);
  });
}

// Bump this whenever SEED_DATA content changes (new/updated images, fixed texts, ...)
// so already-installed apps refresh their seed content instead of staying stuck
// on whatever was loaded the first time. User-created categories/entries/items and
// any polozka assignment or color the user set on a seed entry are preserved —
// only the seed's own text/images are refreshed to match the latest extraction.
const SEED_VERSION = 'flat-paths-v1';

async function seedIfEmpty() {
  const versionRow = await idbGet('meta', 'seedVersion');
  if (versionRow && versionRow.value === SEED_VERSION) return;

  const existingCats = await idbGetAll('categories');
  const existingCatIds = new Set(existingCats.map(c => c.id));
  const existingEntries = await idbGetAll('entries');
  const existingEntryMap = new Map(existingEntries.map(e => [e.id, e]));

  const catsToPut = [];
  SEED_DATA.forEach((c, i) => {
    if (!existingCatIds.has(c.id)) {
      catsToPut.push({ id: c.id, name: c.name, order: i });
    }
  });

  const entriesToPut = [];
  SEED_DATA.forEach(c => {
    c.entries.forEach((e, i) => {
      const images = (e.images || []).map(src => ({ type: 'url', src: src }));
      const existing = existingEntryMap.get(e.id);
      if (existing) {
        existing.text = e.text;
        existing.images = images;
        existing.videos = existing.videos || [];
        entriesToPut.push(existing);
      } else {
        entriesToPut.push({
          id: e.id, categoryId: c.id, itemId: null, text: e.text,
          images, videos: [], order: i, createdAt: 0, updatedAt: 0
        });
      }
    });
  });

  if (catsToPut.length) await idbPutMany('categories', catsToPut);
  if (entriesToPut.length) await idbPutMany('entries', entriesToPut);
  await idbPut('meta', { key: 'seedVersion', value: SEED_VERSION });
}

// Creates the two default halls once, so the app starts organized. If the user
// later deletes both halls on purpose, this won't recreate them (checked via a
// separate meta flag, not just "halls store is empty").
async function ensureDefaultHalls() {
  const flag = await idbGet('meta', 'defaultHallsCreated');
  if (flag && flag.value) return;
  const existing = await idbGetAll('halls');
  if (existing.length === 0) {
    await idbPutMany('halls', [
      { id: 'hall_stara', name: 'Stará Hala', order: 0 },
      { id: 'hall_nova', name: 'Nová Hala', order: 1 }
    ]);
  }
  await idbPut('meta', { key: 'defaultHallsCreated', value: true });
}

// ===================== UTIL =====================
function normalizeCz(str) {
  return (str || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function uid() {
  return 'id_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

function escapeHtml(str) {
  return (str || '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

function fileToBlobRecord(file) {
  return new Promise((resolve) => {
    const id = uid();
    idbPut('media', { id, blob: file, type: file.type }).then(() => resolve(id));
  });
}

async function resolveMediaUrl(item) {
  if (item.type === 'url') return item.src;
  if (item.type === 'blob') {
    const rec = await idbGet('media', item.mediaId);
    if (!rec) return '';
    if (!item._objectUrl) {
      item._objectUrl = URL.createObjectURL(rec.blob);
    }
    return item._objectUrl;
  }
  return '';
}

// ===================== STATE =====================
let state = {
  view: 'home', // home | hall | category | entry-form
  categoryId: null,
  currentHallId: null,
  editingEntryId: null,
  searchTerm: '',
  categories: [],
  entriesByCat: {},
  allEntries: [],
  items: [],
  itemsByCat: {},
  halls: [],
  categoriesByHall: {},
  expandedItems: new Set(['unassigned']),
  bulkMode: false,
  bulkGroupKey: null,
  bulkSelected: new Set()
};

const app = document.getElementById('app');

async function loadAll() {
  const cats = await idbGetAll('categories');
  cats.sort((a, b) => a.order - b.order);
  const entries = await idbGetAll('entries');
  const items = await idbGetAll('items');
  items.sort((a, b) => (a.order || 0) - (b.order || 0));
  const halls = await idbGetAll('halls');
  halls.sort((a, b) => (a.order || 0) - (b.order || 0));
  state.categories = cats;
  state.allEntries = entries;
  state.items = items;
  state.halls = halls;
  const byCat = {};
  entries.forEach(e => {
    byCat[e.categoryId] = byCat[e.categoryId] || [];
    byCat[e.categoryId].push(e);
  });
  Object.values(byCat).forEach(list => list.sort((a, b) => (a.order || 0) - (b.order || 0)));
  state.entriesByCat = byCat;

  const itemsByCat = {};
  items.forEach(it => {
    itemsByCat[it.categoryId] = itemsByCat[it.categoryId] || [];
    itemsByCat[it.categoryId].push(it);
  });
  state.itemsByCat = itemsByCat;

  const categoriesByHall = {};
  cats.forEach(c => {
    const key = c.hallId || 'unassigned';
    categoriesByHall[key] = categoriesByHall[key] || [];
    categoriesByHall[key].push(c);
  });
  state.categoriesByHall = categoriesByHall;
}

function catName(id) {
  const c = state.categories.find(c => c.id === id);
  return c ? c.name : '';
}

// ===================== RENDER: HOME =====================
function renderHome() {
  const term = normalizeCz(state.searchTerm);
  let searchResults = null;
  if (term.length >= 2) {
    searchResults = state.allEntries.filter(e => normalizeCz(e.text).includes(term) || normalizeCz(catName(e.categoryId)).includes(term));
  }

  let body;
  if (searchResults) {
    body = `
      <div class="section-label">Výsledky hledání (${searchResults.length})</div>
      <div class="entry-list">
        ${searchResults.length === 0 ? `<div class="empty-state">Nic nenalezeno pro „${escapeHtml(state.searchTerm)}“.</div>` :
          searchResults.map(e => renderEntryCard(e, true)).join('')}
      </div>
    `;
  } else {
    const unassignedCount = (state.categoriesByHall['unassigned'] || []).length;
    body = `
      <div class="section-label">Haly (${state.halls.length}) <span class="hint-inline">— přetažením za ⠿ změníš pořadí</span></div>
      <div class="cat-grid" id="hallGrid">
        ${state.halls.map(renderHallTile).join('')}
        ${unassignedCount ? renderUnassignedHallTile() : ''}
      </div>
      <button class="fab-secondary" onclick="openNewHall()">+ Přidat halu</button>
    `;
  }

  app.innerHTML = `
    <header class="topbar">
      <div class="topbar-title">🔧 Údržba strojů</div>
      <button class="icon-btn" onclick="openHomeExportPicker()" title="Export do PDF">📄</button>
      <button class="icon-btn" onclick="openBackup()" title="Záloha">⇅</button>
    </header>
    <div class="search-bar">
      <input id="searchInput" type="text" inputmode="search" placeholder="Hledat závadu, stroj, řešení…" value="${escapeHtml(state.searchTerm)}" />
      ${state.searchTerm ? `<button class="clear-btn" onclick="clearSearch()">✕</button>` : ''}
    </div>
    <main class="content">${body}</main>
  `;

  const input = document.getElementById('searchInput');
  input.addEventListener('input', (e) => {
    state.searchTerm = e.target.value;
    renderHome();
    const el = document.getElementById('searchInput');
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  });

  if (!searchResults) {
    const hallGrid = document.getElementById('hallGrid');
    if (hallGrid) attachHallTileDragReorder(hallGrid);
  }
}

function renderHallTile(hall) {
  const count = (state.categoriesByHall[hall.id] || []).length;
  const styleParts = [];
  if (hall.color) { styleParts.push(`background:${hall.color}`); styleParts.push(`border-left-color:${hall.color}`); }
  if (hall.textColor) styleParts.push(`color:${hall.textColor}`);
  const styleAttr = styleParts.length ? ` style="${styleParts.join(';')}"` : '';
  return `
    <div class="cat-card" data-id="${hall.id}" onclick="openHallDetail('${hall.id}')"${styleAttr}>
      <div class="cat-card-name">${escapeHtml(hall.name)}</div>
      <div class="cat-card-count">${count} ${count === 1 ? 'stroj' : (count >= 2 && count <= 4 ? 'stroje' : 'strojů')}</div>
      <div class="drag-handle" data-id="${hall.id}" onclick="event.stopPropagation()">⠿</div>
    </div>
  `;
}

function renderUnassignedHallTile() {
  const count = (state.categoriesByHall['unassigned'] || []).length;
  return `
    <div class="cat-card unassigned-hall-tile" data-id="unassigned" onclick="openHallDetail('unassigned')">
      <div class="cat-card-name">Bez haly</div>
      <div class="cat-card-count">${count} ${count === 1 ? 'stroj' : (count >= 2 && count <= 4 ? 'stroje' : 'strojů')}</div>
    </div>
  `;
}

// Drag reorder for hall tiles on the home screen — same handle-based pattern as
// machine tiles, just calling reorderHalls instead. The virtual "Bez haly" tile
// has no handle so it's never a drag source; dropping onto it is a harmless no-op.
function attachHallTileDragReorder(gridEl) {
  gridEl.querySelectorAll('.drag-handle').forEach(handle => {
    const card = handle.closest('.cat-card');
    if (!card) return;
    let startX = 0, startY = 0, dragging = false;

    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      startX = e.clientX; startY = e.clientY; dragging = true;
      try { handle.setPointerCapture(e.pointerId); } catch (err) {}
      card.classList.add('dragging');
      if (navigator.vibrate) navigator.vibrate(12);
    });

    handle.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      e.preventDefault();
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      card.style.transform = `translate(${dx}px, ${dy}px) scale(1.04)`;
    });

    async function endDrag(e) {
      if (!dragging) return;
      dragging = false;
      card.style.transform = '';
      card.classList.remove('dragging');
      card.style.pointerEvents = 'none';
      const dropEl = document.elementFromPoint(e.clientX, e.clientY);
      card.style.pointerEvents = '';
      const dropCard = dropEl && dropEl.closest && dropEl.closest('.cat-card');
      if (dropCard && dropCard !== card) {
        await reorderHalls(card.dataset.id, dropCard.dataset.id);
      }
    }

    handle.addEventListener('pointerup', endDrag);
    handle.addEventListener('pointercancel', () => {
      dragging = false;
      card.style.transform = '';
      card.classList.remove('dragging');
    });
  });
}

// ===================== RENDER: HALL DETAIL (machines inside one hall) =====================
function renderHallDetail() {
  const hallId = state.currentHallId;
  const isUnassigned = hallId === 'unassigned';
  const hall = isUnassigned ? null : state.halls.find(h => h.id === hallId);
  const cats = state.categoriesByHall[hallId] || [];
  const name = isUnassigned ? 'Bez haly' : (hall ? hall.name : '');

  app.innerHTML = `
    <header class="topbar">
      <button class="icon-btn" onclick="goHome()">←</button>
      <div class="topbar-title">${escapeHtml(name)}</div>
      ${isUnassigned ? '' : `
        <button class="icon-btn" onclick="openHallColorPicker('${hallId}')" title="Barva">🎨</button>
        <button class="icon-btn" onclick="renameHall('${hallId}')" title="Přejmenovat">✎</button>
        <button class="icon-btn" onclick="deleteHall('${hallId}')" title="Smazat halu">🗑</button>
      `}
    </header>
    <main class="content">
      <div class="cat-toolbar">
        <button class="toolbar-btn" onclick="openNewCategory(${isUnassigned ? 'null' : `'${hallId}'`})">+ Přidat stroj</button>
      </div>
      <div class="cat-grid" id="hallCatGrid">
        ${cats.length === 0 ? `<div class="empty-state">Zatím tu nejsou žádné stroje.</div>` : cats.map(renderCatCard).join('')}
      </div>
    </main>
  `;

  const grid = document.getElementById('hallCatGrid');
  if (grid) attachHomeDragReorder(grid);
}

function openHallDetail(hallId) {
  state.view = 'hall';
  state.currentHallId = hallId;
  render();
}

function renderCatCard(c) {
  const count = (state.entriesByCat[c.id] || []).length;
  const styleParts = [];
  if (c.color) { styleParts.push(`background:${c.color}`); styleParts.push(`border-left-color:${c.color}`); }
  if (c.textColor) styleParts.push(`color:${c.textColor}`);
  const styleAttr = styleParts.length ? ` style="${styleParts.join(';')}"` : '';
  return `
    <div class="cat-card" data-id="${c.id}" onclick="openCategory('${c.id}')"${styleAttr}>
      <div class="cat-card-name">${escapeHtml(c.name)}</div>
      <div class="cat-card-count">${count} ${count === 1 ? 'záznam' : (count >= 2 && count <= 4 ? 'záznamy' : 'záznamů')}</div>
      <div class="drag-handle" data-id="${c.id}" onclick="event.stopPropagation()">⠿</div>
    </div>
  `;
}

function clearSearch() {
  state.searchTerm = '';
  renderHome();
}

// ===================== HOME DRAG REORDER =====================
// Dragging starts only from the small ⠿ handle (not the whole card). This avoids
// the ambiguity between "trying to scroll" and "trying to drag" that made
// whole-card long-press drags unreliable on touch screens.
function attachHomeDragReorder(gridEl) {
  gridEl.querySelectorAll('.drag-handle').forEach(handle => {
    const card = handle.closest('.cat-card');
    if (!card) return;
    let startX = 0, startY = 0, dragging = false, pointerId = null;

    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      startX = e.clientX; startY = e.clientY; dragging = true; pointerId = e.pointerId;
      try { handle.setPointerCapture(pointerId); } catch (err) {}
      card.classList.add('dragging');
      if (navigator.vibrate) navigator.vibrate(12);
    });

    handle.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      e.preventDefault();
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      card.style.transform = `translate(${dx}px, ${dy}px) scale(1.04)`;
    });

    async function endDrag(e) {
      if (!dragging) return;
      dragging = false;
      card.style.transform = '';
      card.classList.remove('dragging');
      card.style.pointerEvents = 'none';
      const dropEl = document.elementFromPoint(e.clientX, e.clientY);
      card.style.pointerEvents = '';
      const dropCard = dropEl && dropEl.closest && dropEl.closest('.cat-card');
      if (dropCard && dropCard !== card) {
        await reorderCategories(card.dataset.id, dropCard.dataset.id);
      }
    }

    handle.addEventListener('pointerup', endDrag);
    handle.addEventListener('pointercancel', () => {
      dragging = false;
      card.style.transform = '';
      card.classList.remove('dragging');
    });
  });
}

async function reorderCategories(dragId, targetId) {
  const dragCat = state.categories.find(c => c.id === dragId);
  const targetCat = state.categories.find(c => c.id === targetId);
  if (!dragCat || !targetCat) return;

  const targetHallKey = targetCat.hallId || null;
  dragCat.hallId = targetHallKey;

  const siblings = state.categories.filter(c => (c.hallId || null) === targetHallKey && c.id !== dragId);
  const targetIdx = siblings.findIndex(c => c.id === targetId);
  siblings.splice(targetIdx, 0, dragCat);
  siblings.forEach((c, i) => { c.order = i; });

  await idbPutMany('categories', siblings);
  await loadAll();
  renderHome();
}

async function reorderHalls(dragId, targetId) {
  const list = state.halls.slice();
  const fromIdx = list.findIndex(h => h.id === dragId);
  const toIdx = list.findIndex(h => h.id === targetId);
  if (fromIdx === -1 || toIdx === -1) return;
  const [moved] = list.splice(fromIdx, 1);
  list.splice(toIdx, 0, moved);
  list.forEach((h, i) => { h.order = i; });
  await idbPutMany('halls', list);
  state.halls = list;
  renderHome();
}

// ===================== HALLS (Stará Hala / Nová Hala apod.) =====================
async function openNewHall() {
  const name = prompt('Název nové haly:');
  if (!name || !name.trim()) return;
  const id = uid();
  const order = state.halls.length;
  await idbPut('halls', { id, name: name.trim(), order });
  await loadAll();
  render();
}

async function renameHall(id) {
  const hall = state.halls.find(h => h.id === id);
  if (!hall) return;
  const name = prompt('Nový název haly:', hall.name);
  if (!name || !name.trim()) return;
  hall.name = name.trim();
  await idbPut('halls', hall);
  await loadAll();
  render();
}

async function deleteHall(id) {
  const hall = state.halls.find(h => h.id === id);
  if (!hall) return;
  if (!confirm(`Smazat halu „${hall.name}“? Stroje v ní zůstanou zachované a přesunou se do „Bez haly“.`)) return;
  const affected = state.categories.filter(c => c.hallId === id);
  affected.forEach(c => { c.hallId = null; });
  if (affected.length) await idbPutMany('categories', affected);
  await idbDelete('halls', id);
  await loadAll();
  if (state.view === 'hall' && state.currentHallId === id) {
    goHome();
  } else {
    render();
  }
}

function openHallColorPicker(hallId) {
  const hall = state.halls.find(h => h.id === hallId);
  if (!hall) return;
  const div = document.createElement('div');
  div.className = 'modal-overlay';
  div.innerHTML = `
    <div class="modal">
      <div class="modal-title">Barva haly — ${escapeHtml(hall.name)}</div>
      <p class="modal-text">Vyber barvu pozadí a barvu textu pro tuto halu.</p>

      <div class="section-label">Barva pozadí</div>
      <div class="swatch-grid">
        ${TILE_PRESET_COLORS.map(hex => `<button class="swatch" style="background:${hex}" onclick="applyHallColor('${hallId}','${hex}')"></button>`).join('')}
      </div>
      <label class="custom-color-row">
        Vlastní barva
        <input type="color" value="${hall.color || '#171f29'}" onchange="applyHallColor('${hallId}', this.value)" />
      </label>

      <div class="section-label" style="margin-top:18px">Barva textu</div>
      <div class="text-color-row">
        <button class="modal-btn" onclick="applyHallTextColor('${hallId}','#e8edf2')">Světlý text</button>
        <button class="modal-btn" onclick="applyHallTextColor('${hallId}','#12181f')">Tmavý text</button>
      </div>
      <label class="custom-color-row">
        Vlastní barva textu
        <input type="color" value="${hall.textColor || '#e8edf2'}" onchange="applyHallTextColor('${hallId}', this.value)" />
      </label>

      <button class="modal-btn" onclick="resetHallColor('${hallId}')" style="margin-top:16px">↺ Výchozí vzhled</button>
      <button class="modal-btn primary" onclick="this.closest('.modal-overlay').remove()">Hotovo</button>
    </div>
  `;
  document.body.appendChild(div);
}

async function applyHallColor(hallId, hex) {
  const hall = state.halls.find(h => h.id === hallId);
  if (!hall) return;
  hall.color = hex;
  await idbPut('halls', hall);
  await loadAll();
  render();
}

async function applyHallTextColor(hallId, hex) {
  const hall = state.halls.find(h => h.id === hallId);
  if (!hall) return;
  hall.textColor = hex;
  await idbPut('halls', hall);
  await loadAll();
  render();
}

async function resetHallColor(hallId) {
  const hall = state.halls.find(h => h.id === hallId);
  if (!hall) return;
  hall.color = null;
  hall.textColor = null;
  await idbPut('halls', hall);
  await loadAll();
  document.querySelectorAll('.modal-overlay').forEach(el => el.remove());
  render();
}

function openHallPicker(categoryId) {
  const cat = state.categories.find(c => c.id === categoryId);
  if (!cat) return;
  const div = document.createElement('div');
  div.className = 'modal-overlay';
  div.innerHTML = `
    <div class="modal">
      <div class="modal-title">Přesunout „${escapeHtml(cat.name)}“ do haly</div>
      <select id="hallPickerSelect" class="field-select">
        <option value="" ${!cat.hallId ? 'selected' : ''}>Bez haly</option>
        ${state.halls.map(h => `<option value="${h.id}" ${cat.hallId === h.id ? 'selected' : ''}>${escapeHtml(h.name)}</option>`).join('')}
      </select>
      <button class="modal-btn primary" style="margin-top:14px" onclick="applyHallPicker('${categoryId}')">Uložit</button>
      <button class="modal-btn" onclick="this.closest('.modal-overlay').remove()">Zrušit</button>
    </div>
  `;
  document.body.appendChild(div);
}

async function applyHallPicker(categoryId) {
  const select = document.getElementById('hallPickerSelect');
  const cat = state.categories.find(c => c.id === categoryId);
  if (!cat || !select) return;
  const newHallId = select.value || null;
  const siblingCount = (state.categoriesByHall[newHallId || 'unassigned'] || []).length;
  cat.hallId = newHallId;
  cat.order = siblingCount;
  await idbPut('categories', cat);
  await loadAll();
  document.querySelectorAll('.modal-overlay').forEach(el => el.remove());
  render();
}

// Same handle-based drag approach as the home screen, applied to the item-group
// rows inside a category. The "Nezařazené" pseudo-group has no handle (not a real
// item) and is skipped automatically since only .item-drag-handle elements wire up.
function attachItemDragReorder(listEl) {
  listEl.querySelectorAll('.item-drag-handle').forEach(handle => {
    const group = handle.closest('.item-group');
    if (!group) return;
    let startX = 0, startY = 0, dragging = false;

    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      startX = e.clientX; startY = e.clientY; dragging = true;
      try { handle.setPointerCapture(e.pointerId); } catch (err) {}
      group.classList.add('dragging');
      if (navigator.vibrate) navigator.vibrate(12);
    });

    handle.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      e.preventDefault();
      const dy = e.clientY - startY;
      group.style.transform = `translateY(${dy}px)`;
    });

    async function endDrag(e) {
      if (!dragging) return;
      dragging = false;
      group.style.transform = '';
      group.classList.remove('dragging');
      group.style.pointerEvents = 'none';
      const dropEl = document.elementFromPoint(e.clientX, e.clientY);
      group.style.pointerEvents = '';
      const dropGroup = dropEl && dropEl.closest && dropEl.closest('.item-group[data-id]');
      if (dropGroup && dropGroup !== group) {
        await reorderItems(group.dataset.id, dropGroup.dataset.id);
      }
    }

    handle.addEventListener('pointerup', endDrag);
    handle.addEventListener('pointercancel', () => {
      dragging = false;
      group.style.transform = '';
      group.classList.remove('dragging');
    });
  });
}

async function reorderItems(dragId, targetId) {
  const list = (state.itemsByCat[state.categoryId] || []).slice();
  const fromIdx = list.findIndex(it => it.id === dragId);
  const toIdx = list.findIndex(it => it.id === targetId);
  if (fromIdx === -1 || toIdx === -1) return;
  const [moved] = list.splice(fromIdx, 1);
  list.splice(toIdx, 0, moved);
  list.forEach((it, i) => { it.order = i; });
  await idbPutMany('items', list);
  await loadAll();
  render();
}

// Reordering entries within one item group (or the Nezařazené bucket). Same
// handle-based drag pattern as everything else; dropping is only meaningful
// onto another entry card, so cross-group drops (which shouldn't happen since
// each entry-list only contains its own group's cards) are naturally excluded.
function attachEntryDragReorder(listEl) {
  listEl.querySelectorAll('.entry-drag-handle').forEach(handle => {
    const card = handle.closest('.entry-card');
    if (!card) return;
    let startY = 0, dragging = false;

    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      startY = e.clientY; dragging = true;
      try { handle.setPointerCapture(e.pointerId); } catch (err) {}
      card.classList.add('dragging');
      if (navigator.vibrate) navigator.vibrate(12);
    });

    handle.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      e.preventDefault();
      const dy = e.clientY - startY;
      card.style.transform = `translateY(${dy}px)`;
    });

    async function endDrag(e) {
      if (!dragging) return;
      dragging = false;
      card.style.transform = '';
      card.classList.remove('dragging');
      card.style.pointerEvents = 'none';
      const dropEl = document.elementFromPoint(e.clientX, e.clientY);
      card.style.pointerEvents = '';
      const dropCard = dropEl && dropEl.closest && dropEl.closest('.entry-card');
      if (dropCard && dropCard !== card && listEl.contains(dropCard)) {
        await reorderEntries(card.dataset.id, dropCard.dataset.id);
      }
    }

    handle.addEventListener('pointerup', endDrag);
    handle.addEventListener('pointercancel', () => {
      dragging = false;
      card.style.transform = '';
      card.classList.remove('dragging');
    });
  });
}

async function reorderEntries(dragId, targetId) {
  const dragEntry = state.allEntries.find(e => e.id === dragId);
  const targetEntry = state.allEntries.find(e => e.id === targetId);
  if (!dragEntry || !targetEntry) return;
  if ((dragEntry.itemId || null) !== (targetEntry.itemId || null)) return;

  const siblings = (state.entriesByCat[state.categoryId] || [])
    .filter(e => (e.itemId || null) === (targetEntry.itemId || null) && e.id !== dragId);
  const targetIdx = siblings.findIndex(e => e.id === targetId);
  siblings.splice(targetIdx, 0, dragEntry);
  siblings.forEach((e, i) => { e.order = i; });

  await idbPutMany('entries', siblings);
  await loadAll();
  render();
}

// ===================== RENDER: CATEGORY =====================
function renderCategory() {
  const cat = state.categories.find(c => c.id === state.categoryId);
  const items = state.itemsByCat[state.categoryId] || [];
  const allEntries = state.entriesByCat[state.categoryId] || [];

  const grouped = {};
  items.forEach(it => { grouped[it.id] = []; });
  const unassigned = [];
  allEntries.forEach(e => {
    if (e.itemId && grouped[e.itemId]) grouped[e.itemId].push(e);
    else unassigned.push(e);
  });

  const groupsHtml = items.map(it => renderItemGroup(it, grouped[it.id] || [])).join('')
    + renderItemGroup(null, unassigned);

  app.innerHTML = `
    <header class="topbar">
      <button class="icon-btn" onclick="categoryBack()">←</button>
      <div class="topbar-title">${escapeHtml(cat ? cat.name : '')}</div>
      <button class="icon-btn" onclick="openColorPicker('${state.categoryId}')" title="Barva dlaždice">🎨</button>
      <button class="icon-btn" onclick="openHallPicker('${state.categoryId}')" title="Přesunout do haly">🏢</button>
      <button class="icon-btn" onclick="renameCategory('${state.categoryId}')" title="Přejmenovat">✎</button>
    </header>
    <main class="content">
      <div class="cat-toolbar">
        <button class="toolbar-btn" onclick="openNewItem('${state.categoryId}')">+ Položka</button>
        <button class="toolbar-btn" onclick="openExportPicker()">📄 Export</button>
      </div>
      <div class="item-group-list">
        ${groupsHtml}
      </div>
    </main>
    <button class="fab" onclick="openNewEntry('${state.categoryId}', null)">+</button>
  `;

  const groupList = document.querySelector('.item-group-list');
  if (groupList) attachItemDragReorder(groupList);
  document.querySelectorAll('.entry-list').forEach(list => attachEntryDragReorder(list));
}

function renderItemGroup(itemOrNull, entries) {
  const key = itemOrNull ? itemOrNull.id : 'unassigned';
  const isOpen = state.expandedItems.has(key);
  const name = itemOrNull ? itemOrNull.name : 'Nezařazené';
  const isUnassigned = !itemOrNull;
  const bulkActiveHere = state.bulkMode && state.bulkGroupKey === key;
  const bulkBar = bulkActiveHere ? renderBulkBar() : '';

  const styleParts = [];
  if (itemOrNull && itemOrNull.color) styleParts.push(`background:${itemOrNull.color}`);
  const headerStyle = styleParts.length ? ` style="${styleParts.join(';')}"` : '';
  const nameStyle = (itemOrNull && itemOrNull.textColor) ? ` style="color:${itemOrNull.textColor}"` : '';

  return `
    <div class="item-group ${isOpen ? 'open' : ''} ${isUnassigned ? 'unassigned-group' : ''}" ${itemOrNull ? `data-id="${itemOrNull.id}"` : ''}>
      <div class="item-header" onclick="toggleItem('${key}')"${headerStyle}>
        <span class="item-chevron">${isOpen ? '▾' : '▸'}</span>
        <span class="item-name"${nameStyle}>${escapeHtml(name)}</span>
        <span class="item-count">${entries.length}</span>
        ${itemOrNull ? `
          <button class="item-icon-btn" onclick="event.stopPropagation(); openItemColorPicker('${itemOrNull.id}')" title="Barva">🎨</button>
          <button class="item-icon-btn" onclick="event.stopPropagation(); renameItem('${itemOrNull.id}')" title="Přejmenovat">✎</button>
          <button class="item-icon-btn" onclick="event.stopPropagation(); openMoveItemPicker('${itemOrNull.id}')" title="Přesunout do jiného stroje">🔀</button>
          <button class="item-icon-btn danger" onclick="event.stopPropagation(); deleteItemGroup('${itemOrNull.id}')" title="Smazat položku">🗑</button>
          <span class="item-drag-handle" data-id="${itemOrNull.id}" onclick="event.stopPropagation()">⠿</span>
        ` : `
          ${entries.length > 0 ? `<button class="item-icon-btn danger" onclick="event.stopPropagation(); deleteUnassigned()" title="Smazat vše nezařazené">🗑</button>` : ''}
        `}
      </div>
      ${isOpen ? `
        <div class="item-body">
          ${entries.length > 0 ? `<button class="item-icon-btn" onclick="toggleBulkMode('${key}')">${bulkActiveHere ? 'Zrušit výběr' : 'Vybrat více'}</button>` : ''}
          ${bulkBar}
          ${entries.length === 0 ? `<div class="empty-state-small">Zatím žádné záznamy.</div>` :
            `<div class="entry-list">${entries.map(e => renderEntryCard(e, false, bulkActiveHere)).join('')}</div>`}
          <button class="add-entry-in-item" onclick="openNewEntry('${state.categoryId}', ${itemOrNull ? `'${itemOrNull.id}'` : 'null'})">+ Přidat záznam sem</button>
        </div>
      ` : ''}
    </div>
  `;
}

function renderBulkBar() {
  const items = state.itemsByCat[state.categoryId] || [];
  return `
    <div class="bulk-bar-sticky">
      <div class="bulk-bar">
        <div class="bulk-count">${state.bulkSelected.size} vybráno</div>
        <button class="bulk-move-btn" ${state.bulkSelected.size < 2 ? 'disabled' : ''} onclick="mergeBulkSelected()" title="Spojí text i fotky vybraných záznamů do jednoho">🔗 Sloučit do jednoho</button>
      </div>
      <div class="bulk-bar">
        <select id="bulkTargetSelect" class="bulk-select">
          ${items.length === 0 ? `<option value="">Nejdřív vytvoř položku</option>` :
            items.map(it => `<option value="${it.id}">${escapeHtml(it.name)}</option>`).join('')}
        </select>
        <button class="bulk-move-btn" ${items.length === 0 || state.bulkSelected.size === 0 ? 'disabled' : ''} onclick="moveBulkSelected()">Přesunout</button>
      </div>
    </div>
  `;
}

function renderEntryCard(e, showCat, showCheckbox) {
  const imgs = e.images || [];
  const vids = e.videos || [];
  const docs = e.documents || [];
  const checked = state.bulkSelected.has(e.id);
  const showDragHandle = !showCat && !showCheckbox;
  const textStyle = e.textColor ? ` style="color:${e.textColor}"` : '';
  return `
    <div class="entry-card" data-id="${e.id}">
      <div class="entry-card-top">
        ${showCheckbox ? `<input type="checkbox" class="entry-checkbox" ${checked ? 'checked' : ''} onchange="toggleBulkSelect('${e.id}')" />` : ''}
        <div class="entry-card-main">
          ${showCat ? `<div class="entry-cat-tag">${escapeHtml(catName(e.categoryId))}</div>` : ''}
          <div class="entry-text"${textStyle}>${escapeHtml(e.text)}</div>
        </div>
        ${showDragHandle ? `<span class="entry-drag-handle" data-id="${e.id}">⠿</span>` : ''}
      </div>
      ${(imgs.length || vids.length) ? `<div class="media-row" id="media-${e.id}"></div>` : ''}
      ${docs.length ? `<div class="doc-list" id="docs-${e.id}"></div>` : ''}
      ${showCheckbox ? '' : `
        <div class="entry-actions">
          <button onclick="openEditEntry('${e.id}')">Upravit</button>
          <button onclick="confirmDeleteEntry('${e.id}')" class="danger">Smazat</button>
        </div>
      `}
    </div>
  `;
}

async function hydrateMediaRows() {
  const rows = document.querySelectorAll('.media-row');
  for (const row of rows) {
    const id = row.id.replace('media-', '');
    const entry = state.allEntries.find(x => x.id === id);
    if (!entry) continue;
    const media = [];
    for (const img of (entry.images || [])) {
      const url = await resolveMediaUrl(img);
      if (url) media.push({ type: 'image', url });
    }
    for (const vid of (entry.videos || [])) {
      const url = await resolveMediaUrl(vid);
      if (url) media.push({ type: 'video', url });
    }

    if (media.length === 0) { row.innerHTML = ''; continue; }

    if (media.length === 1) {
      const m = media[0];
      row.innerHTML = m.type === 'video'
        ? `<div class="thumb thumb-video" onclick="openLightboxForEntry('${id}',0)"><video src="${m.url}" muted playsinline preload="metadata"></video><span class="thumb-play">▶</span></div>`
        : `<img class="thumb" src="${m.url}" onclick="openLightboxForEntry('${id}',0)" />`;
      continue;
    }

    const slides = media.map((m, i) => m.type === 'video'
      ? `<div class="media-slide thumb-video" onclick="openLightboxForEntry('${id}',${i})"><video src="${m.url}" muted playsinline preload="metadata"></video><span class="thumb-play">▶</span></div>`
      : `<div class="media-slide" onclick="openLightboxForEntry('${id}',${i})"><img src="${m.url}" /></div>`
    ).join('');
    const dots = media.map((_, i) => `<span class="media-dot${i === 0 ? ' active' : ''}"></span>`).join('');

    row.innerHTML = `
      <div class="media-carousel">
        <div class="media-carousel-track">${slides}</div>
        <div class="media-dots">${dots}</div>
      </div>
    `;

    const track = row.querySelector('.media-carousel-track');
    const dotEls = row.querySelectorAll('.media-dot');
    let scrollTimer = null;
    track.addEventListener('scroll', () => {
      clearTimeout(scrollTimer);
      scrollTimer = setTimeout(() => {
        const idx = Math.round(track.scrollLeft / track.clientWidth);
        dotEls.forEach((d, i) => d.classList.toggle('active', i === idx));
      }, 60);
    });
  }

  const docRows = document.querySelectorAll('.doc-list[id^="docs-"]');
  for (const row of docRows) {
    const id = row.id.replace('docs-', '');
    const entry = state.allEntries.find(x => x.id === id);
    if (!entry) continue;
    let html = '';
    (entry.documents || []).forEach((doc, i) => {
      html += `<div class="doc-row" onclick="openDocument('${id}',${i})"><span class="doc-icon">${docIcon(doc.name)}</span><span class="doc-name">${escapeHtml(doc.name)}</span><span class="doc-open">⋯</span></div>`;
      prepareDocFile(doc); // warm the cache ahead of time, don't wait for it
    });
    row.innerHTML = html;
  }
}

// Cache of prepared File objects, keyed by mediaId, built ahead of time while the
// card renders — so tapping a document doesn't need to await IndexedDB first.
// That matters because navigator.share() only works when called as a direct
// result of a user gesture; any await beforehand (like an IndexedDB read) can
// cause the browser to no longer treat the tap as "trusted", silently falling
// back to a plain download instead of offering the app picker.
const docFileCache = {};

async function prepareDocFile(doc) {
  if (docFileCache[doc.mediaId]) return docFileCache[doc.mediaId];
  try {
    const rec = doc.type === 'blob' ? await idbGet('media', doc.mediaId) : null;
    const blob = rec ? rec.blob : await (await fetch(await resolveMediaUrl(doc))).blob();
    const file = new File([blob], doc.name, { type: doc.mimeType || (rec && rec.type) || blob.type || 'application/octet-stream' });
    docFileCache[doc.mediaId] = file;
    return file;
  } catch (err) {
    return null;
  }
}

// Tries to hand the file off to Android's "Open with…" / share sheet so it opens
// directly in Excel/Word/a PDF reader/etc. Falls back to a plain download if the
// Web Share API (with files) isn't available, or the file wasn't ready in time.
// Deliberately NOT async up front — navigator.share() is called synchronously
// within the click handler whenever the file is already cached, so the browser
// still sees this as a direct response to the tap.
function openDocument(entryId, docIndex) {
  const entry = state.allEntries.find(x => x.id === entryId);
  if (!entry) return;
  const doc = (entry.documents || [])[docIndex];
  if (!doc) return;

  const cached = docFileCache[doc.mediaId];
  if (cached && navigator.canShare && navigator.share && navigator.canShare({ files: [cached] })) {
    navigator.share({ files: [cached], title: doc.name }).catch(() => {
      // user closed the share sheet or it failed — don't force a surprise download
    });
    return;
  }

  // File wasn't cached yet (rare — render just happened) or Web Share isn't
  // supported here: fall back to a plain download.
  (async () => {
    const file = cached || await prepareDocFile(doc);
    if (file && navigator.canShare && navigator.share && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: doc.name }); return; } catch (err) { /* fall through */ }
    }
    const url = await resolveMediaUrl(doc);
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = doc.name;
    a.target = '_blank';
    document.body.appendChild(a);
    a.click();
    a.remove();
  })();
}

async function openLightboxForEntry(entryId, startIndex) {
  const entry = state.allEntries.find(x => x.id === entryId);
  if (!entry) return;
  const media = [];
  for (const img of (entry.images || [])) {
    const url = await resolveMediaUrl(img);
    if (url) media.push({ type: 'image', url });
  }
  for (const vid of (entry.videos || [])) {
    const url = await resolveMediaUrl(vid);
    if (url) media.push({ type: 'video', url });
  }
  openLightbox(media, startIndex || 0);
}

// ===================== LIGHTBOX (zoomable image / video viewer, swipeable when multiple) =====================
function openLightbox(media, startIndex) {
  let idx = startIndex || 0;
  const overlay = document.createElement('div');
  overlay.className = 'lightbox';
  overlay.innerHTML = `
    <button class="lightbox-close" onclick="this.closest('.lightbox').remove()">✕</button>
    ${media.length > 1 ? `<div class="lightbox-counter" id="lbCounter"></div>` : ''}
    ${media.length > 1 ? `
      <button class="lightbox-nav lightbox-prev" onclick="event.stopPropagation(); window.__lbNav(-1)">‹</button>
      <button class="lightbox-nav lightbox-next" onclick="event.stopPropagation(); window.__lbNav(1)">›</button>
    ` : ''}
    <div class="lightbox-hint">Přiblížíš sevřením prstů${media.length > 1 ? ', přepneš přejetím prstem do strany' : ''}, zavřeš ✕</div>
    <div class="lightbox-viewport" id="lbViewport">
      <div class="lightbox-content" id="lbContent"></div>
    </div>
  `;
  document.body.appendChild(overlay);

  const viewport = document.getElementById('lbViewport');
  const content = document.getElementById('lbContent');
  const counterEl = document.getElementById('lbCounter');

  function navigate(dir) {
    idx = (idx + dir + media.length) % media.length;
    renderSlide();
  }
  window.__lbNav = navigate;

  const nav = setupLightboxNav(viewport, content, media.length, navigate);

  function renderSlide() {
    const item = media[idx];
    content.innerHTML = item.type === 'video'
      ? `<video src="${item.url}" controls playsinline autoplay></video>`
      : `<img src="${item.url}" draggable="false" />`;
    if (counterEl) counterEl.textContent = `${idx + 1} / ${media.length}`;
    nav.resetZoom();
  }
  renderSlide();
}

function setupLightboxNav(viewport, content, mediaLength, onNavigate) {
  let scale = 1, panX = 0, panY = 0;
  const pointers = new Map();
  let startDist = 0, startScale = 1;
  let startPanX = 0, startPanY = 0, startMidX = 0, startMidY = 0;
  let lastTapTime = 0;
  let swipeStartX = 0, swipeDX = 0, singlePointerId = null;

  function apply() {
    content.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
  }
  function resetZoom() {
    scale = 1; panX = 0; panY = 0;
    apply();
  }

  function dist(pts) {
    const [a, b] = pts;
    return Math.hypot(a.x - b.x, a.y - b.y);
  }
  function mid(pts) {
    const [a, b] = pts;
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  viewport.addEventListener('pointerdown', (e) => {
    try { viewport.setPointerCapture(e.pointerId); } catch (err) {}
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.size === 1) {
      singlePointerId = e.pointerId;
      swipeStartX = e.clientX;
      swipeDX = 0;
      startPanX = panX - e.clientX;
      startPanY = panY - e.clientY;
      const now = Date.now();
      if (now - lastTapTime < 320) {
        if (scale > 1) { scale = 1; panX = 0; panY = 0; }
        else { scale = 2.5; }
        apply();
        lastTapTime = 0;
      } else {
        lastTapTime = now;
      }
    } else if (pointers.size === 2) {
      const pts = Array.from(pointers.values());
      startDist = dist(pts);
      startScale = scale;
      const m = mid(pts);
      startMidX = m.x; startMidY = m.y;
      startPanX = panX; startPanY = panY;
    }
  });

  viewport.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.size === 2) {
      e.preventDefault();
      const pts = Array.from(pointers.values());
      const d = dist(pts);
      scale = Math.min(4, Math.max(1, startScale * (d / (startDist || d))));
      const m = mid(pts);
      panX = startPanX + (m.x - startMidX);
      panY = startPanY + (m.y - startMidY);
      apply();
    } else if (pointers.size === 1) {
      if (scale > 1) {
        e.preventDefault();
        panX = e.clientX + startPanX;
        panY = e.clientY + startPanY;
        apply();
      } else if (e.pointerId === singlePointerId) {
        swipeDX = e.clientX - swipeStartX;
      }
    }
  });

  function release(e) {
    if (pointers.size === 1 && scale <= 1 && mediaLength > 1 && e.pointerId === singlePointerId) {
      if (swipeDX > 60) onNavigate(-1);
      else if (swipeDX < -60) onNavigate(1);
    }
    pointers.delete(e.pointerId);
    swipeDX = 0;
    if (scale <= 1) { scale = 1; panX = 0; panY = 0; apply(); }
  }
  viewport.addEventListener('pointerup', release);
  viewport.addEventListener('pointercancel', release);

  return { resetZoom };
}

// ===================== ITEMS (položky) =====================
function toggleItem(key) {
  if (state.expandedItems.has(key)) state.expandedItems.delete(key);
  else state.expandedItems.add(key);
  render();
}

async function openNewItem(categoryId) {
  const name = prompt('Název položky (např. Nůž, Válečky, Kamera…):');
  if (!name || !name.trim()) return;
  const id = uid();
  const order = (state.itemsByCat[categoryId] || []).length;
  const item = { id, categoryId, name: name.trim(), order };
  await idbPut('items', item);
  await loadAll();
  state.expandedItems.add(id);
  render();
}

async function renameItem(id) {
  const it = state.items.find(x => x.id === id);
  if (!it) return;
  const name = prompt('Nový název položky:', it.name);
  if (!name || !name.trim()) return;
  it.name = name.trim();
  await idbPut('items', it);
  await loadAll();
  render();
}

async function deleteItemGroup(id) {
  const it = state.items.find(x => x.id === id);
  if (!it) return;
  if (!confirm(`Smazat položku „${it.name}“? Záznamy v ní zůstanou zachované a přesunou se do Nezařazené.`)) return;
  const affected = state.allEntries.filter(e => e.itemId === id);
  affected.forEach(e => { e.itemId = null; });
  if (affected.length) await idbPutMany('entries', affected);
  await idbDelete('items', id);
  state.expandedItems.delete(id);
  await loadAll();
  render();
}

function openMoveItemPicker(itemId) {
  const item = state.items.find(x => x.id === itemId);
  if (!item) return;
  const otherCats = state.categories.filter(c => c.id !== state.categoryId);
  const div = document.createElement('div');
  div.className = 'modal-overlay';
  div.innerHTML = `
    <div class="modal">
      <div class="modal-title">Přesunout „${escapeHtml(item.name)}“ do jiného stroje</div>
      <p class="modal-text">Položka i všechny její záznamy (texty, fotky, videa) se přesunou do vybraného stroje.</p>
      <select id="moveItemSelect" class="field-select">
        ${otherCats.length === 0 ? `<option value="">Žádný jiný stroj neexistuje</option>` :
          otherCats.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('')}
      </select>
      <button class="modal-btn primary" style="margin-top:14px" ${otherCats.length === 0 ? 'disabled' : ''} onclick="applyMoveItem('${itemId}')">Přesunout</button>
      <button class="modal-btn" onclick="this.closest('.modal-overlay').remove()">Zrušit</button>
    </div>
  `;
  document.body.appendChild(div);
}

async function applyMoveItem(itemId) {
  const select = document.getElementById('moveItemSelect');
  const item = state.items.find(x => x.id === itemId);
  if (!item || !select || !select.value) return;
  const targetCategoryId = select.value;

  const order = (state.itemsByCat[targetCategoryId] || []).length;
  item.categoryId = targetCategoryId;
  item.order = order;
  await idbPut('items', item);

  const affected = state.allEntries.filter(e => e.itemId === itemId);
  affected.forEach(e => { e.categoryId = targetCategoryId; });
  if (affected.length) await idbPutMany('entries', affected);

  await loadAll();
  document.querySelectorAll('.modal-overlay').forEach(el => el.remove());
  openCategory(targetCategoryId);
}

async function deleteUnassigned() {
  const entries = (state.entriesByCat[state.categoryId] || []).filter(e => !e.itemId);
  if (!entries.length) return;
  if (!confirm(`Opravdu trvale smazat všech ${entries.length} nezařazených záznamů? Tuto akci nelze vrátit zpět.`)) return;
  for (const e of entries) {
    await idbDelete('entries', e.id);
  }
  await loadAll();
  render();
}

// ===================== BULK MOVE / MERGE =====================
function toggleBulkMode(groupKey) {
  if (state.bulkMode && state.bulkGroupKey === groupKey) {
    state.bulkMode = false;
    state.bulkGroupKey = null;
  } else {
    state.bulkMode = true;
    state.bulkGroupKey = groupKey;
  }
  state.bulkSelected = new Set();
  render();
}

function toggleBulkSelect(entryId) {
  if (state.bulkSelected.has(entryId)) state.bulkSelected.delete(entryId);
  else state.bulkSelected.add(entryId);
  render();
}

async function moveBulkSelected() {
  const select = document.getElementById('bulkTargetSelect');
  if (!select || !select.value) return;
  const targetItemId = select.value;
  const ids = Array.from(state.bulkSelected);
  const toUpdate = state.allEntries.filter(e => ids.includes(e.id));
  toUpdate.forEach(e => { e.itemId = targetItemId; });
  await idbPutMany('entries', toUpdate);
  state.bulkMode = false;
  state.bulkGroupKey = null;
  state.bulkSelected = new Set();
  state.expandedItems.add(targetItemId);
  await loadAll();
  render();
}

async function mergeBulkSelected() {
  const ids = Array.from(state.bulkSelected);
  if (ids.length < 2) return;
  if (!confirm(`Sloučit vybraných ${ids.length} záznamů do jednoho? Text i fotky se spojí, ostatní záznamy zmizí (jejich obsah zůstane v tom sloučeném). Půjde to pak ještě ručně doladit.`)) return;

  const selected = state.allEntries
    .filter(e => ids.includes(e.id))
    .sort((a, b) => (a.order || 0) - (b.order || 0));
  const base = selected[0];
  const mergedText = selected.map(e => e.text).filter(t => t && t.trim()).join('\n\n');
  const mergedImages = selected.flatMap(e => e.images || []);
  const mergedVideos = selected.flatMap(e => e.videos || []);
  const mergedDocuments = selected.flatMap(e => e.documents || []);

  base.text = mergedText;
  base.images = mergedImages;
  base.videos = mergedVideos;
  base.documents = mergedDocuments;
  base.updatedAt = Date.now();
  await idbPut('entries', base);

  for (const e of selected.slice(1)) {
    await idbDelete('entries', e.id);
  }

  state.bulkMode = false;
  state.bulkGroupKey = null;
  state.bulkSelected = new Set();
  await loadAll();
  openEditEntry(base.id);
}

// ===================== NAVIGATION =====================
function goHome() {
  state.view = 'home';
  state.categoryId = null;
  state.currentHallId = null;
  render();
}

function categoryBack() {
  const cat = state.categories.find(c => c.id === state.categoryId);
  if (cat && cat.hallId) {
    openHallDetail(cat.hallId);
  } else if (cat) {
    openHallDetail('unassigned');
  } else {
    goHome();
  }
}

function openCategory(id) {
  state.view = 'category';
  state.categoryId = id;
  state.searchTerm = '';
  state.expandedItems = new Set(['unassigned']);
  state.bulkMode = false;
  state.bulkGroupKey = null;
  state.bulkSelected = new Set();
  render();
}

async function openNewCategory(hallId) {
  const name = prompt('Název nového stroje / kategorie:');
  if (!name || !name.trim()) return;
  const id = uid();
  const siblingCount = hallId ? (state.categoriesByHall[hallId] || []).length : (state.categoriesByHall['unassigned'] || []).length;
  const cat = { id, name: name.trim(), order: siblingCount, hallId: hallId || null };
  await idbPut('categories', cat);
  await loadAll();
  render();
}

async function renameCategory(id) {
  const cat = state.categories.find(c => c.id === id);
  if (!cat) return;
  const name = prompt('Nový název:', cat.name);
  if (!name || !name.trim()) return;
  cat.name = name.trim();
  await idbPut('categories', cat);
  await loadAll();
  render();
}

// ===================== COLOR PICKER =====================
const TILE_PRESET_COLORS = [
  '#171f29', '#1e293b', '#1e3a5f', '#0f4c4c', '#164e3a',
  '#5c4a1e', '#7a3a1e', '#5c1e2e', '#4a1e5c', '#2b3a4a',
  '#e8edf2', '#f0a83c'
];

function openColorPicker(categoryId) {
  const cat = state.categories.find(c => c.id === categoryId);
  if (!cat) return;
  const div = document.createElement('div');
  div.className = 'modal-overlay';
  div.innerHTML = `
    <div class="modal">
      <div class="modal-title">Barva stroje — ${escapeHtml(cat.name)}</div>
      <p class="modal-text">Vyber barvu dlaždice a barvu textu na hlavní obrazovce.</p>

      <div class="section-label">Barva dlaždice</div>
      <div class="swatch-grid">
        ${TILE_PRESET_COLORS.map(hex => `<button class="swatch" style="background:${hex}" onclick="applyCategoryColor('${categoryId}','${hex}')"></button>`).join('')}
      </div>
      <label class="custom-color-row">
        Vlastní barva
        <input type="color" value="${cat.color || '#171f29'}" onchange="applyCategoryColor('${categoryId}', this.value)" />
      </label>

      <div class="section-label" style="margin-top:18px">Barva textu</div>
      <div class="text-color-row">
        <button class="modal-btn" onclick="applyCategoryTextColor('${categoryId}','#e8edf2')">Světlý text</button>
        <button class="modal-btn" onclick="applyCategoryTextColor('${categoryId}','#12181f')">Tmavý text</button>
      </div>
      <label class="custom-color-row">
        Vlastní barva textu
        <input type="color" value="${cat.textColor || '#e8edf2'}" onchange="applyCategoryTextColor('${categoryId}', this.value)" />
      </label>

      <button class="modal-btn" onclick="resetCategoryColor('${categoryId}')" style="margin-top:16px">↺ Výchozí vzhled</button>
      <button class="modal-btn primary" onclick="this.closest('.modal-overlay').remove()">Hotovo</button>
    </div>
  `;
  document.body.appendChild(div);
}

async function applyCategoryColor(categoryId, hex) {
  const cat = state.categories.find(c => c.id === categoryId);
  if (!cat) return;
  cat.color = hex;
  await idbPut('categories', cat);
  await loadAll();
  if (state.view === 'category' || state.view === 'home') render();
}

async function applyCategoryTextColor(categoryId, hex) {
  const cat = state.categories.find(c => c.id === categoryId);
  if (!cat) return;
  cat.textColor = hex;
  await idbPut('categories', cat);
  await loadAll();
  if (state.view === 'category' || state.view === 'home') render();
}

async function resetCategoryColor(categoryId) {
  const cat = state.categories.find(c => c.id === categoryId);
  if (!cat) return;
  cat.color = null;
  cat.textColor = null;
  await idbPut('categories', cat);
  await loadAll();
  document.querySelectorAll('.modal-overlay').forEach(el => el.remove());
  render();
}

function openItemColorPicker(itemId) {
  const it = state.items.find(x => x.id === itemId);
  if (!it) return;
  const div = document.createElement('div');
  div.className = 'modal-overlay';
  div.innerHTML = `
    <div class="modal">
      <div class="modal-title">Barva položky — ${escapeHtml(it.name)}</div>
      <p class="modal-text">Vyber barvu pozadí a barvu textu pro tuto položku.</p>

      <div class="section-label">Barva pozadí</div>
      <div class="swatch-grid">
        ${TILE_PRESET_COLORS.map(hex => `<button class="swatch" style="background:${hex}" onclick="applyItemColor('${itemId}','${hex}')"></button>`).join('')}
      </div>
      <label class="custom-color-row">
        Vlastní barva
        <input type="color" value="${it.color || '#171f29'}" onchange="applyItemColor('${itemId}', this.value)" />
      </label>

      <div class="section-label" style="margin-top:18px">Barva textu</div>
      <div class="text-color-row">
        <button class="modal-btn" onclick="applyItemTextColor('${itemId}','#e8edf2')">Světlý text</button>
        <button class="modal-btn" onclick="applyItemTextColor('${itemId}','#12181f')">Tmavý text</button>
      </div>
      <label class="custom-color-row">
        Vlastní barva textu
        <input type="color" value="${it.textColor || '#e8edf2'}" onchange="applyItemTextColor('${itemId}', this.value)" />
      </label>

      <button class="modal-btn" onclick="resetItemColor('${itemId}')" style="margin-top:16px">↺ Výchozí vzhled</button>
      <button class="modal-btn primary" onclick="this.closest('.modal-overlay').remove()">Hotovo</button>
    </div>
  `;
  document.body.appendChild(div);
}

async function applyItemColor(itemId, hex) {
  const it = state.items.find(x => x.id === itemId);
  if (!it) return;
  it.color = hex;
  await idbPut('items', it);
  await loadAll();
  render();
}

async function applyItemTextColor(itemId, hex) {
  const it = state.items.find(x => x.id === itemId);
  if (!it) return;
  it.textColor = hex;
  await idbPut('items', it);
  await loadAll();
  render();
}

async function resetItemColor(itemId) {
  const it = state.items.find(x => x.id === itemId);
  if (!it) return;
  it.color = null;
  it.textColor = null;
  await idbPut('items', it);
  await loadAll();
  document.querySelectorAll('.modal-overlay').forEach(el => el.remove());
  render();
}

// ===================== ENTRY FORM =====================
let formDraft = null;

function openNewEntry(categoryId, itemId) {
  formDraft = { id: uid(), categoryId, itemId: itemId || null, text: '', textColor: null, images: [], videos: [], documents: [], isNew: true };
  state.view = 'entry-form';
  render();
}

function openEditEntry(entryId) {
  const e = state.allEntries.find(x => x.id === entryId);
  if (!e) return;
  formDraft = JSON.parse(JSON.stringify(e));
  formDraft.isNew = false;
  formDraft.documents = formDraft.documents || [];
  state.categoryId = e.categoryId;
  state.view = 'entry-form';
  render();
}

async function renderEntryForm() {
  const items = state.itemsByCat[formDraft.categoryId] || [];
  app.innerHTML = `
    <header class="topbar">
      <button class="icon-btn" onclick="cancelForm()">←</button>
      <div class="topbar-title">${formDraft.isNew ? 'Nový záznam' : 'Upravit záznam'}</div>
      <button class="icon-btn primary" onclick="saveForm()" title="Uložit">✓</button>
    </header>
    <main class="content">
      <label class="field-label">Položka (skupina)</label>
      <select id="entryItemSelect" class="field-select">
        <option value="" ${!formDraft.itemId ? 'selected' : ''}>Bez položky (Nezařazené)</option>
        ${items.map(it => `<option value="${it.id}" ${formDraft.itemId === it.id ? 'selected' : ''}>${escapeHtml(it.name)}</option>`).join('')}
        <option value="__new__">+ Nová položka…</option>
      </select>

      <div class="field-label-row">
        <label class="field-label" style="margin:0">Popis závady / řešení</label>
        <button type="button" class="voice-btn" onclick="openVoiceRecorder()">🎙 Namluvit</button>
      </div>
      <textarea id="entryText" rows="8" placeholder="Popiš problém a jak se řeší…">${escapeHtml(formDraft.text)}</textarea>

      <label class="field-label">Barva textu (nepovinné)</label>
      <div class="entry-color-row">
        <button type="button" class="modal-btn" style="margin:0;flex:1" onclick="setEntryTextColor(null)">Výchozí</button>
        <button type="button" class="modal-btn" style="margin:0;flex:1" onclick="setEntryTextColor('#e8edf2')">Světlá</button>
        <button type="button" class="modal-btn" style="margin:0;flex:1" onclick="setEntryTextColor('#f0a83c')">Zvýraznit</button>
        <input type="color" id="entryTextColorPicker" value="${formDraft.textColor || '#e8edf2'}" onchange="setEntryTextColor(this.value)" />
      </div>
      <div class="entry-color-preview" id="entryColorPreview"${formDraft.textColor ? ` style="color:${formDraft.textColor}"` : ''}>Náhled textu takhle bude vypadat</div>

      <label class="field-label">Fotky</label>
      <div class="media-row" id="formImages"></div>
      <div class="media-add-row">
        <label class="media-add-btn">📷 Foto
          <input type="file" accept="image/*" capture="environment" multiple style="display:none" onchange="addImages(event)" />
        </label>
        <label class="media-add-btn">🖼 Galerie
          <input type="file" accept="image/*" multiple style="display:none" onchange="addImages(event)" />
        </label>
      </div>

      <label class="field-label">Videa</label>
      <div class="media-row" id="formVideos"></div>
      <div class="media-add-row">
        <label class="media-add-btn">🎥 Video
          <input type="file" accept="video/*" capture="environment" style="display:none" onchange="addVideos(event)" />
        </label>
        <label class="media-add-btn">📼 Z galerie
          <input type="file" accept="video/*" multiple style="display:none" onchange="addVideos(event)" />
        </label>
      </div>

      <label class="field-label">Dokumenty</label>
      <div class="doc-list" id="formDocs"></div>
      <div class="media-add-row">
        <label class="media-add-btn">📎 Přidat dokument
          <input type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.ods,.odt,.csv,.txt,.rtf" multiple style="display:none" onchange="addDocuments(event)" />
        </label>
      </div>
    </main>
  `;
  document.getElementById('entryText').addEventListener('input', (e) => { formDraft.text = e.target.value; });
  document.getElementById('entryItemSelect').addEventListener('change', async (e) => {
    if (e.target.value === '__new__') {
      const name = prompt('Název nové položky:');
      if (name && name.trim()) {
        const id = uid();
        const order = (state.itemsByCat[formDraft.categoryId] || []).length;
        const item = { id, categoryId: formDraft.categoryId, name: name.trim(), order };
        await idbPut('items', item);
        await loadAll();
        formDraft.itemId = id;
      } else {
        formDraft.itemId = null;
      }
      renderEntryForm();
    } else {
      formDraft.itemId = e.target.value || null;
    }
  });
  await hydrateFormMedia();
}

async function hydrateFormMedia() {
  const imgWrap = document.getElementById('formImages');
  const vidWrap = document.getElementById('formVideos');
  const docWrap = document.getElementById('formDocs');
  let imgHtml = '';
  for (let i = 0; i < formDraft.images.length; i++) {
    const url = await resolveMediaUrl(formDraft.images[i]);
    imgHtml += `<div class="thumb-wrap"><img class="thumb" src="${url}" /><button class="thumb-remove" onclick="removeImage(${i})">✕</button></div>`;
  }
  imgWrap.innerHTML = imgHtml || '<span class="hint">Zatím žádné fotky</span>';

  let vidHtml = '';
  for (let i = 0; i < formDraft.videos.length; i++) {
    const url = await resolveMediaUrl(formDraft.videos[i]);
    vidHtml += `<div class="thumb-wrap"><video class="thumb" src="${url}" controls></video><button class="thumb-remove" onclick="removeVideo(${i})">✕</button></div>`;
  }
  vidWrap.innerHTML = vidHtml || '<span class="hint">Zatím žádná videa</span>';

  let docHtml = '';
  for (let i = 0; i < (formDraft.documents || []).length; i++) {
    const doc = formDraft.documents[i];
    docHtml += `<div class="doc-row"><span class="doc-icon">${docIcon(doc.name)}</span><span class="doc-name">${escapeHtml(doc.name)}</span><button class="doc-remove" onclick="removeDocument(${i})">✕</button></div>`;
  }
  docWrap.innerHTML = docHtml || '<span class="hint">Zatím žádné dokumenty</span>';
}

function docIcon(name) {
  const ext = (name || '').split('.').pop().toLowerCase();
  if (['xls', 'xlsx', 'ods', 'csv'].includes(ext)) return '📊';
  if (['doc', 'docx', 'odt', 'rtf'].includes(ext)) return '📝';
  if (ext === 'pdf') return '📕';
  return '📄';
}

async function addImages(event) {
  const files = Array.from(event.target.files || []);
  for (const f of files) {
    const mediaId = await fileToBlobRecord(f);
    formDraft.images.push({ type: 'blob', mediaId });
  }
  await hydrateFormMedia();
}

async function addVideos(event) {
  const files = Array.from(event.target.files || []);
  for (const f of files) {
    const mediaId = await fileToBlobRecord(f);
    formDraft.videos.push({ type: 'blob', mediaId });
  }
  await hydrateFormMedia();
}

async function addDocuments(event) {
  const files = Array.from(event.target.files || []);
  for (const f of files) {
    const mediaId = await fileToBlobRecord(f);
    formDraft.documents.push({ type: 'blob', mediaId, name: f.name, mimeType: f.type });
  }
  await hydrateFormMedia();
}

function removeImage(i) { formDraft.images.splice(i, 1); hydrateFormMedia(); }
function removeVideo(i) { formDraft.videos.splice(i, 1); hydrateFormMedia(); }
function removeDocument(i) { formDraft.documents.splice(i, 1); hydrateFormMedia(); }

function setEntryTextColor(hex) {
  formDraft.textColor = hex;
  const preview = document.getElementById('entryColorPreview');
  if (preview) preview.style.color = hex || '';
  const picker = document.getElementById('entryTextColorPicker');
  if (picker && hex) picker.value = hex;
}

// ===================== PDF EXPORT (for NotebookLM etc.) =====================
function openHomeExportPicker() {
  const div = document.createElement('div');
  div.className = 'modal-overlay';
  div.innerHTML = `
    <div class="modal">
      <div class="modal-title">📄 Export do PDF</div>
      <p class="modal-text">Vyber stroje, které chceš dostat do jednoho PDF souboru (s texty i fotkami) — jeden, víc, nebo úplně všechny.</p>
      <div class="export-check-list">
        ${state.categories.map(c => {
          const count = (state.entriesByCat[c.id] || []).length;
          return `
            <label class="export-check-row">
              <input type="checkbox" class="export-check-home" value="${c.id}" />
              <span>${escapeHtml(c.name)}</span>
              <span class="export-check-count">${count}</span>
            </label>
          `;
        }).join('')}
      </div>
      <button class="modal-btn" onclick="exportSelectAllHome()">Vybrat vše</button>
      <button class="modal-btn primary" onclick="runHomeExportPdf()">Vygenerovat PDF</button>
      <button class="modal-btn" onclick="this.closest('.modal-overlay').remove()">Zrušit</button>
      <div id="exportProgress" class="voice-progress"></div>
    </div>
  `;
  document.body.appendChild(div);
}

function exportSelectAllHome() {
  document.querySelectorAll('.export-check-home').forEach(el => { el.checked = true; });
}

async function runHomeExportPdf() {
  const checkedCatIds = Array.from(document.querySelectorAll('.export-check-home:checked')).map(el => el.value);
  const progressEl = document.getElementById('exportProgress');
  if (!checkedCatIds.length) {
    if (progressEl) progressEl.textContent = 'Vyber aspoň jeden stroj.';
    return;
  }
  if (progressEl) progressEl.textContent = 'Připravuji PDF…';

  try {
    const sections = [];
    for (const catId of checkedCatIds) {
      const cat = state.categories.find(c => c.id === catId);
      if (!cat) continue;
      const items = state.itemsByCat[catId] || [];
      const allEntries = state.entriesByCat[catId] || [];
      sections.push({ heading: cat.name, level: 1 });
      items.forEach(it => {
        const groupEntries = allEntries.filter(e => e.itemId === it.id);
        if (groupEntries.length) sections.push({ heading: it.name, level: 2, entries: groupEntries });
      });
      const unassigned = allEntries.filter(e => !e.itemId);
      if (unassigned.length) sections.push({ heading: 'Nezařazené', level: 2, entries: unassigned });
    }

    const title = checkedCatIds.length === state.categories.length
      ? 'Údržba strojů — kompletní export'
      : 'Údržba strojů — export';
    const filenameBase = checkedCatIds.length === 1
      ? (state.categories.find(c => c.id === checkedCatIds[0]) || {}).name || 'export'
      : `vyber-${checkedCatIds.length}-stroju`;

    await buildAndSavePdf(sections, title, filenameBase, progressEl);
    document.querySelectorAll('.modal-overlay').forEach(el => el.remove());
  } catch (err) {
    if (progressEl) progressEl.textContent = 'Export se nepovedl — zkontroluj internet (knihovna pro PDF se stahuje z webu) a zkus to znovu.';
  }
}

function openExportPicker() {
  const items = state.itemsByCat[state.categoryId] || [];
  const allEntries = state.entriesByCat[state.categoryId] || [];
  const unassignedCount = allEntries.filter(e => !e.itemId).length;
  const cat = state.categories.find(c => c.id === state.categoryId);

  const rows = [];
  items.forEach(it => {
    const count = allEntries.filter(e => e.itemId === it.id).length;
    rows.push({ key: it.id, label: it.name, count });
  });
  if (unassignedCount > 0) rows.push({ key: 'unassigned', label: 'Nezařazené', count: unassignedCount });

  const div = document.createElement('div');
  div.className = 'modal-overlay';
  div.innerHTML = `
    <div class="modal">
      <div class="modal-title">📄 Export do PDF — ${escapeHtml(cat ? cat.name : '')}</div>
      <p class="modal-text">Vyber položky, které chceš dostat do jednoho PDF souboru (s texty i fotkami). Jde vybrat jednu, víc, nebo úplně všechny.</p>
      <div class="export-check-list">
        ${rows.length === 0 ? `<div class="hint">Zatím tu nejsou žádné záznamy.</div>` : rows.map(r => `
          <label class="export-check-row">
            <input type="checkbox" class="export-check" value="${r.key}" />
            <span>${escapeHtml(r.label)}</span>
            <span class="export-check-count">${r.count}</span>
          </label>
        `).join('')}
      </div>
      ${rows.length > 0 ? `<button class="modal-btn" onclick="exportSelectAll()">Vybrat vše</button>` : ''}
      <button class="modal-btn primary" onclick="runExportPdf()">Vygenerovat PDF</button>
      <button class="modal-btn" onclick="this.closest('.modal-overlay').remove()">Zrušit</button>
      <div id="exportProgress" class="voice-progress"></div>
    </div>
  `;
  document.body.appendChild(div);
}

function exportSelectAll() {
  document.querySelectorAll('.export-check').forEach(el => { el.checked = true; });
}

function urlToDataInfo(url) {
  return new Promise((resolve, reject) => {
    fetch(url).then(r => r.blob()).then(blob => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const img = new Image();
        img.onload = () => resolve({ dataUrl: reader.result, width: img.naturalWidth, height: img.naturalHeight, isPng: blob.type.includes('png') });
        img.onerror = () => reject(new Error('img decode failed'));
        img.src = reader.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    }).catch(reject);
  });
}

async function buildAndSavePdf(sections, docTitle, filenameBase, progressEl) {
  const { jsPDF } = await import('https://cdn.jsdelivr.net/npm/jspdf@2.5.2/+esm');
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 40;
  const contentW = pageW - margin * 2;
  let y = margin;

  function ensureSpace(neededHeight) {
    if (y + neededHeight > pageH - margin) {
      doc.addPage();
      y = margin;
    }
  }

  doc.setFontSize(18);
  doc.setFont(undefined, 'bold');
  const titleLines = doc.splitTextToSize(docTitle, contentW);
  doc.text(titleLines, margin, y);
  y += titleLines.length * 22 + 14;
  doc.setFont(undefined, 'normal');

  for (const section of sections) {
    const level = section.level || 2;
    if (level === 1) {
      ensureSpace(46);
      y += 10;
      doc.setDrawColor(230, 168, 60);
      doc.setLineWidth(1.2);
      doc.line(margin, y, pageW - margin, y);
      y += 20;
      doc.setFontSize(16);
      doc.setFont(undefined, 'bold');
      doc.text(section.heading, margin, y);
      y += 22;
      doc.setFont(undefined, 'normal');
      doc.setFontSize(10.5);
      continue;
    }

    ensureSpace(30);
    y += 6;
    doc.setFontSize(13);
    doc.setFont(undefined, 'bold');
    doc.text(section.heading, margin, y);
    y += 18;
    doc.setFont(undefined, 'normal');
    doc.setFontSize(10.5);

    for (const entry of (section.entries || [])) {
      if (progressEl) progressEl.textContent = `Zpracovávám: ${section.heading}…`;
      const text = (entry.text || '').trim();
      if (text) {
        const lines = doc.splitTextToSize(text, contentW);
        ensureSpace(lines.length * 13 + 6);
        doc.text(lines, margin, y);
        y += lines.length * 13 + 6;
      }
      for (const img of (entry.images || [])) {
        try {
          const url = await resolveMediaUrl(img);
          if (!url) continue;
          const info = await urlToDataInfo(url);
          let w = contentW * 0.6;
          let h = w * (info.height / info.width);
          const maxH = pageH - margin * 2;
          if (h > maxH) { h = maxH; w = h * (info.width / info.height); }
          ensureSpace(h + 10);
          doc.addImage(info.dataUrl, info.isPng ? 'PNG' : 'JPEG', margin, y, w, h);
          y += h + 10;
        } catch (err) { /* skip image that fails to load */ }
      }
      if ((entry.videos || []).length) {
        ensureSpace(14);
        doc.setTextColor(140, 140, 140);
        doc.text('[Video — dostupné jen v appce, do PDF se nedá vložit]', margin, y);
        doc.setTextColor(0, 0, 0);
        y += 16;
      }
      if ((entry.documents || []).length) {
        ensureSpace(14);
        doc.setTextColor(140, 140, 140);
        const docNames = entry.documents.map(d => d.name).join(', ');
        const docLines = doc.splitTextToSize(`[Přiložené dokumenty (jen v appce): ${docNames}]`, contentW);
        doc.text(docLines, margin, y);
        doc.setTextColor(0, 0, 0);
        y += docLines.length * 13 + 4;
      }
      ensureSpace(10);
      y += 8;
    }
  }

  const fname = `udrzba-${filenameBase.replace(/[^a-z0-9á-žÁ-Ž_\- ]/gi, '').trim().replace(/\s+/g, '-')}.pdf`;
  doc.save(fname);
}

async function runExportPdf() {
  const checked = Array.from(document.querySelectorAll('.export-check:checked')).map(el => el.value);
  const progressEl = document.getElementById('exportProgress');
  if (!checked.length) {
    if (progressEl) progressEl.textContent = 'Vyber aspoň jednu položku.';
    return;
  }
  if (progressEl) progressEl.textContent = 'Připravuji PDF…';

  try {
    const cat = state.categories.find(c => c.id === state.categoryId);
    const items = state.itemsByCat[state.categoryId] || [];
    const allEntries = state.entriesByCat[state.categoryId] || [];

    const sections = checked.map(key => {
      const groupName = key === 'unassigned' ? 'Nezařazené' : (items.find(it => it.id === key) || {}).name || '';
      const groupEntries = key === 'unassigned'
        ? allEntries.filter(e => !e.itemId)
        : allEntries.filter(e => e.itemId === key);
      return { heading: groupName, level: 2, entries: groupEntries };
    });

    await buildAndSavePdf(sections, `${cat ? cat.name : ''} — Údržba strojů`, cat ? cat.name : 'export', progressEl);
    document.querySelectorAll('.modal-overlay').forEach(el => el.remove());
  } catch (err) {
    if (progressEl) progressEl.textContent = 'Export se nepovedl — zkontroluj internet (knihovna pro PDF se stahuje z webu) a zkus to znovu.';
  }
}

// ===================== VOICE RECORDING + OFFLINE TRANSCRIPTION =====================
// Records audio with MediaRecorder, then transcribes it fully offline in the browser
// using a Whisper model (via transformers.js). The model itself (tens of MB) is
// fetched from a CDN and cached by the browser the first time it's used — after that,
// transcription works without an internet connection. No API keys, no server involved.
let voiceRecorderState = null;
let cachedTranscriber = null;

function openVoiceRecorder() {
  const div = document.createElement('div');
  div.className = 'modal-overlay';
  div.innerHTML = `
    <div class="modal">
      <div class="modal-title">🎙 Namluvit poznámku</div>
      <p class="modal-text" id="voiceStatus">Nahraj hlasovku, appka ji pak offline přepíše do textu. První přepis potřebuje internet (stáhne se model, cca 40&nbsp;MB), další už fungují bez signálu.</p>

      <div class="voice-recorder-box">
        <div class="voice-timer" id="voiceTimer">00:00</div>
        <div class="voice-controls" id="voiceControls">
          <button class="voice-record-btn" id="voiceRecordBtn" onclick="voiceStartRecording()">● Nahrávat</button>
        </div>
        <div id="voicePlaybackWrap" style="display:none"></div>
      </div>

      <button class="modal-btn" onclick="this.closest('.modal-overlay').remove()">Zavřít</button>
    </div>
  `;
  document.body.appendChild(div);
  voiceRecorderState = { mediaRecorder: null, chunks: [], stream: null, timerInterval: null, seconds: 0, blob: null };
}

async function voiceStartRecording() {
  const statusEl = document.getElementById('voiceStatus');
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    voiceRecorderState.stream = stream;
    const mr = new MediaRecorder(stream);
    voiceRecorderState.mediaRecorder = mr;
    voiceRecorderState.chunks = [];
    mr.ondataavailable = (e) => { if (e.data.size > 0) voiceRecorderState.chunks.push(e.data); };
    mr.onstop = () => {
      voiceRecorderState.blob = new Blob(voiceRecorderState.chunks, { type: mr.mimeType || 'audio/webm' });
      stream.getTracks().forEach(t => t.stop());
      voiceShowPlayback();
    };
    mr.start();
    voiceRecorderState.seconds = 0;
    voiceRecorderState.timerInterval = setInterval(() => {
      voiceRecorderState.seconds++;
      const m = String(Math.floor(voiceRecorderState.seconds / 60)).padStart(2, '0');
      const s = String(voiceRecorderState.seconds % 60).padStart(2, '0');
      const t = document.getElementById('voiceTimer');
      if (t) t.textContent = `${m}:${s}`;
    }, 1000);

    document.getElementById('voiceControls').innerHTML = `
      <button class="voice-record-btn recording" onclick="voiceStopRecording()">■ Zastavit</button>
    `;
    if (statusEl) statusEl.textContent = 'Nahrávám… mluv zřetelně, klidně i delší souvislý text.';
  } catch (err) {
    if (statusEl) statusEl.textContent = 'Nepodařilo se získat přístup k mikrofonu. Zkontroluj oprávnění prohlížeče pro mikrofon.';
  }
}

function voiceStopRecording() {
  if (voiceRecorderState.timerInterval) clearInterval(voiceRecorderState.timerInterval);
  if (voiceRecorderState.mediaRecorder && voiceRecorderState.mediaRecorder.state !== 'inactive') {
    voiceRecorderState.mediaRecorder.stop();
  }
}

function voiceShowPlayback() {
  const url = URL.createObjectURL(voiceRecorderState.blob);
  const wrap = document.getElementById('voicePlaybackWrap');
  wrap.style.display = 'block';
  wrap.innerHTML = `
    <audio class="voice-audio" src="${url}" controls></audio>
    <div class="voice-playback-actions">
      <button class="modal-btn" onclick="voiceReset()">↺ Nahrát znovu</button>
      <button class="modal-btn primary" onclick="voiceTranscribe()">✓ Přepsat do textu</button>
    </div>
  `;
  document.getElementById('voiceControls').innerHTML = '';
  const statusEl = document.getElementById('voiceStatus');
  if (statusEl) statusEl.textContent = 'Nahrávka hotová. Přehraj si ji, nebo rovnou přepiš do textu.';
}

function voiceReset() {
  const t = document.getElementById('voiceTimer');
  if (t) t.textContent = '00:00';
  document.getElementById('voicePlaybackWrap').style.display = 'none';
  document.getElementById('voicePlaybackWrap').innerHTML = '';
  document.getElementById('voiceControls').innerHTML = `<button class="voice-record-btn" onclick="voiceStartRecording()">● Nahrávat</button>`;
  const statusEl = document.getElementById('voiceStatus');
  if (statusEl) statusEl.textContent = 'Nahraj hlasovku, appka ji pak offline přepíše do textu.';
}

async function voiceTranscribe() {
  const statusEl = document.getElementById('voiceStatus');
  const wrap = document.getElementById('voicePlaybackWrap');
  wrap.innerHTML = `<div class="voice-progress" id="voiceProgress">Připravuji model…</div>`;
  if (statusEl) statusEl.textContent = '';

  try {
    if (!cachedTranscriber) {
      const progressEl = document.getElementById('voiceProgress');
      const { pipeline } = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.2');
      cachedTranscriber = await pipeline('automatic-speech-recognition', 'Xenova/whisper-base', {
        progress_callback: (p) => {
          const el = document.getElementById('voiceProgress');
          if (!el) return;
          if (p.status === 'progress' && p.file) {
            el.textContent = `Stahuji model (jen napoprvé): ${p.file} — ${Math.round(p.progress || 0)}%`;
          } else if (p.status === 'ready') {
            el.textContent = 'Model připraven, přepisuji…';
          }
        }
      });
    }
    const progressEl2 = document.getElementById('voiceProgress');
    if (progressEl2) progressEl2.textContent = 'Přepisuji nahrávku…';

    const audioUrl = URL.createObjectURL(voiceRecorderState.blob);
    const output = await cachedTranscriber(audioUrl, { language: 'czech', task: 'transcribe' });
    const text = (output && output.text || '').trim();

    if (!text) {
      wrap.innerHTML = `<div class="voice-progress">Nepodařilo se rozpoznat žádný text. Zkus to nahrát znovu, klidně blíž k mikrofonu.</div>
        <div class="voice-playback-actions"><button class="modal-btn" onclick="voiceReset()">↺ Nahrát znovu</button></div>`;
      return;
    }

    const textarea = document.getElementById('entryText');
    if (textarea) {
      const sep = formDraft.text.trim() ? '\n' : '';
      formDraft.text = formDraft.text + sep + text;
      textarea.value = formDraft.text;
    }
    document.querySelectorAll('.modal-overlay').forEach(el => el.remove());
  } catch (err) {
    const el = document.getElementById('voiceProgress');
    if (el) el.textContent = 'Přepis se nepovedl (možná chybí internet pro první stažení modelu, nebo appku otevíráš přímo ze souboru a ne přes web). Zkus to prosím na appce nahrané na GitHub Pages.';
  }
}

function cancelForm() {
  formDraft = null;
  state.view = state.categoryId ? 'category' : 'home';
  render();
}

async function saveForm() {
  if (!formDraft.text.trim() && formDraft.images.length === 0 && formDraft.videos.length === 0 && (formDraft.documents || []).length === 0) {
    alert('Zadej alespoň text nebo přidej fotku.');
    return;
  }
  const now = Date.now();
  const record = {
    id: formDraft.id,
    categoryId: formDraft.categoryId,
    itemId: formDraft.itemId || null,
    text: formDraft.text.trim(),
    textColor: formDraft.textColor || null,
    images: formDraft.images.map(i => ({ type: i.type, src: i.src, mediaId: i.mediaId })),
    videos: formDraft.videos.map(i => ({ type: i.type, src: i.src, mediaId: i.mediaId })),
    documents: (formDraft.documents || []).map(d => ({ type: d.type, mediaId: d.mediaId, name: d.name, mimeType: d.mimeType })),
    order: formDraft.isNew ? (state.entriesByCat[formDraft.categoryId] || []).length : formDraft.order,
    createdAt: formDraft.isNew ? now : formDraft.createdAt,
    updatedAt: now
  };
  await idbPut('entries', record);
  const savedItemId = record.itemId;
  formDraft = null;
  await loadAll();
  state.view = 'category';
  state.expandedItems.add(savedItemId || 'unassigned');
  render();
}

async function confirmDeleteEntry(id) {
  if (!confirm('Opravdu smazat tento záznam?')) return;
  await idbDelete('entries', id);
  await loadAll();
  render();
}

// ===================== BACKUP / RESTORE =====================
function openBackup() {
  const div = document.createElement('div');
  div.className = 'modal-overlay';
  div.innerHTML = `
    <div class="modal">
      <div class="modal-title">Záloha dat</div>
      <p class="modal-text">Data jsou uložená jen v tomto telefonu. Doporučujeme pravidelně stahovat zálohu.</p>
      <button class="modal-btn primary" onclick="exportBackup()">⬇ Stáhnout zálohu (JSON)</button>
      <label class="modal-btn">⬆ Nahrát zálohu ze souboru
        <input type="file" accept="application/json" style="display:none" onchange="importBackup(event)" />
      </label>
      <button class="modal-btn" onclick="this.closest('.modal-overlay').remove()">Zavřít</button>
    </div>
  `;
  document.body.appendChild(div);
}

async function exportBackup() {
  const cats = await idbGetAll('categories');
  const entries = await idbGetAll('entries');
  const items = await idbGetAll('items');
  const halls = await idbGetAll('halls');
  const media = await idbGetAll('media');
  const mediaEncoded = [];
  for (const m of media) {
    const b64 = await blobToBase64(m.blob);
    mediaEncoded.push({ id: m.id, type: m.type, data: b64 });
  }
  const payload = { version: 3, exportedAt: new Date().toISOString(), categories: cats, entries, items, halls, media: mediaEncoded };
  const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `udrzba-zaloha-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function blobToBase64(blob) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.readAsDataURL(blob);
  });
}

async function importBackup(event) {
  const file = event.target.files[0];
  if (!file) return;
  if (!confirm('Import přepíše aktuální data v telefonu zálohou ze souboru. Pokračovat?')) return;
  const text = await file.text();
  const payload = JSON.parse(text);
  await idbClear('categories');
  await idbClear('entries');
  await idbClear('items');
  await idbClear('halls');
  await idbClear('media');
  await idbPutMany('categories', payload.categories || []);
  await idbPutMany('entries', payload.entries || []);
  await idbPutMany('items', payload.items || []);
  await idbPutMany('halls', payload.halls || []);
  if (!payload.halls) {
    // old backup from before halls existed — let ensureDefaultHalls recreate them next load
    await idbPut('meta', { key: 'defaultHallsCreated', value: false });
  }
  const mediaRecords = [];
  for (const m of (payload.media || [])) {
    const blob = await (await fetch(m.data)).blob();
    mediaRecords.push({ id: m.id, blob, type: m.type });
  }
  await idbPutMany('media', mediaRecords);
  await ensureDefaultHalls();
  await loadAll();
  document.querySelectorAll('.modal-overlay').forEach(el => el.remove());
  goHome();
}

// ===================== MAIN RENDER =====================
function render() {
  if (state.view === 'home') renderHome();
  else if (state.view === 'hall') renderHallDetail();
  else if (state.view === 'category') renderCategory();
  else if (state.view === 'entry-form') renderEntryForm();
  if (state.view === 'home' || state.view === 'hall' || state.view === 'category') {
    setTimeout(hydrateMediaRows, 0);
  }
}

// expose functions used inline in HTML
Object.assign(window, {
  openCategory, goHome, categoryBack, openHallDetail, openNewCategory, renameCategory,
  openNewEntry, openEditEntry, cancelForm, saveForm,
  addImages, addVideos, removeImage, removeVideo, setEntryTextColor,
  addDocuments, removeDocument, openDocument,
  confirmDeleteEntry, clearSearch, openLightbox, openLightboxForEntry,
  openBackup, exportBackup, importBackup,
  toggleItem, openNewItem, renameItem, deleteItemGroup, deleteUnassigned,
  openMoveItemPicker, applyMoveItem,
  toggleBulkMode, toggleBulkSelect, moveBulkSelected, mergeBulkSelected,
  openColorPicker, applyCategoryColor, applyCategoryTextColor, resetCategoryColor,
  openItemColorPicker, applyItemColor, applyItemTextColor, resetItemColor,
  openVoiceRecorder, voiceStartRecording, voiceStopRecording, voiceReset, voiceTranscribe,
  openExportPicker, exportSelectAll, runExportPdf,
  openHomeExportPicker, exportSelectAllHome, runHomeExportPdf,
  openNewHall, renameHall, deleteHall, reorderHalls,
  openHallColorPicker, applyHallColor, applyHallTextColor, resetHallColor,
  openHallPicker, applyHallPicker
});

// ===================== INIT =====================
async function init() {
  await openDB();
  await seedIfEmpty();
  await ensureDefaultHalls();
  await loadAll();
  render();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

init();
