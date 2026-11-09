// End-to-end: the Practice page (trainer.html) coaches on the device with the network off.
//
//   PLAYWRIGHT=/path/to/playwright/index.mjs [CHROME=/path/to/chrome] node extension/tests/e2e/trainer-offline.mjs
//
// Same setup as break-offline.mjs: unpacked extension, Chromium's fake camera (nobody in frame),
// browser offline, every request recorded. Start must reach "open", frames must come back from the
// on-device model, calibration must start recording, and nothing may leave the extension.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const { chromium } = await import(process.env.PLAYWRIGHT ?? "playwright");
const extension = fileURLToPath(new URL("../..", import.meta.url));
const profile = mkdtempSync(join(tmpdir(), "so-e2e-"));

const countFrames = () => {
  const seen = { frames: 0, calibration: null };
  Object.defineProperty(window, "__poseSeen", { value: seen });
  const dispatch = EventTarget.prototype.dispatchEvent;
  EventTarget.prototype.dispatchEvent = function (ev) {
    if (ev.type === "message" && ev.data?.type === "frame") {
      seen.frames++;
      if (ev.data.calibration) seen.calibration = ev.data.calibration.status;
    }
    return dispatch.call(this, ev);
  };
};

/** The extension's service worker. Polled: its "serviceworker" event may fire before anyone listens. */
async function extensionWorker(context) {
  for (const deadline = Date.now() + 15_000; Date.now() < deadline; ) {
    const worker = context.serviceWorkers().find((w) => w.url().startsWith("chrome-extension://"));
    if (worker) return worker;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("the extension's service worker never started");
}

const context = await chromium.launchPersistentContext(profile, {
  executablePath: process.env.CHROME,
  headless: true,
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
});
const requests = [];
context.on("request", (req) => requests.push(req.url()));
let failed = false;
try {
  const worker = await extensionWorker(context);
  const id = new URL(worker.url()).host;
  await worker.evaluate(() => chrome.storage.local.set({ setupDone: true }));
  await context.setOffline(true);
  await context.addInitScript(countFrames);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (err) => errors.push(err.message));
  await page.goto(`chrome-extension://${id}/trainer.html`);
  await page.locator("#startBtn").click();
  await page.waitForFunction(() => window.__poseSeen.frames >= 10 || document.getElementById("conn").dataset.state === "error", null, { timeout: 60_000 });
  const conn = await page.locator("#conn").getAttribute("data-state");
  assert.equal(conn, "open", `trainer says "${await page.locator("#connText").textContent()}"`);
  await page.locator("#calibBtn").click();
  await page.waitForFunction(() => window.__poseSeen.calibration === "recording", null, { timeout: 10_000 });
  assert.deepEqual(errors, []);
  const seen = await page.evaluate(() => window.__poseSeen.frames);
  console.log(`ok trainer: ${seen} frames analysed on the device, calibration recording`);
  const outside = requests.filter((u) => !/^(chrome-extension|data|blob):/.test(u));
  assert.deepEqual(outside, [], "requests left the extension");
  console.log(`ok nothing left the extension (${requests.length} requests)`);
} catch (err) {
  failed = true;
  console.log(`FAIL ${err.stack ?? err.message}`);
} finally {
  await context.close();
  rmSync(profile, { recursive: true, force: true });
}
process.exitCode = failed ? 1 : 0;
