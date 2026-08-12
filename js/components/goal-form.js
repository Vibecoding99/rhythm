import { openSheet, el, toast } from "./sheet.js";
import { showConfirm } from "./dialogs.js";
import { getCategories, getCategory, addGoal, updateGoal, deleteGoal } from "../lib/store.js";
import { numericFieldOptions, filterFieldOptions } from "../lib/goals.js";
import { catColor } from "../lib/color.js";

const INPUT_STYLE = "padding:11px 12px;border-radius:8px;border:1px solid var(--border-strong);background:var(--surface);font-size:14.5px;color:var(--ink);width:100%;";

const METRICS = [
  ["time", "Time logged", "Total hours spent in this category"],
  ["count", "Count", "Number of sessions / matching entries"],
  ["sum", "Sum of a field", "Total of a number field, e.g. weight or pages"],
];

function field(labelText, node) {
  return el("div", { class: "field" }, [el("label", {}, labelText), node]);
}

function segmented(options, selected, onSelect) {
  const wrap = el("div", { style: "display:flex;border:1px solid var(--border-strong);border-radius:8px;overflow:hidden;" });
  options.forEach(([val, label]) => {
    const btn = el("button", {
      type: "button",
      style: `flex:1;padding:9px 10px;font-size:13px;font-weight:600;background:${val === selected ? "var(--ink)" : "transparent"};color:${val === selected ? "var(--page)" : "var(--ink-secondary)"};border:none;`,
      onclick: () => {
        Array.from(wrap.children).forEach((c, i) => {
          const v = options[i][0];
          c.style.background = v === val ? "var(--ink)" : "transparent";
          c.style.color = v === val ? "var(--page)" : "var(--ink-secondary)";
        });
        onSelect(val);
      },
    }, label);
    wrap.appendChild(btn);
  });
  return wrap;
}

