// Sdílený klientský store: lokální cache + odběratelé + polling = "živá" data napříč uživateli.
'use strict';
import { Api } from './api.js';

const listeners = new Map(); // collection -> Set<fn>
const cache = new Map(); // collection -> array
const cacheKey = (c) => `ochr.cache.${c}`;

function persist(c) {
  try {
    localStorage.setItem(cacheKey(c), JSON.stringify(cache.get(c) || []));
  } catch {
    /* localStorage plný/nedostupný – ignorujeme */
  }
}

function emit(c) {
  const arr = cache.get(c) || [];
  (listeners.get(c) || []).forEach((fn) => {
    try {
      fn(arr);
    } catch (e) {
      console.error(e);
    }
  });
}

export const Store = {
  get(c) {
    if (!cache.has(c)) {
      let init = [];
      try {
        init = JSON.parse(localStorage.getItem(cacheKey(c)) || '[]');
      } catch {
        init = [];
      }
      cache.set(c, Array.isArray(init) ? init : []);
    }
    return cache.get(c);
  },

  subscribe(c, fn) {
    if (!listeners.has(c)) listeners.set(c, new Set());
    listeners.get(c).add(fn);
    fn(this.get(c));
    return () => listeners.get(c).delete(fn);
  },

  async refresh(c) {
    const items = await Api.list(c);
    cache.set(c, items);
    persist(c);
    emit(c);
    return items;
  },

  async add(c, data) {
    const item = await Api.create(c, data);
    cache.set(c, [item, ...this.get(c)]);
    persist(c);
    emit(c);
    return item;
  },

  async update(c, id, data) {
    const item = await Api.update(c, id, data);
    cache.set(
      c,
      this.get(c).map((x) => (x.id === id ? item : x))
    );
    persist(c);
    emit(c);
    return item;
  },

  async remove(c, id) {
    await Api.remove(c, id);
    cache.set(
      c,
      this.get(c).filter((x) => x.id !== id)
    );
    persist(c);
    emit(c);
  },
};

// --- polling pro živost ---
let pollTimer = null;
let pollCollections = [];

export function setLiveCollections(cols) {
  pollCollections = cols;
  pollCollections.forEach((c) => Store.refresh(c).catch(() => {}));
}

export function startSync(intervalMs = 20000) {
  stopSync();
  pollTimer = setInterval(() => {
    if (document.visibilityState === 'visible') {
      pollCollections.forEach((c) => Store.refresh(c).catch(() => {}));
    }
  }, intervalMs);
  const onWake = () => pollCollections.forEach((c) => Store.refresh(c).catch(() => {}));
  window.addEventListener('focus', onWake);
  window.addEventListener('online', onWake);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') onWake();
  });
}

export function stopSync() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}
