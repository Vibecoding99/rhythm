// Date & time helpers. Dates are always local time, no timezone math.
// ISO date strings are "YYYY-MM-DD". Times are "HH:MM" 24-hour, 15-min snapped.

export const MINUTES_PER_DAY = 24 * 60;
export const SNAP = 15;

export function pad2(n) {
  return String(n).padStart(2, "0");
}

export function toISODate(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function fromISODate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

export function addDaysISO(iso, n) {
  return toISODate(addDays(fromISODate(iso), n));
}

export function isToday(iso) {
  return iso === toISODate(new Date());
}

// Monday-start weeks.
export function startOfWeek(date) {
  const d = new Date(date);
  const day = d.getDay(); // 0 Sun .. 6 Sat
  const diff = (day === 0 ? -6 : 1) - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function getWeekDates(anchorDate) {
  const start = startOfWeek(anchorDate);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

export function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function endOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

// Returns array of Date objects covering full weeks (Mon-start) for month grid.
export function getMonthGrid(anchorDate) {
  const first = startOfMonth(anchorDate);
  const last = endOfMonth(anchorDate);
  const gridStart = startOfWeek(first);
  const lastWeekStart = startOfWeek(last);
  const gridEnd = addDays(lastWeekStart, 6);
  const days = [];
  let cur = gridStart;
  while (cur <= gridEnd) {
    days.push(cur);
    cur = addDays(cur, 1);
  }
  return days;
}

export function weekdayIndex(date) {
  // 0 = Monday .. 6 = Sunday
  const d = date.getDay();
  return d === 0 ? 6 : d - 1;
}

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const WEEKDAY_LABELS_FULL = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const MONTH_LABELS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function weekdayLabel(date, full = false) {
  return (full ? WEEKDAY_LABELS_FULL : WEEKDAY_LABELS)[weekdayIndex(date)];
}

export function monthLabel(date) {
  return MONTH_LABELS[date.getMonth()];
}

export function formatDayHeading(date) {
  return `${weekdayLabel(date, true)}, ${monthLabel(date)} ${date.getDate()}`;
}

// "HH:MM" -> minutes since midnight
export function timeStrToMinutes(t) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

export function minutesToTimeStr(mins) {
  mins = ((mins % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${pad2(h)}:${pad2(m)}`;
}

export function snapMinutes(mins) {
  return Math.round(mins / SNAP) * SNAP;
}

export function formatTimeLabel(t) {
  const mins = typeof t === "string" ? timeStrToMinutes(t) : t;
  let h = Math.floor(mins / 60);
  const m = mins % 60;
  const period = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if (h === 0) h = 12;
  return m === 0 ? `${h} ${period}` : `${h}:${pad2(m)} ${period}`;
}

export function formatDurationLabel(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export function weekRangeLabel(anchorDate) {
  const [start, ...rest] = getWeekDates(anchorDate);
  const end = rest[rest.length - 1];
  if (start.getMonth() === end.getMonth()) {
    return `${monthLabel(start)} ${start.getDate()}–${end.getDate()}, ${end.getFullYear()}`;
  }
  return `${monthLabel(start)} ${start.getDate()} – ${monthLabel(end)} ${end.getDate()}, ${end.getFullYear()}`;
}
