'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'db.json');

const DEFAULT_DATA = {
  encounter: { round: 1, activeCombatantId: null, combatants: [] },
  library: [],
  notes: [],
  rollHistory: [],
};

// ---------- Persistenz ----------

function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(DEFAULT_DATA, null, 2), 'utf-8');
  }
}

function loadData() {
  ensureDataFile();
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return {
      encounter: { ...DEFAULT_DATA.encounter, ...(parsed.encounter || {}) },
      library: Array.isArray(parsed.library) ? parsed.library : [],
      notes: Array.isArray(parsed.notes) ? parsed.notes : [],
      rollHistory: Array.isArray(parsed.rollHistory) ? parsed.rollHistory : [],
    };
  } catch (err) {
    console.error('Fehler beim Lesen von data/db.json – verwende Standardwerte.', err);
    return JSON.parse(JSON.stringify(DEFAULT_DATA));
  }
}

let data = loadData();

function saveData() {
  const tmpFile = `${DATA_FILE}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmpFile, DATA_FILE);
}

function newId() {
  return crypto.randomUUID();
}

// ---------- Hilfsfunktionen ----------

function sortEncounter() {
  data.encounter.combatants.sort((a, b) => b.initiative - a.initiative);
}

function getActiveIndex() {
  if (!data.encounter.activeCombatantId) return -1;
  return data.encounter.combatants.findIndex((c) => c.id === data.encounter.activeCombatantId);
}

function toNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

const VALID_TYPES = new Set(['pc', 'npc', 'monster']);
const VALID_CATEGORIES = new Set(['npc', 'monster']);

function rollDice(expression, mode = 'normal') {
  const cleaned = String(expression).replace(/\s+/g, '').toLowerCase();
  if (!cleaned) throw new Error('Ungültiger Würfelausdruck.');
  if (cleaned.length > 200) throw new Error('Würfelausdruck ist zu lang.');

  const tokenRegex = /([+-]?)(\d*d\d+|\d+)/g;
  const sanitizedCheck = cleaned.replace(tokenRegex, '');
  if (sanitizedCheck.length > 0) throw new Error('Ungültiger Würfelausdruck.');

  let match;
  let total = 0;
  const details = [];
  let found = false;
  let advDisApplied = false;

  while ((match = tokenRegex.exec(cleaned)) !== null) {
    found = true;
    const sign = match[1] === '-' ? -1 : 1;
    const token = match[2];

    if (token.includes('d')) {
      const [countStr, sidesStr] = token.split('d');
      const count = countStr === '' ? 1 : parseInt(countStr, 10);
      const sides = parseInt(sidesStr, 10);
      if (!count || !sides || count < 1 || count > 100 || sides < 2 || sides > 1000) {
        throw new Error('Ungültiger Würfelausdruck (max. 100 Würfel, 2–1000 Seiten).');
      }

      if (!advDisApplied && mode !== 'normal' && count === 1 && sides === 20) {
        const rollA = Math.floor(Math.random() * 20) + 1;
        const rollB = Math.floor(Math.random() * 20) + 1;
        const chosen = mode === 'advantage' ? Math.max(rollA, rollB) : Math.min(rollA, rollB);
        total += sign * chosen;
        details.push({
          token: `${sign < 0 ? '-' : ''}1d20 (${mode === 'advantage' ? 'Vorteil' : 'Nachteil'})`,
          rolls: [rollA, rollB],
          chosen,
          subtotal: sign * chosen,
        });
        advDisApplied = true;
        continue;
      }

      const rolls = [];
      for (let i = 0; i < count; i++) {
        rolls.push(Math.floor(Math.random() * sides) + 1);
      }
      const subtotal = rolls.reduce((a, b) => a + b, 0);
      total += sign * subtotal;
      details.push({ token: `${sign < 0 ? '-' : ''}${count}d${sides}`, rolls, subtotal: sign * subtotal });
    } else {
      const value = parseInt(token, 10);
      total += sign * value;
      details.push({ token: `${sign < 0 ? '-' : ''}${value}`, value: sign * value });
    }
  }

  if (!found) throw new Error('Ungültiger Würfelausdruck.');
  return { total, details };
}

// ---------- Middleware ----------

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ---------- Gesamtstatus ----------

app.get('/api/state', (req, res) => {
  res.json(data);
});

// ---------- Initiative / Encounter ----------

app.get('/api/encounter', (req, res) => {
  res.json(data.encounter);
});

app.post('/api/encounter/combatants', (req, res) => {
  const { name, type, initiative, hp, maxHp, ac, conditions, notes } = req.body || {};
  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'Name ist erforderlich.' });
  }
  const hpValue = toNumber(hp, 0);
  const combatant = {
    id: newId(),
    name: name.trim().slice(0, 100),
    type: VALID_TYPES.has(type) ? type : 'monster',
    initiative: toNumber(initiative, 0),
    hp: hpValue,
    maxHp: toNumber(maxHp, hpValue),
    ac: toNumber(ac, 10),
    conditions: Array.isArray(conditions) ? conditions.filter((c) => typeof c === 'string').slice(0, 20) : [],
    notes: typeof notes === 'string' ? notes.slice(0, 500) : '',
  };

  data.encounter.combatants.push(combatant);
  sortEncounter();
  saveData();
  res.status(201).json(data.encounter);
});

app.put('/api/encounter/combatants/:id', (req, res) => {
  const combatant = data.encounter.combatants.find((c) => c.id === req.params.id);
  if (!combatant) return res.status(404).json({ error: 'Kämpfer nicht gefunden.' });

  const body = req.body || {};
  if ('name' in body && typeof body.name === 'string' && body.name.trim()) {
    combatant.name = body.name.trim().slice(0, 100);
  }
  if ('type' in body && VALID_TYPES.has(body.type)) combatant.type = body.type;
  if ('initiative' in body) combatant.initiative = toNumber(body.initiative, combatant.initiative);
  if ('hp' in body) combatant.hp = toNumber(body.hp, combatant.hp);
  if ('maxHp' in body) combatant.maxHp = toNumber(body.maxHp, combatant.maxHp);
  if ('ac' in body) combatant.ac = toNumber(body.ac, combatant.ac);
  if ('conditions' in body && Array.isArray(body.conditions)) {
    combatant.conditions = body.conditions.filter((c) => typeof c === 'string').slice(0, 20);
  }
  if ('notes' in body && typeof body.notes === 'string') combatant.notes = body.notes.slice(0, 500);

  sortEncounter();
  saveData();
  res.json(data.encounter);
});

app.delete('/api/encounter/combatants/:id', (req, res) => {
  const idx = data.encounter.combatants.findIndex((c) => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Kämpfer nicht gefunden.' });

  const wasActive = data.encounter.activeCombatantId === req.params.id;
  data.encounter.combatants.splice(idx, 1);
  if (wasActive) {
    data.encounter.activeCombatantId =
      data.encounter.combatants[idx]?.id ?? data.encounter.combatants[0]?.id ?? null;
  }
  saveData();
  res.json(data.encounter);
});

app.post('/api/encounter/next-turn', (req, res) => {
  const combatants = data.encounter.combatants;
  if (combatants.length === 0) {
    data.encounter.activeCombatantId = null;
    saveData();
    return res.json(data.encounter);
  }
  const currentIndex = getActiveIndex();
  if (currentIndex === -1) {
    data.encounter.activeCombatantId = combatants[0].id;
  } else {
    let nextIndex = currentIndex + 1;
    if (nextIndex >= combatants.length) {
      nextIndex = 0;
      data.encounter.round++;
    }
    data.encounter.activeCombatantId = combatants[nextIndex].id;
  }
  saveData();
  res.json(data.encounter);
});

app.post('/api/encounter/prev-turn', (req, res) => {
  const combatants = data.encounter.combatants;
  if (combatants.length === 0) {
    data.encounter.activeCombatantId = null;
    saveData();
    return res.json(data.encounter);
  }
  const currentIndex = getActiveIndex();
  if (currentIndex === -1) {
    data.encounter.activeCombatantId = combatants[combatants.length - 1].id;
  } else {
    let prevIndex = currentIndex - 1;
    if (prevIndex < 0) {
      prevIndex = combatants.length - 1;
      data.encounter.round = Math.max(1, data.encounter.round - 1);
    }
    data.encounter.activeCombatantId = combatants[prevIndex].id;
  }
  saveData();
  res.json(data.encounter);
});

app.post('/api/encounter/reset', (req, res) => {
  data.encounter = { round: 1, activeCombatantId: null, combatants: [] };
  saveData();
  res.json(data.encounter);
});

// ---------- Bibliothek (NPCs & Monster) ----------

app.get('/api/library', (req, res) => {
  res.json(data.library);
});

app.post('/api/library', (req, res) => {
  const body = req.body || {};
  if (!body.name || typeof body.name !== 'string' || !body.name.trim()) {
    return res.status(400).json({ error: 'Name ist erforderlich.' });
  }
  const entry = {
    id: newId(),
    name: body.name.trim().slice(0, 100),
    category: VALID_CATEGORIES.has(body.category) ? body.category : 'monster',
    ac: body.ac === '' || body.ac == null ? null : toNumber(body.ac, null),
    hp: body.hp === '' || body.hp == null ? null : toNumber(body.hp, null),
    speed: typeof body.speed === 'string' ? body.speed.slice(0, 100) : '',
    stats: {
      str: toNumber(body.stats?.str, null),
      dex: toNumber(body.stats?.dex, null),
      con: toNumber(body.stats?.con, null),
      int: toNumber(body.stats?.int, null),
      wis: toNumber(body.stats?.wis, null),
      cha: toNumber(body.stats?.cha, null),
    },
    abilities: typeof body.abilities === 'string' ? body.abilities.slice(0, 4000) : '',
    actions: typeof body.actions === 'string' ? body.actions.slice(0, 4000) : '',
    notes: typeof body.notes === 'string' ? body.notes.slice(0, 2000) : '',
    tags: Array.isArray(body.tags) ? body.tags.filter((t) => typeof t === 'string').slice(0, 20) : [],
  };
  data.library.push(entry);
  saveData();
  res.status(201).json(entry);
});

app.put('/api/library/:id', (req, res) => {
  const entry = data.library.find((e) => e.id === req.params.id);
  if (!entry) return res.status(404).json({ error: 'Eintrag nicht gefunden.' });

  const body = req.body || {};
  if ('name' in body && typeof body.name === 'string' && body.name.trim()) {
    entry.name = body.name.trim().slice(0, 100);
  }
  if ('category' in body && VALID_CATEGORIES.has(body.category)) entry.category = body.category;
  if ('ac' in body) entry.ac = body.ac === '' || body.ac == null ? null : toNumber(body.ac, entry.ac);
  if ('hp' in body) entry.hp = body.hp === '' || body.hp == null ? null : toNumber(body.hp, entry.hp);
  if ('speed' in body && typeof body.speed === 'string') entry.speed = body.speed.slice(0, 100);
  if ('stats' in body && body.stats && typeof body.stats === 'object') {
    entry.stats = {
      str: toNumber(body.stats.str, entry.stats.str),
      dex: toNumber(body.stats.dex, entry.stats.dex),
      con: toNumber(body.stats.con, entry.stats.con),
      int: toNumber(body.stats.int, entry.stats.int),
      wis: toNumber(body.stats.wis, entry.stats.wis),
      cha: toNumber(body.stats.cha, entry.stats.cha),
    };
  }
  if ('abilities' in body && typeof body.abilities === 'string') entry.abilities = body.abilities.slice(0, 4000);
  if ('actions' in body && typeof body.actions === 'string') entry.actions = body.actions.slice(0, 4000);
  if ('notes' in body && typeof body.notes === 'string') entry.notes = body.notes.slice(0, 2000);
  if ('tags' in body && Array.isArray(body.tags)) {
    entry.tags = body.tags.filter((t) => typeof t === 'string').slice(0, 20);
  }

  saveData();
  res.json(entry);
});

app.delete('/api/library/:id', (req, res) => {
  const idx = data.library.findIndex((e) => e.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Eintrag nicht gefunden.' });
  data.library.splice(idx, 1);
  saveData();
  res.status(204).end();
});

app.post('/api/library/:id/add-to-encounter', (req, res) => {
  const entry = data.library.find((e) => e.id === req.params.id);
  if (!entry) return res.status(404).json({ error: 'Eintrag nicht gefunden.' });

  const body = req.body || {};
  const count = Math.min(Math.max(parseInt(body.count, 10) || 1, 1), 20);
  const rollInitiative = !!body.rollInitiative;
  const baseInitiative = toNumber(body.initiative, 0);

  const created = [];
  for (let i = 0; i < count; i++) {
    const initiative = rollInitiative ? Math.floor(Math.random() * 20) + 1 : baseInitiative;
    const combatant = {
      id: newId(),
      name: count > 1 ? `${entry.name} ${i + 1}` : entry.name,
      type: entry.category,
      initiative,
      hp: entry.hp ?? 0,
      maxHp: entry.hp ?? 0,
      ac: entry.ac ?? 10,
      conditions: [],
      notes: '',
    };
    data.encounter.combatants.push(combatant);
    created.push(combatant);
  }
  sortEncounter();
  saveData();
  res.status(201).json({ encounter: data.encounter, created });
});

// ---------- Notizen ----------

app.get('/api/notes', (req, res) => {
  res.json(data.notes);
});

app.post('/api/notes', (req, res) => {
  const body = req.body || {};
  if (!body.title || typeof body.title !== 'string' || !body.title.trim()) {
    return res.status(400).json({ error: 'Titel ist erforderlich.' });
  }
  const now = new Date().toISOString();
  const note = {
    id: newId(),
    title: body.title.trim().slice(0, 150),
    content: typeof body.content === 'string' ? body.content.slice(0, 20000) : '',
    tags: Array.isArray(body.tags) ? body.tags.filter((t) => typeof t === 'string').slice(0, 20) : [],
    createdAt: now,
    updatedAt: now,
  };
  data.notes.unshift(note);
  saveData();
  res.status(201).json(note);
});

app.put('/api/notes/:id', (req, res) => {
  const note = data.notes.find((n) => n.id === req.params.id);
  if (!note) return res.status(404).json({ error: 'Notiz nicht gefunden.' });

  const body = req.body || {};
  if ('title' in body && typeof body.title === 'string' && body.title.trim()) {
    note.title = body.title.trim().slice(0, 150);
  }
  if ('content' in body && typeof body.content === 'string') note.content = body.content.slice(0, 20000);
  if ('tags' in body && Array.isArray(body.tags)) {
    note.tags = body.tags.filter((t) => typeof t === 'string').slice(0, 20);
  }
  note.updatedAt = new Date().toISOString();
  saveData();
  res.json(note);
});

app.delete('/api/notes/:id', (req, res) => {
  const idx = data.notes.findIndex((n) => n.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Notiz nicht gefunden.' });
  data.notes.splice(idx, 1);
  saveData();
  res.status(204).end();
});

// ---------- Würfel ----------

app.post('/api/dice/roll', (req, res) => {
  const { expression, mode, label } = req.body || {};
  if (!expression || typeof expression !== 'string') {
    return res.status(400).json({ error: 'Würfelausdruck ist erforderlich.' });
  }
  let result;
  try {
    result = rollDice(expression, mode === 'advantage' || mode === 'disadvantage' ? mode : 'normal');
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  const entry = {
    id: newId(),
    expression: expression.slice(0, 200),
    label: typeof label === 'string' ? label.slice(0, 100) : '',
    mode: mode === 'advantage' || mode === 'disadvantage' ? mode : 'normal',
    details: result.details,
    total: result.total,
    timestamp: new Date().toISOString(),
  };
  data.rollHistory.unshift(entry);
  data.rollHistory = data.rollHistory.slice(0, 100);
  saveData();
  res.status(201).json(entry);
});

app.get('/api/dice/history', (req, res) => {
  res.json(data.rollHistory);
});

app.delete('/api/dice/history', (req, res) => {
  data.rollHistory = [];
  saveData();
  res.status(204).end();
});

// ---------- Fehlerbehandlung ----------

app.use((req, res) => {
  res.status(404).json({ error: 'Nicht gefunden.' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Interner Serverfehler.' });
});

app.listen(PORT, () => {
  console.log(`DM-Board läuft auf http://localhost:${PORT}`);
});
