import { openSheet, el, toast } from "./sheet.js";
import { showScopeDialog, showConflictDialog, showConfirm } from "./dialogs.js";
import {
  snapMinutes, minutesToTimeStr, timeStrToMinutes, formatTimeLabel,
  toISODate, fromISODate, weekdayLabel, MINUTES_PER_DAY, SNAP,
} from "../lib/date.js";
import {
  getCategories, addCategory, findConflicts, addEntry, updateOccurrence,
  deleteOccurrence, trimOrReplaceOccurrence, getCategory,
} from "../lib/store.js";
import { catColor, nextPaletteSlot, PALETTE } from "../lib/color.js";
import { generateId } from "../lib/id.js";
import { compressImage, savePhoto, deletePhoto, getPhotoURL } from "../lib/photos.js";

const TIME_OPTIONS = Array.from({ length: MINUTES_PER_DAY / SNAP }, (_, i) => {
  const mins = i * SNAP;
  return { value: minutesToTimeStr(mins), label: formatTimeLabel(mins) };
});

function nowSnapped() {
  const now = new Date();
  const mins = snapMinutes(now.getHours() * 60 + now.getMinutes());
  const start = Math.min(mins, MINUTES_PER_DAY - SNAP);
  const end = Math.min(start + 30, MINUTES_PER_DAY - SNAP);
  return { startTime: minutesToTimeStr(start), endTime: minutesToTimeStr(end === start ? start + SNAP : end) };
}

// Drops blank scalar values and blank group rows so half-filled inputs
// (an untouched "+ Add another exercise" row, an empty text field) don't
// get persisted as noise.
function cleanCustomFields(cat, customFields) {
  const cleaned = {};
  if (!cat) return cleaned;
  (cat.fields || []).forEach((f) => {
    const v = customFields[f.id];
    if (f.type === "group") {
      const rows = (Array.isArray(v) ? v : []).filter((inst) =>
        (f.subfields || []).some((sf) => inst[sf.id] !== undefined && String(inst[sf.id]).trim() !== "")
      );
      if (rows.length > 0) cleaned[f.id] = rows;
    } else if (v !== undefined && v !== null && String(v).trim() !== "") {
      cleaned[f.id] = v;
    }
  });
  return cleaned;
}

function buildTimeSelect(selected, onChange) {
  const select = el("select", {
    onchange: (e) => onChange(e.target.value),
  });
  TIME_OPTIONS.forEach((opt) => {
    const optionEl = el("option", { value: opt.value }, opt.label);
    if (opt.value === selected) optionEl.selected = true;
    select.appendChild(optionEl);
  });
  return select;
}

