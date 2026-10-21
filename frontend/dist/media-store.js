const DATABASE = 'pawletter.media.v1';
const urls = new Map();
function open() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('media');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function storeMedia(url) {
  if (!url) return null;
  if (!url.startsWith('blob:')) return { src: url };
  const blob = await (await fetch(url)).blob();
  const db = await open();
  const id = crypto.randomUUID();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction('media', 'readwrite');
      tx.objectStore('media').put(blob, id);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Media save aborted'));
    });
    return { id };
  } finally { db.close(); }
}
export async function mediaUrl(id) {
  if (urls.has(id)) return urls.get(id);
  const db = await open();
  try {
    const blob = await new Promise((resolve, reject) => {
      const request = db.transaction('media').objectStore('media').get(id);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    if (!blob) return '';
    const url = URL.createObjectURL(blob);
    urls.set(id, url);
    return url;
  } finally { db.close(); }
}
export async function clearMedia() {
  urls.forEach(url => URL.revokeObjectURL(url)); urls.clear();
  const db = await open();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction('media','readwrite');
      tx.objectStore('media').clear();
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
    });
  } finally { db.close(); }
}
