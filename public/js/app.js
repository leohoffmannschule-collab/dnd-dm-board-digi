'use strict';

const CONDITIONS = [
  'Kampfunfähig', 'Betäubt', 'Blind', 'Taub', 'Verängstigt', 'Bezaubert',
  'Ergriffen', 'Unsichtbar', 'Gelähmt', 'Versteinert', 'Vergiftet', 'Liegend',
  'Festgehalten', 'Bewusstlos',
  'Erschöpfung 1', 'Erschöpfung 2', 'Erschöpfung 3', 'Erschöpfung 4', 'Erschöpfung 5', 'Erschöpfung 6',
];

const TYPE_LABELS = { pc: 'Spieler', npc: 'NPC', monster: 'Monster' };

const state = {
  encounter: { round: 1, activeCombatantId: null, combatants: [] },
  library: [],
  notes: [],
  rollHistory: [],
  activeNoteId: null,
  libraryFilter: { category: 'all', search: '' },
  notesSearch: '',
};

// ---------- Hilfsfunktionen ----------

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDate(iso) {
  try {
    return new Date(iso).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return iso;
  }
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    let message = `Fehler (${res.status})`;
    try {
      const body = await res.json();
      if (body && body.error) message = body.error;
    } catch {
      /* Antwort war kein JSON */
    }
    throw new Error(message);
  }
  if (res.status === 204) return null;
  return res.json();
}

