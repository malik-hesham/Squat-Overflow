// End-to-end check of the menu bar app's hand-off to the Chrome extension.
//
// Loads extension/ into Chrome for Testing, then hands Chrome the app's Break now and Open settings
// URLs from outside, the way the app does (NSWorkspace → `open -a`), and checks what the extension
// does with them. Run: node macos/tests/journey.mjs
//   CHROME_APP     path to "Google Chrome for Testing.app" (default: newest Playwright/Puppeteer copy)
//   EXTENSION_DIR  extension to load (default: ../../extension)
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { createServer } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const extensionDir = process.env.EXTENSION_DIR ?? join(here, "../../extension");
const projectYml = readFileSync(join(here, "../project.yml"), "utf8");
const extensionId = projectYml.match(/SO_EXTENSION_ID:\s*"([a-p]{32})"/)?.[1];
assert.ok(extensionId, "SO_EXTENSION_ID not found in macos/project.yml");
// Must match Config.startURL / Config.optionsURL (pinned in ScheduleTests.swift).
const startURL = `chrome-extension://${extensionId}/start.html`;
const optionsURL = `chrome-extension://${extensionId}/options.html`;

function findChrome() {
  if (process.env.CHROME_APP) return process.env.CHROME_APP;
  const roots = [join(homedir(), "Library/Caches/ms-playwright"), join(homedir(), ".cache/puppeteer/chrome")];
  const found = [];
  for (const root of roots.filter(existsSync)) {
    for (const dir of readdirSync(root)) {
      for (const arch of ["chrome-mac-arm64", "chrome-mac-x64"]) {
        const app = join(root, dir, arch, "Google Chrome for Testing.app");
        if (existsSync(app)) found.push(app);
      }
    }
  }
  assert.ok(found.length, "Chrome for Testing not found; set CHROME_APP");
  return found.sort().at(-1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const app = findChrome();
const port = 9400 + Math.floor(Math.random() * 500);
const profile = mkdtempSync(join(tmpdir(), "so-journey-"));
const chrome = spawn(join(app, "Contents/MacOS/Google Chrome for Testing"), [
  `--user-data-dir=${profile}`, `--load-extension=${extensionDir}`, `--disable-extensions-except=${extensionDir}`,
  `--remote-debugging-port=${port}`, "--no-first-run", "--no-default-browser-check", "about:blank",
], { stdio: "ignore" });

const targets = async () => (await fetch(`http://127.0.0.1:${port}/json`)).json();
async function waitFor(what, test, ms = 10_000) {
  const end = Date.now() + ms;
  for (;;) {
    let list = [];
    try { list = await targets(); } catch {}
    const hit = test(list);
    if (hit) return hit;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}; targets: ${list.map((t) => t.url).join(", ")}`);
    await sleep(200);
  }
}
const pages = (list, path) => list.filter((t) => t.type === "page" && t.url.startsWith(`chrome-extension://${extensionId}/${path}`));
// What the app does: NSWorkspace.open(url, withApplicationAt: Chrome).
const openFromAnotherApp = (url) => execFileSync("open", ["-a", app, url]);

/** Runs `expression` in a page through the DevTools protocol (a renderer-side, website-like action). */
async function evaluate(target, expression) {
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((ok, fail) => { ws.onopen = ok; ws.onerror = fail; });
  const reply = new Promise((ok) => { ws.onmessage = (e) => ok(JSON.parse(e.data)); });
  ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression } }));
  const res = await reply;
  ws.close();
  return res;
}

let failed = false;
async function step(name, fn) {
  try {
    await fn();
    console.log(`ok ${name}`);
  } catch (err) {
    failed = true;
    console.log(`FAIL ${name}\n  ${err.message}`);
  }
}

try {
  await step("the loaded extension has the ID the app is built with", async () => {
    await waitFor(`the service worker of ${extensionId}`, (l) =>
      l.find((t) => t.type === "service_worker" && t.url.startsWith(`chrome-extension://${extensionId}/`)));
  });

  await step("a website can't open start.html to start a break", async () => {
    // A real http origin (an opaque data: page wouldn't match web_accessible_resources anyway).
    const server = createServer((_, res) => res.end("<!doctype html><title>website</title>"));
    await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
    try {
      const url = `http://127.0.0.1:${/** @type {any} */ (server.address()).port}/`;
      const site = await (await fetch(`http://127.0.0.1:${port}/json/new?${url}`, { method: "PUT" })).json();
      await waitFor("the website to load", (l) => l.some((t) => t.id === site.id && t.title === "website"));
      await evaluate(site, `location.href = ${JSON.stringify(startURL)}`);
      await sleep(2500);
      assert.deepEqual(pages(await targets(), "break.html").map((t) => t.url), []);
    } finally {
      server.close();
    }
  });

  await step("Break now: Chrome opens start.html, a break window opens, the start tab closes", async () => {
    openFromAnotherApp(startURL);
    const [win] = await waitFor("the break window", (l) => { const p = pages(l, "break.html"); return p.length && p; });
    assert.equal(win.url, `chrome-extension://${extensionId}/break.html#manual`); // same as the popup's Break now
    await waitFor("the start tab to close", (l) => pages(l, "start.html").length === 0 && true);
  });

  await step("Open settings: Chrome opens the extension's options page", async () => {
    const before = pages(await targets(), "options.html").length;
    openFromAnotherApp(optionsURL);
    const page = await waitFor("a new options page", (l) => { const p = pages(l, "options.html"); return p.length > before && p.at(-1); });
    await sleep(1000); // let options.js run
    const res = await evaluate(page, `document.getElementById("heading")?.textContent ?? ""`);
    assert.ok(res.result?.result?.value, "options page has no heading; did it load?");
  });
} finally {
  chrome.kill();
  await sleep(500);
  rmSync(profile, { recursive: true, force: true });
}
process.exitCode = failed ? 1 : 0;
