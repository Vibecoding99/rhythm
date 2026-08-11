import { el } from "../components/sheet.js";
import { openEntryForm } from "../components/entry-form.js";
import { getEntriesForDate, getCategory, getSettings } from "../lib/store.js";
import { catColor } from "../lib/color.js";
import {
  toISODate, fromISODate, addDaysISO, isToday, formatDayHeading,
  timeStrToMinutes, minutesToTimeStr, snapMinutes, formatTimeLabel,
} from "../lib/date.js";

const ROW_H = 64; // px per hour, matches CSS .hour-row height

function formatEntryDetail(occurrence, cat) {
  const fieldParts = ((cat && cat.fields) || [])
    .map((f) => {
      const v = occurrence.customFields && occurrence.customFields[f.id];
      if (v === undefined || v === null || v === "") return null;
      if (f.type === "group") {
        if (!Array.isArray(v) || v.length === 0) return null;
        const firstSubfield = (f.subfields || [])[0];
        const names = firstSubfield
          ? v.map((row) => row[firstSubfield.id]).filter(Boolean)
          : [];
        return names.length ? `${f.label}: ${names.join(", ")}` : `${v.length} ${f.label.toLowerCase()} logged`;
      }
      return `${f.label}: ${v}`;
    })
    .filter(Boolean);
  const parts = [...fieldParts];
  if (occurrence.note) parts.push(occurrence.note);
  return parts.join(" · ");
}
const PX_PER_MIN = ROW_H / 60;

function layoutEntries(occurrences) {
  const sorted = [...occurrences].sort((a, b) => timeStrToMinutes(a.startTime) - timeStrToMinutes(b.startTime));
  const clusters = [];
  let current = [];
  let clusterEnd = -1;
  for (const occ of sorted) {
    const s = timeStrToMinutes(occ.startTime);
    const e = timeStrToMinutes(occ.endTime);
    if (current.length && s >= clusterEnd) {
      clusters.push(current);
      current = [];
      clusterEnd = -1;
    }
    current.push(occ);
    clusterEnd = Math.max(clusterEnd, e);
  }
  if (current.length) clusters.push(current);

  const layout = [];
  clusters.forEach((cluster) => {
    const columns = [];
    const assigned = new Map();
    cluster.forEach((occ) => {
      const s = timeStrToMinutes(occ.startTime);
      let colIndex = columns.findIndex((endTime) => endTime <= s);
      if (colIndex === -1) {
        colIndex = columns.length;
        columns.push(-Infinity);
      }
      columns[colIndex] = timeStrToMinutes(occ.endTime);
      assigned.set(occ, colIndex);
    });
    const numCols = columns.length;
    cluster.forEach((occ) => layout.push({ occurrence: occ, col: assigned.get(occ), cols: numCols }));
  });
  return layout;
}

function conflictSet(occurrences) {
  const conflicted = new Set();
  for (let i = 0; i < occurrences.length; i++) {
    for (let j = i + 1; j < occurrences.length; j++) {
      const a = occurrences[i], b = occurrences[j];
      const as = timeStrToMinutes(a.startTime), ae = timeStrToMinutes(a.endTime);
      const bs = timeStrToMinutes(b.startTime), be = timeStrToMinutes(b.endTime);
      if (as < be && bs < ae) {
        conflicted.add(a.occurrenceId);
        conflicted.add(b.occurrenceId);
      }
    }
  }
  return conflicted;
}