function toast(message, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  toastContainerEl.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

// ---------- Elemente ----------

const roundDisplayEl = document.getElementById('round-display');
const activeNameDisplayEl = document.getElementById('active-name-display');
const tabsEl = document.getElementById('tabs');
const toastContainerEl = document.getElementById('toast-container');

const btnPrevTurn = document.getElementById('btn-prev-turn');
const btnNextTurn = document.getElementById('btn-next-turn');
const btnResetEncounter = document.getElementById('btn-reset-encounter');
const formAddCombatant = document.getElementById('form-add-combatant');
const btnRollInitQuick = document.getElementById('btn-roll-init-quick');
const combatantListEl = document.getElementById('combatant-list');

const librarySearchEl = document.getElementById('library-search');
const libraryFilterEl = document.getElementById('library-filter');
const btnNewLibraryEntry = document.getElementById('btn-new-library-entry');
const libraryListEl = document.getElementById('library-list');
const libraryDialog = document.getElementById('library-dialog');
const libraryDialogTitle = document.getElementById('library-dialog-title');
const formLibraryEntry = document.getElementById('form-library-entry');
const addToEncounterDialog = document.getElementById('add-to-encounter-dialog');
const formAddToEncounter = document.getElementById('form-add-to-encounter');
const addToEncounterNameEl = document.getElementById('add-to-encounter-name');

const notesSearchEl = document.getElementById('notes-search');
const btnNewNote = document.getElementById('btn-new-note');
const notesListEl = document.getElementById('notes-list');
const notesEditorEmpty = document.getElementById('notes-editor-empty');
const formNote = document.getElementById('form-note');
const noteTitleEl = document.getElementById('note-title');
const noteTagsEl = document.getElementById('note-tags');
const noteContentEl = document.getElementById('note-content');
const noteMetaEl = document.getElementById('note-meta');
const btnDeleteNote = document.getElementById('btn-delete-note');

const quickDiceEl = document.getElementById('quick-dice');
const btnAdv = document.getElementById('btn-adv');
const btnDis = document.getElementById('btn-dis');
const formCustomRoll = document.getElementById('form-custom-roll');
const customExpressionEl = document.getElementById('custom-expression');
const customLabelEl = document.getElementById('custom-label');
const btnClearHistory = document.getElementById('btn-clear-history');
const rollHistoryEl = document.getElementById('roll-history');

// ---------- Tabs ----------

function switchTab(tabName) {
  document.querySelectorAll('.tab-btn').forEach((btn) => btn.classList.toggle('active', btn.dataset.tab === tabName));
  document.querySelectorAll('.tab-panel').forEach((panel) => panel.classList.toggle('active', panel.id === `tab-${tabName}`));
  try {
    localStorage.setItem('dmboard-active-tab', tabName);
  } catch {
    /* localStorage evtl. nicht verfügbar */
  }
}

tabsEl.addEventListener('click', (e) => {
  const btn = e.target.closest('.tab-btn');
  if (!btn) return;
  switchTab(btn.dataset.tab);
});

// ---------- Initiative ----------

function setEncounter(encounter) {
  state.encounter = encounter;
  renderInitiative();
}

function combatantRowHtml(c, isActive) {
  const hpPct = c.maxHp > 0 ? Math.max(0, Math.min(100, Math.round((c.hp / c.maxHp) * 100))) : 0;
  const hpClass = hpPct <= 25 ? 'critical' : hpPct <= 50 ? 'warn' : '';
  const typeLabel = TYPE_LABELS[c.type] || c.type;

  const conditionTags = c.conditions.map((cond) => `
    <span class="condition-tag">${escapeHtml(cond)}<button type="button" data-action="remove-condition" data-condition="${escapeHtml(cond)}" title="Entfernen">×</button></span>
  `).join('');

  const conditionOptions = CONDITIONS
    .filter((cond) => !c.conditions.includes(cond))
    .map((cond) => `<option value="${escapeHtml(cond)}">${escapeHtml(cond)}</option>`)
    .join('');

  return `
    <div class="combatant-row type-${c.type} ${isActive ? 'active' : ''}" data-id="${c.id}">
      <div class="combatant-init">
        <input type="number" value="${c.initiative}" data-field="initiative" aria-label="Initiative" />
      </div>
      <div class="combatant-main">
        <div class="combatant-name-row">
          <input type="text" class="combatant-name" value="${escapeHtml(c.name)}" data-field="name" aria-label="Name" maxlength="100" />
          <span class="type-tag type-${c.type}">${typeLabel}</span>
          <button class="btn-icon btn-sm" type="button" data-action="toggle-extra" title="Notizen anzeigen">📝</button>
        </div>
        <div class="condition-tags">${conditionTags}</div>
        <div class="condition-adder">
          <select data-role="condition-select" aria-label="Zustand hinzufügen">
            <option value="">+ Zustand hinzufügen…</option>
            ${conditionOptions}
          </select>
        </div>
      </div>
      <div class="combatant-hp">
        <div class="hp-values">
          <input type="number" value="${c.hp}" data-field="hp" aria-label="Trefferpunkte" />
          <span>/</span>
          <input type="number" value="${c.maxHp}" data-field="maxHp" aria-label="Maximale Trefferpunkte" />
        </div>
        <div class="hp-bar-track"><div class="hp-bar-fill ${hpClass}" style="width:${hpPct}%"></div></div>
        <div class="hp-quick-actions">
          <input type="number" value="5" min="1" data-role="hp-delta" aria-label="Betrag" />
          <button type="button" class="btn-icon btn-sm" data-action="damage" title="Schaden abziehen">−</button>
          <button type="button" class="btn-icon btn-sm" data-action="heal" title="Heilen">+</button>
        </div>
      </div>
      <div class="combatant-ac">
        <span class="field-label">RK</span>
        <input type="number" value="${c.ac}" data-field="ac" aria-label="Rüstungsklasse" />
      </div>
      <div class="combatant-actions">
        <button type="button" class="btn-icon" data-action="remove" title="Aus dem Kampf entfernen">🗑</button>
      </div>
      <div class="combatant-extra" data-role="extra">
        <textarea data-field="notes" placeholder="Notizen zu diesem Kämpfer…" rows="2">${escapeHtml(c.notes)}</textarea>
      </div>
    </div>
  `;
}

function renderInitiative() {
  const { round, activeCombatantId, combatants } = state.encounter;
  roundDisplayEl.textContent = round;
  const activeCombatant = combatants.find((c) => c.id === activeCombatantId);
  activeNameDisplayEl.textContent = activeCombatant ? `Am Zug: ${activeCombatant.name}` : 'Kein Kampf aktiv';
  activeNameDisplayEl.classList.toggle('has-active', !!activeCombatant);

  if (combatants.length === 0) {
    combatantListEl.innerHTML = '<p class="empty-hint">Noch keine Kämpfer im Kampf. Füge oben welche hinzu oder aus der Bibliothek.</p>';
    return;
  }
  combatantListEl.innerHTML = combatants.map((c) => combatantRowHtml(c, c.id === activeCombatantId)).join('');
}

async function updateCombatant(id, patch) {
  try {
    setEncounter(await api(`/api/encounter/combatants/${id}`, { method: 'PUT', body: JSON.stringify(patch) }));
  } catch (err) {
    toast(err.message, 'error');
    renderInitiative();
  }
}

formAddCombatant.addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(formAddCombatant);
  const hp = Number(fd.get('hp')) || 0;
  const maxHpRaw = fd.get('maxHp');
  const payload = {
    name: fd.get('name'),
    type: fd.get('type'),
    initiative: Number(fd.get('initiative')) || 0,
    hp,
    maxHp: maxHpRaw ? Number(maxHpRaw) : hp,
    ac: Number(fd.get('ac')) || 10,
  };
  try {
    setEncounter(await api('/api/encounter/combatants', { method: 'POST', body: JSON.stringify(payload) }));
    formAddCombatant.reset();
    formAddCombatant.querySelector('[name="hp"]').value = 10;
    formAddCombatant.querySelector('[name="ac"]').value = 10;
    formAddCombatant.querySelector('[name="initiative"]').value = 0;
    formAddCombatant.querySelector('[name="name"]').focus();
  } catch (err) {
    toast(err.message, 'error');
  }
});

