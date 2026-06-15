// Sdílený klientský store s OFFLINE FRONTOU = automatické a spolehlivé ukládání do sdílené DB.
// Zápisy se hned zobrazí (optimisticky) a na pozadí se odešlou; když není signál,
// počkají ve frontě v localStorage a odešlou se samy, jakmile je připojení.
'use strict';
import { Api } from './api.js';
import { getUser } from './ui.js';

const listeners = new Map(); // collection -> Set<fn>
const cache = new Map(); // collection -> array (vč. čekajících _pending položek)
const cacheKey = (c) => `ochr.cache.${c}`;
const QUEUE_KEY = 'ochr.queue.v1';

let queue = loadQueue();
let flushing = false;
const pendingSubs = new Set();

function loadQueue() {
  try {
    const q = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
    return Array.isArray(q) ? q : [];
  } catch {
    return [];
  }
}
function saveQueue() {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch {
    /* ignore */
  }
  pendingSubs.forEach((fn) => {
    try {
      fn(queue.length);
    } catch (e) {
      console.error(e);
    }
  });
}

export function onPending(fn) {
  pendingSubs.add(fn);
  fn(queue.length);
  return () => pendingSubs.delete(fn);
}
export const pendingCount = () => queue.length;

function persist(c) {
  try {
    localStorage.setItem(cacheKey(c), JSON.stringify(cache.get(c) || []));
  } catch {
    /* ignore */
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

function uuid() {
  return crypto && crypto.randomUUID ? crypto.randomUUID() : 'x' + Math.random().toString(36).slice(2) + Date.now();
}
const isTmp = (id) => typeof id === 'string' && id.startsWith('tmp_');

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

  // Načte ze serveru, ale zachová ještě neodeslané (_pending) položky.
  async refresh(c) {
    const server = await Api.list(c);
    const pending = this.get(c).filter((x) => x._pending);
    const pendingIds = new Set(pending.map((x) => x.id));
    cache.set(c, dedupById([...pending, ...server.filter((s) => !pendingIds.has(s.id))]));
    persist(c);
    emit(c);
    return cache.get(c);
  },

  add(c, data) {
    const now = new Date().toISOString();
    const tmpId = 'tmp_' + uuid();
    const item = { ...data, id: tmpId, author: getUser()?.name || '?', createdAt: now, updatedAt: now, _pending: true };
    cache.set(c, [item, ...this.get(c)]);
    persist(c);
    emit(c);
    queue.push({ qid: uuid(), op: 'add', c, tmpId, data });
    saveQueue();
    flush();
    return Promise.resolve(item);
  },

  update(c, id, data) {
    const arr = this.get(c).map((x) => (x.id === id ? { ...x, ...data, updatedAt: new Date().toISOString() } : x));
    cache.set(c, arr);
    persist(c);
    emit(c);
    if (isTmp(id)) {
      const q = queue.find((o) => o.op === 'add' && o.tmpId === id);
      if (q) q.data = { ...q.data, ...data };
    } else {
      queue.push({ qid: uuid(), op: 'update', c, id, data });
    }
    saveQueue();
    flush();
    return Promise.resolve();
  },

  remove(c, id) {
    cache.set(c, this.get(c).filter((x) => x.id !== id));
    persist(c);
    emit(c);
    if (isTmp(id)) {
      queue = queue.filter((o) => !(o.op === 'add' && o.tmpId === id));
    } else {
      queue.push({ qid: uuid(), op: 'remove', c, id });
    }
    saveQueue();
    flush();
    return Promise.resolve();
  },
};

let flushPromise = null;
const dedupById = (arr) => {
  const seen = new Set();
  return arr.filter((x) => (seen.has(x.id) ? false : (seen.add(x.id), true)));
};

// Přehraje frontu zápisů. Vrací promise (i když už běží), aby šlo počkat na dokončení.
export function flush() {
  if (flushing) return flushPromise || Promise.resolve();
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return Promise.resolve();
  flushing = true;
  flushPromise = (async () => {
    const touched = new Set();
    try {
      while (queue.length) {
        const op = queue[0];
        try {
          if (op.op === 'add') {
            const item = await Api.create(op.c, op.data);
            cache.set(op.c, dedupById(Store.get(op.c).map((x) => (x.id === op.tmpId ? item : x))));
            touched.add(op.c);
          } else if (op.op === 'update') {
            await Api.update(op.c, op.id, op.data);
            cache.set(op.c, Store.get(op.c).map((x) => (x.id === op.id ? { ...x, _pending: false } : x)));
            touched.add(op.c);
          } else if (op.op === 'remove') {
            await Api.remove(op.c, op.id);
          }
          queue.shift();
          saveQueue();
        } catch (err) {
          if (err && typeof err.status === 'number' && err.status >= 400 && err.status < 500) {
            queue.shift(); // nevalidní zápis -> zahodit, ať fronta neuvázne
            saveQueue();
            continue;
          }
          break; // offline / server nedostupný -> retry později
        }
      }
    } finally {
      flushing = false;
      touched.forEach((c) => {
        persist(c);
        emit(c);
      });
    }
  })();
  return flushPromise;
}

// --- polling + automatické odeslání fronty ---
let pollTimer = null;
let pollCollections = [];

export function setLiveCollections(cols) {
  pollCollections = cols;
  pollCollections.forEach((c) => Store.refresh(c).catch(() => {}));
}

async function wake() {
  try {
    await flush(); // nejdřív doodesílej frontu, pak teprve načti z DB (jinak hrozí zdvojení)
  } catch {
    /* ignore */
  }
  if (document.visibilityState === 'visible') {
    pollCollections.forEach((c) => Store.refresh(c).catch(() => {}));
  }
}

export function startSync(intervalMs = 20000) {
  stopSync();
  flush(); // odešli, co případně zbylo z minula
  pollTimer = setInterval(wake, intervalMs);
  window.addEventListener('focus', wake);
  window.addEventListener('online', wake);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') wake();
  });
}

export function stopSync() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}
