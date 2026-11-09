import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const MAX_BODY = 1024 * 1024;

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".task": "application/octet-stream",
  ".wasm": "application/wasm", // the on-device pose model's runtime (lib/vendor/mediapipe); instantiateStreaming needs it
};

export function createServer({ webDir, shimPath, chrome, host, port, closeGraceMs = 4000 }) {
  const root = path.resolve(webDir);
  const token = crypto.randomBytes(24).toString("hex");
  let actualPort = port;
  let baseUrl = null;
  let server = null;
  let unsubscribeStorage = null;

  const sseClients = new Set(); // { res, wid, ping }
  const graceTimers = new Map(); // wid -> timer

  function widConnections(wid) {
    let n = 0;
    for (const c of sseClients) if (c.wid === wid) n++;
    return n;
  }

  function send(res, status, body, headers = {}) {
    res.writeHead(status, { "Cache-Control": "no-store", ...headers });
    res.end(body);
  }

  function sendJson(res, status, obj) {
    send(res, status, JSON.stringify(obj), { "Content-Type": "application/json; charset=utf-8" });
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      req.on("data", (chunk) => {
        size += chunk.length;
        if (size > MAX_BODY) {
          const err = new Error("too large");
          err.status = 413;
          reject(err);
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      req.on("error", reject);
    });
  }

  async function readJson(req) {
    const text = await readBody(req);
    if (!text) return {};
    return JSON.parse(text);
  }

  function injectShim(html) {
    const tag = '<script src="__shim.js"></script>';
    const m = /<head[^>]*>/i.exec(html);
    if (!m) return tag + html;
    const end = m.index + m[0].length;
    return html.slice(0, end) + tag + html.slice(end);
  }

  async function serveFile(res, filePath) {
    let data;
    try {
      const st = await fs.stat(filePath);
      if (!st.isFile()) return send(res, 404, "");
      data = await fs.readFile(filePath);
    } catch {
      return send(res, 404, "");
    }
    const ext = path.extname(filePath).toLowerCase();
    const type = CONTENT_TYPES[ext] || "application/octet-stream";
    if (ext === ".html") {
      return send(res, 200, injectShim(data.toString("utf8")), { "Content-Type": type });
    }
    send(res, 200, data, { "Content-Type": type });
  }

  async function serveStatic(res, decodedPath) {
    const target = path.resolve(root, "." + decodedPath);
    if (!target.startsWith(root + path.sep)) return send(res, 404, "");
    return serveFile(res, target);
  }

  function handleEvents(req, res, query) {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
    });
    res.write(": ok\n\n");

    const widParam = query.get("wid");
    const wid = widParam !== null && widParam !== "" ? Number(widParam) : null;
    const client = { res, wid, ping: null };
    client.ping = setInterval(() => {
      try {
        res.write(": ping\n\n");
      } catch {}
    }, 15000);
    client.ping.unref?.();
    sseClients.add(client);

    if (wid !== null && Number.isFinite(wid)) {
      const pending = graceTimers.get(wid);
      if (pending) {
        clearTimeout(pending);
        graceTimers.delete(wid);
      }
      host.windowSeen(wid);
    }

    res.on("close", () => {
      clearInterval(client.ping);
      sseClients.delete(client);
      if (wid === null || !Number.isFinite(wid)) return;
      if (widConnections(wid) > 0) return;
      if (graceTimers.has(wid)) return;
      const t = setTimeout(() => {
        graceTimers.delete(wid);
        if (widConnections(wid) === 0) host.windowClosed(wid);
      }, closeGraceMs);
      t.unref?.();
      graceTimers.set(wid, t);
    });
  }

  async function handleApi(req, res, route, query) {
    try {
      if (route === "/__api/message") {
        const msg = await readJson(req);
        const response = await host.dispatchMessage(msg);
        return sendJson(res, 200, { response: response === undefined ? null : response });
      }
      if (route === "/__api/storage/get") {
        const { keys } = await readJson(req);
        return sendJson(res, 200, await chrome.storage.local.get(keys));
      }
      if (route === "/__api/storage/set") {
        const { items } = await readJson(req);
        await chrome.storage.local.set(items || {});
        return sendJson(res, 200, { ok: true });
      }
      if (route === "/__api/storage/remove") {
        const { keys } = await readJson(req);
        await chrome.storage.local.remove(keys);
        return sendJson(res, 200, { ok: true });
      }
      if (route === "/__api/close") {
        await readBody(req).catch(() => "");
        host.windowClosed(Number(query.get("wid")));
        return sendJson(res, 200, { ok: true });
      }
      return send(res, 404, "");
    } catch (err) {
      if (err && err.status === 413) return send(res, 413, "");
      return sendJson(res, 500, { error: String((err && err.message) || err) });
    }
  }

  async function handle(req, res) {
    const allowedHosts = [`127.0.0.1:${actualPort}`, `localhost:${actualPort}`];
    if (!allowedHosts.includes(req.headers.host || "")) return send(res, 403, "");
    const origin = req.headers.origin;
    if (origin !== undefined) {
      const allowedOrigins = [`http://127.0.0.1:${actualPort}`, `http://localhost:${actualPort}`];
      if (!allowedOrigins.includes(origin)) return send(res, 403, "");
    }

    // Parse manually so dot segments are not normalized away before the checks.
    const rawUrl = req.url || "/";
    const qIdx = rawUrl.indexOf("?");
    const rawPath = qIdx === -1 ? rawUrl : rawUrl.slice(0, qIdx);
    const query = new URLSearchParams(qIdx === -1 ? "" : rawUrl.slice(qIdx + 1));
    if (!rawPath.startsWith("/")) return send(res, 404, "");
    const segEnd = rawPath.indexOf("/", 1);
    const firstSeg = segEnd === -1 ? rawPath.slice(1) : rawPath.slice(1, segEnd);
    if (firstSeg !== token) return send(res, 404, "");
    const route = segEnd === -1 ? "/" : rawPath.slice(segEnd);

    let decoded;
    try {
      decoded = decodeURIComponent(route);
    } catch {
      return send(res, 404, "");
    }
    if (decoded.includes("\0")) return send(res, 404, "");

    if (req.method === "POST") return handleApi(req, res, route, query);
    if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "");

    if (route === "/__shim.js") {
      try {
        const data = await fs.readFile(shimPath);
        return send(res, 200, data, { "Content-Type": CONTENT_TYPES[".js"] });
      } catch {
        return send(res, 404, "");
      }
    }
    if (route === "/__events") return handleEvents(req, res, query);
    if (route === "/" || route === "/index.html") return serveStatic(res, "/popup.html");
    return serveStatic(res, decoded);
  }

  function listen(p) {
    return new Promise((resolve, reject) => {
      const srv = http.createServer((req, res) => {
        handle(req, res).catch(() => {
          if (!res.headersSent) send(res, 500, "");
          else res.end();
        });
      });
      srv.once("error", reject);
      srv.listen(p, "127.0.0.1", () => {
        srv.removeListener("error", reject);
        resolve(srv);
      });
    });
  }

  async function start() {
    try {
      server = await listen(port);
    } catch (err) {
      if (err && err.code === "EADDRINUSE") server = await listen(0);
      else throw err;
    }
    actualPort = server.address().port;
    baseUrl = `http://127.0.0.1:${actualPort}/${token}`;

    unsubscribeStorage = host.onStorageChanged((changes) => {
      const payload = `data: ${JSON.stringify({ type: "storage", changes })}\n\n`;
      for (const c of sseClients) {
        try {
          c.res.write(payload);
        } catch {}
      }
    });
    return { port: actualPort, token, baseUrl };
  }

  async function stop() {
    if (unsubscribeStorage) {
      unsubscribeStorage();
      unsubscribeStorage = null;
    }
    for (const t of graceTimers.values()) clearTimeout(t);
    graceTimers.clear();
    for (const c of [...sseClients]) {
      clearInterval(c.ping);
      try {
        c.res.end();
      } catch {}
    }
    sseClients.clear();
    if (!server) return;
    const srv = server;
    server = null;
    await new Promise((resolve) => {
      srv.close(() => resolve());
      srv.closeAllConnections?.();
    });
  }

  return {
    start,
    stop,
    get baseUrl() {
      return baseUrl;
    },
    get port() {
      return actualPort;
    },
    get token() {
      return token;
    },
  };
}
