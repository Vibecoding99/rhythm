// Turns a ParsedCapture (from parse.js) into something Rhythm can actually
// save — resolving a real category, filling in defaults parse.js correctly
// leaves blank, and expanding daily/every-weekday recurrence into several
// ordinary weekly-recurring entries (Rhythm's recurrence engine only
// understands "weekly, on one weekday"; this reuses that exactly rather
// than extending it).
import { toISODate, nextWeekdayOnOrAfter } from "./parse.js";
import { minutesToTimeStr, timeStrToMinutes } from "./date.js";
import { getCategories, addCategory, addEntry, addInboxItem } from "./store.js";

const DEFAULT_TIME = "09:00";
const DEFAULT_DURATION = 30;

export function resolveCategory(tags) {
  const cats = getCategories();
  for (const tag of tags) {
    const exact = cats.find((c) => c.name.toLowerCase() === tag.toLowerCase());
    if (exact) return exact;
  }
  for (const tag of tags) {
    const fuzzy = cats.find((c) =>
      c.name.toLowerCase().includes(tag.toLowerCase()) || tag.toLowerCase().includes(c.name.toLowerCase())
    );
    if (fuzzy) return fuzzy;
  }
  return getOrCreateInboxCategory();
}

export function getOrCreateInboxCategory() {
  const existing = getCategories().find((c) => c.name.toLowerCase() === "inbox");
  if (existing) return existing;
  return addCategory("Inbox", { emoji: "📥" });
}

function buildNote(parsed, categoryName) {
  let note = parsed.title;
  if (parsed.priority === "high") note = `‼️ ${note}`.trim();
  if (parsed.list) note = note ? `${note} (${parsed.list})` : `(${parsed.list})`;
  // The first matching tag became the category; any extra tags would
  // otherwise vanish silently, so fold them into the note.
  const extraTags = parsed.tags.filter((t) => t.toLowerCase() !== categoryName.toLowerCase());
  if (extraTags.length) note = note ? `${note} #${extraTags.join(" #")}` : `#${extraTags.join(" #")}`;
  return note.trim();
}

// A draft is the editable, confirm-screen-ready shape — nothing is saved
// until saveDraft() is called on one.
export function buildDraft(parsed) {
  const category = resolveCategory(parsed.tags);
  // A pure recurrence phrase ("every weekday") has no explicit date, but it
  // still implies a starting point (today) — it must not fall through to
  // the inbox just because no calendar date was named.
  const effectiveDate = parsed.date || (parsed.recurrence ? toISODate(new Date()) : null);
  const hasDate = !!effectiveDate;
  const time = parsed.time || DEFAULT_TIME;
  const durationMin = parsed.durationMin || DEFAULT_DURATION;
  const endMinutes = Math.min(timeStrToMinutes(time) + durationMin, 24 * 60 - 1);

  return {
    categoryId: category.id,
    date: hasDate ? effectiveDate : null,
    startTime: hasDate ? time : null,
    endTime: hasDate ? minutesToTimeStr(endMinutes) : null,
    timeWasGuessed: hasDate && !parsed.time,
    durationMin,
    note: buildNote(parsed, category.name),
    recurrence: parsed.recurrence,
    status: hasDate ? "scheduled" : "inbox",
  };
}

// Commits a confirmed draft. Returns the array of saved entries (usually
// one; several for a fanned-out "daily"/"every weekday" recurrence).
export function saveDraft(draft) {
  if (draft.status === "inbox") {
    return [addInboxItem({
      categoryId: draft.categoryId,
      note: draft.note,
      durationMin: draft.durationMin,
      isRecurring: !!draft.recurrence && draft.recurrence.freq !== "monthly",
      recurrenceRule: draft.recurrence,
    })];
  }

  const freq = draft.recurrence?.freq;
  if (!freq || freq === "monthly") {
    // No recurrence, or "monthly" (unsupported — confirm UI must already
    // have told the user; falls back to a plain one-time entry).
    return [commitOne(draft, draft.date, false)];
  }

  const weekdays = freq === "daily" ? [0, 1, 2, 3, 4, 5, 6]
    : freq === "weekday" ? [1, 2, 3, 4, 5]
    : [draft.recurrence.weekday];

  const anchor = new Date(draft.date + "T00:00:00");
  return weekdays.map((weekday) => commitOne(draft, toISODate(nextWeekdayOnOrAfter(anchor, weekday)), true));
}

function commitOne(draft, date, isRecurring) {
  return addEntry({
    date,
    startTime: draft.startTime,
    endTime: draft.endTime,
    category: draft.categoryId,
    note: draft.note,
    isRecurring,
  });
}
