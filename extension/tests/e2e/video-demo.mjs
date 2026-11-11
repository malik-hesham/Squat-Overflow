// End-to-end: a move with a demo video on the API server plays it in place of the drawn figure, on
// the break window and on the Practice page; a move with none keeps the figure.
//
//   PLAYWRIGHT=/path/to/playwright/index.mjs [CHROME=/path/to/chrome] node extension/tests/e2e/video-demo.mjs
//
// Needs Playwright (as break-offline.mjs does), a Chrome that plays H.264 (Chrome for Testing does)
// and ffmpeg. A small stand-in for the API server serves server/demos-style videos (the real route
// is pinned by server/test/server/demos.spec.ts), and a scratch copy of the extension points its
// API_URL at it. Only the Neck tension moves get a video.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, createReadStream, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

import { makeDemoVideo } from "../../scripts/make-demo-video.mjs";

const NECK = ["neck_tilt", "head_turn", "chin_to_chest", "shoulder_shrug", "chin_tuck", "levator_stretch"];
const { chromium } = await import(process.env.PLAYWRIGHT ?? "playwright");
const source = fileURLToPath(new URL("../..", import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), "so-video-demo-"));
const extension = join(scratch, "extension");
const demos = join(scratch, "server/demos");

// The videos: one clip of ffmpeg's test pattern, made by the real script, copied for each Neck move.
const clip = join(scratch, "clip.mp4");
execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc2=duration=3:size=1280x720:rate=30", "-pix_fmt", "yuv420p", clip]);
makeDemoVideo({ root: scratch, key: NECK[0], clip });
for (const key of NECK.slice(1)) cpSync(join(demos, `${NECK[0]}.mp4`), join(demos, `${key}.mp4`));

// The stand-in API server: GET /demos/<key>.mp4 with byte ranges, 404 for anything else.
const asked = [];
const api = createServer((req, res) => {
  asked.push(req.url);
  const file = /^\/demos\/([a-z0-9_]+\.mp4)$/.exec(req.url ?? "")?.[1];
  const path = file && join(demos, file);
  if (!path || !existsSync(path)) return res.writeHead(404).end();
  const size = statSync(path).size;
  const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? "");
  const [start, end] = range ? [Number(range[1]), range[2] ? Number(range[2]) : size - 1] : [0, size - 1];
  res.writeHead(range ? 206 : 200, {
    "Content-Type": "video/mp4",
    "Accept-Ranges": "bytes",
    "Content-Length": end - start + 1,
    ...(range ? { "Content-Range": `bytes ${start}-${end}/${size}` } : {}),
  });
  createReadStream(path, { start, end }).pipe(res);
});
await new Promise((r) => api.listen(0, "127.0.0.1", r));
const apiUrl = `http://127.0.0.1:${api.address().port}`;

cpSync(source, extension, { recursive: true, filter: (p) => !["node_modules", "tests", ".DS_Store"].includes(basename(p)) });
const config = join(extension, "config.js");
writeFileSync(config, readFileSync(config, "utf8").replace(/^export const API_URL = ".*";$/m, `export const API_URL = ${JSON.stringify(apiUrl)};`));

/** What the demo panel shows: the video (and whether it is playing), the canvas, the drag hint. */
const panel = (page, hint) =>
  page.evaluate((hintId) => {
    const video = /** @type {HTMLVideoElement} */ (document.getElementById("demoVideo"));
    const shown = (el) => !!el && !el.hidden && el.getClientRects().length > 0;
    return {
      video: shown(video) ? new URL(video.currentSrc).pathname : null,
      playing: !!video && !video.paused,
      label: video?.getAttribute("aria-label") ?? null,
      canvas: shown(document.getElementById("demoView")),
      hint: hintId ? shown(document.getElementById(hintId)) : null,
    };
  }, hint);
const playing = (page, path) =>
  page.waitForFunction(
    (p) => {
      const v = /** @type {HTMLVideoElement} */ (document.getElementById("demoVideo"));
      return !v.hidden && new URL(v.currentSrc).pathname === p && !v.paused && v.currentTime > 0.2;
    },
    path,
    { timeout: 10_000 },
  );

