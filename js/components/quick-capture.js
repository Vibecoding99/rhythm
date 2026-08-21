import { openSheet, el, toast } from "./sheet.js";
import { showConfirm } from "./dialogs.js";
import { parseCapture } from "../lib/parse.js";
import { buildDraft, saveDraft } from "../lib/capture.js";
import { getCategories, getCategory, getInboxItems, deleteInboxItem, promoteInboxItem } from "../lib/store.js";
import { catColor } from "../lib/color.js";
import { isVoiceSupported, startListening } from "../lib/voice.js";
import {
  minutesToTimeStr, timeStrToMinutes, formatTimeLabel, formatDurationLabel,
  weekdayLabel, fromISODate, toISODate, MINUTES_PER_DAY, SNAP,
} from "../lib/date.js";

const TIME_OPTIONS = Array.from({ length: MINUTES_PER_DAY / SNAP }, (_, i) => {
  const mins = i * SNAP;
  return { value: minutesToTimeStr(mins), label: formatTimeLabel(mins) };
});
const DURATION_OPTIONS = [15, 30, 45, 60, 90, 120];
const WEEKDAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function formatDateChip(iso) {
  const d = fromISODate(iso);
  const today = toISODate(new Date());
  const tomorrow = toISODate(new Date(Date.now() + 86400000));
  if (iso === today) return "Today";
  if (iso === tomorrow) return "Tomorrow";
  return `${weekdayLabel(d, true).slice(0, 3)}, ${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}

function recurrenceLabel(recurrence) {
  if (!recurrence) return null;
  if (recurrence.freq === "daily") return "Repeats daily";
  if (recurrence.freq === "weekday") return "Repeats every weekday";
  if (recurrence.freq === "monthly") return "Monthly (not supported yet)";
  if (recurrence.freq === "weekly") return `Repeats every ${WEEKDAY_NAMES[recurrence.weekday]}`;
  return null;
}

export function openQuickCapture(onDone) {
  let draft = null;

  openSheet((sheet, close) => {
    sheet.appendChild(el("h2", {}, "Quick capture"));
    sheet.appendChild(el("button", { class: "sheet-close", "aria-label": "Close", onclick: close }, "✕"));
    sheet.appendChild(el("p", { style: "margin-top:6px;color:var(--ink-secondary);font-size:13.5px;line-height:1.5;" },
      "Type anything — \"gym tomorrow 7am for 45 min tag health\" — and see it parsed below. No field is required."));

    const input = el("input", {
      type: "text",
      placeholder: "gym tomorrow 7am for 45 min...",
      style: "flex:1;min-width:0;padding:13px 14px;border-radius:12px;border:1.5px solid var(--border-strong);background:var(--surface);font-size:16px;",
      oninput: (e) => renderPreview(e.target.value),
      onkeydown: (e) => { if (e.key === "Enter") { e.preventDefault(); handleConfirm(); } },
    });

    const inputRow = el("div", { style: "display:flex;gap:8px;align-items:stretch;margin-top:14px;" }, [input]);

    let stopListening = null;
    let micBtn = null;
    if (isVoiceSupported()) {
      micBtn = el("button", {
        type: "button", class: "mic-btn", "aria-label": "Voice capture",
        onclick: () => { if (stopListening) stopListening(); else beginListening(); },
      }, "🎙️");
      inputRow.appendChild(micBtn);
    }
    sheet.appendChild(inputRow);

    const voiceStatus = el("p", { class: "voice-status", style: "display:none;" });
    sheet.appendChild(voiceStatus);

    const previewWrap = el("div", { style: "margin-top:14px;" });
    sheet.appendChild(previewWrap);

    function setVoiceStatus(text, isError) {
      if (!text) { voiceStatus.style.display = "none"; return; }
      voiceStatus.textContent = text;
      voiceStatus.className = `voice-status${isError ? " voice-status-error" : ""}`;
      voiceStatus.style.display = "block";
    }

    function beginListening() {
      micBtn.classList.add("listening");
      input.value = "";
      setVoiceStatus("Listening…");
      stopListening = startListening({
        onInterim: (text) => setVoiceStatus(text),
        onFinal: (text) => {
          input.value = text;
          renderPreview(text);
        },
        onError: (reason) => {
          if (reason === "not-allowed") setVoiceStatus("Microphone access denied — you can still type", true);
          else setVoiceStatus("Didn't catch that — try again or type it", true);
        },
        onEnd: () => {
          micBtn.classList.remove("listening");
          stopListening = null;
        },
      });
    }

    const actions = el("div", { class: "sheet-actions" });
    const confirmBtn = el("button", { type: "button", class: "btn btn-primary btn-block", disabled: "true", onclick: handleConfirm }, "Add");
    actions.appendChild(confirmBtn);
    sheet.appendChild(actions);

    function renderPreview(text) {
      previewWrap.innerHTML = "";
      if (!text || !text.trim()) {
        draft = null;
        confirmBtn.disabled = true;
        return;
      }
      const parsed = parseCapture(text);
      draft = buildDraft(parsed);
      confirmBtn.disabled = false;
      previewWrap.appendChild(renderChips());
    }

    function renderChips() {
      const wrap = el("div", { class: "capture-chips" });
      const cat = getCategory(draft.categoryId);

      // Category chip — a native select styled as a chip; simplest reliable
      // way to make every chip actually tappable-to-edit for this milestone.
      const catSelect = el("select", { class: "capture-chip", onchange: (e) => { draft.categoryId = e.target.value; } });
      getCategories().forEach((c) => {
        const opt = el("option", { value: c.id }, `${c.emoji || "🏷️"} ${c.name}`);
        if (c.id === draft.categoryId) opt.selected = true;
        catSelect.appendChild(opt);
      });
      wrap.appendChild(catSelect);

      if (draft.status === "inbox") {
        wrap.appendChild(el("span", { class: "capture-chip capture-chip-static" }, "📥 No date → Inbox"));
      } else {
        const dateInput = el("input", {
          type: "date", value: draft.date, class: "capture-chip",
          onchange: (e) => { if (e.target.value) draft.date = e.target.value; },
        });
        wrap.appendChild(dateInput);

        const timeSelect = el("select", {
          class: `capture-chip${draft.timeWasGuessed ? " capture-chip-guess" : ""}`,
          onchange: (e) => { draft.startTime = e.target.value; draft.timeWasGuessed = false; syncEndTime(); },
        });
        TIME_OPTIONS.forEach((opt) => {
          const optionEl = el("option", { value: opt.value }, opt.label);
          if (opt.value === draft.startTime) optionEl.selected = true;
          timeSelect.appendChild(optionEl);
        });
        wrap.appendChild(timeSelect);

        const durSelect = el("select", {
          class: "capture-chip",
          onchange: (e) => { draft.durationMin = Number(e.target.value); syncEndTime(); },
        });
        DURATION_OPTIONS.forEach((mins) => {
          const optionEl = el("option", { value: mins }, formatDurationLabel(mins));
          if (mins === draft.durationMin) optionEl.selected = true;
          durSelect.appendChild(optionEl);
        });
        wrap.appendChild(durSelect);
      }

      if (draft.recurrence) {
        const label = recurrenceLabel(draft.recurrence);
        const unsupported = draft.recurrence.freq === "monthly";
        wrap.appendChild(el("span", { class: `capture-chip capture-chip-static${unsupported ? " capture-chip-warn" : ""}` }, label));
      }

      wrap.appendChild(el("button", {
        type: "button",
        class: `capture-chip capture-chip-priority${draft.note.startsWith("‼️") ? " active" : ""}`,
        onclick: () => {
          draft.note = draft.note.startsWith("‼️") ? draft.note.replace(/^‼️\s*/, "") : `‼️ ${draft.note}`;
          previewWrap.innerHTML = "";
          previewWrap.appendChild(renderChips());
        },
      }, "‼️ Priority"));

      const notePreview = el("div", { style: "margin-top:10px;font-size:13.5px;color:var(--ink-secondary);" }, [
        el("span", { style: "font-weight:600;color:var(--ink);" }, "Note: "),
        draft.note || "(none)",
      ]);

      const container = el("div", {}, [wrap, notePreview]);
      return container;
    }

    function syncEndTime() {
      const endMinutes = Math.min(timeStrToMinutes(draft.startTime) + draft.durationMin, MINUTES_PER_DAY - 1);
      draft.endTime = minutesToTimeStr(endMinutes);
    }

    async function handleConfirm() {
      if (!draft) return;
      if (draft.recurrence?.freq === "monthly") {
        const ok = await showConfirm({
          title: "Monthly recurrence isn't supported yet",
          message: "This will be saved as a one-time entry instead. You can make it weekly from the entry itself afterward.",
          confirmLabel: "Save as one-time",
        });
        if (!ok) return;
      }
      const saved = saveDraft(draft);
      close();
      toast(draft.status === "inbox" ? "Added to Inbox" : saved.length > 1 ? `${saved.length} entries added` : "Entry added");
      onDone && onDone();
    }

    // ---- Inbox ----
    const inboxItems = getInboxItems();
    if (inboxItems.length > 0) {
      sheet.appendChild(el("div", {
        style: "font-size:11px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;color:var(--ink-muted);margin-top:26px;margin-bottom:6px;",
      }, `Inbox (${inboxItems.length})`));
      const inboxList = el("div", { style: "display:flex;flex-direction:column;gap:8px;" });
      inboxItems.forEach((item) => inboxList.appendChild(renderInboxRow(item, () => { openQuickCapture(onDone); close(); })));
      sheet.appendChild(inboxList);
    }

    requestAnimationFrame(() => input.focus());
  });
}

function renderInboxRow(item, refresh) {
  const cat = getCategory(item.categoryId);
  const color = cat ? catColor(cat.colorIndex) : "#898781";
  return el("div", { class: "inbox-row", style: `--cat-color:${color}` }, [
    el("span", { class: "swatch" }),
    el("span", { class: "inbox-row-note" }, item.note || (cat ? cat.name : "Untitled")),
    el("button", {
      type: "button", class: "btn btn-secondary", style: "padding:6px 10px;font-size:12px;",
      onclick: () => openPromoteDate(item, refresh),
    }, "Add date"),
    el("button", {
      type: "button", "aria-label": "Delete", style: "background:none;border:none;color:var(--ink-muted);padding:6px;",
      onclick: () => { deleteInboxItem(item.id); refresh(); },
    }, "🗑"),
  ]);
}

function openPromoteDate(item, refresh) {
  openSheet((sheet, close) => {
    sheet.appendChild(el("h2", {}, "Add a date"));
    sheet.appendChild(el("button", { class: "sheet-close", "aria-label": "Close", onclick: close }, "✕"));
    const dateInput = el("input", { type: "date", value: toISODate(new Date()), style: "width:100%;padding:11px 12px;border-radius:8px;border:1px solid var(--border-strong);background:var(--surface);font-size:15px;margin-top:14px;" });
    const timeSelect = el("select", { style: "width:100%;padding:11px 12px;border-radius:8px;border:1px solid var(--border-strong);background:var(--surface);font-size:15px;margin-top:10px;" });
    TIME_OPTIONS.forEach((opt) => {
      const optionEl = el("option", { value: opt.value }, opt.label);
      if (opt.value === "09:00") optionEl.selected = true;
      timeSelect.appendChild(optionEl);
    });
    sheet.appendChild(dateInput);
    sheet.appendChild(timeSelect);
    sheet.appendChild(el("div", { class: "sheet-actions" }, [
      el("button", {
        type: "button", class: "btn btn-primary btn-block",
        onclick: () => {
          const startTime = timeSelect.value;
          const endMinutes = Math.min(timeStrToMinutes(startTime) + item.durationMin, MINUTES_PER_DAY - 1);
          promoteInboxItem(item.id, { date: dateInput.value, startTime, endTime: minutesToTimeStr(endMinutes) });
          close();
          toast("Scheduled");
          refresh();
        },
      }, "Schedule it"),
    ]));
  });
}
