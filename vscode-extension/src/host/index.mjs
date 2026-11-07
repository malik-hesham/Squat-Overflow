import path from "node:path";
import { pathToFileURL } from "node:url";
import { createServer } from "./server.mjs";
import { createChrome } from "./node-chrome.mjs";

export async function createHost({ webDir, shimPath, state, openUrl, idleState, onBadge, port }) {
  let chromeObj = null;
  let hostObj = null;

  // Late-bound: the server needs chrome/host, chrome needs server.baseUrl.
  const lateChrome = {
    storage: {
      local: {
        get: (...a) => chromeObj.storage.local.get(...a),
        set: (...a) => chromeObj.storage.local.set(...a),
        remove: (...a) => chromeObj.storage.local.remove(...a),
      },
    },
  };
  const lateHost = {
    dispatchMessage: (...a) => hostObj.dispatchMessage(...a),
    windowSeen: (...a) => hostObj.windowSeen(...a),
    windowClosed: (...a) => hostObj.windowClosed(...a),
    onStorageChanged: (...a) => hostObj.onStorageChanged(...a),
  };

  const server = createServer({ webDir, shimPath, chrome: lateChrome, host: lateHost, port });

  const made = createChrome({
    state,
    baseUrl: () => server.baseUrl,
    openUrl,
    idleState,
    onBadge,
  });
  chromeObj = made.chrome;
  hostObj = made.host;

  globalThis.chrome = chromeObj;
  const { port: boundPort, baseUrl } = await server.start();

  await import(pathToFileURL(path.join(webDir, "service-worker.js")).href);

  let firstRun = false;
  if (!state.get().__installed) {
    firstRun = true;
    state.set({ ...state.get(), __installed: true });
    hostObj.fireInstalled("install");
  }
  hostObj.fireStartup();

  return {
    baseUrl,
    port: boundPort,
    chrome: chromeObj,
    host: hostObj,
    firstRun,
    async dispose() {
      await server.stop();
      hostObj.dispose();
      delete globalThis.chrome;
    },
  };
}
