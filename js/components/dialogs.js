import { openSheet, el } from "./sheet.js";
import { formatTimeLabel } from "../lib/date.js";
import { getCategory } from "../lib/store.js";
import { catColor } from "../lib/color.js";

export function showConfirm({ title, message, confirmLabel = "Confirm", danger = false, cancelLabel = "Cancel" }) {
  return new Promise((resolve) => {
    let resolved = false;
    openSheet((sheet, closeSheet) => {
      sheet.appendChild(el("h2", {}, title));
      sheet.appendChild(el("p", { style: "margin-top:8px;color:var(--ink-secondary);font-size:14px;line-height:1.5;" }, message));
      const actions = el("div", { class: "sheet-actions" }, [
        el("button", {
          class: "btn btn-secondary",
          onclick: () => { resolved = true; closeSheet(); resolve(false); },
        }, cancelLabel),
        el("button", {
          class: `btn ${danger ? "btn-danger" : "btn-primary"}`,
          onclick: () => { resolved = true; closeSheet(); resolve(true); },
        }, confirmLabel),
      ]);
      sheet.appendChild(actions);
    });
    // If dismissed via backdrop/escape without a button choice, resolve false.
    const observer = new MutationObserver(() => {
      if (!document.body.contains(document.querySelector(".sheet-backdrop")) && !resolved) {
        resolved = true;
        resolve(false);
        observer.disconnect();
      }
    });
    observer.observe(document.body, { childList: true });
  });
}

export function showScopeDialog(verb = "Edit") {
  return new Promise((resolve) => {
    let resolved = false;
    openSheet((sheet, close) => {
      sheet.appendChild(el("h2", {}, `${verb} recurring entry`));
      sheet.appendChild(el("p", { style: "margin-top:6px;color:var(--ink-secondary);font-size:14px;" }, "This entry repeats weekly. What should this change apply to?"));
      const opts = el("div", { class: "scope-options" }, [
        el("button", {
          class: "option-btn",
          onclick: () => { resolved = true; close(); resolve("instance"); },
        }, [
          el("div", { class: "opt-title" }, "Just this occurrence"),
          el("div", { class: "opt-desc" }, "Only this date is affected."),
        ]),
        el("button", {
          class: "option-btn",
          onclick: () => { resolved = true; close(); resolve("series"); },
        }, [
          el("div", { class: "opt-title" }, "The whole series"),
          el("div", { class: "opt-desc" }, "Every week this entry repeats."),
        ]),
      ]);
      sheet.appendChild(opts);
      sheet.appendChild(el("div", { class: "sheet-actions" }, [
        el("button", { class: "btn btn-ghost btn-block", onclick: () => { resolved = true; close(); resolve(null); } }, "Cancel"),
      ]));
    });
    watchDismiss(() => resolved, () => resolve(null));
  });
}

function watchDismiss(isResolved, onDismiss) {
  const observer = new MutationObserver(() => {
    if (!document.querySelector(".sheet-backdrop") && !isResolved()) {
      onDismiss();
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true });
}

// conflicts: array of occurrence objects from store.findConflicts
export function showConflictDialog(conflicts) {
  return new Promise((resolve) => {
    let resolved = false;
    openSheet((sheet, close) => {
      sheet.appendChild(el("h2", {}, "Time conflict"));
      const list = el("div", { style: "margin-top:10px;display:flex;flex-direction:column;gap:8px;" });
      conflicts.forEach((c) => {
        const cat = getCategory(c.category);
        const color = catColor(cat ? cat.colorIndex : 0);
        list.appendChild(el("div", {
          style: `padding:10px 12px;border-radius:8px;background:var(--surface);border-left:3px solid ${color};`,
        }, [
          el("div", { style: "font-weight:600;font-size:13.5px;" }, cat ? cat.name : "Untitled"),
          el("div", { style: "font-size:12px;color:var(--ink-muted);" }, `${formatTimeLabel(c.startTime)} – ${formatTimeLabel(c.endTime)}`),
        ]));
      });
      sheet.appendChild(el("p", { style: "margin-top:12px;font-size:13.5px;color:var(--ink-secondary);" },
        `This overlaps ${conflicts.length > 1 ? "these entries" : "an existing entry"}. Choose how to resolve it:`));
      sheet.appendChild(list);

      const opts = el("div", { class: "resolve-options" }, [
        el("button", {
          class: "option-btn",
          onclick: () => { resolved = true; close(); resolve({ action: "adjust" }); },
        }, [
          el("div", { class: "opt-title" }, "Adjust this entry's time"),
          el("div", { class: "opt-desc" }, "Go back and pick a different time."),
        ]),
        el("button", {
          class: "option-btn",
          onclick: () => { resolved = true; close(); resolve({ action: "trim" }); },
        }, [
          el("div", { class: "opt-title" }, "Trim or replace the conflict"),
          el("div", { class: "opt-desc" }, "Shorten the existing entry, or remove it if it's fully covered."),
        ]),
        el("button", {
          class: "option-btn",
          onclick: () => { resolved = true; close(); resolve({ action: "keep" }); },
        }, [
          el("div", { class: "opt-title" }, "Keep both, overlapping"),
          el("div", { class: "opt-desc" }, "Save anyway — both stay on the timeline, flagged as overlapping."),
        ]),
      ]);
      sheet.appendChild(opts);
      sheet.appendChild(el("div", { class: "sheet-actions" }, [
        el("button", { class: "btn btn-ghost btn-block", onclick: () => { resolved = true; close(); resolve({ action: "cancel" }); } }, "Cancel"),
      ]));
    });
    watchDismiss(() => resolved, () => resolve({ action: "cancel" }));
  });
}