export function openGoalForm({ goal, categoryId, onDone } = {}) {
  const editing = !!goal;
  const form = editing
    ? { ...goal }
    : {
        categoryId: categoryId || null,
        metric: "time",
        sumFieldId: null,
        filterFieldId: null,
        filterValue: "",
        direction: "min",
        target: 0,
        period: "weekly",
        unit: "",
        name: "",
      };
  // Time targets are stored/saved in minutes but edited in hours; count/sum
  // targets are edited directly. Kept as separate locals (rather than
  // reusing form.target) so switching the metric type never mixes units.
  let targetHours = form.metric === "time" ? Math.round(((form.target || 0) / 60) * 100) / 100 : 3;
  let targetOther = form.metric !== "time" ? (form.target || 3) : 3;
  let hasFilter = !!form.filterFieldId;

  openSheet((sheet, close) => {
    sheet.appendChild(el("h2", {}, editing ? "Edit goal" : "New goal"));
    sheet.appendChild(el("button", { class: "sheet-close", "aria-label": "Close", onclick: close }, "✕"));

    // ---- Category ----
    const catPicker = el("div", { class: "category-picker" });
    const cats = getCategories();
    cats.forEach((cat) => {
      const color = catColor(cat.colorIndex);
      const chip = el("button", {
        type: "button",
        class: `category-chip${form.categoryId === cat.id ? " selected" : ""}`,
        style: `--cat-color:${color}`,
        onclick: () => {
          form.categoryId = cat.id;
          form.filterFieldId = null;
          form.sumFieldId = null;
          hasFilter = false;
          renderCatPicker();
          renderMetricFields();
        },
      }, [el("span", { class: "swatch" }), cat.name]);
      catPicker.appendChild(chip);
    });
    function renderCatPicker() {
      Array.from(catPicker.children).forEach((chip, i) => chip.classList.toggle("selected", cats[i] && cats[i].id === form.categoryId));
    }
    sheet.appendChild(field("Category", catPicker));
    if (cats.length === 0) {
      sheet.appendChild(el("div", { class: "duration-hint" }, "Add a category from the entry form first."));
    }

    // ---- Metric ----
    const metricWrap = el("div", { style: "display:flex;flex-direction:column;gap:8px;" });
    METRICS.forEach(([val, label, desc]) => {
      const row = el("button", {
        type: "button",
        style: `display:flex;flex-direction:column;align-items:flex-start;gap:2px;text-align:left;padding:10px 12px;border-radius:8px;border:1px solid ${form.metric === val ? "var(--ink)" : "var(--border-strong)"};background:${form.metric === val ? "var(--surface)" : "transparent"};`,
        onclick: () => {
          form.metric = val;
          renderMetricSelection();
          renderMetricFields();
          renderTargetField();
        },
      }, [
        el("span", { style: "font-size:14px;font-weight:600;" }, label),
        el("span", { style: "font-size:12px;color:var(--ink-muted);" }, desc),
      ]);
      metricWrap.appendChild(row);
    });
    function renderMetricSelection() {
      Array.from(metricWrap.children).forEach((row, i) => {
        const val = METRICS[i][0];
        row.style.borderColor = form.metric === val ? "var(--ink)" : "var(--border-strong)";
        row.style.background = form.metric === val ? "var(--surface)" : "transparent";
      });
    }
    sheet.appendChild(field("What are you tracking?", metricWrap));

    const metricFieldsWrap = el("div", {});
    sheet.appendChild(metricFieldsWrap);

    function renderMetricFields() {
      metricFieldsWrap.innerHTML = "";
      const cat = form.categoryId ? getCategory(form.categoryId) : null;
      if (!cat) return;

      // Sum-of-field target selector.
      if (form.metric === "sum") {
        const numOpts = numericFieldOptions(cat);
        if (numOpts.length === 0) {
          metricFieldsWrap.appendChild(el("div", { class: "duration-hint" }, `"${cat.name}" has no Number fields yet — add one from Settings first.`));
        } else {
          const select = el("select", { style: INPUT_STYLE, onchange: (e) => { form.sumFieldId = e.target.value; } });
          numOpts.forEach((opt) => {
            const optEl = el("option", { value: opt.id }, opt.label);
            if (opt.id === form.sumFieldId) optEl.selected = true;
            select.appendChild(optEl);
          });
          if (!form.sumFieldId) form.sumFieldId = numOpts[0].id;
          select.value = form.sumFieldId;
          metricFieldsWrap.appendChild(field("Field to total", select));
        }
      }

      // Optional sub-category filter.
      const filterOpts = filterFieldOptions(cat);
      if (filterOpts.length > 0) {
        const filterSwitch = el("button", {
          type: "button",
          class: `switch${hasFilter ? " on" : ""}`,
          role: "switch",
          "aria-checked": String(hasFilter),
          onclick: () => {
            hasFilter = !hasFilter;
            filterSwitch.classList.toggle("on", hasFilter);
            filterSwitch.setAttribute("aria-checked", String(hasFilter));
            if (!hasFilter) { form.filterFieldId = null; form.filterValue = ""; }
            renderMetricFields();
          },
        });
        metricFieldsWrap.appendChild(el("div", { class: "field" }, [
          el("div", { class: "recurrence-toggle" }, [
            el("div", {}, [
              el("label", { style: "margin-bottom:2px;" }, "Limit to a specific value"),
              el("div", { class: "duration-hint" }, "e.g. one exercise, one book — instead of the whole category"),
            ]),
            filterSwitch,
          ]),
        ]));

        if (hasFilter) {
          const fieldSelect = el("select", {
            style: INPUT_STYLE,
            onchange: (e) => { form.filterFieldId = e.target.value; },
          });
          filterOpts.forEach((opt) => {
            const optEl = el("option", { value: opt.id }, opt.label);
            if (opt.id === form.filterFieldId) optEl.selected = true;
            fieldSelect.appendChild(optEl);
          });
          if (!form.filterFieldId) form.filterFieldId = filterOpts[0].id;
          fieldSelect.value = form.filterFieldId;

          const valueInput = el("input", {
            type: "text",
            placeholder: "Value to match, e.g. Bench Press",
            value: form.filterValue || "",
            style: INPUT_STYLE,
            oninput: (e) => { form.filterValue = e.target.value; },
          });
          metricFieldsWrap.appendChild(field("Field", fieldSelect));
          metricFieldsWrap.appendChild(field("Value", valueInput));
        }
      }
    }
    renderMetricFields();

    // ---- Direction + target ----
    const dirSeg = segmented([["min", "At least"], ["max", "At most"]], form.direction, (v) => { form.direction = v; });
    sheet.appendChild(field("Direction", dirSeg));

    const targetWrap = el("div", {});
    sheet.appendChild(targetWrap);
    function renderTargetField() {
      targetWrap.innerHTML = "";
      const isTime = form.metric === "time";
      const input = el("input", {
        type: "number",
        inputmode: "decimal",
        min: "0",
        step: isTime ? "0.25" : "1",
        value: isTime ? targetHours : targetOther,
        style: INPUT_STYLE,
        oninput: (e) => {
          if (isTime) targetHours = e.target.valueAsNumber;
          else targetOther = e.target.valueAsNumber;
        },
      });
      targetWrap.appendChild(field(isTime ? "Target (hours)" : "Target", input));
    }
    renderTargetField();

    const unitInput = el("input", {
      type: "text",
      placeholder: "e.g. lbs, pages, sessions",
      value: form.unit,
      style: INPUT_STYLE,
      oninput: (e) => { form.unit = e.target.value; },
    });
    sheet.appendChild(field("Unit label (optional)", unitInput));

    const nameInput = el("input", {
      type: "text",
      placeholder: "Auto-generated if left blank",
      value: form.name,
      style: INPUT_STYLE,
      oninput: (e) => { form.name = e.target.value; },
    });
    sheet.appendChild(field("Name (optional)", nameInput));

    // ---- Period ----
    const periodSeg = segmented([["weekly", "Weekly"], ["monthly", "Monthly"]], form.period, (v) => { form.period = v; });
    sheet.appendChild(field("Resets", periodSeg));

    // ---- Actions ----
    const actions = el("div", { class: "sheet-actions" });
    if (editing) {
      actions.appendChild(el("button", { type: "button", class: "btn btn-danger", onclick: handleDelete }, "Delete"));
    }
    actions.appendChild(el("button", { type: "button", class: "btn btn-primary", onclick: handleSave }, editing ? "Save changes" : "Add goal"));
    sheet.appendChild(actions);

    async function handleDelete() {
      const ok = await showConfirm({ title: "Delete this goal?", message: "This can't be undone.", confirmLabel: "Delete", danger: true });
      if (!ok) return;
      deleteGoal(goal.id);
      close();
      toast("Goal deleted");
      onDone && onDone();
    }

    function handleSave() {
      if (!form.categoryId) { toast("Choose a category"); return; }
      if (form.metric === "sum" && !form.sumFieldId) { toast("Choose a field to total"); return; }
      if (hasFilter && (!form.filterFieldId || !form.filterValue.trim())) { toast("Fill in the filter value, or turn it off"); return; }
      if (!hasFilter) { form.filterFieldId = null; form.filterValue = null; }

      const targetVal = form.metric === "time" ? Math.round((targetHours || 0) * 60) : Math.round(targetOther || 0);
      if (targetVal <= 0) { toast("Set a target greater than 0"); return; }

      const payload = {
        categoryId: form.categoryId,
        metric: form.metric,
        sumFieldId: form.metric === "sum" ? form.sumFieldId : null,
        filterFieldId: form.filterFieldId,
        filterValue: form.filterValue,
        direction: form.direction,
        target: targetVal,
        period: form.period,
        unit: form.unit.trim(),
        name: form.name.trim(),
      };

      if (editing) updateGoal(goal.id, payload);
      else addGoal(payload);

      close();
      toast(editing ? "Goal updated" : "Goal added");
      onDone && onDone();
    }
  });
}
