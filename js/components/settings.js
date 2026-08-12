import { openSheet, el, toast } from "./sheet.js";
import { showConfirm } from "./dialogs.js";
import {
  getCategories, deleteCategory, updateCategory, categoryUsageCount,
  getSettings, updateSettings, importData, setCategoryFields,
} from "../lib/store.js";
import { catColor } from "../lib/color.js";
import { generateId } from "../lib/id.js";
import { downloadBackupFile, backupStatus } from "../lib/backup.js";

const THEME_KEY = "rhythm.theme";

export function applyStoredTheme() {
  const saved = localStorage.getItem(THEME_KEY) || "system";
  if (saved === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", saved);
}

const HOUR_LABELS = Array.from({ length: 24 }, (_, h) => {
  const period = h >= 12 ? "PM" : "AM";
  let hh = h % 12;
  if (hh === 0) hh = 12;
  return `${hh} ${period}`;
});

export function openSettings(onChange) {
  openSheet((sheet, close) => {
    sheet.appendChild(el("h2", {}, "Settings"));
    sheet.appendChild(el("button", { class: "sheet-close", "aria-label": "Close", onclick: close }, "✕"));

    // Appearance
    sheet.appendChild(sectionLabel("Appearance"));
    const savedTheme = localStorage.getItem(THEME_KEY) || "system";
    const themeRow = el("div", { class: "settings-row" }, [
      el("div", {}, [el("div", { class: "lbl" }, "Theme")]),
      segmented(["system", "light", "dark"], savedTheme, (val) => {
        localStorage.setItem(THEME_KEY, val);
        applyStoredTheme();
      }),
    ]);
    sheet.appendChild(themeRow);

    // Day range
    sheet.appendChild(sectionLabel("Day timeline"));
    const settings = getSettings();
    const startSelect = hourSelect(settings.dayStartHour, (v) => { updateSettings({ dayStartHour: v }); onChange(); });
    const endSelect = hourSelect(settings.dayEndHour, (v) => { updateSettings({ dayEndHour: v }); onChange(); });
    sheet.appendChild(el("div", { class: "settings-row" }, [
      el("div", {}, [el("div", { class: "lbl" }, "Visible hours")]),
      el("div", { style: "display:flex;gap:6px;align-items:center;" }, [startSelect, el("span", { style: "color:var(--ink-muted);font-size:13px;" }, "to"), endSelect]),
    ]));

    // Categories
    sheet.appendChild(sectionLabel("Categories"));
    const catList = el("div", {});
    sheet.appendChild(catList);
    renderCategories();

    function renderCategories() {
      catList.innerHTML = "";
      const cats = getCategories();
      if (cats.length === 0) {
        catList.appendChild(el("p", { style: "color:var(--ink-muted);font-size:13px;padding:8px 0;" }, "No categories yet — add one from the entry form."));
      }
      cats.forEach((cat) => {
        const color = catColor(cat.colorIndex);
        const count = categoryUsageCount(cat.id);
        const row = el("div", { class: "category-manage-row", style: `--cat-color:${color}` }, [
          el("span", { class: "swatch" }),
          el("span", { class: "cname" }, cat.name),
          el("span", { class: "count" }, `${count}`),
          el("button", {
            "aria-label": "Custom fields",
            title: "Custom fields",
            onclick: () => openCategoryFieldsEditor(cat, () => { renderCategories(); onChange(); }),
          }, "▤"),
          el("button", {
            "aria-label": "Rename",
            onclick: () => {
              const name = prompt("Rename category", cat.name);
              if (name && name.trim()) { updateCategory(cat.id, { name: name.trim() }); renderCategories(); onChange(); }
            },
          }, "✎"),
          el("button", {
            "aria-label": "Delete",
            onclick: async () => {
              const ok = await showConfirm({
                title: `Delete "${cat.name}"?`,
                message: count > 0 ? `This also deletes ${count} logged ${count === 1 ? "entry" : "entries"} in this category. This can't be undone.` : "This can't be undone.",
                confirmLabel: "Delete",
                danger: true,
              });
              if (ok) { deleteCategory(cat.id); renderCategories(); onChange(); }
            },
          }, "🗑"),
        ]);
        catList.appendChild(row);
      });
    }

    // Backups
    sheet.appendChild(sectionLabel("Backups"));
    const backupSettings = getSettings();
    const autoBackupSwitch = el("button", {
      type: "button",
      class: `switch${backupSettings.autoBackup.enabled ? " on" : ""}`,
      role: "switch",
      "aria-checked": String(backupSettings.autoBackup.enabled),
      onclick: () => {
        const next = !getSettings().autoBackup.enabled;
        updateSettings({ autoBackup: { ...getSettings().autoBackup, enabled: next } });
        autoBackupSwitch.classList.toggle("on", next);
        autoBackupSwitch.setAttribute("aria-checked", String(next));
      },
    });
    sheet.appendChild(el("div", { class: "settings-row" }, [
      el("div", {}, [
        el("div", { class: "lbl" }, "Automatic backups"),
        el("div", { class: "sub" }, "Downloads a JSON backup on its own when one is overdue."),
      ]),
      autoBackupSwitch,
    ]));
    const intervalSelect = el("select", {
      style: `${INPUT_STYLE}`,
      onchange: (e) => {
        updateSettings({ autoBackup: { ...getSettings().autoBackup, intervalDays: Number(e.target.value) } });
        renderBackupStatusLine();
      },
    });
    [3, 7, 14, 30].forEach((d) => {
      const opt = el("option", { value: d }, `Every ${d} days`);
      if (d === backupSettings.autoBackup.intervalDays) opt.selected = true;
      intervalSelect.appendChild(opt);
    });
    sheet.appendChild(el("div", { class: "settings-row" }, [
      el("div", {}, [el("div", { class: "lbl" }, "Backup interval")]),
      intervalSelect,
    ]));
    const backupStatusLine = el("div", { style: "font-size:12px;color:var(--ink-muted);padding:6px 0 2px;" });
    sheet.appendChild(backupStatusLine);
    function renderBackupStatusLine() {
      const status = backupStatus();
      backupStatusLine.textContent = status.lastBackupAt
        ? `Last backup: ${status.daysSince === 0 ? "today" : `${status.daysSince} day${status.daysSince === 1 ? "" : "s"} ago`}`
        : "No backup yet";
    }
    renderBackupStatusLine();

    // Data
    sheet.appendChild(sectionLabel("Data"));
    const fileInput = el("input", { type: "file", accept: "application/json", style: "display:none" });
    fileInput.addEventListener("change", async () => {
      const file = fileInput.files[0];
      if (!file) return;
      const ok = await showConfirm({
        title: "Import backup?",
        message: "This replaces all current entries and categories on this device. This can't be undone.",
        confirmLabel: "Import",
        danger: true,
      });
      if (!ok) { fileInput.value = ""; return; }
      try {
        const text = await file.text();
        await importData(text);
        toast("Data imported");
        renderCategories();
        renderBackupStatusLine();
        onChange();
      } catch (e) {
        toast("Couldn't read that file");
      }
      fileInput.value = "";
    });
    sheet.appendChild(el("div", { class: "sheet-actions" }, [
      el("button", {
        class: "btn btn-secondary",
        onclick: async () => {
          await downloadBackupFile();
          renderBackupStatusLine();
        },
      }, "Export JSON"),
      el("button", { class: "btn btn-secondary", onclick: () => fileInput.click() }, "Import JSON"),
    ]));
    sheet.appendChild(fileInput);
  });
}

const INPUT_STYLE = "padding:8px 10px;border-radius:6px;border:1px solid var(--border-strong);background:var(--surface);font-size:13px;color:var(--ink);";

function openCategoryFieldsEditor(category, onChange) {
  let fields = (category.fields || []).map((f) => ({ ...f }));

  function persistFields() {
    setCategoryFields(category.id, fields);
    onChange();
  }

  openSheet((sheet, close) => {
    sheet.appendChild(el("h2", {}, `${category.name} — custom fields`));
    sheet.appendChild(el("button", { class: "sheet-close", "aria-label": "Close", onclick: close }, "✕"));
    sheet.appendChild(el("p", { style: "margin-top:6px;color:var(--ink-secondary);font-size:13.5px;line-height:1.5;" },
      `Fields specific to "${category.name}" show up in the entry form whenever you pick this category — for example "Book" and "Pages" for Reading.`));

    const list = el("div", { style: "margin-top:16px;display:flex;flex-direction:column;gap:10px;" });
    sheet.appendChild(list);

    function fieldRow(f, onRemove, onChangeType, typeOptions) {
      const labelInput = el("input", {
        type: "text",
        value: f.label,
        placeholder: "Field name",
        style: `${INPUT_STYLE}flex:1;`,
        onchange: (e) => {
          const v = e.target.value.trim();
          f.label = v || f.label;
          e.target.value = f.label;
          persistFields();
        },
      });
      const typeSelect = el("select", {
        style: `${INPUT_STYLE}width:110px;`,
        onchange: (e) => onChangeType(e.target.value),
      });
      typeOptions.forEach(([val, label]) => {
        const opt = el("option", { value: val }, label);
        if (val === f.type) opt.selected = true;
        typeSelect.appendChild(opt);
      });
      const removeBtn = el("button", {
        type: "button",
        "aria-label": `Remove ${f.label}`,
        style: "background:none;border:none;color:var(--ink-muted);padding:6px;flex-shrink:0;",
        onclick: onRemove,
      }, "🗑");
      return el("div", { style: "display:flex;gap:8px;align-items:center;" }, [labelInput, typeSelect, removeBtn]);
    }

    function renderList() {
      list.innerHTML = "";
      if (fields.length === 0) {
        list.appendChild(el("p", { style: "color:var(--ink-muted);font-size:13px;" }, "No custom fields yet — just the note field for now."));
        return;
      }
      fields.forEach((f, i) => {
        const card = el("div", { style: "border:1px solid var(--border);border-radius:10px;padding:10px;" });
        card.appendChild(fieldRow(
          f,
          () => { fields.splice(i, 1); persistFields(); renderList(); },
          (val) => {
            f.type = val;
            if (val === "group" && !f.subfields) f.subfields = [];
            persistFields();
            renderList();
          },
          [["text", "Text"], ["number", "Number"], ["group", "Repeatable group"]],
        ));

        if (f.type === "group") {
          const sub = el("div", { style: "margin-top:10px;padding-top:10px;border-top:1px dashed var(--gridline);display:flex;flex-direction:column;gap:8px;" });
          sub.appendChild(el("div", { style: "font-size:11px;color:var(--ink-muted);" },
            `Each "${f.label}" entry can repeat — e.g. one row per exercise. Define what each row asks for:`));
          if (!f.subfields || f.subfields.length === 0) {
            sub.appendChild(el("p", { style: "color:var(--ink-muted);font-size:12.5px;" }, "No sub-fields yet."));
          } else {
            f.subfields.forEach((sf, si) => {
              sub.appendChild(fieldRow(
                sf,
                () => { f.subfields.splice(si, 1); persistFields(); renderList(); },
                (val) => { sf.type = val; persistFields(); },
                [["text", "Text"], ["number", "Number"]],
              ));
            });
          }
          sub.appendChild(el("button", {
            type: "button",
            class: "btn btn-secondary",
            style: "font-size:12.5px;padding:7px 12px;align-self:flex-start;",
            onclick: () => {
              f.subfields = f.subfields || [];
              f.subfields.push({ id: generateId(), label: "New sub-field", type: "text" });
              persistFields();
              renderList();
            },
          }, "+ Add sub-field"));
          card.appendChild(sub);
        }

        list.appendChild(card);
      });
    }
    renderList();

    sheet.appendChild(el("button", {
      type: "button",
      class: "btn btn-secondary btn-block",
      style: "margin-top:14px;",
      onclick: () => {
        fields.push({ id: generateId(), label: "New field", type: "text" });
        persistFields();
        renderList();
      },
    }, "+ Add field"));

    sheet.appendChild(el("div", { class: "sheet-actions" }, [
      el("button", { type: "button", class: "btn btn-primary btn-block", onclick: close }, "Done"),
    ]));
  });
}

function sectionLabel(text) {
  return el("div", { style: "font-size:11px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;color:var(--ink-muted);margin-top:22px;margin-bottom:4px;" }, text);
}

function hourSelect(value, onChange) {
  const select = el("select", { style: "padding:8px 10px;border-radius:6px;border:1px solid var(--border-strong);background:var(--surface);font-size:13px;", onchange: (e) => onChange(Number(e.target.value)) });
  HOUR_LABELS.forEach((label, h) => {
    const opt = el("option", { value: h }, label);
    if (h === value) opt.selected = true;
    select.appendChild(opt);
  });
  return select;
}

function segmented(options, selected, onSelect) {
  const wrap = el("div", { style: "display:flex;border:1px solid var(--border-strong);border-radius:8px;overflow:hidden;" });
  options.forEach((opt) => {
    const btn = el("button", {
      type: "button",
      style: `padding:7px 12px;font-size:12.5px;font-weight:600;text-transform:capitalize;background:${opt === selected ? "var(--ink)" : "transparent"};color:${opt === selected ? "var(--page)" : "var(--ink-secondary)"};border:none;`,
      onclick: () => {
        Array.from(wrap.children).forEach((c, i) => {
          c.style.background = options[i] === opt ? "var(--ink)" : "transparent";
          c.style.color = options[i] === opt ? "var(--page)" : "var(--ink-secondary)";
        });
        onSelect(opt);
      },
    }, opt);
    wrap.appendChild(btn);
  });
  return wrap;
}
