#!/usr/bin/env node
// Cross-device check (docs/plans/offline-first.md, item 12): an offline break on Chrome, the phone
// and the Mac each counts locally, uploads once when the network is back, and shows on the others.
//
//   cd server && npm run build && cd ..
//   PLAYWRIGHT=/path/to/playwright/index.mjs [CHROME=/path/to/chromium] node scripts/cross-device/run.mjs
//
// Needs Postgres's initdb/pg_ctl/psql on PATH, Playwright and a Chromium (as in extension/tests/e2e),
// Node, and Swift. Everything runs on this machine and is thrown away afterwards:
//  - a fresh Postgres database (its own data folder and port 55432);
//  - the real API server from server/dist on 127.0.0.1:18765 (api.mjs). Only Google's key check
//    is a local test key, so each client gets a real session from the server's own /auth/google;
//  - Chrome: the real extension in Chromium (chrome.mjs), from a temp copy whose config.js points
//    at that server;
//  - phone: mobile's real engine and sync code under Jest (mobile/src/core/__tests__/crossDevice.live.test.ts);
//  - Mac: SquatCore's real Engine and SyncClient under swift test (CrossDeviceLiveTests.swift).
// "Network off" means the API server is stopped. The clients take turns through files in <work>/sig.
import { execFileSync, spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const work = mkdtempSync(join(tmpdir(), "so-cross-device-"));
const PG_PORT = "55432";
const API = "http://127.0.0.1:18765";

const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
const failures = [];
const check = (ok, what) => {
  log(ok ? "ok  " : "FAIL", what);
  if (!ok) failures.push(what);
};
const sig = (n) => join(work, "sig", n);
const read = (n) => JSON.parse(readFileSync(sig(n), "utf8"));
const signal = (n) => writeFileSync(sig(n), "go");
const exited = []; // clients that stopped before the check ended
async function waitFor(n, ms = 240_000) {
  for (const end = Date.now() + ms; Date.now() < end; ) {
    if (exited.length) throw new Error(`${exited.join(", ")} exited early; see its output above`);
    for (const who of ["chrome", "phone", "mac"]) {
      if (existsSync(sig(`${who}-error`))) throw new Error(`${who}: ${readFileSync(sig(`${who}-error`), "utf8")}`);
    }
    if (existsSync(sig(n))) return read(n);
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`timed out waiting for ${n}`);
}

if (!process.env.PLAYWRIGHT) {
  console.error("Set PLAYWRIGHT to a Playwright install's index.mjs (and CHROME to a Chromium if it has none).");
  process.exit(2);
}
if (!existsSync(join(root, "server", "dist", "main.js"))) {
  console.error("Build the server first: cd server && npm run build");
  process.exit(2);
}

// ---- Postgres, in its own data folder. TCP only: the temp path can be too long for a Unix socket.
const pgEnv = { ...process.env, LANG: "en_US.UTF-8", LC_ALL: "en_US.UTF-8" };
const pgData = join(work, "pg");
execFileSync("initdb", ["-D", pgData, "-U", "postgres", "--auth=trust", "-E", "UTF8"], { env: pgEnv, stdio: "ignore" });
execFileSync("pg_ctl", ["-D", pgData, "-o", `-p ${PG_PORT} -c unix_socket_directories='' -c listen_addresses=127.0.0.1`, "-l", join(work, "pg.log"), "-w", "start"], { env: pgEnv, stdio: "ignore" });
execFileSync("createdb", ["-h", "127.0.0.1", "-p", PG_PORT, "-U", "postgres", "squat"]);
const sql = (q) => execFileSync("psql", ["-h", "127.0.0.1", "-p", PG_PORT, "-U", "postgres", "-d", "squat", "-At", "-c", q], { encoding: "utf8" }).trim();
const events = () => sql("select coalesce(string_agg(device || ':' || id, ',' order by seq), '') from break_events").split(",").filter(Boolean);

// ---- The API server, under this script's control: down = network off for every client.
let api = null;
async function apiUp() {
  api = spawn("node", [join(here, "api.mjs"), join(root, "server"), work], {
    env: { ...process.env, XD_DATABASE_URL: `postgres://postgres@127.0.0.1:${PG_PORT}/squat` },
    stdio: ["ignore", "pipe", "inherit"],
  });
  await new Promise((resolve, reject) => {
    api.stdout.on("data", (d) => String(d).includes("api up") && resolve());
    api.on("exit", (code) => reject(new Error(`api server exited with ${code}`)));
  });
  log("API server up");
}
function apiDown() {
  api.kill();
  log("API server down");
}

const children = [];
try {
  mkdirSync(join(work, "sig"));
  await apiUp();

  // The extension, pointed at this server instead of its default 127.0.0.1:8765.
  const ext = join(work, "ext");
  cpSync(join(root, "extension"), ext, { recursive: true, filter: (p) => !/\/(node_modules|tests|scripts)(\/|$)/.test(p) });
  const config = join(ext, "config.js");
  writeFileSync(config, readFileSync(config, "utf8").replace(/^export const API_URL = ".*";$/m, `export const API_URL = "${API}";`));

  // Own process groups, so the cleanup below also ends what npx and swift start.
  const env = { ...process.env, XD_DIR: work, XD_API: API };
  const clients = {
    chrome: spawn("node", [join(here, "chrome.mjs"), ext, work], { env, stdio: ["ignore", "inherit", "inherit"], detached: true }),
    phone: spawn("npx", ["jest", "src/core/__tests__/crossDevice.live.test.ts", "--testTimeout=900000"], { cwd: join(root, "mobile"), env, stdio: "ignore", detached: true }),
    mac: spawn("swift", ["test", "--filter", "CrossDeviceLiveTests"], { cwd: join(root, "macos", "SquatCore"), env, stdio: "ignore", detached: true }),
  };
  for (const [who, child] of Object.entries(clients)) {
    children.push(child);
    child.on("exit", () => existsSync(sig(`${who}-final-done`)) || exited.push(who));
  }

  for (const who of ["chrome", "phone", "mac"]) await waitFor(`${who}-ready`, 600_000);
  check(events().length === 0, "a fresh account: the server has no breaks yet");

  log("--- network off: one break on each device");
  apiDown();
  signal("go-offline");
  for (const who of ["chrome", "phone", "mac"]) {
    const off = await waitFor(`${who}-offline-done`);
    const { before, after } = off;
    log(`${who}: before ${JSON.stringify(before)}`);
    log(`${who}: after  ${JSON.stringify(after)}`);
    check(after.breaks === before.breaks + 1 && after.today === before.today + 1, `${who}: the offline break is in today's count right away`);
    check(after.outbox === 1, `${who}: the offline break waits in the outbox`);
    // The fake camera shows nobody, so Chrome's break scores 0 XP; the phone and the Mac report reps.
    if (who !== "chrome") check(after.xp > before.xp, `${who}: XP went up offline (${before.xp} -> ${after.xp})`);
    if (off.syncWhileOffline) check(off.syncWhileOffline.ok === false, `${who}: a sync attempt while offline fails and keeps the queue`);
  }
  check(events().length === 0, "while every device is offline the server has received nothing");

  log("--- back online, one device at a time");
  await apiUp();
  const expected = { phone: 1, chrome: 2, mac: 3 };
  for (const who of ["phone", "chrome", "mac"]) {
    signal(`${who}-sync`);
    const synced = await waitFor(`${who}-synced`);
    const ev = events();
    log(`${who}: ${JSON.stringify(synced.after)}  server: ${ev.length} breaks`);
    check(ev.length === expected[who], `${who}: its break uploaded once (server has ${ev.length})`);
    check(synced.after.outbox === 0, `${who}: outbox empty after sync`);
    check(synced.after.breaks === expected[who], `${who}: has the ${expected[who]} break(s) uploaded so far`);
  }

  log("--- final sync everywhere");
  for (const who of ["chrome", "phone", "mac"]) signal(`${who}-final`);
  for (const who of ["chrome", "phone", "mac"]) {
    const fin = await waitFor(`${who}-final-done`);
    log(`${who}: ${JSON.stringify(fin.after)}`);
    check(fin.after.breaks === 3 && fin.after.today === 3, `${who}: sees all 3 breaks, 3 today`);
    check(new Set(fin.after.devices).size === 3, `${who}: the breaks came from 3 devices (${[...new Set(fin.after.devices)].join(", ")})`);
  }
  const ev = events();
  check(
    ev.length === 3 && new Set(ev.map((e) => e.split(":")[1])).size === 3,
    `server: exactly 3 distinct breaks after every device synced twice (${ev.map((e) => e.split(":")[0]).join(", ")})`,
  );
  log("server:", sql("select 'xp=' || sum(xp) || ' breaks=' || count(*) from break_events"));
} catch (err) {
  failures.push(String(err.message ?? err));
  log("ERROR", err.message ?? err);
} finally {
  for (const c of children) {
    try {
      process.kill(-c.pid, "SIGTERM");
    } catch {}
  }
  api?.kill();
  // swift test runs xctest outside its process group; end a test still waiting on a signal.
  try {
    execFileSync("pkill", ["-f", "CrossDeviceLiveTests|crossDevice.live.test"]);
  } catch {}
  try {
    execFileSync("pg_ctl", ["-D", pgData, "-m", "fast", "stop"], { env: pgEnv, stdio: "ignore" });
  } catch {}
  rmSync(work, { recursive: true, force: true });
  log(failures.length ? `${failures.length} FAILED` : "ALL PASSED");
  process.exit(failures.length ? 1 : 0);
}
