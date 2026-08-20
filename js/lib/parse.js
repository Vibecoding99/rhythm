// Quick-capture natural-language parser. Pure function, no DOM/store
// dependencies — the same parse() is fed by both typed text and a voice
// transcript, so voice and text are identical from here on.
//
// Strategy: run an ordered pipeline of recognizers over a mutable working
// copy of the string. Each recognizer finds its pattern, records the value,
// and deletes the matched substring from the working copy. Order matters —
// more specific patterns (e.g. "every friday", "next friday") must run
// before looser ones (bare "friday") so the loose pattern never gets a
// chance to eat part of a phrase a stricter recognizer already owns.
// Whatever text is left after every recognizer has run, trimmed and
// whitespace-collapsed, is the title. Never throws — worst case, nothing
// matches and the whole input becomes the title with every field null.

const WEEKDAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const MONTH_NAMES = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];
const MONTH_ABBR = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const WORD_NUMBERS = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12,
};

const pad2 = (n) => String(n).padStart(2, "0");
export const toISODate = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

// ---------- spoken-form normalization (runs before everything else) ----------
// Speech has no digits or symbols — turn the common spoken time/number forms
// into the same shorthand a typed capture would use, so one set of
// recognizers below handles both.
function normalizeSpoken(input) {
  // Case-insensitive matching throughout (`i` flag), but the input itself is
  // never lowercased wholesale — proper nouns like "Sam" must survive into
  // the title untouched. Only the specific tokens being rewritten (numbers,
  // am/pm markers) come out lowercase, and those always get consumed by a
  // recognizer before the title is assembled.
  let s = ` ${input} `;

  // "seven a m" / "seven a.m." / "seven am" -> "7am" (and pm)
  for (const [word, num] of Object.entries(WORD_NUMBERS)) {
    s = s.replace(new RegExp(`\\b${word}\\b(?:\\s*:\\s*(\\d{2}))?\\s*a\\.?\\s*m\\.?\\b`, "gi"), `${num}$1am`);
    s = s.replace(new RegExp(`\\b${word}\\b(?:\\s*:\\s*(\\d{2}))?\\s*p\\.?\\s*m\\.?\\b`, "gi"), `${num}$1pm`);
  }
  // spelled-out "a m" / "p m" left after a digit, e.g. "7 a m"
  s = s.replace(/\b(\d{1,2}(?::\d{2})?)\s*a\.?\s*m\.?\b/gi, "$1am");
  s = s.replace(/\b(\d{1,2}(?::\d{2})?)\s*p\.?\s*m\.?\b/gi, "$1pm");

  // "half past two" -> "2:30", "quarter past three" -> "3:15", "quarter to four" -> "3:45"
  s = s.replace(/\bhalf past (\w+)\b/gi, (m, h) => {
    const hour = WORD_NUMBERS[h.toLowerCase()] ?? (/^\d+$/.test(h) ? Number(h) : null);
    return hour ? `${hour}:30` : m;
  });
  s = s.replace(/\bquarter past (\w+)\b/gi, (m, h) => {
    const hour = WORD_NUMBERS[h.toLowerCase()] ?? (/^\d+$/.test(h) ? Number(h) : null);
    return hour ? `${hour}:15` : m;
  });
  s = s.replace(/\bquarter to (\w+)\b/gi, (m, h) => {
    const hour = WORD_NUMBERS[h.toLowerCase()] ?? (/^\d+$/.test(h) ? Number(h) : null);
    return hour ? `${Math.max(1, hour - 1)}:45` : m;
  });

  // "half an hour" -> "30 min" ; "an hour and a half" -> "90 min"
  s = s.replace(/\ban hour and a half\b/gi, "90 min");
  s = s.replace(/\bhalf an hour\b/gi, "30 min");

  return s.trim().replace(/\s+/g, " ");
}

// ---------- helpers ----------
function stripMatch(text, match) {
  return (text.slice(0, match.index) + text.slice(match.index + match[0].length))
    .replace(/\s+/g, " ")
    .trim();
}

function resolveWeekday(name) {
  return WEEKDAY_NAMES.indexOf(name.toLowerCase());
}

