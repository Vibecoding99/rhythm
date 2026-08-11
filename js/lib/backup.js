import { exportData, getSettings, updateSettings } from "./store.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const SNOOZE_KEY = "rhythm.backupBannerSnoozeUntil";

export function downloadBackupFile() {
  const blob = new Blob([exportData()], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `rhythm-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  updateSettings({ lastBackupAt: Date.now() });
}

export function backupStatus() {
  const { lastBackupAt, autoBackup } = getSettings();
  const intervalDays = autoBackup?.intervalDays ?? 7;
  const enabled = autoBackup?.enabled ?? true;
  const overdue = !lastBackupAt || Date.now() - lastBackupAt > intervalDays * DAY_MS;
  const daysSince = lastBackupAt ? Math.floor((Date.now() - lastBackupAt) / DAY_MS) : null;
  return { lastBackupAt, daysSince, overdue, autoBackupEnabled: enabled, intervalDays };
}

// Call once at app startup. Downloads a fresh backup if one is overdue and
// auto-backup is enabled; returns true if it did.
export function maybeRunAutoBackup() {
  const status = backupStatus();
  if (status.overdue && status.autoBackupEnabled) {
    downloadBackupFile();
    return true;
  }
  return false;
}

export function isBannerSnoozed() {
  const until = Number(localStorage.getItem(SNOOZE_KEY) || 0);
  return Date.now() < until;
}

export function snoozeBanner(days = 1) {
  localStorage.setItem(SNOOZE_KEY, String(Date.now() + days * DAY_MS));
}
