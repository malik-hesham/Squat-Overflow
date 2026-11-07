import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import fs from "node:fs";
import { createHost } from "../src/host/index.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.join(here, "..", "web");
const shimPath = path.join(here, "..", "src", "host", "page-shim.js");

let h;
let data = {};
const urls = [];
const badges = [];

before(async () => {
  h = await createHost({
    webDir,
    shimPath,
    state: { get: () => data, set: (o) => (data = o) },
    openUrl: (u) => urls.push(u),
    idleState: () => "active",
    onBadge: (b) => badges.push(b),
    port: 0,
  });
});
after(async () => {
  await h?.dispose();
});

test("break flow through the real service worker", async () => {
  assert.ok(h.firstRun);
  assert.match(h.baseUrl, /^http:\/\/127\.0\.0\.1:\d+\/[0-9a-f]{48}$/);
  assert.ok(urls.some((u) => u.endsWith("/options.html")), "first run opens settings");

  await h.chrome.storage.local.set({ setupDone: true, areas: ["back"] });
  assert.deepEqual(await h.host.dispatchMessage({ type: "settings-saved" }), { ok: true });
  assert.deepEqual(await h.host.dispatchMessage({ type: "break-now" }), { ok: true });

  const breakUrl = urls.find((u) => u.includes("/break.html"));
  assert.ok(breakUrl, "break url opened");
  const m = /__wid=(\d+)/.exec(breakUrl);
  assert.ok(m, "__wid present");
  const id = Number(m[1]);

  h.host.windowClosed(id);
  await new Promise((r) => setTimeout(r, 100));
  const { schedule } = await h.chrome.storage.local.get("schedule");
  assert.ok(schedule);
  assert.notEqual(schedule.windowId, id);

  assert.ok(badges.length >= 1);
  assert.ok(badges.some((b) => typeof b.text === "string"));
});

test("page-shim getURL and sendMessage target", () => {
  const calls = [];
  const win = {
    location: { origin: "http://127.0.0.1:1234", pathname: "/tok/popup.html", search: "" },
    sessionStorage: { getItem: () => null, setItem() {} },
    EventSource: class {
      constructor(url) {
        this.url = url;
      }
    },
    fetch: (url, opts) => {
      calls.push({ url, opts });
      return Promise.resolve({ ok: true, json: async () => ({ response: { ok: 1 } }) });
    },
    open: () => null,
    close() {},
    console,
  };
  win.window = win;
  const ctx = vm.createContext({ ...win, URL, URLSearchParams, setTimeout, document: { body: {} } });
  ctx.window = ctx;
  vm.runInContext(fs.readFileSync(shimPath, "utf8"), ctx);
  const c = ctx.chrome ?? ctx.window.chrome;
  assert.equal(c.runtime.getURL("a.png"), "http://127.0.0.1:1234/tok/a.png");
  return c.runtime.sendMessage({ type: "x" }).then((res) => {
    assert.deepEqual(res, { ok: 1 });
    assert.equal(calls[0].url, "http://127.0.0.1:1234/tok/__api/message");
    assert.equal(calls[0].opts.method, "POST");
  });
});
