// Cloud sync + push notifications. Entirely optional — the app works fully
// offline/local without ever touching this module. Only active once the user
// signs in from Settings. Loads the Supabase client from a CDN (not vendored)
// since this feature inherently requires network access anyway; everything
// else in Rhythm keeps working offline regardless.
import { exportData, subscribe as subscribeStore } from "./store.js";

const SUPABASE_URL = "https://hlfhrdhvtxpnspkbgnwm.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhsZmhyZGh2dHhwbnNwa2JnbndtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY4OTE1MTMsImV4cCI6MjEwMjQ2NzUxM30.6aYLRha8V-SLqg4c7I_vZ49byuRAOLKFGBNTdl3KJr8";
const VAPID_PUBLIC_KEY = "BH83i13k02UA9M9DlgmVBtv5OCddP4p87skAPkKUrHqmVQJshAmy8IDw2PXr0CuUx6qmTWIL94o5OMrYcY9OFb0";

let clientPromise = null;
function client() {
  if (!clientPromise) {
    clientPromise = import("https://esm.sh/@supabase/supabase-js@2").then(({ createClient }) =>
      createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    );
  }
  return clientPromise;
}

export async function requestMagicLink(email) {
  const supabase = await client();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: location.origin + location.pathname },
  });
  if (error) throw error;
}

// Verifying the 6-8 digit code from the sign-in email completes auth via a
// direct API call — no link click, no redirect involved. More robust than
// the link (which depends on the project's redirect-URL allowlist being
// configured correctly) and works with the same email Supabase sends.
export async function verifyCode(email, token) {
  const supabase = await client();
  const { error } = await supabase.auth.verifyOtp({ email, token, type: "email" });
  if (error) throw error;
}

export async function getSession() {
  const supabase = await client();
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export async function signOut() {
  const supabase = await client();
  await supabase.auth.signOut();
}

// Registers the store->cloud sync exactly once, no matter how many times
// onAuthChange fires or who called it (app.js at boot, Settings after a
// fresh sign-in, a token refresh, ...).
let autoSyncWired = false;
function ensureAutoSync() {
  if (autoSyncWired) return;
  autoSyncWired = true;
  subscribeStore(() => scheduleSync());
}

// cb(session) fires on sign-in, sign-out, and token refresh — including
// right after a magic-link redirect completes (the SDK auto-detects the
// session from the URL on client init), and once immediately with whatever
// session already exists when first subscribed. A truthy session always
// triggers both an immediate sync push and (once) the ongoing auto-sync
// subscription — a first-time sign-in used to leave the app without either
// until the next full reload, which is why "signed in" could still show an
// empty synced state.
export function onAuthChange(cb) {
  client().then((supabase) => supabase.auth.onAuthStateChange((_event, session) => {
    if (session) {
      ensureAutoSync();
      syncNow().catch(() => {});
    }
    cb(session);
  }));
}

// ---------- State sync ----------

let syncTimer = null;
export function scheduleSync() {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => { syncNow().catch(() => {}); }, 4000);
}

export async function syncNow() {
  const session = await getSession();
  if (!session) return false;
  const supabase = await client();
  const state = JSON.parse(await exportData());
  // Not part of local state — annotated at sync time so the server can
  // resolve reminder/notification times in the user's actual local time
  // instead of guessing.
  let timezone = null;
  try { timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || null; } catch (e) { /* unsupported */ }
  const { error } = await supabase.from("user_state").upsert({
    user_id: session.user.id,
    state,
    timezone,
    updated_at: new Date().toISOString(),
  });
  return !error;
}

// ---------- Push subscription ----------

function urlBase64ToUint8Array(base64) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const safe = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(safe);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export function pushSupported() {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

export async function pushSubscriptionStatus() {
  if (!pushSupported()) return "unsupported";
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return "off";
  const sub = await reg.pushManager.getSubscription();
  return sub ? "on" : "off";
}

export async function enablePush() {
  if (!pushSupported()) throw new Error("Push notifications aren't supported in this browser.");
  const session = await getSession();
  if (!session) throw new Error("Sign in first.");

  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Notification permission was denied.");

  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
  }

  const json = sub.toJSON();
  const supabase = await client();
  const { error } = await supabase.from("push_subscriptions").upsert(
    { user_id: session.user.id, endpoint: json.endpoint, p256dh: json.keys.p256dh, auth_key: json.keys.auth },
    { onConflict: "endpoint" },
  );
  if (error) throw error;
}

export async function disablePush() {
  if (!pushSupported()) return;
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;
  const endpoint = sub.endpoint;
  await sub.unsubscribe();
  const session = await getSession();
  if (session) {
    const supabase = await client();
    await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
  }
}