btnRollInitQuick.addEventListener('click', () => {
  formAddCombatant.querySelector('[name="initiative"]').value = Math.floor(Math.random() * 20) + 1;
});

btnNextTurn.addEventListener('click', async () => {
  try {
    setEncounter(await api('/api/encounter/next-turn', { method: 'POST' }));
  } catch (err) {
    toast(err.message, 'error');
  }
});

btnPrevTurn.addEventListener('click', async () => {
  try {
    setEncounter(await api('/api/encounter/prev-turn', { method: 'POST' }));
  } catch (err) {
    toast(err.message, 'error');
  }
});

btnResetEncounter.addEventListener('click', async () => {
  if (!confirm('Den gesamten Kampf zurücksetzen? Alle Kämpfer werden entfernt.')) return;
  try {
    setEncounter(await api('/api/encounter/reset', { method: 'POST' }));
  } catch (err) {
    toast(err.message, 'error');
  }
});

combatantListEl.addEventListener('click', (e) => {
  const row = e.target.closest('.combatant-row');
  if (!row) return;
  const id = row.dataset.id;
  const actionBtn = e.target.closest('[data-action]');
  if (!actionBtn) return;
  const action = actionBtn.dataset.action;
  const combatant = state.encounter.combatants.find((c) => c.id === id);
  if (!combatant) return;

  if (action === 'remove') {
    if (!confirm(`„${combatant.name}“ aus dem Kampf entfernen?`)) return;
    api(`/api/encounter/combatants/${id}`, { method: 'DELETE' }).then(setEncounter).catch((err) => toast(err.message, 'error'));
  } else if (action === 'damage' || action === 'heal') {
    const deltaInput = row.querySelector('[data-role="hp-delta"]');
    const delta = Number(deltaInput.value) || 0;
    const rawHp = action === 'damage' ? combatant.hp - delta : combatant.hp + delta;
    const clamped = Math.max(0, combatant.maxHp > 0 ? Math.min(rawHp, combatant.maxHp) : rawHp);
    updateCombatant(id, { hp: clamped });
  } else if (action === 'toggle-extra') {
    row.querySelector('[data-role="extra"]').classList.toggle('open');
  } else if (action === 'remove-condition') {
    const cond = actionBtn.dataset.condition;
    updateCombatant(id, { conditions: combatant.conditions.filter((c) => c !== cond) });
  }
});

