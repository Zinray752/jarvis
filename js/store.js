// store.js: a tiny wrapper around the phone's local storage.
// Everything JARVIS remembers lives on the device, under keys that start with "jarvis:".

const PREFIX = 'jarvis:';

export function createStore(backend = globalThis.localStorage) {
  return {
    get(key, fallback = null) {
      try {
        const raw = backend.getItem(PREFIX + key);
        return raw == null ? fallback : JSON.parse(raw);
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      backend.setItem(PREFIX + key, JSON.stringify(value));
    },
    remove(key) {
      backend.removeItem(PREFIX + key);
    },
    keys() {
      const out = [];
      for (let i = 0; i < backend.length; i++) {
        const k = backend.key(i);
        if (k && k.startsWith(PREFIX)) out.push(k.slice(PREFIX.length));
      }
      return out;
    },
  };
}

// In-memory backend, used by the tests (and as a fallback if storage is blocked).
export function memoryBackend() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    key: (i) => [...m.keys()][i] ?? null,
    get length() {
      return m.size;
    },
  };
}
