import { el } from "../components/sheet.js";
import { getEntriesForDate, getCategory } from "../lib/store.js";
import { catColor } from "../lib/color.js";
import {
  getWeekDates, toISODate, weekRangeLabel, addDays, timeStrToMinutes, formatDurationLabel,
} from "../lib/date.js";

export function render(container, api) {
  const anchor = new Date(api.date + "T00:00:00");
  const days = getWeekDates(anchor);

  container.innerHTML = "";

  const switcher = el("div", { class: "week-switcher" }, [
    el("div", {}, [
      el("div", { class: "wk-label" }, weekRangeLabel(anchor)),
      el("div", { class: "wk-sub" }, "Weekly summary"),
    ]),
    el("div", { class: "nav-arrows" }, [
      el("button", { "aria-label": "Previous week", onclick: () => api.goToDate(toISODate(addDays(anchor, -7))) }, "‹"),
      el("button", { "aria-label": "Next week", onclick: () => api.goToDate(toISODate(addDays(anchor, 7))) }, "›"),
    ]),
  ]);
  container.appendChild(switcher);

  const totals = new Map(); // categoryId -> minutes
  const fieldAgg = new Map(); // categoryId -> Map(fieldId -> { label, type, sum, values })

  days.forEach((d) => {
    const iso = toISODate(d);
    getEntriesForDate(iso).forEach((occ) => {
      const mins = timeStrToMinutes(occ.endTime) - timeStrToMinutes(occ.startTime);
      totals.set(occ.category, (totals.get(occ.category) || 0) + mins);

      const cat = getCategory(occ.category);
      if (!cat || !cat.fields || cat.fields.length === 0) return;
      if (!fieldAgg.has(cat.id)) fieldAgg.set(cat.id, new Map());
      const catFields = fieldAgg.get(cat.id);
      cat.fields.forEach((f) => {
        const raw = occ.customFields && occ.customFields[f.id];
        if (raw === undefined || raw === null || raw === "") return;

        if (f.type === "group") {
          if (!Array.isArray(raw) || raw.length === 0) return;
          if (!catFields.has(f.id)) catFields.set(f.id, { label: f.label, type: "group", count: 0, subAgg: new Map() });
          const agg = catFields.get(f.id);
          agg.count += raw.length;
          raw.forEach((row) => {
            (f.subfields || []).forEach((sf) => {
              const subRaw = row[sf.id];
              if (subRaw === undefined || subRaw === null || subRaw === "") return;
              if (!agg.subAgg.has(sf.id)) agg.subAgg.set(sf.id, { label: sf.label, type: sf.type, sum: 0, values: [] });
              const subAgg = agg.subAgg.get(sf.id);
              if (sf.type === "number") {
                const n = parseFloat(subRaw);
                if (!isNaN(n)) subAgg.sum += n;
              } else {
                subAgg.values.push(String(subRaw));
              }
            });
          });
          return;
        }

        if (!catFields.has(f.id)) catFields.set(f.id, { label: f.label, type: f.type, sum: 0, values: [] });
        const agg = catFields.get(f.id);
        if (f.type === "number") {
          const n = parseFloat(raw);
          if (!isNaN(n)) agg.sum += n;
        } else {
          agg.values.push(String(raw));
        }
      });
    });
  });

  function scalarAggText(agg) {
    return agg.type === "number"
      ? `${Math.round(agg.sum * 100) / 100}`
      : agg.values.slice(0, 4).join(", ") + (agg.values.length > 4 ? ` +${agg.values.length - 4} more` : "");
  }

  function fieldAggNodes(catFieldsMap) {
    const nodes = [];
    [...catFieldsMap.values()].forEach((agg, i) => {
      if (i > 0) nodes.push(document.createTextNode(" · "));
      if (agg.type === "group") {
        nodes.push(el("span", {}, `${agg.count}× ${agg.label}`));
        [...agg.subAgg.values()].forEach((subAgg) => {
          nodes.push(document.createTextNode(" · "));
          nodes.push(el("span", {}, `${subAgg.label}: `));
          nodes.push(document.createTextNode(scalarAggText(subAgg)));
        });
        return;
      }
      nodes.push(el("span", {}, `${agg.label}: `));
      nodes.push(document.createTextNode(scalarAggText(agg)));
    });
    return nodes;
  }

  const totalMinutes = [...totals.values()].reduce((a, b) => a + b, 0);

  if (totalMinutes === 0) {
    container.appendChild(el("div", { class: "empty-day" }, [
      el("div", { class: "glyph" }, "◌"),
      el("p", {}, "Nothing logged this week. Once you add entries, they'll be summarized here by category."),
    ]));
    return;
  }

  const hero = el("div", { class: "summary-hero" }, [
    el("div", { class: "total-figure" }, formatDurationLabel(totalMinutes)),
    el("div", { class: "total-label" }, "tracked this week"),
  ]);
  container.appendChild(hero);

  const rows = [...totals.entries()]
    .map(([catId, mins]) => ({ cat: getCategory(catId), mins }))
    .filter((r) => r.cat)
    .sort((a, b) => b.mins - a.mins);

  const maxMins = rows[0].mins;

  const chart = el("div", { class: "bar-chart" });
  rows.forEach(({ cat, mins }) => {
    const color = catColor(cat.colorIndex);
    const pct = Math.round((mins / totalMinutes) * 100);
    const widthPct = Math.max((mins / maxMins) * 100, 3);
    chart.appendChild(el("div", { class: "bar-row" }, [
      el("div", { class: "bar-row-head" }, [
        el("span", { class: "cname" }, [el("span", { class: "swatch", style: `--cat-color:${color}` }), cat.name]),
        el("span", { class: "cval" }, `${formatDurationLabel(mins)} · ${pct}%`),
      ]),
      el("div", { class: "bar-track" }, [
        el("div", { class: "bar-fill", style: `width:${widthPct}%;--cat-color:${color}` }),
      ]),
    ]));
  });
  container.appendChild(chart);

  const table = el("div", { class: "summary-table" });
  rows.forEach(({ cat, mins }) => {
    const color = catColor(cat.colorIndex);
    const pct = Math.round((mins / totalMinutes) * 100);
    const row = el("div", { class: "row" }, [
      el("span", { class: "cname" }, [el("span", { class: "swatch", style: `--cat-color:${color}` }), cat.name]),
      el("span", { class: "figs" }, [
        el("span", {}, formatDurationLabel(mins)),
        el("span", {}, `${pct}%`),
      ]),
    ]);
    const catFieldsMap = fieldAgg.get(cat.id);
    const group = el("div", { class: "row-group" }, [row]);
    if (catFieldsMap && catFieldsMap.size > 0) {
      group.appendChild(el("div", { class: "row-fields" }, fieldAggNodes(catFieldsMap)));
    }
    table.appendChild(group);
  });
  container.appendChild(table);
}
