// Remembers your choices (avatar, voice, chat size...) and the avatar files you add yourself.
// Settings live in localStorage; avatar files live in IndexedDB. Both stay in YOUR browser only.

const PREFS_KEY = 'nova.prefs';

export function loadPrefs() {
  try { return JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') || {}; } catch { return {}; }
}
export function savePrefs(prefs) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* storage blocked */ }
}

const DB_NAME = 'nova-avatars';
const STORE = 'avatars';
let memory = []; // used when IndexedDB is unavailable (for example private windows)

function openDb() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) return reject(new Error('IndexedDB not available'));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function run(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => { db.close(); resolve(req && req.result); };
    t.onerror = () => { db.close(); reject(t.error); };
    t.onabort = () => { db.close(); reject(t.error); };
  });
}

/** Returns [{ id, name, blob, body }] */
export async function listCustomAvatars() {
  try { return (await run(await openDb(), 'readonly', s => s.getAll())) || []; }
  catch { return memory.slice(); }
}

/** Saves an avatar. Returns { persisted: false } if it could only be kept until the tab closes. */
export async function addCustomAvatar(record) {
  try { await run(await openDb(), 'readwrite', s => s.put(record)); return { persisted: true }; }
  catch { memory.push(record); return { persisted: false }; }
}

export async function removeCustomAvatar(id) {
  memory = memory.filter(r => r.id !== id);
  try { await run(await openDb(), 'readwrite', s => s.delete(id)); } catch { /* nothing stored */ }
}
