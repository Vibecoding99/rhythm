import { generateId } from "./id.js";
import { fromISODate, weekdayIndex, timeStrToMinutes } from "./date.js";
import { nextPaletteSlot } from "./color.js";

const STORAGE_KEY = "rhythm.v1";

const DEFAULT_STATE = {
  version: 1,
  categories: [],
  entries: [],
  exceptions: [],
  goals: [],
  settings: {
    dayStartHour: 6,
    dayEndHour: 23,
    lastBackupAt: null,
    autoBackup: { enabled: true, intervalDays: 7 },
  },
};

let state = load();
const listeners = new Set();

// Settings is nested — a shallow spread would drop new default keys (e.g.
// autoBackup) for anyone with a settings object saved before those keys
// existed, so merge it one level deeper explicitly.
function mergeWithDefaults(parsed) {
  const merged = { ...structuredClone(DEFAULT_STATE), ...parsed };
  merged.settings = {
    ...structuredClone(DEFAULT_STATE.settings),
    ...(parsed.settings || {}),
    autoBackup: {
      ...DEFAULT_STATE.settings.autoBackup,
      ...((parsed.settings && parsed.settings.autoBackup) || {}),
    },
  };
  return merged;
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(DEFAULT_STATE);
    return mergeWithDefaults(JSON.parse(raw));
  } catch (e) {
    console.error("Failed to load rhythm data", e);
    return structuredClone(DEFAULT_STATE);
  }
}

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  listeners.forEach((fn) => fn());
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// ---------- Categories ----------

export function getCategories() {
  return state.categories.slice().sort((a, b) => a.name.localeCompare(b.name));
}

export function getCategory(id) {
  return state.categories.find((c) => c.id === id) || null;
}

export function addCategory(name, colorIndex) {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Category name required");
  const existing = state.categories.find((c) => c.name.toLowerCase() === trimmed.toLowerCase());
  if (existing) return existing;
  const cat = {
    id: generateId(),
    name: trimmed,
    colorIndex: colorIndex ?? nextPaletteSlot(state.categories),
    fields: [],
    createdAt: Date.now(),
  };
  state.categories.push(cat);
  persist();
  return cat;
}

// fields: [{ id, label, type: 'text' | 'number' }]
export function setCategoryFields(id, fields) {
  updateCategory(id, { fields });
}

export function updateCategory(id, changes) {
  const cat = state.categories.find((c) => c.id === id);
  if (!cat) return;
  Object.assign(cat, changes);
  persist();
}

export function categoryUsageCount(id) {
  return state.entries.filter((e) => e.category === id).length;
}

export function deleteCategory(id) {
  state.categories = state.categories.filter((c) => c.id !== id);
  state.entries = state.entries.filter((e) => e.category !== id);
  state.exceptions = state.exceptions.filter((x) => {
    const master = state.entries.find((e) => e.id === x.masterId);
    return !!master;
  });
  state.goals = state.goals.filter((g) => g.categoryId !== id);
  persist();
}

// ---------- Entry expansion (recurrence-aware) ----------

function occurrenceKey(masterId, date) {
  return `${masterId}::${date}`;
}

function findException(masterId, date) {
  return state.exceptions.find((x) => x.masterId === masterId && x.date === date) || null;
}

// Returns concrete occurrences for a given ISO date, sorted by start time.
export function getEntriesForDate(iso) {
  const results = [];
  const targetWeekday = weekdayIndex(fromISODate(iso));

  for (const e of state.entries) {
    if (!e.isRecurring) {
      if (e.date === iso) {
        results.push({
          occurrenceId: e.id,
          masterId: e.id,
          isRecurring: false,
          isException: false,
          date: e.date,
          startTime: e.startTime,
          endTime: e.endTime,
          category: e.category,
          note: e.note,
          customFields: e.customFields || {},
        });
      }
      continue;
    }
    // Recurring master.
    if (iso < e.date) continue;
    if (weekdayIndex(fromISODate(e.date)) !== targetWeekday) continue;
    const exc = findException(e.id, iso);
    if (exc && exc.type === "deleted") continue;
    if (exc && exc.type === "modified") {
      results.push({
        occurrenceId: occurrenceKey(e.id, iso),
        masterId: e.id,
        isRecurring: true,
        isException: true,
        date: iso,
        startTime: exc.overrides.startTime,
        endTime: exc.overrides.endTime,
        category: exc.overrides.category,
        note: exc.overrides.note,
        customFields: exc.overrides.customFields || {},
      });
      continue;
    }
    results.push({
      occurrenceId: occurrenceKey(e.id, iso),
      masterId: e.id,
      isRecurring: true,
      isException: false,
      date: iso,
      startTime: e.startTime,
      endTime: e.endTime,
      category: e.category,
      note: e.note,
      customFields: e.customFields || {},
    });
  }

  return results.sort((a, b) => timeStrToMinutes(a.startTime) - timeStrToMinutes(b.startTime));
}

export function getEntriesForRange(startIso, endIso) {
  const map = {};
  let cur = startIso;
  while (cur <= endIso) {
    map[cur] = getEntriesForDate(cur);
    cur = addOneDay(cur);
  }
  return map;
}

