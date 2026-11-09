// Cross-device check (run.mjs starts this), Chrome client: the real extension in Chromium
// (Playwright), signed in with the test session, a break while the API server is down, then online
// on cue. Phases are driven by files in <work dir>/sig.
//   PLAYWRIGHT=... [CHROME=...] node chrome.mjs <extension copy> <work dir>
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [extension, xd] = process.argv.slice(2);
const { chromium } = await import(process.env.PLAYWRIGHT);
const sig = (name) => join(xd, "sig", name);
const report = (name, data) => writeFileSync(sig(name), JSON.stringify(data));
const waitFor = async (name, ms = 300_000) => {
  for (const end = Date.now() + ms; Date.now() < end; ) {
    if (existsSync(sig(name))) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`timed out waiting for ${name}`);
};

const body = JSON.parse(readFileSync(join(xd, "session-chrome.json"), "utf8"));
const session = {
  accessToken: body.access_token,
  refreshToken: body.refresh_token,
  expiresAt: Date.now() + body.expires_in * 1000,
  user: { id: body.user.id, email: body.user.email, name: "Cross Device", picture: "" },
};

const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "so-xd-")), {
  executablePath: process.env.CHROME,
  headless: true,
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
});
const requests = [];
context.on("request", (r) => requests.push(r.url()));
try {
  let worker;
  for (let i = 0; i < 150 && !worker; i++) {
    worker = context.serviceWorkers().find((w) => w.url().startsWith("chrome-extension://"));
    if (!worker) await new Promise((r) => setTimeout(r, 100));
  }
  const id = new URL(worker.url()).host;
  await worker.evaluate((s) => chrome.storage.local.set({ setupDone: true, areas: ["Neck tension"], voice: false, memes: false, auth: s }), session);
  await context.newPage(); // about:blank keeps the browser open while extension pages come and go
  const page = await context.newPage();
  await page.goto(`chrome-extension://${id}/popup.html`);
  // What the popup does on open: ask the service worker to sync. A fresh page each time.
  const sync = async () => {
    const p = await context.newPage();
    await p.goto(`chrome-extension://${id}/popup.html`);
    const result = await p.evaluate(() => chrome.runtime.sendMessage({ type: "sync" }));
    await p.close();
    return result;
  };
  const local = () =>
    worker.evaluate(async () => {
      const s = await chrome.storage.local.get(["profile", "breakLog", "syncOutbox"]);
      const today = new Date().toDateString();
      return {
        xp: s.profile?.xp ?? 0,
        streak: s.profile?.streak ?? 0,
        breaks: (s.breakLog ?? []).length,
        today: (s.breakLog ?? []).filter((e) => new Date(e.at).toDateString() === today).length,
        devices: (s.breakLog ?? []).map((e) => e.device ?? "chrome"),
        outbox: (s.syncOutbox ?? []).length,
      };
    });

  const first = await sync(); // first sync after sign-in: nothing to send yet
  report("chrome-ready", { result: first, local: await local() });

  // Network off: the API server is down (the orchestrator stopped it) and the browser is offline.
  await waitFor("go-offline");
  await context.setOffline(true);
  const before = await local();
  // Break now, as the popup does: the extension opens its own break window, which closes itself on Done.
  const opened = context.waitForEvent("page", { predicate: (p) => p.url().includes("/break.html") });
  await page.evaluate(() => chrome.runtime.sendMessage({ type: "break-now" }));
  const brk = await opened;
  await brk.waitForLoadState();
  await brk.waitForTimeout(4000); // the on-device model analyses frames; the fake camera has nobody in it
  await brk.locator("#done").click();
  await new Promise((r) => setTimeout(r, 1500)); // the window may already have closed itself
  report("chrome-offline-done", { before, after: await local() });

  await waitFor("chrome-sync");
  await context.setOffline(false);
  report("chrome-synced", { result: await sync(), after: await local() });

  await waitFor("chrome-final");
  report("chrome-final-done", { result: await sync(), after: await local(), apiRequests: requests.filter((u) => u.includes(":18765")).length });
} catch (err) {
  report("chrome-error", { error: String(err.stack ?? err) });
} finally {
  await Promise.race([context.close(), new Promise((r) => setTimeout(r, 5000))]);
  process.exit(0);
}
