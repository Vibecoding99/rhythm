import {
  toISODate, fromISODate, addDays, addDaysISO, startOfWeek, startOfMonth, endOfMonth,
  timeStrToMinutes, weekRangeLabel, monthLabel,
} from "./date.js";
import { getEntriesForRange } from "./store.js";

// Locates a field definition on a category, whether it's a top-level field
// or a sub-field nested inside a repeatable group. Goals reference fields by
// id regardless of nesting, so every lookup goes through here.
export function resolveFieldPath(category, fieldId) {
  if (!category || !fieldId) return null;
  for (const f of category.fields || []) {
    if (f.id === fieldId) return { field: f, groupField: null };
    if (f.type === "group") {
      const sub = (f.subfields || []).find((sf) => sf.id === fieldId);
      if (sub) return { field: sub, groupField: f };
    }
  }
  return null;
}

// Numeric fields a "sum" goal can total: top-level Number fields, or Number
// sub-fields inside a Repeatable group.
export function numericFieldOptions(category) {
  const opts = [];
  (category.fields || []).forEach((f) => {
    if (f.type === "number") opts.push({ id: f.id, label: f.label });
    if (f.type === "group") {
      (f.subfields || []).forEach((sf) => {
        if (sf.type === "number") opts.push({ id: sf.id, label: `${f.label} — ${sf.label}` });
      });
    }
  });
  return opts;
}

// Any field a goal can filter on to target a sub-category (Text or Number,
// top-level or nested inside a group).
export function filterFieldOptions(category) {
  const opts = [];
  (category.fields || []).forEach((f) => {
    if (f.type === "text" || f.type === "number") opts.push({ id: f.id, label: f.label });
    if (f.type === "group") {
      (f.subfields || []).forEach((sf) => {
        opts.push({ id: sf.id, label: `${f.label} — ${sf.label}` });
      });
    }
  });
  return opts;
}

function addMonths(date, n) {
  return new Date(date.getFullYear(), date.getMonth() + n, 1);
}

export function periodRange(period, anchorDate) {
  if (period === "monthly") {
    const start = startOfMonth(anchorDate);
    const end = endOfMonth(anchorDate);
    return { startISO: toISODate(start), endISO: toISODate(end), label: `${monthLabel(start)} ${start.getFullYear()}` };
  }
  const start = startOfWeek(anchorDate);
  const end = addDays(start, 6);
  return { startISO: toISODate(start), endISO: toISODate(end), label: weekRangeLabel(anchorDate) };
}

export function previousPeriodAnchor(period, anchorDate) {
  return period === "monthly" ? addMonths(anchorDate, -1) : addDays(anchorDate, -7);
}

const norm = (v) => String(v ?? "").trim().toLowerCase();

// Sums/counts matching occurrences in [startISO, endISO] for one goal.
// Returns { total, valid } — valid is false if the goal points at a field
// that no longer exists on the category (e.g. it was deleted since).
export function computeGoalTotal(goal, category, startISO, endISO) {
  const filterPath = goal.filterFieldId ? resolveFieldPath(category, goal.filterFieldId) : null;
  const sumPath = goal.metric === "sum" ? resolveFieldPath(category, goal.sumFieldId) : null;
  if (goal.filterFieldId && !filterPath) return { total: 0, valid: false };
  if (goal.metric === "sum" && !sumPath) return { total: 0, valid: false };

  let total = 0;
  const byDate = getEntriesForRange(startISO, endISO);
  Object.values(byDate).forEach((occurrences) => {
    occurrences.forEach((occ) => {
      if (occ.category !== goal.categoryId) return;

      let matchingRows = null;
      if (filterPath) {
        if (filterPath.groupField) {
          const rows = Array.isArray(occ.customFields[filterPath.groupField.id]) ? occ.customFields[filterPath.groupField.id] : [];
          matchingRows = rows.filter((r) => norm(r[filterPath.field.id]) === norm(goal.filterValue));
          if (matchingRows.length === 0) return;
        } else if (norm(occ.customFields[filterPath.field.id]) !== norm(goal.filterValue)) {
          return;
        }
      }

      if (goal.metric === "time") {
        total += timeStrToMinutes(occ.endTime) - timeStrToMinutes(occ.startTime);
      } else if (goal.metric === "count") {
        total += matchingRows ? matchingRows.length : 1;
      } else if (goal.metric === "sum") {
        if (sumPath.groupField) {
          const sameGroup = filterPath && filterPath.groupField && filterPath.groupField.id === sumPath.groupField.id;
          const rows = sameGroup ? matchingRows : (Array.isArray(occ.customFields[sumPath.groupField.id]) ? occ.customFields[sumPath.groupField.id] : []);
          rows.forEach((r) => {
            const n = parseFloat(r[sumPath.field.id]);
            if (!isNaN(n)) total += n;
          });
        } else {
          const n = parseFloat(occ.customFields[sumPath.field.id]);
          if (!isNaN(n)) total += n;
        }
      }
    });
  });
  return { total, valid: true };
}

export function goalMet(goal, total) {
  return goal.direction === "max" ? total <= goal.target : total >= goal.target;
}

// Progress for the period containing `anchorDate`, plus up to `count` prior
// periods (oldest first) for a streak/history view. Periods that ended
// before the goal was created are omitted.
export function goalHistory(goal, category, anchorDate, count = 6) {
  const createdISO = toISODate(new Date(goal.createdAt));
  const periods = [];
  let anchor = anchorDate;
  for (let i = 0; i < count; i++) {
    const range = periodRange(goal.period, anchor);
    if (range.endISO < createdISO) break;
    const { total, valid } = computeGoalTotal(goal, category, range.startISO, range.endISO);
    periods.unshift({ ...range, total, valid, met: valid && goalMet(goal, total) });
    anchor = previousPeriodAnchor(goal.period, anchor);
  }
  return periods;
}

export function goalLabel(goal, category) {
  if (goal.name && goal.name.trim()) return goal.name.trim();
  const cmp = goal.direction === "max" ? "≤" : "≥";
  const per = goal.period === "monthly" ? "/mo" : "/wk";
  const unit = goal.unit ? ` ${goal.unit}` : goal.metric === "time" ? " hrs" : goal.metric === "count" ? " ×" : "";
  const subject = goal.filterFieldId && goal.filterValue ? goal.filterValue : (category ? category.name : "Untitled");
  const targetVal = goal.metric === "time" ? Math.round((goal.target / 60) * 10) / 10 : goal.target;
  return `${subject} ${cmp} ${targetVal}${unit}${per}`;
}