function addOneDay(iso) {
  const d = fromISODate(iso);
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ---------- Conflict detection ----------

export function findConflicts(iso, startTime, endTime, excludeOccurrenceId) {
  const s = timeStrToMinutes(startTime);
  const en = timeStrToMinutes(endTime);
  return getEntriesForDate(iso).filter((occ) => {
    if (occ.occurrenceId === excludeOccurrenceId) return false;
    const os = timeStrToMinutes(occ.startTime);
    const oe = timeStrToMinutes(occ.endTime);
    return s < oe && os < en;
  });
}

// ---------- Mutations ----------

export function addEntry(data) {
  const now = Date.now();
  const entry = {
    id: generateId(),
    date: data.date,
    startTime: data.startTime,
    endTime: data.endTime,
    category: data.category,
    note: data.note || "",
    customFields: data.customFields || {},
    isRecurring: !!data.isRecurring,
    recurrenceRule: data.isRecurring ? { freq: "weekly" } : null,
    createdAt: now,
    updatedAt: now,
  };
  state.entries.push(entry);
  persist();
  return entry;
}

// occurrence: result item from getEntriesForDate
export function updateOccurrence(occurrence, changes, scope) {
  if (!occurrence.isRecurring) {
    const entry = state.entries.find((e) => e.id === occurrence.masterId);
    if (!entry) return;
    Object.assign(entry, changes, { updatedAt: Date.now() });
    persist();
    return;
  }

  if (scope === "series") {
    const master = state.entries.find((e) => e.id === occurrence.masterId);
    if (!master) return;
    Object.assign(master, changes, { updatedAt: Date.now() });
    persist();
    return;
  }

  // scope === 'instance'
  let exc = findException(occurrence.masterId, occurrence.date);
  const master = state.entries.find((e) => e.id === occurrence.masterId);
  const overrides = {
    startTime: changes.startTime ?? occurrence.startTime,
    endTime: changes.endTime ?? occurrence.endTime,
    category: changes.category ?? occurrence.category,
    note: changes.note !== undefined ? changes.note : occurrence.note,
    customFields: changes.customFields !== undefined ? changes.customFields : occurrence.customFields,
  };
  if (exc) {
    exc.type = "modified";
    exc.overrides = overrides;
    exc.updatedAt = Date.now();
  } else {
    state.exceptions.push({
      id: generateId(),
      masterId: occurrence.masterId,
      date: occurrence.date,
      type: "modified",
      overrides,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  }
  persist();
}

export function deleteOccurrence(occurrence, scope) {
  if (!occurrence.isRecurring) {
    state.entries = state.entries.filter((e) => e.id !== occurrence.masterId);
    persist();
    return;
  }

  if (scope === "series") {
    state.entries = state.entries.filter((e) => e.id !== occurrence.masterId);
    state.exceptions = state.exceptions.filter((x) => x.masterId !== occurrence.masterId);
    persist();
    return;
  }

  // scope === 'instance'
  let exc = findException(occurrence.masterId, occurrence.date);
  if (exc) {
    exc.type = "deleted";
    exc.updatedAt = Date.now();
  } else {
    state.exceptions.push({
      id: generateId(),
      masterId: occurrence.masterId,
      date: occurrence.date,
      type: "deleted",
      overrides: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  }
  persist();
}

// Trim the conflicting occurrence around [newStart,newEnd), or delete it
// entirely when it can't be cleanly shortened (fully covered either way).
// Recurring conflicts are trimmed for this date only (scope: instance).
export function trimOrReplaceOccurrence(occurrence, newStart, newEnd) {
  const s = timeStrToMinutes(newStart);
  const en = timeStrToMinutes(newEnd);
  const os = timeStrToMinutes(occurrence.startTime);
  const oe = timeStrToMinutes(occurrence.endTime);

  if (os < s && oe > s && oe <= en) {
    updateOccurrence(occurrence, { startTime: occurrence.startTime, endTime: newStart }, "instance");
  } else if (os >= s && os < en && oe > en) {
    updateOccurrence(occurrence, { startTime: newEnd, endTime: occurrence.endTime }, "instance");
  } else {
    deleteOccurrence(occurrence, "instance");
  }
}

// ---------- Goals ----------

export function getGoals() {
  return state.goals.slice();
}

export function getGoal(id) {
  return state.goals.find((g) => g.id === id) || null;
}

export function addGoal(data) {
  const now = Date.now();
  const goal = {
    id: generateId(),
    categoryId: data.categoryId,
    metric: data.metric, // 'time' | 'count' | 'sum'
    sumFieldId: data.sumFieldId || null,
    filterFieldId: data.filterFieldId || null,
    filterValue: data.filterValue || null,
    direction: data.direction === "max" ? "max" : "min",
    target: Number(data.target) || 0,
    period: data.period === "monthly" ? "monthly" : "weekly",
    unit: data.unit || "",
    name: data.name || "",
    createdAt: now,
    updatedAt: now,
  };
  state.goals.push(goal);
  persist();
  return goal;
}

export function updateGoal(id, changes) {
  const goal = state.goals.find((g) => g.id === id);
  if (!goal) return;
  Object.assign(goal, changes, { updatedAt: Date.now() });
  persist();
}

export function deleteGoal(id) {
  state.goals = state.goals.filter((g) => g.id !== id);
  persist();
}

// ---------- Settings ----------

export function getSettings() {
  return { ...state.settings };
}

export function updateSettings(changes) {
  Object.assign(state.settings, changes);
  persist();
}

// ---------- Export / Import ----------

export function exportData() {
  return JSON.stringify(state, null, 2);
}

export function importData(json) {
  const parsed = JSON.parse(json);
  if (!parsed || !Array.isArray(parsed.entries) || !Array.isArray(parsed.categories)) {
    throw new Error("Invalid backup file");
  }
  state = mergeWithDefaults(parsed);
  persist();
}
