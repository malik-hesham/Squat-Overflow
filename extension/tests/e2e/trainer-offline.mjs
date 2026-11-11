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

/** Content Security Policy refusals, recorded in the page (the human loads a model file and textures). */
const watchCsp = () => {
  const refused = [];
  Object.defineProperty(window, "__csp", { value: refused });
  addEventListener("securitypolicyviolation", (ev) => refused.push(`${ev.violatedDirective} ${ev.blockedURI}`));
};

/** Painted pixels on the demo canvas (WebGL for the human, read through a 2D copy). */
const painted = (page) =>
  page.evaluate(() => {
    const c = /** @type {HTMLCanvasElement} */ (document.getElementById("demoView"));
    const copy = Object.assign(document.createElement("canvas"), { width: c.width, height: c.height });
    const g = copy.getContext("2d");
    g.drawImage(c, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i]) n++;
    return n;
  });

/** Opens the demo beside the exercise picker; which renderer it got, once it has one. */
async function openDemo(page) {
  await page.locator("#demoBtn").click();
  await page.locator("#demoPanel").waitFor({ state: "visible", timeout: 5000 });
  await page.waitForFunction(() => document.getElementById("demoView").dataset.renderer, null, { timeout: 15_000 });
  await page.waitForTimeout(500);
  return page.locator("#demoView").getAttribute("data-renderer");
}

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
  await context.addInitScript(watchCsp);
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
  // The 3D demo opens next to the exercise picker: the Blender human, drawn with WebGL. It draws,
  // and follows a change of exercise.
  assert.equal(await openDemo(page), "human", "the demo should be the Blender human");
  assert.ok((await painted(page)) > 1000, "the demo drew nothing");
  const before = await page.locator("#demoView").getAttribute("aria-label");
  await page.locator("#exercise").selectOption("hip_hinge");
  assert.notEqual(await page.locator("#demoView").getAttribute("aria-label"), before);
  assert.equal(await page.locator("#demoBtn").textContent(), "Hide demo");
  assert.deepEqual(errors, []);
  assert.deepEqual(await page.evaluate(() => window.__csp), [], "the Content Security Policy refused something");
  console.log(`ok trainer: the Blender human plays offline (${await painted(page)} px)`);
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

// Without WebGL the demo is the flat mannequin, as before the human.
const flatProfile = mkdtempSync(join(tmpdir(), "so-e2e-"));
const flat = await chromium.launchPersistentContext(flatProfile, {
  executablePath: process.env.CHROME,
  headless: true,
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, "--disable-3d-apis"],
});
try {
  const worker = await extensionWorker(flat);
  await worker.evaluate(() => chrome.storage.local.set({ setupDone: true }));
  const page = await flat.newPage();
  const errors = [];
  page.on("pageerror", (err) => errors.push(err.message));
  await page.goto(`chrome-extension://${new URL(worker.url()).host}/trainer.html`);
  assert.equal(await openDemo(page), "2d", "without WebGL the demo should fall back to the flat mannequin");
  assert.ok((await painted(page)) > 1000, "the flat demo drew nothing");
  assert.deepEqual(errors, []);
  console.log(`ok trainer: without WebGL the flat mannequin plays (${await painted(page)} px)`);
} catch (err) {
  failed = true;
  console.log(`FAIL ${err.stack ?? err.message}`);
} finally {
  await flat.close();
  rmSync(flatProfile, { recursive: true, force: true });
}
process.exitCode = failed ? 1 : 0;