// Next occurrence of `weekday` on/after `from` (today counts if it matches).
// Exported — the capture-save layer needs this same math to pick anchor
// dates when fanning "daily"/"every weekday" out into several weekly
// recurring entries.
export function nextWeekdayOnOrAfter(from, weekday) {
  const d = new Date(from);
  const diff = (weekday - d.getDay() + 7) % 7;
  d.setDate(d.getDate() + diff);
  return d;
}

// ---------- recognizers (each returns { value, text } or null) ----------

function recognizePriority(text) {
  let m = text.match(/!!!|!!|!/);
  if (m) return { value: "high", text: stripMatch(text, m), confidence: 1 };
  m = text.match(/\b(urgent|asap|high priority|important)\b/i);
  if (m) return { value: "high", text: stripMatch(text, m), confidence: 0.9 };
  return null;
}

// Runs BEFORE the date recognizer so "every friday" is claimed here, not
// left as a bare "friday" for the date recognizer to (wrongly) also match.
function recognizeRecurrence(text, now) {
  let m = text.match(/\b(daily|every day)\b/i);
  if (m) return { value: { freq: "daily" }, text: stripMatch(text, m), confidence: 0.95 };

  m = text.match(/\bevery weekday(s)?\b/i);
  if (m) return { value: { freq: "weekday" }, text: stripMatch(text, m), confidence: 0.95 };

  m = text.match(new RegExp(`\\bevery\\s+(${WEEKDAY_NAMES.join("|")})\\b`, "i"));
  if (m) {
    const weekday = resolveWeekday(m[1]);
    return { value: { freq: "weekly", weekday }, text: stripMatch(text, m), confidence: 0.95 };
  }

  m = text.match(/\b(weekly|every week)\b/i);
  if (m) return { value: { freq: "weekly", weekday: null }, text: stripMatch(text, m), confidence: 0.85 };

  m = text.match(/\bmonthly\b/i);
  if (m) return { value: { freq: "monthly", unsupported: true }, text: stripMatch(text, m), confidence: 0.85 };

  return null;
}

function recognizeDuration(text) {
  // "1 hour 30 min" / "1h30m" combined form first, so the loose single-unit
  // patterns below don't each grab half of it.
  let m = text.match(/\b(\d+)\s*(?:h|hr|hour|hours)\s*(?:and\s*)?(\d+)\s*(?:m|min|mins|minute|minutes)\b/i);
  if (m) return { value: Number(m[1]) * 60 + Number(m[2]), text: stripMatch(text, m), confidence: 0.95 };

  m = text.match(/\bfor\s+(\d+)\s*(?:m|min|mins|minute|minutes)\b/i) || text.match(/\b(\d+)\s*(?:m|min|mins|minute|minutes)\b/i);
  if (m) return { value: Number(m[1]), text: stripMatch(text, m), confidence: 0.9 };

  m = text.match(/\bfor\s+(\d+)\s*(?:h|hr|hrs|hour|hours)\b/i) || text.match(/\b(\d+)\s*(?:h|hr|hrs|hour|hours)\b/i);
  if (m) return { value: Number(m[1]) * 60, text: stripMatch(text, m), confidence: 0.9 };

  return null;
}

// Bare "at N" with no am/pm has no unambiguous meaning — this is a
// documented, editable-via-chip heuristic, not a claim of correctness:
// 7-12 defaults to AM (typical morning/midday hours), 1-6 defaults to PM
// (typical afternoon/evening hours).
function defaultMeridiem(hour) {
  return hour >= 7 && hour <= 12 ? "am" : "pm";
}

function to24Hour(hour, minute, meridiem) {
  let h = hour % 12;
  if (meridiem === "pm") h += 12;
  return `${pad2(h)}:${pad2(minute)}`;
}

