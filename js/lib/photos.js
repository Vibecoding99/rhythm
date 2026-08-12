// Photo blobs live in IndexedDB, not localStorage — phones cap localStorage
// around 5-10MB, which a handful of photos would blow through. Entries only
// ever hold a photoId string; the blob itself is fetched from here.

const DB_NAME = "rhythm-photos";
const STORE_NAME = "photos";
const DB_VERSION = 1;

let dbPromise = null;
function openDB() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE_NAME);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

export async function savePhoto(id, blob) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(blob, id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getPhotoBlob(id) {
  if (!id) return null;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

// Object URLs are cached per id for the life of the page so repeated
// re-renders (the app re-renders on every store change) don't keep hitting
// IndexedDB or leaking URLs.
const urlCache = new Map();

export async function getPhotoURL(id) {
  if (!id) return null;
  if (urlCache.has(id)) return urlCache.get(id);
  const blob = await getPhotoBlob(id);
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  urlCache.set(id, url);
  return url;
}

export async function deletePhoto(id) {
  if (!id) return;
  if (urlCache.has(id)) {
    URL.revokeObjectURL(urlCache.get(id));
    urlCache.delete(id);
  }
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// Downscales/re-encodes to keep phone-camera photos (often several MB each)
// from bloating IndexedDB and, more importantly, JSON backup files.
export function compressImage(file, { maxDim = 1600, quality = 0.82 } = {}) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        const scale = maxDim / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d").drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("Could not encode image"))),
        "image/jpeg",
        quality
      );
    };
    img.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error("Could not read image")); };
    img.src = objectUrl;
  });
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function base64ToBlob(base64, type) {
  const chars = atob(base64);
  const bytes = new Uint8Array(chars.length);
  for (let i = 0; i < chars.length; i++) bytes[i] = chars.charCodeAt(i);
  return new Blob([bytes], { type: type || "image/jpeg" });
}

// Bundles the given photo ids as base64 for inclusion in a JSON backup.
export async function exportPhotosForIds(ids) {
  const unique = [...new Set(ids.filter(Boolean))];
  const out = {};
  for (const id of unique) {
    const blob = await getPhotoBlob(id);
    if (!blob) continue;
    out[id] = { data: await blobToBase64(blob), type: blob.type || "image/jpeg" };
  }
  return out;
}

// Restores photos from a backup's base64 bundle back into IndexedDB.
export async function importPhotos(photosObj) {
  if (!photosObj) return;
  for (const [id, rec] of Object.entries(photosObj)) {
    if (!rec || !rec.data) continue;
    await savePhoto(id, base64ToBlob(rec.data, rec.type));
  }
}
