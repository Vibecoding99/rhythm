import { toISODate } from "./lib/date.js";
import { subscribe } from "./lib/store.js";
import { openEntryForm } from "./components/entry-form.js";
import { openSettings, applyStoredTheme } from "./components/settings.js";
import { checkAndShowBackupReminder } from "./components/backup-banner.js";
import * as dayView from "./views/day.js";
import * as weekView from "./views/week.js";
import * as monthView from "./views/month.js";
import * as summaryView from "./views/summary.js";
import * as goalsView from "./views/goals.js";

applyStoredTheme();

const VIEWS = { day: dayView, week: weekView, month: monthView, summary: summaryView, goals: goalsView };

const state = {
  view: "day",
  date: toISODate(new Date()),
};

const container = document.getElementById("view-container");
const nav = document.getElementById("bottom-nav");
const fab = document.getElementById("fab-add");

const api = {
  get date() { return state.date; },
  goToDate(iso, view) {
    state.date = iso;
    if (view) state.view = view;
    render();
  },
  goToView(view, iso) {
    state.view = view;
    if (iso) state.date = iso;
    render();
  },
  refresh() { render(); },
};

let lastRenderKey = null;

function render() {
  const key = `${state.view}:${state.date}`;
  api.freshNav = key !== lastRenderKey;
  lastRenderKey = key;

  VIEWS[state.view].render(container, api);
  if (api.freshNav && state.view !== "day") container.scrollTop = 0;

  Array.from(nav.children).forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.view === state.view);
  });
  fab.style.display = state.view === "summary" || state.view === "goals" ? "none" : "flex";
}

nav.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-view]");
  if (!btn) return;
  state.view = btn.dataset.view;
  render();
});

fab.addEventListener("click", () => {
  openEntryForm({ date: state.date, onDone: () => render() });
});

document.getElementById("settings-btn").addEventListener("click", () => {
  openSettings(() => render());
});

subscribe(() => render());

render();
checkAndShowBackupReminder();

// ---------- Cloud sync (optional) ----------
// Only loaded if there's a previous session to resume or a magic-link
// redirect just landed — keeps the default fully-local, fast boot untouched
// for anyone who has never used Notifications.
const SUPABASE_SESSION_HINT = "sb-hlfhrdhvtxpnspkbgnwm-auth-token";
if (localStorage.getItem(SUPABASE_SESSION_HINT) || location.hash.includes("access_token")) {
  import("./lib/sync.js").then(({ onAuthChange, syncNow, scheduleSync }) => {
    onAuthChange((session) => { if (session) syncNow().catch(() => {}); });
    subscribe(() => scheduleSync());
  }).catch(() => {});
}

// ---------- Service worker registration ----------
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}