function recognizeTime(text) {
  let m = text.match(/\bnoon\b/i);
  if (m) return { value: "12:00", text: stripMatch(text, m), confidence: 0.9 };
  m = text.match(/\bmidnight\b/i);
  if (m) return { value: "00:00", text: stripMatch(text, m), confidence: 0.9 };

  // Explicit am/pm, with or without minutes/colon: "7am", "7:30pm", "3 pm"
  m = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  if (m) {
    const hour = Number(m[1]) % 12;
    return { value: to24Hour(hour, Number(m[2] || 0), m[3].toLowerCase()), text: stripMatch(text, m), confidence: 0.95 };
  }

  // 24-hour form, e.g. "15:00" — only counts as unambiguous at hour >= 13.
  m = text.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (m && Number(m[1]) >= 13) {
    return { value: `${pad2(Number(m[1]))}:${m[2]}`, text: stripMatch(text, m), confidence: 0.9 };
  }
  if (m && Number(m[1]) < 13) {
    // Ambiguous "9:15" with no am/pm — treat as a genuine time (colon makes
    // intent clear even without am/pm), default meridiem heuristic applies.
    const hour = Number(m[1]);
    const meridiem = defaultMeridiem(hour === 0 ? 12 : hour);
    return { value: to24Hour(hour === 12 ? 0 : hour, Number(m[2]), meridiem), text: stripMatch(text, m), confidence: 0.6 };
  }

  // Bare "at 7" — lowest confidence, no colon or am/pm at all.
  m = text.match(/\bat\s+(\d{1,2})\b/i);
  if (m) {
    const hour = Number(m[1]);
    if (hour >= 1 && hour <= 23) {
      const h12 = hour > 12 ? hour - 12 : hour;
      const meridiem = hour > 12 ? "pm" : defaultMeridiem(hour);
      return { value: to24Hour(h12 === 0 ? 12 : h12, 0, meridiem), text: stripMatch(text, m), confidence: 0.5 };
    }
  }

  return null;
}

