import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createChrome } from "../src/host/node-chrome.mjs";

function make(openImpl) {
  let data = {};
  const opened = [];
  const made = createChrome({
    state: { get: () => data, set: (o) => (data = o) },
    baseUrl: () => "http://127.0.0.1:1/tok",
    openUrl: (u) => (opened.push(u), openImpl ? openImpl(u) : undefined),
    idleState: () => "active",
    onBadge: () => {},
  });
  return { ...made, opened, getData: () => data };
}

const instances = [];
const fresh = (openImpl) => {
  const m = make(openImpl);
  instances.push(m);
  return m;
};
after(() => instances.forEach((m) => m.host.dispose()));

test("storage get/set/remove with defaults", async () => {
  const { chrome } = fresh();
  const s = chrome.storage.local;
  await s.set({ a: 1, b: { x: 2 } });
  assert.deepEqual(await s.get("a"), { a: 1 });
  assert.deepEqual(await s.get(["a", "zz"]), { a: 1 });
  assert.deepEqual(await s.get({ a: 9, c: 3 }), { a: 1, c: 3 });
  assert.deepEqual(await s.get(null), { a: 1, b: { x: 2 } });
  const copy = await s.get("b");
  copy.b.x = 99;
  assert.deepEqual(await s.get("b"), { b: { x: 2 } });
  await s.remove("a");
  assert.deepEqual(await s.get(null), { b: { x: 2 } });
});

test("storage onChanged diffs and ignores unchanged values", async () => {
  const { chrome } = fresh();
  const seen = [];
  chrome.storage.onChanged.addListener((c, area) => seen.push(["g", c, area]));
  chrome.storage.local.onChanged.addListener((c, area) => seen.push(["l", c, area]));
  await chrome.storage.local.set({ k: 1 });
  assert.equal(seen.length, 2);
  assert.deepEqual(seen[0][1], { k: { newValue: 1 } });
  assert.equal(seen[0][2], "local");
  await chrome.storage.local.set({ k: 1 });
  assert.equal(seen.length, 2);
  await chrome.storage.local.set({ k: 2 });
  assert.deepEqual(seen[2][1], { k: { oldValue: 1, newValue: 2 } });
  await chrome.storage.local.remove("k");
  assert.deepEqual(seen[4][1], { k: { oldValue: 2 } });
});

test("alarm when fires, get returns it, create replaces", async () => {
  const { chrome } = fresh();
  const fired = [];
  chrome.alarms.onAlarm.addListener((a) => fired.push(a.name));
  const when = Date.now() + 20;
  await chrome.alarms.create("a", { when });
  const got = await chrome.alarms.get("a");
  assert.equal(got.name, "a");
  assert.equal(got.scheduledTime, when);
  assert.equal(await chrome.alarms.get("nope"), undefined);
  await chrome.alarms.create("a", { when: Date.now() + 5000 });
  await new Promise((r) => setTimeout(r, 80));
  assert.deepEqual(fired, []);
  await chrome.alarms.create("b", { when: Date.now() - 1000 });
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(fired, ["b"]);
  assert.equal(await chrome.alarms.get("b"), undefined);
  assert.equal((await chrome.alarms.get("a")).name, "a");
});

test("windows.create adds __wid before hash; get returns original url", async () => {
  const { chrome, opened } = fresh();
  const win = await chrome.windows.create({ url: "http://h/tok/break.html#manual" });
  assert.equal(win.id, 1);
  assert.deepEqual(win.tabs, [{ url: "http://h/tok/break.html#manual" }]);
  assert.deepEqual(opened, ["http://h/tok/break.html?__wid=1#manual"]);
  const w2 = await chrome.windows.create({ url: "http://h/tok/x.html?a=1" });
  assert.equal(opened[1], "http://h/tok/x.html?a=1&__wid=2");
  assert.equal(w2.id, 2);
  const got = await chrome.windows.get(1, { populate: true });
  assert.equal(got.tabs[0].url, "http://h/tok/break.html#manual");
  await chrome.windows.update(1, { focused: true });
  assert.equal(opened[2], "http://h/tok/break.html?__wid=1#manual");
  await assert.rejects(chrome.windows.get(77), /No window with id: 77/);
});

test("windowClosed fires onRemoved once", async () => {
  const { chrome, host } = fresh();
  const removed = [];
  chrome.windows.onRemoved.addListener((id) => removed.push(id));
  const { id } = await chrome.windows.create({ url: "http://h/a.html" });
  host.windowClosed(id);
  host.windowClosed(id);
  host.windowClosed(999);
  assert.deepEqual(removed, [id]);
  assert.deepEqual(await chrome.windows.getAll(), []);
});

test("dispatchMessage: undefined when unhandled, value via sendResponse", async () => {
  const { chrome, host } = fresh();
  assert.equal(await host.dispatchMessage({ type: "x" }), undefined);
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type !== "ping") return false;
    assert.equal(sender.id, chrome.runtime.id);
    setTimeout(() => sendResponse({ pong: 1 }), 5);
    return true;
  });
  assert.deepEqual(await host.dispatchMessage({ type: "ping" }), { pong: 1 });
  assert.equal(await host.dispatchMessage({ type: "other" }), undefined);
});

test("openUrl promise resolving false fires onRemoved once and window is gone", async () => {
  const { chrome } = fresh(() => Promise.resolve(false));
  const removed = [];
  chrome.windows.onRemoved.addListener((id) => removed.push(id));
  const { id } = await chrome.windows.create({ url: "http://h/a.html" });
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(removed, [id]);
  await assert.rejects(() => chrome.windows.get(id), /No window with id/);
});

test("openUrl promise resolving true keeps the window", async () => {
  const { chrome } = fresh(() => Promise.resolve(true));
  const removed = [];
  chrome.windows.onRemoved.addListener((id) => removed.push(id));
  const { id } = await chrome.windows.create({ url: "http://h/a.html" });
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(removed, []);
  assert.equal((await chrome.windows.get(id)).id, id);
});

test("windows.create returns before the openUrl promise resolves", async () => {
  let release;
  const gate = new Promise((r) => (release = r));
  const { chrome } = fresh(() => gate);
  const removed = [];
  chrome.windows.onRemoved.addListener((id) => removed.push(id));
  const { id } = await chrome.windows.create({ url: "http://h/a.html" });
  assert.equal((await chrome.windows.get(id)).id, id);
  assert.deepEqual(removed, []);
  release(false);
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(removed, [id]);
});