export function openEntryForm({ date, startTime, endTime, occurrence, onDone } = {}) {
  const editing = !!occurrence;
  const seed = editing
    ? { date: occurrence.date, startTime: occurrence.startTime, endTime: occurrence.endTime, category: occurrence.category, note: occurrence.note || "", customFields: { ...(occurrence.customFields || {}) }, photoId: occurrence.photoId || null }
    : { date: date || toISODate(new Date()), ...nowSnapped(), category: null, note: "", customFields: {}, photoId: null };
  if (startTime) seed.startTime = startTime;
  if (endTime) seed.endTime = endTime;

  const form = {
    date: seed.date,
    startTime: seed.startTime,
    endTime: seed.endTime,
    category: seed.category,
    note: seed.note,
    customFields: seed.customFields,
    photoId: seed.photoId,
    isRecurring: editing ? !!occurrence.isRecurring : false,
  };
  // Photo edits stay pending (in memory / a local object URL) until Save —
  // nothing is written to IndexedDB, and nothing old is deleted, until then.
  const existingPhotoId = seed.photoId;
  let pendingBlob = null;
  let pendingPreviewUrl = null;
  let photoRemoved = false;

  openSheet((sheet, close) => {
    sheet.appendChild(el("h2", {}, editing ? "Edit entry" : "New entry"));
    sheet.appendChild(el("button", { class: "sheet-close", "aria-label": "Close", onclick: close }, "✕"));

    // ---- Date field ----
    const dateField = el("div", { class: "field" }, [
      el("label", {}, "Date"),
      el("input", {
        type: "date",
        value: form.date,
        disabled: editing && occurrence.isRecurring ? "true" : undefined,
        onchange: (e) => { form.date = e.target.value; recurrenceHint.textContent = recurrenceLabel(); },
      }),
    ]);
    sheet.appendChild(dateField);
    if (editing && occurrence.isRecurring) {
      dateField.appendChild(el("div", { class: "duration-hint" }, "The date of a recurring entry can't be changed — delete this occurrence and add a new one instead."));
    }

    // ---- Time fields ----
    const startSelect = buildTimeSelect(form.startTime, (v) => { form.startTime = v; refreshDuration(); });
    const endSelect = buildTimeSelect(form.endTime, (v) => { form.endTime = v; refreshDuration(); });
    const durationHint = el("div", { class: "duration-hint" }, "");
    const timeField = el("div", { class: "field" }, [
      el("label", {}, "Time"),
      el("div", { class: "time-row" }, [
        el("div", { class: "time-select-group" }, [startSelect]),
        el("span", { class: "to-label" }, "–"),
        el("div", { class: "time-select-group" }, [endSelect]),
      ]),
      durationHint,
    ]);
    sheet.appendChild(timeField);

    function refreshDuration() {
      const mins = timeStrToMinutes(form.endTime) - timeStrToMinutes(form.startTime);
      durationHint.textContent = mins > 0 ? `${formatDur(mins)} logged` : "End time must be after start time";
      durationHint.style.color = mins > 0 ? "var(--ink-muted)" : "var(--danger)";
    }
    function formatDur(mins) {
      const h = Math.floor(mins / 60), m = mins % 60;
      if (h && m) return `${h}h ${m}m`;
      if (h) return `${h}h`;
      return `${m}m`;
    }
    refreshDuration();

    // ---- Category field ----
    const catField = el("div", { class: "field" }, [el("label", {}, "Category")]);
    const catPicker = el("div", { class: "category-picker" });
    catField.appendChild(catPicker);
    const newCatRow = el("div", { class: "new-category-row" });
    newCatRow.style.display = "none";
    catField.appendChild(newCatRow);
    sheet.appendChild(catField);

    const customFieldsWrap = el("div", {});
    sheet.appendChild(customFieldsWrap);

    function renderCustomFields() {
      customFieldsWrap.innerHTML = "";
      const cat = form.category ? getCategory(form.category) : null;
      const fields = (cat && cat.fields) || [];
      fields.forEach((f) => {
        if (f.type === "group") {
          customFieldsWrap.appendChild(buildGroupField(f));
        } else {
          const input = el("input", {
            type: f.type === "number" ? "number" : "text",
            inputmode: f.type === "number" ? "decimal" : undefined,
            value: form.customFields[f.id] ?? "",
            placeholder: f.label,
            oninput: (e) => { form.customFields[f.id] = e.target.value; },
          });
          customFieldsWrap.appendChild(el("div", { class: "field" }, [el("label", {}, f.label), input]));
        }
      });
    }

    function buildGroupField(f) {
      if (!Array.isArray(form.customFields[f.id]) || form.customFields[f.id].length === 0) {
        form.customFields[f.id] = [{}];
      }
      const instances = form.customFields[f.id];

      const wrap = el("div", { class: "field" }, [el("label", {}, f.label)]);
      const listEl = el("div", { class: "field-group" });
      wrap.appendChild(listEl);

      function renderInstances() {
        listEl.innerHTML = "";
        instances.forEach((inst, idx) => {
          const subfieldsRow = el("div", { class: "subfields-row" });
          (f.subfields || []).forEach((sf) => {
            const input = el("input", {
              type: sf.type === "number" ? "number" : "text",
              inputmode: sf.type === "number" ? "decimal" : undefined,
              value: inst[sf.id] ?? "",
              placeholder: sf.label,
              oninput: (e) => { inst[sf.id] = e.target.value; },
            });
            subfieldsRow.appendChild(el("div", { class: `subfield${sf.type === "text" ? " text-type" : ""}` }, [
              el("label", {}, sf.label),
              input,
            ]));
          });
          listEl.appendChild(el("div", { class: "field-group-instance" }, [
            subfieldsRow,
            el("button", {
              type: "button",
              class: "remove-btn",
              "aria-label": `Remove ${f.label} ${idx + 1}`,
              onclick: () => { instances.splice(idx, 1); renderInstances(); },
            }, "✕"),
          ]));
        });
      }
      renderInstances();

      wrap.appendChild(el("button", {
        type: "button",
        class: "btn btn-secondary btn-block",
        style: "font-size:13.5px;padding:9px 14px;margin-top:2px;",
        onclick: () => { instances.push({}); renderInstances(); },
      }, `+ Add another ${f.label.toLowerCase()}`));

      return wrap;
    }

    function renderCategoryPicker() {
      catPicker.innerHTML = "";
      const cats = getCategories();
      cats.forEach((cat) => {
        const color = catColor(cat.colorIndex);
        const chip = el("button", {
          type: "button",
          class: `category-chip${form.category === cat.id ? " selected" : ""}`,
          style: `--cat-color:${color}`,
          onclick: () => {
            if (form.category !== cat.id) { form.category = cat.id; form.customFields = {}; }
            renderCategoryPicker();
            renderCustomFields();
          },
        }, [el("span", { class: "swatch" }), cat.name]);
        catPicker.appendChild(chip);
      });
      const addChip = el("button", {
        type: "button",
        class: "category-chip add-new",
        onclick: () => {
          newCatRow.style.display = newCatRow.style.display === "none" ? "flex" : "none";
          if (newCatRow.style.display === "flex") newCatRow.querySelector("input").focus();
        },
      }, "+ New");
      catPicker.appendChild(addChip);
    }

    function renderNewCategoryRow() {
      newCatRow.innerHTML = "";
      const suggestedIndex = nextPaletteSlot(getCategories());
      let chosenIndex = suggestedIndex;
      const nameInput = el("input", { type: "text", placeholder: "Category name", maxlength: "30" });
      const dotPicker = el("div", { class: "color-dot-picker" });
      PALETTE.forEach((slot, i) => {
        const color = catColor(i);
        const dot = el("button", {
          type: "button",
          class: `${i === chosenIndex ? "selected" : ""}`,
          style: `--dot-color:${color}`,
          "aria-label": slot.name,
          onclick: () => {
            chosenIndex = i;
            dotPicker.querySelectorAll("button").forEach((b, bi) => b.classList.toggle("selected", bi === i));
          },
        });
        dotPicker.appendChild(dot);
      });
      const confirmBtn = el("button", {
        type: "button",
        class: "btn btn-primary",
        style: "padding:9px 14px;font-size:13px;",
        onclick: () => {
          const name = nameInput.value.trim();
          if (!name) { nameInput.focus(); return; }
          const cat = addCategory(name, chosenIndex);
          form.category = cat.id;
          form.customFields = {};
          newCatRow.style.display = "none";
          renderCategoryPicker();
          renderCustomFields();
        },
      }, "Add");
      const wrap = el("div", { style: "display:flex;flex-direction:column;gap:8px;width:100%;" }, [
        el("div", { style: "display:flex;gap:8px;" }, [nameInput, confirmBtn]),
        dotPicker,
      ]);
      newCatRow.appendChild(wrap);
    }

    renderCategoryPicker();
    renderNewCategoryRow();
    renderCustomFields();

    // ---- Photo field ----
    const photoWrap = el("div", { class: "field" }, [el("label", {}, "Photo")]);
    const photoBody = el("div", { class: "photo-field" });
    photoWrap.appendChild(photoBody);
    sheet.appendChild(photoWrap);

    const fileInput = el("input", {
      type: "file",
      accept: "image/*",
      style: "display:none",
      onchange: async (e) => {
        const file = e.target.files[0];
        e.target.value = "";
        if (!file) return;
        renderPhotoBody(true);
        try {
          const blob = await compressImage(file);
          if (pendingPreviewUrl) URL.revokeObjectURL(pendingPreviewUrl);
          pendingBlob = blob;
          pendingPreviewUrl = URL.createObjectURL(blob);
          photoRemoved = false;
        } catch (err) {
          toast("Couldn't read that photo");
        }
        renderPhotoBody();
      },
    });
    photoWrap.appendChild(fileInput);

    async function renderPhotoBody(loading = false) {
      photoBody.innerHTML = "";
      if (loading) {
        photoBody.appendChild(el("div", { class: "duration-hint" }, "Processing photo…"));
        return;
      }
      let previewUrl = null;
      if (pendingBlob) previewUrl = pendingPreviewUrl;
      else if (!photoRemoved && existingPhotoId) previewUrl = await getPhotoURL(existingPhotoId);

      if (previewUrl) {
        photoBody.appendChild(el("img", { src: previewUrl, class: "photo-preview", alt: "Entry photo" }));
        photoBody.appendChild(el("div", { class: "photo-actions" }, [
          el("button", { type: "button", class: "btn btn-secondary", style: "flex:1;", onclick: () => fileInput.click() }, "Replace"),
          el("button", {
            type: "button",
            class: "btn btn-secondary",
            style: "flex:1;",
            onclick: () => {
              if (pendingPreviewUrl) { URL.revokeObjectURL(pendingPreviewUrl); pendingPreviewUrl = null; }
              pendingBlob = null;
              photoRemoved = true;
              renderPhotoBody();
            },
          }, "Remove"),
        ]));
      } else {
        photoBody.appendChild(el("button", {
          type: "button",
          class: "btn btn-secondary btn-block",
          onclick: () => fileInput.click(),
        }, "+ Add photo"));
      }
    }
    renderPhotoBody();

    // ---- Note field ----
    const noteInput = el("textarea", {
      placeholder: "What are you doing? (optional)",
      oninput: (e) => { form.note = e.target.value; },
    }, form.note);
    sheet.appendChild(el("div", { class: "field" }, [el("label", {}, "Note"), noteInput]));

    // ---- Recurrence ----
    const recurrenceLabel = () => `Repeats every ${weekdayLabel(fromISODate(form.date), true)}`;
    const recurrenceHint = el("div", { class: "duration-hint", style: "margin-top:2px;" }, recurrenceLabel());
    const canToggleRecurrence = !editing || !occurrence.isRecurring;
    const recurSwitch = el("button", {
      type: "button",
      class: `switch${form.isRecurring ? " on" : ""}`,
      role: "switch",
      "aria-checked": String(form.isRecurring),
      disabled: canToggleRecurrence ? undefined : "true",
      onclick: () => {
        form.isRecurring = !form.isRecurring;
        recurSwitch.classList.toggle("on", form.isRecurring);
        recurSwitch.setAttribute("aria-checked", String(form.isRecurring));
      },
    });
    const recurField = el("div", { class: "field" }, [
      el("div", { class: "recurrence-toggle" }, [
        el("div", {}, [
          el("label", { style: "margin-bottom:2px;" }, "Repeat weekly"),
          recurrenceHint,
        ]),
        recurSwitch,
      ]),
    ]);
    if (editing && occurrence.isRecurring) {
      recurrenceHint.textContent = "This entry repeats weekly. Edits ask whether to apply to this occurrence or the whole series.";
    }
    sheet.appendChild(recurField);

    // ---- Actions ----
    const actions = el("div", { class: "sheet-actions" });
    if (editing) {
      actions.appendChild(el("button", { type: "button", class: "btn btn-danger", onclick: handleDelete }, "Delete"));
    }
    actions.appendChild(el("button", { type: "button", class: "btn btn-primary", onclick: handleSave }, editing ? "Save changes" : "Add entry"));
    sheet.appendChild(actions);

    async function handleDelete() {
      let scope = "instance";
      if (occurrence.isRecurring) {
        const chosen = await showScopeDialog("Delete");
        if (!chosen) return;
        scope = chosen;
      } else {
        const ok = await showConfirm({ title: "Delete this entry?", message: "This can't be undone.", confirmLabel: "Delete", danger: true });
        if (!ok) return;
      }
      deleteOccurrence(occurrence, scope);
      close();
      toast("Entry deleted");
      onDone && onDone();
    }

    // Only touches IndexedDB once the save is actually committed — a
    // cancelled save never writes a new blob or deletes the old one.
    async function resolvePhotoId() {
      if (pendingBlob) {
        const newId = generateId();
        await savePhoto(newId, pendingBlob);
        if (existingPhotoId) await deletePhoto(existingPhotoId);
        return newId;
      }
      if (photoRemoved) {
        if (existingPhotoId) await deletePhoto(existingPhotoId);
        return null;
      }
      return existingPhotoId;
    }

    async function handleSave() {
      if (!form.category) { toast("Choose a category"); return; }
      const durMins = timeStrToMinutes(form.endTime) - timeStrToMinutes(form.startTime);
      if (durMins <= 0) { toast("End time must be after start time"); return; }

      form.customFields = cleanCustomFields(getCategory(form.category), form.customFields);

      const excludeId = editing ? occurrence.occurrenceId : undefined;
      let conflicts = findConflicts(form.date, form.startTime, form.endTime, excludeId);

      if (conflicts.length > 0) {
        const result = await showConflictDialog(conflicts);
        if (result.action === "cancel") return;
        if (result.action === "adjust") return; // back to form
        if (result.action === "trim") {
          conflicts.forEach((c) => trimOrReplaceOccurrence(c, form.startTime, form.endTime));
        }
        // 'keep' falls through and saves as-is.
      }

      form.photoId = await resolvePhotoId();

      if (editing) {
        const baseChanges = { startTime: form.startTime, endTime: form.endTime, category: form.category, note: form.note, customFields: form.customFields, photoId: form.photoId };
        if (occurrence.isRecurring) {
          // Date is fixed for recurring occurrences — the anchor/exception key never moves.
          const scope = await showScopeDialog("Save");
          if (!scope) return;
          updateOccurrence(occurrence, baseChanges, scope);
        } else if (form.isRecurring && !occurrence.isRecurring) {
          // Promote a single entry into a recurring series.
          updateOccurrence(occurrence, { ...baseChanges, date: form.date, isRecurring: true, recurrenceRule: { freq: "weekly" } }, undefined);
        } else {
          updateOccurrence(occurrence, { ...baseChanges, date: form.date }, undefined);
        }
      } else {
        addEntry({ ...form });
      }
      close();
      toast(editing ? "Entry updated" : "Entry logged");
      onDone && onDone();
    }
  });
}
