import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "../src/host/server.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.join(here, "..", "web");
const shimPath = path.join(here, "..", "src", "host", "page-shim.js");

const closed = [];
const seen = [];
const storageListeners = new Set();
const host = {
  dispatchMessage: async (msg) => (msg.type === "echo" ? { got: msg } : undefined),
  windowSeen: (id) => seen.push(id),
  windowClosed: (id) => closed.push(id),
  onStorageChanged: (fn) => {
    storageListeners.add(fn);
    return () => storageListeners.delete(fn);
  },
};
let store = {};
const chrome = {
  storage: {
    local: {
      get: async () => store,
      set: async (items) => Object.assign(store, items),
      remove: async () => {},
    },
  },
};

let srv, info;
before(async () => {
  srv = createServer({ webDir, shimPath, chrome, host, port: 0, closeGraceMs: 50 });
  info = await srv.start();
});
after(() => srv.stop());

// Raw request so dot segments and Host are sent untouched.
function raw(p, { method = "GET", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port: info.port, path: p, method, headers: { Host: `127.0.0.1:${info.port}`, ...headers } },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString("utf8") }));
      },
    );
    req.on("error", reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

test("wrong token => 404", async () => {
  assert.equal((await raw("/nottoken/popup.html")).status, 404);
});

test("wrong Host => 403, wrong Origin => 403", async () => {
  assert.equal((await raw(`/${info.token}/popup.html`, { headers: { Host: "evil.com" } })).status, 403);
  assert.equal((await raw(`/${info.token}/popup.html`, { headers: { Origin: "http://evil.com" } })).status, 403);
  assert.equal((await raw(`/${info.token}/popup.html`, { headers: { Host: `localhost:${info.port}` } })).status, 200);
});

test("html gets shim injected after <head>", async () => {
  const r = await raw(`/${info.token}/popup.html`);
  assert.equal(r.status, 200);
  const m = /<head[^>]*>/i.exec(r.text);
  assert.ok(m);
  assert.equal(r.text.slice(m.index + m[0].length, m.index + m[0].length + 33), '<script src="__shim.js"></script>');
  assert.equal(r.headers["cache-control"], "no-store");
  const idx = await raw(`/${info.token}/`);
  assert.equal(idx.text, r.text);
});

test("static js, shim, and traversal", async () => {
  const xp = await raw(`/${info.token}/lib/xp.js`);
  assert.equal(xp.status, 200);
  assert.match(xp.headers["content-type"], /javascript/);
  const shim = await raw(`/${info.token}/__shim.js`);
  assert.equal(shim.status, 200);
  assert.match(shim.headers["content-type"], /javascript/);
  for (const p of ["/../../package.json", "/%2e%2e/%2e%2e/package.json", "/..%2f..%2fpackage.json", "/lib/", "/nope.js"]) {
    assert.equal((await raw(`/${info.token}${p}`)).status, 404, p);
  }
});

test("POST message round-trip and storage api", async () => {
  const post = (p, obj) =>
    raw(`/${info.token}${p}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(obj) });
  const r = await post("/__api/message", { type: "echo", n: 1 });
  assert.equal(r.status, 200);
  assert.deepEqual(JSON.parse(r.text), { response: { got: { type: "echo", n: 1 } } });
  assert.deepEqual(JSON.parse((await post("/__api/message", { type: "none" })).text), { response: null });
  assert.deepEqual(JSON.parse((await post("/__api/storage/set", { items: { a: 1 } })).text), { ok: true });
  assert.deepEqual(JSON.parse((await post("/__api/storage/get", { keys: "a" })).text), { a: 1 });
});

function sse(p) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port: info.port, path: p, headers: { Host: `127.0.0.1:${info.port}` } },
      (res) => {
        let buf = "";
        const waiters = [];
        res.setEncoding("utf8");
        res.on("data", (d) => {
          buf += d;
          waiters.splice(0).forEach((w) => w());
        });
        resolve({
          res,
          req,
          async until(re) {
            while (!re.test(buf)) await new Promise((r) => waiters.push(r));
            return buf;
          },
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

test("SSE receives storage change", async () => {
  const c = await sse(`/${info.token}/__events`);
  await c.until(/: ok/);
  for (const fn of storageListeners) fn({ k: { oldValue: 1, newValue: 2 } }, "local");
  const buf = await c.until(/"type":"storage"/);
  assert.match(buf, /data: \{"type":"storage","changes":\{"k":\{"oldValue":1,"newValue":2\}\}\}/);
  c.req.destroy();
});

test("SSE disconnect for a wid calls windowClosed after grace", async () => {
  const c = await sse(`/${info.token}/__events?wid=7`);
  await c.until(/: ok/);
  assert.ok(seen.includes(7));
  c.req.destroy();
  assert.ok(!closed.includes(7));
  await new Promise((r) => setTimeout(r, 200));
  assert.deepEqual(closed.filter((x) => x === 7), [7]);
});

test("SSE reconnect within grace cancels close", async () => {
  const a = await sse(`/${info.token}/__events?wid=8`);
  await a.until(/: ok/);
  a.req.destroy();
  const b = await sse(`/${info.token}/__events?wid=8`);
  await b.until(/: ok/);
  await new Promise((r) => setTimeout(r, 200));
  assert.ok(!closed.includes(8));
  b.req.destroy();
});

test("POST /__api/close calls windowClosed", async () => {
  const r = await raw(`/${info.token}/__api/close?wid=9`, { method: "POST", body: "" });
  assert.equal(r.status, 200);
  assert.ok(closed.includes(9));
});

test("the on-device pose model is served: WASM as application/wasm, the model as bytes", async () => {
  const base = `/${info.token}/lib/vendor/mediapipe`;
  const wasm = await raw(`${base}/vision_wasm_internal.wasm`);
  assert.equal(wasm.status, 200);
  assert.equal(wasm.headers["content-type"], "application/wasm"); // or instantiateStreaming refuses it
  const model = await raw(`${base}/pose_landmarker_lite.task`);
  assert.equal(model.status, 200);
  assert.equal(model.headers["content-type"], "application/octet-stream");
  assert.match((await raw(`${base}/vision_bundle.mjs`)).headers["content-type"], /^application\/javascript/);
});
