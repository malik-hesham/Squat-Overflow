// End-to-end: a break runs on the device with the network off and no pose server.
//
//   PLAYWRIGHT=/path/to/playwright/index.mjs [CHROME=/path/to/chrome] node extension/tests/e2e/break-offline.mjs
//
// Needs Playwright (not a dependency of the repo; any recent install works) and a Chromium. It loads
// the unpacked extension, feeds Chromium's fake camera to break.html, takes the browser offline and
// records every request. The fake camera shows no person, so no reps count: the check is that
// frames keep coming back from the on-device model, the page never falls back to "coach offline",
// a privacy-mode frame carries its mask field, Done ends the break, and nothing leaves the extension.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const { chromium } = await import(process.env.PLAYWRIGHT ?? "playwright");
const extension = fileURLToPath(new URL("../..", import.meta.url));
const profile = mkdtempSync(join(tmpdir(), "so-e2e-"));

// Counts the pose replies the page receives, from outside the page's own code.
const countFrames = () => {
  const seen = { frames: 0, masks: 0, last: null };
  Object.defineProperty(window, "__poseSeen", { value: seen });
  const dispatch = EventTarget.prototype.dispatchEvent;
  EventTarget.prototype.dispatchEvent = function (ev) {
    if (ev.type === "message" && ev.data?.type === "frame") {
      seen.frames++;
      if ("mask" in ev.data) seen.masks++;
      seen.last = { exercise: ev.data.exercise, feedback: ev.data.feedback?.map((f) => f.code) };
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

/** Content Security Policy refusals, recorded in the page (the human loads a model file and textures). */
const watchCsp = () => {
  const refused = [];
  Object.defineProperty(window, "__csp", { value: refused });
  addEventListener("securitypolicyviolation", (ev) => refused.push(`${ev.violatedDirective} ${ev.blockedURI}`));
};

/** Painted pixels on the demo canvas (WebGL for the human, read through a 2D copy), and a fingerprint of them. */
const demoPixels = (page) =>
  page.evaluate(() => {
    const c = /** @type {HTMLCanvasElement} */ (document.getElementById("demoView"));
    const copy = Object.assign(document.createElement("canvas"), { width: c.width, height: c.height });
    const g = copy.getContext("2d");
    g.drawImage(c, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let painted = 0;
    let sum = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i]) (painted++, (sum = (sum + d[i - 3] * 7 + d[i - 2] * 3 + i) % 1e9));
    return { painted, sum };
  });

/** The 3D demo plays with the network off: it opens beside the camera, draws, moves, follows the move, and hides. */
async function checkDemo(page) {
  const button = page.locator("#demo");
  await button.waitFor({ state: "visible", timeout: 5000 });
  assert.equal(await button.textContent(), "▶ Watch demo");
  await button.click();
  await page.locator("#demoPanel").waitFor({ state: "visible", timeout: 5000 });
  assert.equal(await button.getAttribute("aria-expanded"), "true");
  await page.waitForFunction(() => document.getElementById("demoView").getAttribute("aria-label")?.startsWith("3D demo: "));
  // The Blender human (models/coach-01.glb), drawn with WebGL.
  await page.waitForFunction(() => document.getElementById("demoView").dataset.renderer, null, { timeout: 15_000 });
  assert.equal(await page.locator("#demoView").getAttribute("data-renderer"), "human", "the demo should be the Blender human");
  await page.waitForTimeout(500);
  const first = await demoPixels(page);
  assert.ok(first.painted > 2000, `the demo drew ${first.painted} pixels`);
  await page.waitForTimeout(700);
  assert.notEqual((await demoPixels(page)).sum, first.sum, "the figure should move");
  const label = await page.locator("#demoView").getAttribute("aria-label");
  await page.locator("#swap").click(); // another move: the open demo follows it
  await page.waitForFunction((l) => document.getElementById("demoView").getAttribute("aria-label") !== l, label);
  assert.equal(await page.locator("#demoPanel").isVisible(), true);
  await button.click();
  assert.equal(await page.locator("#demoPanel").isVisible(), false);
  assert.equal(await button.textContent(), "▶ Watch demo");
  assert.deepEqual(await page.evaluate(() => window.__csp), [], "the Content Security Policy refused something");
  console.log(`ok 3D demo offline: the Blender human drew ${first.painted} px, it moves, follows a swap and hides`);
}

const context = await chromium.launchPersistentContext(profile, {
  executablePath: process.env.CHROME,
  headless: true,
  args: [
    `--disable-extensions-except=${extension}`,
    `--load-extension=${extension}`,
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
  ],
});
const requests = [];
context.on("request", (req) => requests.push(req.url()));
let failed = false;
try {
  const worker = await extensionWorker(context);
  const id = new URL(worker.url()).host;
  await context.setOffline(true);
  await context.addInitScript(countFrames);
  await context.addInitScript(watchCsp);

  for (const privacy of [false, true]) {
    await worker.evaluate((p) => chrome.storage.local.set({ setupDone: true, privacy: p, privacyStyle: "blur", voice: false, memes: false }), privacy);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (err) => errors.push(err.message));
    await page.goto(`chrome-extension://${id}/break.html#manual`);
    // Ten frames, or the fallback screen ("coach offline", "camera unavailable", ...), whichever comes first.
    await page.waitForFunction(() => window.__poseSeen.frames >= 10 || !document.getElementById("fallback").hidden, null, { timeout: 60_000 });
    const seen = await page.evaluate(() => window.__poseSeen);
    const fallback = await page.locator("#fallback").isVisible();
    assert.equal(fallback, false, `break fell back to "${await page.locator("#fallbackTitle").textContent()}" after ${seen.frames} frames`);
    assert.deepEqual(seen.last.feedback, ["not_visible"]); // the fake camera has nobody in it
    assert.equal(seen.masks, privacy ? seen.frames : 0, "a privacy frame carries its mask field, a plain one doesn't");
    assert.deepEqual(errors, []);
    // One analysis per camera frame, not a busy loop over the same frame (the fake camera runs at 30 fps).
    const before = await page.evaluate(() => window.__poseSeen.frames);
    await page.waitForTimeout(2000);
    const rate = ((await page.evaluate(() => window.__poseSeen.frames)) - before) / 2;
    assert.ok(rate <= 35, `${rate} analyses a second for a 30 fps camera`);
    if (!privacy) await checkDemo(page);
    await page.locator("#done").click();
    await page.locator("#summary").waitFor({ state: "visible", timeout: 10_000 }).catch(() => {});
    console.log(`ok break (privacy ${privacy ? "on" : "off"}): frames analysed on the device at ${rate}/s, exercise ${seen.last.exercise}`);
    await page.close().catch(() => {});
  }
  const outside = requests.filter((u) => !/^(chrome-extension|data|blob):/.test(u));
  assert.deepEqual(outside, [], "requests left the extension");
  console.log(`ok nothing left the extension (${requests.length} requests, all chrome-extension://)`);
} catch (err) {
  failed = true;
  console.log(`FAIL ${err.stack ?? err.message}`);
} finally {
  await context.close();
  rmSync(profile, { recursive: true, force: true });
}
process.exitCode = failed ? 1 : 0;
