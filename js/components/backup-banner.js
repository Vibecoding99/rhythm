import { el, toast } from "./sheet.js";
import { maybeRunAutoBackup, backupStatus, isBannerSnoozed, snoozeBanner, downloadBackupFile } from "../lib/backup.js";

// Call once at startup. Auto-downloads a backup if one is due and enabled;
// otherwise shows a dismissible reminder banner if a manual backup is overdue.
export function checkAndShowBackupReminder() {
  if (maybeRunAutoBackup()) {
    toast("Backup downloaded to your Downloads folder");
    return;
  }

  const status = backupStatus();
  if (!status.overdue || isBannerSnoozed()) return;

  const app = document.getElementById("app");
  const header = document.querySelector(".app-header");
  const label = status.lastBackupAt
    ? `Last backup: ${status.daysSince === 0 ? "today" : `${status.daysSince} day${status.daysSince === 1 ? "" : "s"} ago`}`
    : "You haven't backed up your data yet";

  const banner = el("div", { class: "backup-banner" }, [
    el("span", {}, label),
    el("div", { style: "display:flex;gap:10px;align-items:center;" }, [
      el("button", {
        type: "button",
        class: "backup-banner-action",
        onclick: () => { downloadBackupFile(); banner.remove(); toast("Backup downloaded"); },
      }, "Export now"),
      el("button", {
        type: "button",
        "aria-label": "Dismiss",
        class: "backup-banner-dismiss",
        onclick: () => { snoozeBanner(1); banner.remove(); },
      }, "✕"),
    ]),
  ]);
  header.insertAdjacentElement("afterend", banner);
}