function recognizeDate(text, now) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  // "next <weekday>" before bare "<weekday>", and before "this weekend" /
  // "next week" so those don't get shadowed by a coincidental weekday match.
  let m = text.match(new RegExp(`\\bnext\\s+(${WEEKDAY_NAMES.join("|")})\\b`, "i"));
  if (m) {
    const weekday = resolveWeekday(m[1]);
    const immediate = nextWeekdayOnOrAfter(today, weekday);
    const d = new Date(immediate);
    d.setDate(d.getDate() + 7);
    return { value: toISODate(d), text: stripMatch(text, m), confidence: 0.9 };
  }

  m = text.match(/\bnext week\b/i);
  if (m) {
    const d = new Date(today);
    d.setDate(d.getDate() + 7);
    return { value: toISODate(d), text: stripMatch(text, m), confidence: 0.7 };
  }

  m = text.match(/\bnext month\b/i);
  if (m) {
    const d = new Date(today.getFullYear(), today.getMonth() + 1, today.getDate());
    return { value: toISODate(d), text: stripMatch(text, m), confidence: 0.7 };
  }

  m = text.match(/\bthis weekend\b/i);
  if (m) {
    const d = nextWeekdayOnOrAfter(today, 6); // Saturday
    return { value: toISODate(d), text: stripMatch(text, m), confidence: 0.8 };
  }

  m = text.match(/\bin\s+(\d+)\s+days?\b/i);
  if (m) {
    const d = new Date(today);
    d.setDate(d.getDate() + Number(m[1]));
    return { value: toISODate(d), text: stripMatch(text, m), confidence: 0.9 };
  }

  m = text.match(/\btomorrow\b/i);
  if (m) {
    const d = new Date(today);
    d.setDate(d.getDate() + 1);
    return { value: toISODate(d), text: stripMatch(text, m), confidence: 0.95 };
  }

  m = text.match(/\b(today|tonight)\b/i);
  if (m) return { value: toISODate(today), text: stripMatch(text, m), confidence: 0.95 };

  // "aug 20" / "august 20" / "aug 20th" — before bare weekday so a stray
  // month-name-that-looks-like-a-word never confuses things, and after the
  // relative-date forms above so "next week" etc. take priority.
  const monthPattern = [...MONTH_NAMES, ...MONTH_ABBR].join("|");
  m = text.match(new RegExp(`\\b(${monthPattern})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, "i"));
  if (m) {
    const raw = m[1].toLowerCase();
    const monthIdx = MONTH_NAMES.indexOf(raw) !== -1 ? MONTH_NAMES.indexOf(raw) : MONTH_ABBR.indexOf(raw);
    const day = Number(m[2]);
    let year = today.getFullYear();
    let candidate = new Date(year, monthIdx, day);
    if (candidate < today) candidate = new Date(year + 1, monthIdx, day);
    return { value: toISODate(candidate), text: stripMatch(text, m), confidence: 0.9 };
  }

  // Bare weekday name, lowest priority of the date forms.
  m = text.match(new RegExp(`\\b(${WEEKDAY_NAMES.join("|")})\\b`, "i"));
  if (m) {
    const weekday = resolveWeekday(m[1]);
    const d = nextWeekdayOnOrAfter(today, weekday);
    return { value: toISODate(d), text: stripMatch(text, m), confidence: 0.85 };
  }

  return null;
}

function recognizeTags(text) {
  const tags = [];
  let working = text;

  // Typed #tag, possibly several.
  working = working.replace(/#(\w+)/g, (_m, tag) => { tags.push(tag.toLowerCase()); return " "; });

  // Spoken "tag it health", "tag health", "category work" — one at a time,
  // loop in case of multiple.
  let m;
  const re = /\b(?:tag it|tag|category)\s+(\w+)\b/i;
  while ((m = working.match(re))) {
    tags.push(m[1].toLowerCase());
    working = stripMatch(working, m);
  }

  if (tags.length === 0) return null;
  return { value: tags, text: working.replace(/\s+/g, " ").trim(), confidence: 0.85 };
}

function recognizeList(text) {
  let m = text.match(/\/(\w+)/);
  if (m) return { value: m[1].toLowerCase(), text: stripMatch(text, m), confidence: 0.9 };

  m = text.match(/\bin project\s+([a-z0-9][\w\s]*?)(?=\s+(?:tag|category|#|\/|!|$)|$)/i);
  if (m) return { value: m[1].trim().toLowerCase(), text: stripMatch(text, m), confidence: 0.8 };

  m = text.match(/\blist\s+([a-z0-9][\w\s]*?)(?=\s+(?:tag|category|#|\/|!|$)|$)/i);
  if (m) return { value: m[1].trim().toLowerCase(), text: stripMatch(text, m), confidence: 0.7 };

  return null;
}

// ---------- the pipeline ----------

export function parseCapture(input, now = new Date()) {
  const result = {
    title: "",
    date: null,
    time: null,
    durationMin: null,
    recurrence: null,
    tags: [],
    priority: "normal",
    list: null,
    confidence: {},
  };

  let text = normalizeSpoken(input || "");

  const priority = recognizePriority(text);
  if (priority) { result.priority = priority.value; result.confidence.priority = priority.confidence; text = priority.text; }

  const recurrence = recognizeRecurrence(text, now);
  if (recurrence) { result.recurrence = recurrence.value; result.confidence.recurrence = recurrence.confidence; text = recurrence.text; }

  const duration = recognizeDuration(text);
  if (duration) { result.durationMin = duration.value; result.confidence.durationMin = duration.confidence; text = duration.text; }

  const time = recognizeTime(text);
  if (time) { result.time = time.value; result.confidence.time = time.confidence; text = time.text; }

  const date = recognizeDate(text, now);
  if (date) { result.date = date.value; result.confidence.date = date.confidence; text = date.text; }

  const tags = recognizeTags(text);
  if (tags) { result.tags = tags.value; result.confidence.tags = tags.confidence; text = tags.text; }

  const list = recognizeList(text);
  if (list) { result.list = list.value; result.confidence.list = list.confidence; text = list.text; }

  // Recurrence with no explicit weekday ("weekly", "every week") anchors to
  // the parsed date's weekday if there is one, else today's.
  if (result.recurrence && result.recurrence.freq === "weekly" && result.recurrence.weekday == null) {
    const anchor = result.date ? new Date(result.date + "T00:00:00") : now;
    result.recurrence.weekday = anchor.getDay();
  }

  // Clean up leftover filler words/punctuation the recognizers didn't need
  // to consume but that read oddly left dangling in a title (a stray "at",
  // "for", "by" from a phrase whose object got stripped).
  text = text
    .replace(/\b(at|for|by|on|in)\s*$/i, "")
    .replace(/^\s*(at|for|by|on|in)\b/i, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  result.title = text;
  return result;
}
