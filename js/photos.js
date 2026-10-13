// Photos of the original cards, kept in this browser's IndexedDB. They stay on the device they were added on:
// photos are large, and Google Drive sync carries only the typed-up recipes. A backup file can carry them.

const DB = 'from-scratch', STORE = 'photos';
let opening = null;

function db() {
  if (opening) return opening;
  opening = new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('blocked'));
    } catch (e) { reject(e); }
  });
  opening.catch(() => { opening = null; });
  return opening;
}

async function run(mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(STORE, mode), store = tx.objectStore(STORE);
    let result;
    const req = fn(store);
    if (req) req.onsuccess = () => { result = req.result; };
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export const photos = {
  async get(id) { try { return (await run('readonly', s => s.get(id))) || null; } catch { return null; } },
  async set(id, blob) { await run('readwrite', s => s.put(blob, id)); },
  async remove(id) { try { await run('readwrite', s => s.delete(id)); } catch { /* nothing to remove */ } },
  async keys() { try { return (await run('readonly', s => s.getAllKeys())) || []; } catch { return []; } },
  async move(from, to) {
    const b = await photos.get(from);
    if (!b) return;
    if (!(await photos.get(to))) await photos.set(to, b);
    await photos.remove(from);
  },
  async clear() { try { await run('readwrite', s => s.clear()); } catch { /* nothing to clear */ } },
};

// A photo from the camera or files, shrunk to at most 1600 px on its long side as a JPEG.
export async function shrink(file, max = 1600) {
  let img;
  try { img = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { img = null; }
  if (!img) {
    img = await new Promise((resolve, reject) => {
      const el = new Image(), url = URL.createObjectURL(file);
      el.onload = () => { URL.revokeObjectURL(url); resolve(el); };
      el.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file isn’t a photo this browser can open.')); };
      el.src = url;
    });
  }
  const w = img.width, h = img.height, k = Math.min(1, max / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * k);
  canvas.height = Math.round(h * k);
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  return new Promise(resolve => canvas.toBlob(b => resolve(b), 'image/jpeg', 0.84));
}

export const blobToDataURL = blob => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = () => reject(r.error);
  r.readAsDataURL(blob);
});

// A photo from a backup file, or null if it isn't one this browser can read.
export function dataURLToBlob(url) {
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(String(url || ''));
  if (!m || !m[2]) return null;
  let bin;
  try { bin = atob(m[3]); } catch { return null; }
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: m[1] || 'image/jpeg' });
}
