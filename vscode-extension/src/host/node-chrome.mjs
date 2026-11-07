// Node fake of the chrome.* surface used by extension/service-worker.js and extension/lib/store.js.

const MAX_TIMEOUT = 2147483647;
const NEVER_CONNECTED_MS = 20000;
const EXTENSION_ID = "standup-break-vscode";

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function createEvent() {
  const listeners = [];
  return {
    addListener: (fn) => {
      listeners.push(fn);
    },
    listeners,
    fire: (...args) => {
      for (const fn of [...listeners]) {
        try {
          fn(...args);
        } catch (err) {
          console.error(err);
        }
      }
    },
  };
}

function withWid(url, id) {
  const hashAt = url.indexOf("#");
  const base = hashAt === -1 ? url : url.slice(0, hashAt);
  const hash = hashAt === -1 ? "" : url.slice(hashAt);
  return `${base}${base.includes("?") ? "&" : "?"}__wid=${id}${hash}`;
}

export function createChrome({ state, baseUrl, openUrl, idleState, onBadge }) {
  const onMessage = createEvent();
  const onInstalled = createEvent();
  const onStartup = createEvent();
  const onAlarm = createEvent();
  const onRemoved = createEvent();
  const storageChanged = createEvent();
  const localChanged = createEvent();
  const hostStorageListeners = new Set();

  // storage
  function applyChanges(next, keys) {
    const prev = state.get() ?? {};
    const changes = {};
    for (const key of keys) {
      const oldValue = prev[key];
      const newValue = next[key];
      if (!same(oldValue, newValue)) changes[key] = { oldValue: clone(oldValue), newValue: clone(newValue) };
    }
    state.set(next);
    if (!Object.keys(changes).length) return;
    storageChanged.fire(clone(changes), "local");
    localChanged.fire(clone(changes), "local");
    for (const fn of [...hostStorageListeners]) {
      try {
        fn(clone(changes), "local");
      } catch (err) {
        console.error(err);
      }
    }
  }

  const storageLocal = {
    async get(keys) {
      const data = state.get() ?? {};
      let out;
      if (keys == null) out = { ...data };
      else if (typeof keys === "string") out = keys in data ? { [keys]: data[keys] } : {};
      else if (Array.isArray(keys)) {
        out = {};
        for (const k of keys) if (k in data) out[k] = data[k];
      } else {
        out = {};
        for (const [k, def] of Object.entries(keys)) out[k] = k in data ? data[k] : def;
      }
      return clone(out);
    },
    async set(items) {
      const next = { ...(state.get() ?? {}) };
      const copy = clone(items) ?? {};
      for (const [k, v] of Object.entries(copy)) next[k] = v;
      applyChanges(next, Object.keys(copy));
    },
    async remove(keys) {
      const list = typeof keys === "string" ? [keys] : [...keys];
      const next = { ...(state.get() ?? {}) };
      for (const k of list) delete next[k];
      applyChanges(next, list);
    },
    onChanged: { addListener: localChanged.addListener },
  };

  // alarms
  const alarms = new Map();

  function arm(name) {
    const a = alarms.get(name);
    if (!a) return;
    const remaining = Math.max(0, a.scheduledTime - Date.now());
    a.timer = setTimeout(() => {
      if (alarms.get(name) !== a) return;
      if (a.scheduledTime - Date.now() > 0) {
        arm(name);
        return;
      }
      const fired = { name, scheduledTime: a.scheduledTime };
      if (a.periodInMinutes) {
        a.scheduledTime += a.periodInMinutes * 60_000;
        arm(name);
      } else alarms.delete(name);
      onAlarm.fire(fired);
    }, Math.min(remaining, MAX_TIMEOUT));
    a.timer.unref?.();
  }

  function clearAlarm(name) {
    const a = alarms.get(name);
    if (a) clearTimeout(a.timer);
    alarms.delete(name);
  }

  // windows
  const wins = new Map();
  let nextWindowId = 1;

  function closeWindow(id) {
    const w = wins.get(id);
    if (!w) return false;
    clearTimeout(w.timer);
    wins.delete(id);
    onRemoved.fire(id);
    return true;
  }

  function requireWindow(id) {
    const w = wins.get(id);
    if (!w) throw new Error(`No window with id: ${id}`);
    return w;
  }

  // action badge
  const badge = { text: "", color: "", title: "" };
  const pushBadge = (patch) => {
    Object.assign(badge, patch);
    onBadge?.({ ...badge });
  };

  const chrome = {
    runtime: {
      id: EXTENSION_ID,
      getURL: (p) => baseUrl() + "/" + p,
      onMessage: { addListener: onMessage.addListener },
      onInstalled: { addListener: onInstalled.addListener },
      onStartup: { addListener: onStartup.addListener },
      openOptionsPage: () => {
        openUrl(baseUrl() + "/options.html");
      },
    },
    storage: {
      local: storageLocal,
      onChanged: { addListener: storageChanged.addListener },
    },
    alarms: {
      async create(name, info = {}) {
        clearAlarm(name);
        const period = info.periodInMinutes;
        const scheduledTime = info.when != null ? info.when : Date.now() + (period ?? 0) * 60_000;
        const a = { name, scheduledTime, periodInMinutes: period, timer: null };
        alarms.set(name, a);
        arm(name);
      },
      async get(name) {
        const a = alarms.get(name);
        if (!a) return undefined;
        const out = { name, scheduledTime: a.scheduledTime };
        if (a.periodInMinutes) out.periodInMinutes = a.periodInMinutes;
        return out;
      },
      onAlarm: { addListener: onAlarm.addListener },
    },
    action: {
      async setBadgeText({ text }) {
        pushBadge({ text });
      },
      async setBadgeBackgroundColor({ color }) {
        pushBadge({ color });
      },
      async setTitle({ title }) {
        pushBadge({ title });
      },
    },
    idle: {
      async queryState(sec) {
        return idleState(sec);
      },
    },
    windows: {
      async create({ url }) {
        const id = nextWindowId++;
        const fullUrl = withWid(url, id);
        const w = { url, fullUrl, timer: null };
        wins.set(id, w);
        const startTimer = () => {
          if (wins.get(id) !== w || w.timer) return;
          w.timer = setTimeout(() => closeWindow(id), NEVER_CONNECTED_MS);
          w.timer.unref?.();
        };
        let ret;
        try {
          ret = openUrl(fullUrl);
        } catch (err) {
          console.error(err);
        }
        if (ret && typeof ret.then === "function") {
          ret.then(
            (opened) => {
              if (opened === false) closeWindow(id);
              else startTimer();
            },
            () => startTimer()
          );
        } else startTimer();
        return { id, tabs: [{ url }] };
      },
      async get(id) {
        const w = requireWindow(id);
        return { id, state: "normal", tabs: [{ url: w.url }] };
      },
      async getAll() {
        return [...wins.keys()].map((id) => ({ id, state: "normal" }));
      },
      async update(id, props = {}) {
        const w = requireWindow(id);
        if (props.focused) {
          try {
            Promise.resolve(openUrl(w.fullUrl)).catch(() => {});
          } catch (err) {
            // ignore
          }
        }
        return { id, state: "normal", tabs: [{ url: w.url }] };
      },
      async remove(id) {
        requireWindow(id);
        closeWindow(id);
      },
      onRemoved: { addListener: onRemoved.addListener },
    },
    tabs: {
      async query() {
        return [];
      },
    },
  };

  const host = {
    dispatchMessage(msg) {
      const sender = { id: EXTENSION_ID };
      return new Promise((resolve) => {
        let i = 0;
        const next = () => {
          if (i >= onMessage.listeners.length) return resolve(undefined);
          const listener = onMessage.listeners[i++];
          let sync = { done: false, value: undefined };
          let pending = null;
          const sendResponse = (value) => {
            if (pending) pending(value);
            else sync = { done: true, value };
          };
          let ret;
          try {
            ret = listener(msg, sender, sendResponse);
          } catch (err) {
            console.error(err);
            return next();
          }
          if (sync.done) return resolve(sync.value);
          if (ret === true) pending = resolve;
          else next();
        };
        next();
      });
    },
    windowSeen(id) {
      const w = wins.get(id);
      if (w) {
        clearTimeout(w.timer);
        w.timer = true;
      }
    },
    windowClosed(id) {
      closeWindow(id);
    },
    onStorageChanged(fn) {
      hostStorageListeners.add(fn);
      return () => hostStorageListeners.delete(fn);
    },
    fireInstalled(reason) {
      onInstalled.fire({ reason });
    },
    fireStartup() {
      onStartup.fire();
    },
    dispose() {
      for (const a of alarms.values()) clearTimeout(a.timer);
      alarms.clear();
      for (const w of wins.values()) clearTimeout(w.timer);
      hostStorageListeners.clear();
    },
  };

  return { chrome, host };
}
