import { el } from "../components/sheet.js";
import { getEntriesForDate, getCategory } from "../lib/store.js";
import { getMonthGrid, toISODate, isToday, monthLabel, addDays } from "../lib/date.js";

const WEEKDAY_HEADS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MAX_DOTS = 4;

export function render(container, api) {
  const anchor = new Date(api.date + "T00:00:00");
  const currentMonth = anchor.getMonth();
  const days = getMonthGrid(anchor);

  container.innerHTML = "";

  const nav = el("div", { class: "date-nav" }, [
    el("div", { class: "date-heading" }, `${monthLabel(anchor)} ${anchor.getFullYear()}`),
    el("div", { class: "nav-arrows" }, [
      el("button", { "aria-label": "Previous month", onclick: () => api.goToDate(toISODate(new Date(anchor.getFullYear(), currentMonth - 1, 1))) }, "‹"),
      el("button", { "aria-label": "Next month", onclick: () => api.goToDate(toISODate(new Date(anchor.getFullYear(), currentMonth + 1, 1))) }, "›"),
    ]),
  ]);
  container.appendChild(nav);

  const heads = el("div", { class: "month-weekday-heads" });
  WEEKDAY_HEADS.forEach((w) => heads.appendChild(el("span", {}, w)));
  container.appendChild(heads);

  const grid = el("div", { class: "month-grid" });
  days.forEach((d) => {
    const iso = toISODate(d);
    const outside = d.getMonth() !== currentMonth;
    const occurrences = getEntriesForDate(iso);
    const catIds = [...new Set(occurrences.map((o) => o.category))].slice(0, MAX_DOTS);

    const dots = el("div", { class: "dots" });
    catIds.forEach((cid) => {
      const cat = getCategory(cid);
      dots.appendChild(el("span", { class: "dot" }, cat ? cat.emoji || "🏷️" : "🏷️"));
    });

    const cell = el("button", {
      type: "button",
      class: `month-cell${outside ? " outside" : ""}${isToday(iso) ? " is-today" : ""}`,
      onclick: () => api.goToDate(iso, "day"),
    }, [
      el("span", { class: "dnum" }, String(d.getDate())),
      dots,
    ]);
    grid.appendChild(cell);
  });
  container.appendChild(grid);
}
