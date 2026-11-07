#!/usr/bin/env node
// Builds the Chrome Web Store package: dist/extension/ (loadable unpacked) and
// dist/squat-overflow-<version>.zip (what the store and GitHub Releases get).
//
//   node scripts/build-extension.mjs
//   POSE_SERVER_URL=wss://example.fly.dev/ws node scripts/build-extension.mjs
//
// Differences from the extension/ folder you load unpacked:
//  - config.js points at the hosted pose server instead of localhost;
//  - manifest.json has no "key" (the store rejects it on a first upload and assigns its own ID);
//  - tests/ and package.json are left out.
// Needs the `zip` CLI (preinstalled on macOS and GitHub's Ubuntu runners).
import { cpSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "extension");
const DIST = join(ROOT, "dist");
const OUT = join(DIST, "extension");
const DEFAULT_SERVER_URL = "wss://squat-overflow-pose.fly.dev/ws";
const EXCLUDED = new Set(["tests", "package.json", ".DS_Store"]);
const SERVER_LINE = /^export const POSE_SERVER_URL = ".*";$/gm;

function fail(message) {
  console.error(`build-extension: ${message}`);
  process.exit(1);
}

const serverUrl = process.env.POSE_SERVER_URL || DEFAULT_SERVER_URL;
let server;
try {
  server = new URL(serverUrl);
} catch {
  fail(`POSE_SERVER_URL is not a URL: ${serverUrl}`);
}
if (server.protocol !== "wss:") fail(`release builds need a wss:// pose server, got ${serverUrl}`);

rmSync(OUT, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });
cpSync(SRC, OUT, { recursive: true, filter: (path) => !EXCLUDED.has(basename(path)) });

const manifestPath = join(OUT, "manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
if (!/^\d+(\.\d+){0,3}$/.test(manifest.version ?? "")) fail(`manifest version "${manifest.version}" is not 1-4 dot-separated integers`);
delete manifest.key;
const csp = manifest.content_security_policy?.extension_pages ?? "";
const connectSrc = csp.match(/connect-src([^;]*)/)?.[1].trim().split(/\s+/) ?? [];
const origin = `${server.protocol}//${server.host}`;
if (!connectSrc.includes(origin)) {
  fail(`manifest CSP connect-src has no ${origin}; add it to extension/manifest.json or the extension can't reach the server`);
}
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

const configPath = join(OUT, "config.js");
const config = readFileSync(configPath, "utf8");
const matches = config.match(SERVER_LINE) ?? [];
if (matches.length !== 1) fail(`expected one POSE_SERVER_URL line in config.js, found ${matches.length}`);
writeFileSync(configPath, config.replace(SERVER_LINE, `export const POSE_SERVER_URL = ${JSON.stringify(serverUrl)};`));

const zipPath = join(DIST, `squat-overflow-${manifest.version}.zip`);
rmSync(zipPath, { force: true });
execFileSync("zip", ["-r", "-X", "-q", zipPath, "."], { cwd: OUT, stdio: "inherit" });

const kb = Math.round(statSync(zipPath).size / 1024);
console.log(`Built ${manifest.name} ${manifest.version} for ${serverUrl}`);
console.log(`  unpacked: ${OUT}`);
console.log(`  zip:      ${zipPath} (${kb} KB)`);
