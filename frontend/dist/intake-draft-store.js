// Large local drafts include media. Serialize storage operations across navigation.
export function createIntakeDraftStore(database = globalThis.indexedDB) {
  let queue = Promise.resolve();
  function run(key, mode, value) {
    const work = queue.catch(() => {}).then(async () => {
      if (!database) throw new Error('草稿存储不可用');
      const db = await new Promise((resolve, reject) => {
        const request = database.open('pawletter.intake-drafts.v1', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('drafts');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        return await new Promise((resolve, reject) => {
          const tx = db.transaction('drafts', mode === 'load' ? 'readonly' : 'readwrite');
          const store = tx.objectStore('drafts');
          const request = mode === 'load' ? store.get(key) : mode === 'save' ? store.put(value, key) : store.delete(key);
          let result;
          request.onsuccess = () => { result = request.result; };
          tx.oncomplete = () => resolve(result);
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error || new Error('草稿保存中断'));
        });
      } finally { db.close(); }
    });
    queue = work;
    return work;
  }
  return {load:key => run(key,'load'), save:(key,value) => run(key,'save',structuredClone(value)), remove:key => run(key,'remove')};
}
