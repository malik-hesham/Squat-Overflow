// The part of the `chrome.*` extension API that Squat Overflow uses, backed by the Rust shell.
// The shell injects this into every window before the page's own scripts (src-tauri/src/lib.rs),
// so popup.html, options.html, break.html and service-worker.js run here exactly as they do in
// the browser. Each call maps to one command in lib.rs; the shell answers with
// `__soShim.dispatch(name, payload)` for the events (storage changes, alarms, messages, closed
// windows).
(() => {
  if (window.__soShim) return;

  const RUNTIME_ID = "squat-overflow-desktop";
  const isBackground = location.pathname === "/background.html";
  const trace = Boolean(window.__SO_TRACE__);
  const raw = (cmd, args) => window.__TAURI_INTERNALS__.invoke(cmd, args);
  const log = (level, message) => raw("log", { level, message: String(message).slice(0, 2000) }).catch(() => {});
  const invoke = (cmd, args) => {
    if (trace) log("trace", `${cmd} ${JSON.stringify(args ?? {})}`.slice(0, 300));
    return raw(cmd, args);
  };
  const nothing = () => undefined;
  const isWeb = (url) => /^https?:\/\//i.test(url) && new URL(url).origin !== location.origin;

  function event() {
    const listeners = new Set();
    return {
      addListener: (fn) => void listeners.add(fn),
      removeListener: (fn) => void listeners.delete(fn),
      hasListener: (fn) => listeners.has(fn),
      listeners,
      fire(...args) {
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

  const storage = {
    onChanged: event(),
    local: {
      async get(keys) {
        if (keys == null) return invoke("storage_get", { keys: null });
        if (typeof keys === "string") return invoke("storage_get", { keys: [keys] });
        if (Array.isArray(keys)) return invoke("storage_get", { keys });
        return { ...keys, ...(await invoke("storage_get", { keys: Object.keys(keys) })) };
      },
      set: (items) => invoke("storage_set", { items }).then(nothing),
      remove: (keys) => invoke("storage_remove", { keys: [].concat(keys) }).then(nothing),
    },
  };

  const alarms = {
    onAlarm: event(),
    create: (name, info = {}) =>
      invoke("alarms_create", {
        name,
        when: info.when ?? null,
        delayInMinutes: info.delayInMinutes ?? null,
        periodInMinutes: info.periodInMinutes ?? null,
      }).then(nothing),
    get: (name) => invoke("alarms_get", { name }).then((alarm) => alarm ?? undefined),
    clear: (name) => invoke("alarms_clear", { name }),
  };

  const runtime = {
    id: RUNTIME_ID,
    onMessage: event(),
    onInstalled: event(),
    onStartup: event(),
    getURL: (path) => new URL(String(path).replace(/^\//, ""), `${location.origin}/`).href,
    sendMessage: (message) => invoke("runtime_send_message", { message }).then((res) => res ?? undefined),
    openOptionsPage: () => invoke("open_options").then(nothing),
  };

  // Only the background page gets messages, as only service-worker.js listens for them.
  function onRuntimeMessage({ id, message }) {
    let answered = false;
    const respond = (response) => {
      if (answered) return;
      answered = true;
      invoke("runtime_reply", { id, response: response === undefined ? null : response });
    };
    let waiting = false;
    for (const fn of [...runtime.onMessage.listeners]) {
      try {
        const result = fn(message, { id: RUNTIME_ID }, respond);
        if (result === true) waiting = true;
        else if (typeof result?.then === "function") {
          waiting = true;
          result.then(respond, () => respond());
        }
      } catch (err) {
        console.error(err);
      }
    }
    if (!waiting) respond();
  }

  const windows = {
    onRemoved: event(),
    // A page on the web opens in the user's browser, never in a window of this app, where it would
    // sit next to the shell's commands.
    async create({ url, width, height, focused } = {}) {
      if (isWeb(url)) {
        await invoke("open_external", { url });
        return { id: -1, tabs: [] };
      }
      return invoke("windows_create", { url: runtime.getURL(url), width: width ?? null, height: height ?? null, focused: focused ?? true });
    },
    get: (id) => invoke("windows_get", { id }),
    getAll: () => invoke("windows_get_all"),
    getCurrent: () => invoke("windows_current"),
    update: (id, info = {}) => invoke("windows_update", { id, focused: info.focused ?? null }),
    remove: (id) => invoke("windows_remove", { id }).then(nothing),
  };

  // One window is one tab here, and the tab's id is its window's id.
  const tabs = {
    async query(query = {}) {
      if (query.windowId != null) return (await windows.get(query.windowId)).tabs;
      // `audible` asks which browser tabs are playing sound (service-worker.js's meeting check).
      // The app can't see the browser's tabs: README, "Gaps".
      if (query.audible) return [];
      return (await windows.getAll()).flatMap((win) => win.tabs);
    },
    async create({ url }) {
      const win = await windows.create({ url });
      return win.tabs[0] ?? { id: win.id, windowId: win.id, url };
    },
  };

  const action = {
    setBadgeText: ({ text }) => invoke("action_set_badge", { text: text ?? "" }).then(nothing),
    setBadgeBackgroundColor: async () => {}, // the tray title has no background
    setTitle: ({ title }) => invoke("action_set_title", { title: title ?? "" }).then(nothing),
  };

  const idle = { queryState: (seconds) => invoke("idle_state", { seconds }) };

  const unavailable = () => Promise.reject(new Error("Sign-in isn't available in the desktop app yet"));
  const identity = {
    getRedirectURL: () => `https://${RUNTIME_ID}.invalid/`,
    launchWebAuthFlow: unavailable,
  };

  // WebView2 already has a `window.chrome` (chrome.webview), so add to it.
  window.chrome = Object.assign(window.chrome ?? {}, { storage, alarms, runtime, windows, tabs, action, idle, identity });

  // Events from the shell. The background page holds its events until service-worker.js has
  // registered its listeners (ready(), called by background.js).
  let ready = !isBackground;
  const queued = [];
  function deliver(name, payload) {
    if (name === "storage.changed") storage.onChanged.fire(payload, "local");
    else if (name === "alarm") alarms.onAlarm.fire(payload);
    else if (name === "windows.removed") windows.onRemoved.fire(payload);
    else if (name === "runtime.message") onRuntimeMessage(payload);
  }
  window.__soShim = {
    dispatch(name, payload) {
      if (ready) deliver(name, payload);
      else queued.push([name, payload]);
    },
    // The first run is the extension's install; every later launch is a browser start-up.
    async ready() {
      const { firstRun } = await invoke("startup_info");
      ready = true;
      if (firstRun) runtime.onInstalled.fire({ reason: "install" });
      else runtime.onStartup.fire();
      for (const [name, payload] of queued.splice(0)) deliver(name, payload);
    },
    setMenu: (labels) => invoke("set_menu", { labels }),
  };

  // popup.js closes its window after Break now; a window that a script didn't open ignores that.
  window.close = () => void invoke("window_close");
  const open = window.open.bind(window);
  window.open = (url, ...rest) => {
    if (!isWeb(String(url))) return open(url, ...rest);
    invoke("open_external", { url: String(url) });
    return null;
  };

  // The browser sizes the popup to its content; here the shell does, when the page says how tall it is.
  if (location.pathname === "/popup.html") {
    addEventListener("DOMContentLoaded", () => {
      const fit = () => invoke("popup_fit", { height: Math.ceil(document.documentElement.offsetHeight) });
      new ResizeObserver(fit).observe(document.documentElement);
    });
  }

  // Page errors go to the shell's log, since these windows have no console the user can see.
  addEventListener("error", (ev) => log("error", `${ev.message} (${ev.filename}:${ev.lineno})`));
  addEventListener("unhandledrejection", (ev) => log("error", `unhandled rejection: ${ev.reason?.stack ?? ev.reason}`));
  addEventListener("securitypolicyviolation", (ev) => log("error", `CSP blocked ${ev.blockedURI} (${ev.violatedDirective})`));
  if (trace) {
    addEventListener("load", () => setTimeout(() => log("trace", `rendered "${document.title}": ${document.body.innerText.replace(/\s+/g, " ").slice(0, 400)}`), 1500));
  }
})();
