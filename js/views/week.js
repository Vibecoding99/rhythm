import { el } from "../components/sheet.js";
import { openEntryForm } from "../components/entry-form.js";
import { getEntriesForDate, getCategory, getSettings } from "../lib/store.js";
import { catColor } from "../lib/color.js";
import {
  getWeekDates, toISODate, isToday, weekdayLabel, weekRangeLabel,
  addDays, timeStrToMinutes, formatTimeLabel,
} from "../lib/date.js";

const ROW_H = 40;

export function render(container, api) {
  const anchor = new Date(api.date + "T00:00:00");
  const days = getWeekDates(anchor);
  const settings = getSettings();
  const startHour = settings.dayStartHour;
  const endHour = settings.dayEndHour;
  const numHours = endHour - startHour + 1;
  const dayStartMin = startHour * 60;
  const pxPerMin = ROW_H / 60;

  container.innerHTML = "";

  const nav = el("div", { class: "date-nav" }, [
    el("div", {}, [
      el("div", { class: "date-heading", style: "font-size:20px;" }, weekRangeLabel(anchor)),
    ]),
    el("div", { class: "nav-arrows" }, [
      el("button", { "aria-label": "Previous week", onclick: () => api.goToDate(toISODate(addDays(anchor, -7))) }, "‹"),
      el("button", { "aria-label": "Next week", onclick: () => api.goToDate(toISODate(addDays(anchor, 7))) }, "›"),
    ]),
  ]);
  container.appendChild(nav);

  const heads = el("div", { class: "week-grid" });
  heads.appendChild(el("div", {}));
  days.forEach((d) => {
    const iso = toISODate(d);
    heads.appendChild(el("div", {
      class: `col-head${isToday(iso) ? " is-today" : ""}`,
      onclick: () => api.goToDate(iso, "day"),
    }, [
      el("span", { class: "wd" }, weekdayLabel(d)),
      el("span", { class: "dnum" }, String(d.getDate())),
    ]));
  });
  container.appendChild(heads);

  const body = el("div", { class: "week-body", style: `height:${numHours * ROW_H}px` });

  const hourCol = el("div", { class: "week-hour-col" });
  for (let h = startHour; h <= endHour; h++) {
    hourCol.appendChild(el("div", { class: "week-hour-label" }, formatTimeLabel(h * 60)));
  }
  body.appendChild(hourCol);

  days.forEach((d) => {
    const iso = toISODate(d);
    const col = el("div", { class: "week-day-col", onclick: () => api.goToDate(iso, "day") });
    for (let h = startHour; h <= endHour; h++) {
      col.appendChild(el("div", { class: "hour-cell" }));
    }
    const occurrences = getEntriesForDate(iso);
    occurrences.forEach((occ) => {
      const cat = getCategory(occ.category);
      const color = cat ? catColor(cat.colorIndex) : "#898781";
      const s = timeStrToMinutes(occ.startTime);
      const e = timeStrToMinutes(occ.endTime);
      const top = (s - dayStartMin) * pxPerMin;
      const height = Math.max((e - s) * pxPerMin, 3);
      col.appendChild(el("div", {
        class: "week-entry",
        style: `top:${top}px;height:${height}px;--cat-color:${color}`,
        onclick: (evt) => { evt.stopPropagation(); openEntryForm({ occurrence: occ, onDone: () => api.refresh() }); },
      }));
    });
    body.appendChild(col);
  });

  container.appendChild(body);
}