combatantListEl.addEventListener('change', (e) => {
  const row = e.target.closest('.combatant-row');
  if (!row) return;
  const id = row.dataset.id;
  const combatant = state.encounter.combatants.find((c) => c.id === id);
  if (!combatant) return;

  if (e.target.dataset.role === 'condition-select') {
    const cond = e.target.value;
    if (!cond) return;
    if (combatant.conditions.includes(cond)) {
      e.target.value = '';
      return;
    }
    updateCombatant(id, { conditions: [...combatant.conditions, cond] });
    return;
  }

  const field = e.target.dataset.field;
  if (!field) return;
  let value = e.target.value;
  if (['initiative', 'hp', 'maxHp', 'ac'].includes(field)) {
    value = Number(value);
    if (Number.isNaN(value)) {
      renderInitiative();
      return;
    }
  } else if (field === 'name' && !value.trim()) {
    renderInitiative();
    return;
  }
  updateCombatant(id, { [field]: value });
});

// ---------- Bibliothek ----------

function libraryCardHtml(entry) {
  const statKeys = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
  const hasStats = entry.stats && statKeys.some((k) => entry.stats[k] != null);
  const statsHtml = hasStats
    ? `<div class="ability-scores">${statKeys.map((k) => `<div><span>${k.toUpperCase()}</span>${entry.stats[k] ?? '–'}</div>`).join('')}</div>`
    : '';
  const metaParts = [];
  if (entry.ac != null) metaParts.push(`RK <strong>${entry.ac}</strong>`);
  if (entry.hp != null) metaParts.push(`HP <strong>${entry.hp}</strong>`);
  if (entry.speed) metaParts.push(escapeHtml(entry.speed));

  return `
    <div class="library-card" data-id="${entry.id}">
      <div class="library-card-header">
        <h3>${escapeHtml(entry.name)}</h3>
        <span class="type-tag type-${entry.category}">${entry.category === 'npc' ? 'NPC' : 'Monster'}</span>
      </div>
      ${metaParts.length ? `<div class="library-card-stats">${metaParts.join(' · ')}</div>` : ''}
      ${statsHtml}
      ${entry.abilities ? `<div class="library-card-text"><strong>Fähigkeiten:</strong> ${escapeHtml(entry.abilities)}</div>` : ''}
      ${entry.actions ? `<div class="library-card-text"><strong>Aktionen:</strong> ${escapeHtml(entry.actions)}</div>` : ''}
      ${entry.notes ? `<div class="library-card-text"><strong>Notizen:</strong> ${escapeHtml(entry.notes)}</div>` : ''}
      ${entry.tags.length ? `<div class="library-tags">${entry.tags.map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</div>` : ''}
      <div class="library-card-actions">
        <button class="btn btn-primary btn-sm" type="button" data-action="add-to-encounter">+ Zum Kampf</button>
        <button class="btn btn-sm" type="button" data-action="edit">Bearbeiten</button>
        <button class="btn btn-danger-outline btn-sm" type="button" data-action="delete">Löschen</button>
      </div>
    </div>
  `;
}

function renderLibrary() {
  const { category, search } = state.libraryFilter;
  const term = search.trim().toLowerCase();
  const filtered = state.library.filter((e) => {
    if (category !== 'all' && e.category !== category) return false;
    if (!term) return true;
    return e.name.toLowerCase().includes(term) || e.tags.some((t) => t.toLowerCase().includes(term));
  });
  if (filtered.length === 0) {
    libraryListEl.innerHTML = '<p class="empty-hint">Keine Einträge gefunden.</p>';
    return;
  }
  libraryListEl.innerHTML = filtered.map(libraryCardHtml).join('');
}

libraryFilterEl.addEventListener('click', (e) => {
  const btn = e.target.closest('.chip');
  if (!btn) return;
  state.libraryFilter.category = btn.dataset.filter;
  [...libraryFilterEl.children].forEach((c) => c.classList.toggle('active', c === btn));
  renderLibrary();
});

librarySearchEl.addEventListener('input', () => {
  state.libraryFilter.search = librarySearchEl.value;
  renderLibrary();
});

function openLibraryDialog(entry) {
  formLibraryEntry.reset();
  libraryDialogTitle.textContent = entry ? 'Eintrag bearbeiten' : 'Neuer Eintrag';
  const f = formLibraryEntry.elements;
  f.id.value = entry?.id || '';
  f.name.value = entry?.name || '';
  f.category.value = entry?.category || 'monster';
  f.ac.value = entry?.ac ?? '';
  f.hp.value = entry?.hp ?? '';
  f.speed.value = entry?.speed || '';
  ['str', 'dex', 'con', 'int', 'wis', 'cha'].forEach((k) => {
    f[k].value = entry?.stats?.[k] ?? '';
  });
  f.abilities.value = entry?.abilities || '';
  f.actions.value = entry?.actions || '';
  f.notes.value = entry?.notes || '';
  f.tags.value = entry?.tags?.join(', ') || '';
  libraryDialog.showModal();
}

btnNewLibraryEntry.addEventListener('click', () => openLibraryDialog(null));

async function deleteLibraryEntry(entry) {
  if (!confirm(`„${entry.name}“ wirklich aus der Bibliothek löschen?`)) return;
  try {
    await api(`/api/library/${entry.id}`, { method: 'DELETE' });
    state.library = state.library.filter((e) => e.id !== entry.id);
    renderLibrary();
  } catch (err) {
    toast(err.message, 'error');
  }
}

function openAddToEncounterDialog(entry) {
  formAddToEncounter.reset();
  formAddToEncounter.elements.libraryId.value = entry.id;
  addToEncounterNameEl.textContent = entry.name;
  formAddToEncounter.elements.count.value = 1;
  formAddToEncounter.elements.initiative.value = 0;
  formAddToEncounter.elements.rollInitiative.checked = true;
  addToEncounterDialog.showModal();
}

libraryListEl.addEventListener('click', (e) => {
  const card = e.target.closest('.library-card');
  if (!card) return;
  const action = e.target.closest('[data-action]')?.dataset.action;
  if (!action) return;
  const entry = state.library.find((x) => x.id === card.dataset.id);
  if (!entry) return;

  if (action === 'edit') openLibraryDialog(entry);
  else if (action === 'delete') deleteLibraryEntry(entry);
  else if (action === 'add-to-encounter') openAddToEncounterDialog(entry);
});

formLibraryEntry.addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(formLibraryEntry);
  const id = fd.get('id');
  const numOrNull = (v) => (v === '' || v == null ? null : Number(v));
  const payload = {
    name: fd.get('name'),
    category: fd.get('category'),
    ac: numOrNull(fd.get('ac')),
    hp: numOrNull(fd.get('hp')),
    speed: fd.get('speed'),
    stats: {
      str: numOrNull(fd.get('str')),
      dex: numOrNull(fd.get('dex')),
      con: numOrNull(fd.get('con')),
      int: numOrNull(fd.get('int')),
      wis: numOrNull(fd.get('wis')),
      cha: numOrNull(fd.get('cha')),
    },
    abilities: fd.get('abilities'),
    actions: fd.get('actions'),
    notes: fd.get('notes'),
    tags: String(fd.get('tags') || '').split(',').map((t) => t.trim()).filter(Boolean),
  };
  try {
    if (id) {
      const updated = await api(`/api/library/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
      state.library = state.library.map((e) => (e.id === id ? updated : e));
    } else {
      const created = await api('/api/library', { method: 'POST', body: JSON.stringify(payload) });
      state.library.push(created);
    }
    renderLibrary();
    libraryDialog.close();
  } catch (err) {
    toast(err.message, 'error');
  }
});

formAddToEncounter.addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(formAddToEncounter);
  const libraryId = fd.get('libraryId');
  const payload = {
    count: Number(fd.get('count')) || 1,
    initiative: Number(fd.get('initiative')) || 0,
    rollInitiative: fd.get('rollInitiative') === 'on',
  };
  try {
    const result = await api(`/api/library/${libraryId}/add-to-encounter`, { method: 'POST', body: JSON.stringify(payload) });
    setEncounter(result.encounter);
    addToEncounterDialog.close();
    toast(`${result.created.length} Kämpfer zum Kampf hinzugefügt.`, 'success');
    switchTab('initiative');
  } catch (err) {
    toast(err.message, 'error');
  }
});

document.querySelectorAll('[data-close-dialog]').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.getElementById(btn.dataset.closeDialog).close();
  });
});

// ---------- Notizen ----------

function renderNotesList() {
  const term = state.notesSearch.trim().toLowerCase();
  const filtered = state.notes.filter((n) => {
    if (!term) return true;
    return n.title.toLowerCase().includes(term) || n.content.toLowerCase().includes(term) || n.tags.some((t) => t.toLowerCase().includes(term));
  });
  if (filtered.length === 0) {
    notesListEl.innerHTML = '<p class="empty-hint">Keine Notizen gefunden.</p>';
    return;
  }
  notesListEl.innerHTML = filtered.map((n) => `
    <div class="note-list-item ${n.id === state.activeNoteId ? 'active' : ''}" data-id="${n.id}">
      <h4>${escapeHtml(n.title)}</h4>
      <div class="note-snippet">${escapeHtml((n.content || '').slice(0, 80))}</div>
      <div class="note-date">${formatDate(n.updatedAt)}</div>
    </div>
  `).join('');
}

function selectNote(id) {
  const note = state.notes.find((n) => n.id === id);
  if (!note) return;
  state.activeNoteId = id;
  notesEditorEmpty.classList.add('hidden');
  formNote.classList.remove('hidden');
  noteTitleEl.value = note.title;
  noteTagsEl.value = note.tags.join(', ');
  noteContentEl.value = note.content;
  noteMetaEl.textContent = `Erstellt: ${formatDate(note.createdAt)} · Zuletzt geändert: ${formatDate(note.updatedAt)}`;
  renderNotesList();
}

function newNoteDraft() {
  state.activeNoteId = null;
  notesEditorEmpty.classList.add('hidden');
  formNote.classList.remove('hidden');
  noteTitleEl.value = '';
  noteTagsEl.value = '';
  noteContentEl.value = '';
  noteMetaEl.textContent = 'Neue Notiz (noch nicht gespeichert)';
  renderNotesList();
  noteTitleEl.focus();
}

btnNewNote.addEventListener('click', newNoteDraft);

notesListEl.addEventListener('click', (e) => {
  const item = e.target.closest('.note-list-item');
  if (!item) return;
  selectNote(item.dataset.id);
});

notesSearchEl.addEventListener('input', () => {
  state.notesSearch = notesSearchEl.value;
  renderNotesList();
});

formNote.addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = {
    title: noteTitleEl.value,
    content: noteContentEl.value,
    tags: noteTagsEl.value.split(',').map((t) => t.trim()).filter(Boolean),
  };
  if (!payload.title.trim()) {
    toast('Titel ist erforderlich.', 'error');
    return;
  }
  try {
    if (state.activeNoteId) {
      const updated = await api(`/api/notes/${state.activeNoteId}`, { method: 'PUT', body: JSON.stringify(payload) });
      state.notes = state.notes.map((n) => (n.id === updated.id ? updated : n));
      selectNote(updated.id);
    } else {
      const created = await api('/api/notes', { method: 'POST', body: JSON.stringify(payload) });
      state.notes.unshift(created);
      selectNote(created.id);
    }
    toast('Notiz gespeichert.', 'success');
  } catch (err) {
    toast(err.message, 'error');
  }
});

btnDeleteNote.addEventListener('click', async () => {
  if (!state.activeNoteId) {
    formNote.classList.add('hidden');
    notesEditorEmpty.classList.remove('hidden');
    return;
  }
  if (!confirm('Notiz wirklich löschen?')) return;
  try {
    await api(`/api/notes/${state.activeNoteId}`, { method: 'DELETE' });
    state.notes = state.notes.filter((n) => n.id !== state.activeNoteId);
    state.activeNoteId = null;
    formNote.classList.add('hidden');
    notesEditorEmpty.classList.remove('hidden');
    renderNotesList();
  } catch (err) {
    toast(err.message, 'error');
  }
});

// ---------- Würfel ----------

function rollEntryHtml(entry) {
  const detailStr = entry.details.map((d) => {
    if (d.rolls) return `${d.token}: [${d.rolls.join(', ')}]${d.chosen != null ? ` → ${d.chosen}` : ''}`;
    return d.token;
  }).join('  ');
  const labelPrefix = entry.label ? `${escapeHtml(entry.label)} — ` : '';
  return `
    <div class="roll-entry">
      <div class="roll-entry-main">
        <span class="roll-entry-expr">${labelPrefix}${escapeHtml(entry.expression)}</span>
        <span class="roll-entry-detail">${escapeHtml(detailStr)}</span>
      </div>
      <div>
        <div class="roll-entry-total">${entry.total}</div>
        <div class="roll-entry-time">${formatDate(entry.timestamp)}</div>
      </div>
    </div>
  `;
}

function renderHistory() {
  if (state.rollHistory.length === 0) {
    rollHistoryEl.innerHTML = '<p class="empty-hint">Noch keine Würfe.</p>';
    return;
  }
  rollHistoryEl.innerHTML = state.rollHistory.map(rollEntryHtml).join('');
}

async function performRoll(expression, mode, label) {
  try {
    const entry = await api('/api/dice/roll', { method: 'POST', body: JSON.stringify({ expression, mode, label }) });
    state.rollHistory.unshift(entry);
    state.rollHistory = state.rollHistory.slice(0, 100);
    renderHistory();
  } catch (err) {
    toast(err.message, 'error');
  }
}

quickDiceEl.addEventListener('click', (e) => {
  const btn = e.target.closest('.die-btn');
  if (!btn) return;
  performRoll(`1d${btn.dataset.die}`, 'normal', '');
});

btnAdv.addEventListener('click', () => performRoll('1d20', 'advantage', ''));
btnDis.addEventListener('click', () => performRoll('1d20', 'disadvantage', ''));

formCustomRoll.addEventListener('submit', (e) => {
  e.preventDefault();
  const expr = customExpressionEl.value.trim();
  if (!expr) return;
  performRoll(expr.replace(/w/gi, 'd'), 'normal', customLabelEl.value.trim());
  customExpressionEl.value = '';
  customLabelEl.value = '';
});

btnClearHistory.addEventListener('click', async () => {
  if (!confirm('Den gesamten Würfelverlauf löschen?')) return;
  try {
    await api('/api/dice/history', { method: 'DELETE' });
    state.rollHistory = [];
    renderHistory();
  } catch (err) {
    toast(err.message, 'error');
  }
});

// ---------- Start ----------

async function init() {
  try {
    const initialState = await api('/api/state');
    state.encounter = initialState.encounter;
    state.library = initialState.library;
    state.notes = initialState.notes;
    state.rollHistory = initialState.rollHistory;
  } catch (err) {
    toast(`Konnte Daten nicht laden: ${err.message}`, 'error');
  }

  renderInitiative();
  renderLibrary();
  renderNotesList();
  renderHistory();

  let savedTab = 'initiative';
  try {
    savedTab = localStorage.getItem('dmboard-active-tab') || 'initiative';
  } catch {
    /* localStorage evtl. nicht verfügbar */
  }
  if (document.getElementById(`tab-${savedTab}`)) switchTab(savedTab);
}

init();
