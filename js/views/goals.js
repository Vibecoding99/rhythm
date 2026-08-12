import { el } from "../components/sheet.js";
import { openGoalForm } from "../components/goal-form.js";
import { getGoals, getCategory } from "../lib/store.js";
import { catColor } from "../lib/color.js";
import { fromISODate, formatDurationLabel } from "../lib/date.js";
import { computeGoalTotal, goalHistory, goalMet, goalLabel, periodRange } from "../lib/goals.js";

function formatAmount(goal, n) {
  if (goal.metric === "time") return formatDurationLabel(Math.round(n));
  const rounded = Math.round(n * 100) / 100;
  return goal.unit ? `${rounded} ${goal.unit}` : `${rounded}`;
}

function goalCard(goal, cat, anchorDate, api) {
  const range = periodRange(goal.period, anchorDate);
  const { total, valid } = computeGoalTotal(goal, cat, range.startISO, range.endISO);
  const color = catColor(cat.colorIndex);

  if (!valid) {
    return el("button", {
      type: "button",
      class: "goal-card invalid",
      onclick: () => openGoalForm({ goal, onDone: () => api.refresh() }),
    }, [
      el("div", { class: "goal-card-title" }, goalLabel(goal, cat)),
      el("div", { class: "goal-card-warn" }, "A field this goal used was removed — tap to fix or delete."),
    ]);
  }

  const met = goalMet(goal, total);
  const pct = goal.direction === "max"
    ? Math.max(0, Math.min(100, goal.target > 0 ? 100 - ((total - goal.target) / goal.target) * 100 : 100))
    : Math.max(0, Math.min(100, (total / (goal.target || 1)) * 100));
  const history = goalHistory(goal, cat, anchorDate, 6);

  return el("button", {
    type: "button",
    class: `goal-card${met ? " met" : ""}`,
    style: `--cat-color:${color}`,
    onclick: () => openGoalForm({ goal, onDone: () => api.refresh() }),
  }, [
    el("div", { class: "goal-card-head" }, [
      el("div", { class: "goal-card-title" }, goalLabel(goal, cat)),
      met ? el("span", { class: "goal-check" }, "✓") : null,
    ]),
    el("div", { class: "bar-track" }, [
      el("div", { class: "bar-fill", style: `width:${pct}%;--cat-color:${color}` }),
    ]),
    el("div", { class: "goal-card-sub" }, [
      el("span", {}, `${formatAmount(goal, total)} of ${formatAmount(goal, goal.target)}`),
      el("span", {}, range.label),
    ]),
    history.length > 1 ? el("div", { class: "goal-history" }, history.map((p) =>
      el("span", { class: `goal-dot${p.met ? " met" : ""}`, title: p.label })
    )) : null,
  ]);
}

export function render(container, api) {
  container.innerHTML = "";
  const anchorDate = fromISODate(api.date);

  const header = el("div", { class: "date-nav" }, [
    el("div", {}, [
      el("div", { class: "date-heading" }, "Goals"),
      el("div", { class: "date-sub" }, "Track targets across your categories"),
    ]),
    el("button", { class: "btn btn-secondary", style: "padding:8px 14px;font-size:13px;", onclick: () => openGoalForm({ onDone: () => api.refresh() }) }, "+ New goal"),
  ]);
  container.appendChild(header);

  const goals = getGoals();
  if (goals.length === 0) {
    container.appendChild(el("div", { class: "empty-day" }, [
      el("div", { class: "glyph" }, "◌"),
      el("p", {}, "No goals yet. Set a target for a category — like a weekly workout count or a monthly reading total — and track it here."),
    ]));
    return;
  }

  const byCategory = new Map();
  goals.forEach((g) => {
    const cat = getCategory(g.categoryId);
    if (!cat) return;
    if (!byCategory.has(cat.id)) byCategory.set(cat.id, { cat, goals: [] });
    byCategory.get(cat.id).goals.push(g);
  });

  const list = el("div", { class: "goals-list" });
  [...byCategory.values()].forEach(({ cat, goals: catGoals }) => {
    const color = catColor(cat.colorIndex);
    list.appendChild(el("div", { class: "goals-cat-heading" }, [
      el("span", { class: "swatch", style: `--cat-color:${color}` }),
      cat.name,
    ]));
    catGoals.forEach((g) => list.appendChild(goalCard(g, cat, anchorDate, api)));
  });
  container.appendChild(list);
}