/** The extension's service worker. Polled: its "serviceworker" event may fire before anyone listens. */
async function extensionWorker(context) {
  for (const deadline = Date.now() + 15_000; Date.now() < deadline; ) {
    const worker = context.serviceWorkers().find((w) => w.url().startsWith("chrome-extension://"));
    if (worker) return worker;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("the extension's service worker never started");
}

const context = await chromium.launchPersistentContext(join(scratch, "profile"), {
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
  await worker.evaluate(() => chrome.storage.local.set({ setupDone: true, areas: ["Neck tension"], privacy: false, voice: false, memes: false }));
  const errors = [];

  // The break window: every move is a Neck move, so each one plays its video.
  const page = await context.newPage();
  page.on("pageerror", (err) => errors.push(err.message));
  await page.goto(`chrome-extension://${id}/break.html#manual`);
  const button = page.locator("#demo");
  await button.waitFor({ state: "visible", timeout: 60_000 });
  await button.click();
  await page.locator("#demoPanel").waitFor({ state: "visible", timeout: 5000 });
  const opened = await page.evaluate(() => new URL(/** @type {HTMLVideoElement} */ (document.getElementById("demoVideo")).src).pathname);
  assert.match(opened, /^\/demos\/[a-z_]+\.mp4$/);
  await playing(page, opened);
  const first = await panel(page, "demoHint");
  assert.equal(first.playing, true);
  assert.match(first.label, /^Demo video: /);
  assert.equal(first.canvas, false, "the drawn figure is hidden once the video plays");
  assert.equal(first.hint, false, "no 'drag to turn' under a video");
  await page.locator("#swap").click(); // another move: the open demo follows it
  await page.waitForFunction((src) => new URL(/** @type {HTMLVideoElement} */ (document.getElementById("demoVideo")).src).pathname !== src, opened);
  const next = await page.evaluate(() => new URL(/** @type {HTMLVideoElement} */ (document.getElementById("demoVideo")).src).pathname);
  await playing(page, next);
  await button.click();
  assert.equal(await page.locator("#demoPanel").isVisible(), false);
  assert.equal(await page.evaluate(() => /** @type {HTMLVideoElement} */ (document.getElementById("demoVideo")).paused), true, "hiding the demo stops the video");
  console.log(`ok break: a move's demo video plays in place of the figure (${opened}, then ${next} after a swap)`);
  await page.close();

  // The Practice page: a Neck move plays its video; Hip hinge has none, so the figure stays.
  const trainer = await context.newPage();
  trainer.on("pageerror", (err) => errors.push(err.message));
  await trainer.goto(`chrome-extension://${id}/trainer.html`);
  await trainer.locator("#exercise").selectOption("neck_tilt");
  await trainer.locator("#demoBtn").click();
  await trainer.locator("#demoPanel").waitFor({ state: "visible", timeout: 5000 });
  await playing(trainer, "/demos/neck_tilt.mp4");
  assert.equal((await panel(trainer, null)).canvas, false);
  await trainer.locator("#exercise").selectOption("hip_hinge");
  await trainer.waitForTimeout(1500); // the request for hip_hinge's video goes out and comes back 404
  const figure = await panel(trainer, null);
  assert.equal(figure.video, null, "no video for hip_hinge");
  assert.equal(figure.canvas, true, "so the figure shows");
  assert.deepEqual(errors, []);
  console.log("ok practice: neck_tilt plays its video; hip_hinge has none and keeps the figure");

  const outside = requests.filter((u) => !/^(chrome-extension|data|blob):/.test(u));
  assert.ok(outside.every((u) => u.startsWith(`${apiUrl}/demos/`)), `requests outside the extension: ${outside.join(", ")}`);
  assert.ok(asked.includes("/demos/hip_hinge.mp4"), "the page asked for hip_hinge's video (and got a 404)");
  console.log(`ok the only requests outside the extension were for demo videos (${new Set(asked).size} different)`);
} catch (err) {
  failed = true;
  console.log(`FAIL ${err.stack ?? err.message}`);
} finally {
  await context.close();
  api.close();
  rmSync(scratch, { recursive: true, force: true });
}
process.exitCode = failed ? 1 : 0;