export function render(container, api) {
  const date = api.date;
  const d = fromISODate(date);
  const settings = getSettings();
  const startHour = settings.dayStartHour;
  const endHour = settings.dayEndHour;
  const numHours = endHour - startHour + 1;
  const dayStartMin = startHour * 60;

  container.innerHTML = "";

  const nav = el("div", { class: "date-nav" }, [
    el("div", {}, [
      el("div", { class: "date-heading" }, formatDayHeading(d)),
      isToday(date)
        ? el("div", { class: "date-sub" }, "Today")
        : el("button", { class: "today-pill", onclick: () => api.goToDate(toISODate(new Date())) }, "Today"),
    ]),
    el("div", { class: "nav-arrows" }, [
      el("button", { "aria-label": "Previous day", onclick: () => api.goToDate(addDaysISO(date, -1)) }, arrowIcon("left")),
      el("button", { "aria-label": "Next day", onclick: () => api.goToDate(addDaysISO(date, 1)) }, arrowIcon("right")),
    ]),
  ]);
  container.appendChild(nav);

  const occurrences = getEntriesForDate(date);

  if (occurrences.length === 0) {
    container.appendChild(el("div", { class: "empty-day" }, [
      el("div", { class: "glyph" }, "◌"),
      el("p", {}, "Nothing on the books yet. Tap any time below to plan ahead — or log something you already did."),
    ]));
  }

  const wrap = el("div", { class: "timeline-wrap" });
  const timeline = el("div", { class: "timeline", style: `height:${numHours * ROW_H}px` });

  for (let h = startHour; h <= endHour; h++) {
    const row = el("div", { class: "hour-row" });
    row.appendChild(el("div", { class: "hour-label" }, formatTimeLabel(h * 60)));
    const slot = el("div", { class: "hour-slot" });
    [15, 30, 45].forEach((q) => {
      slot.appendChild(el("div", { class: "quarter-line", style: `top:${(q / 60) * ROW_H}px` }));
    });
    slot.addEventListener("click", (e) => {
      const rect = slot.getBoundingClientRect();
      const relY = e.clientY - rect.top;
      const minuteOffset = snapMinutes((relY / ROW_H) * 60);
      let startMin = h * 60 + minuteOffset;
      startMin = Math.min(startMin, 24 * 60 - 15);
      const endMin = Math.min(startMin + 30, 24 * 60);
      openEntryForm({
        date,
        startTime: minutesToTimeStr(startMin),
        endTime: minutesToTimeStr(endMin),
        onDone: () => api.refresh(),
      });
    });
    row.appendChild(slot);
    timeline.appendChild(row);
  }

  const entriesLayer = el("div", { class: "entries-layer" });
  const conflicted = conflictSet(occurrences);
  const laidOut = layoutEntries(occurrences);

  laidOut.forEach(({ occurrence, col, cols }) => {
    const cat = getCategory(occurrence.category);
    const color = cat ? catColor(cat.colorIndex) : "#898781";
    const s = timeStrToMinutes(occurrence.startTime);
    const e = timeStrToMinutes(occurrence.endTime);
    const top = (s - dayStartMin) * PX_PER_MIN;
    const height = Math.max((e - s) * PX_PER_MIN, 18);
    const widthPct = 100 / cols;
    const leftPct = col * widthPct;
    const sizeClass = height < 32 ? "tiny" : height < 48 ? "short" : "";
    const detail = formatEntryDetail(occurrence, cat);

    const block = el("button", {
      type: "button",
      class: `entry-block ${sizeClass}${conflicted.has(occurrence.occurrenceId) ? " conflicted" : ""}${occurrence.isRecurring ? " recurring" : ""}`,
      style: `top:${top}px;height:${height}px;left:calc(${leftPct}% + ${col > 0 ? 3 : 0}px);width:calc(${widthPct}% - ${cols > 1 ? 6 : 0}px);--cat-color:${color}`,
      onclick: () => openEntryForm({ occurrence, onDone: () => api.refresh() }),
    }, [
      el("div", { class: "entry-title" }, cat ? cat.name : "Untitled"),
      el("div", { class: "entry-time" }, `${formatTimeLabel(occurrence.startTime)} – ${formatTimeLabel(occurrence.endTime)}`),
      detail ? el("div", { class: "entry-note" }, detail) : null,
    ]);
    entriesLayer.appendChild(block);
  });
  timeline.appendChild(entriesLayer);

  if (isToday(date)) {
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    if (nowMin >= dayStartMin && nowMin <= endHour * 60 + 60) {
      const top = (nowMin - dayStartMin) * PX_PER_MIN;
      timeline.appendChild(el("div", { class: "now-line", style: `top:${top}px` }));
    }
  }

  wrap.appendChild(timeline);
  container.appendChild(wrap);

  if (api.freshNav) {
    requestAnimationFrame(() => {
      if (isToday(date)) {
        const now = new Date();
        const nowMin = now.getHours() * 60 + now.getMinutes();
        const nowTop = (nowMin - dayStartMin) * PX_PER_MIN;
        container.scrollTop = Math.max(nowTop - 180, 0);
      } else {
        container.scrollTop = 0;
      }
    });
  }
}

function arrowIcon(dir) {
  const d = dir === "left" ? "M15 18l-6-6 6-6" : "M9 18l6-6-6-6";
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "20");
  svg.setAttribute("height", "20");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", d);
  svg.appendChild(path);
  return svg;
}
