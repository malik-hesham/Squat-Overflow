#!/usr/bin/env node
// Builds the Chrome Web Store package: dist/extension/ (loadable unpacked) and
// dist/squat-overflow-<version>.zip (what the store and GitHub Releases get).
//
//   node scripts/build-extension.mjs                                 local only: no sign-in, leaderboard or sync
//   API_URL=https://api.example.com node scripts/build-extension.mjs  with the API server for those
//
// The pose model runs in the extension, so a break never needs a server. API_URL is only for the
// optional Google sign-in, team leaderboard and cross-device sync (server/).
//
// Differences from the extension/ folder you load unpacked:
//  - config.js's API_URL is API_URL (or "" for a local-only build) instead of localhost;
//  - the manifest CSP's connect-src drops the localhost entries and gains API_URL's origin;
//  - manifest.json has no "key" (the store rejects it on a first upload and assigns its own ID);
//  - tests/, scripts/, package.json and the type-checking files (tsconfig.json, *.d.ts, *.d.mts,
//    node_modules/) are left out.
// DIST_DIR overrides where dist/ goes (the tests build into a temp folder).
// Needs the `zip` CLI (preinstalled on macOS and GitHub's Ubuntu runners).
import { cpSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "extension");
const DIST = process.env.DIST_DIR || join(ROOT, "dist");
const OUT = join(DIST, "extension");
const EXCLUDED = new Set(["tests", "scripts", "package.json", "package-lock.json", "tsconfig.json", "node_modules", ".DS_Store"]);
const API_LINE = /^export const API_URL = ".*";$/gm;
const LOOPBACK = /^https?:\/\/(127\.0\.0\.1|localhost)(:|$)/;

function fail(message) {
  console.error(`build-extension: ${message}`);
  process.exit(1);
}

if (process.env.POSE_SERVER_URL) {
  fail("POSE_SERVER_URL is gone: the pose model runs in the extension. Set API_URL=https://... for sign-in and sync, or nothing");
}
const apiUrl = process.env.API_URL ?? "";
let apiOrigin = "";
if (apiUrl) {
  let url;
  try {
    url = new URL(apiUrl);
  } catch {
    fail(`API_URL is not a URL: ${apiUrl}`);
  }
  if (url.protocol !== "https:") fail(`release builds need an https:// API server, got ${apiUrl}`);
  apiOrigin = url.origin;
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });
cpSync(SRC, OUT, { recursive: true, filter: (path) => !EXCLUDED.has(basename(path)) && !/\.d\.m?ts$/.test(path) });

const manifestPath = join(OUT, "manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
if (!/^\d+(\.\d+){0,3}$/.test(manifest.version ?? "")) fail(`manifest version "${manifest.version}" is not 1-4 dot-separated integers`);
delete manifest.key;
const csp = manifest.content_security_policy?.extension_pages ?? "";
if (!/connect-src[^;]*/.test(csp)) fail("manifest CSP has no connect-src");
manifest.content_security_policy.extension_pages = csp.replace(/connect-src([^;]*)/, (_, list) => {
  const sources = list.trim().split(/\s+/).filter((src) => !LOOPBACK.test(src));
  return `connect-src ${[...sources, ...(apiOrigin ? [apiOrigin] : [])].join(" ")}`;
});
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

const configPath = join(OUT, "config.js");
const config = readFileSync(configPath, "utf8");
const matches = config.match(API_LINE) ?? [];
if (matches.length !== 1) fail(`expected one API_URL line in config.js, found ${matches.length}`);
writeFileSync(configPath, config.replace(API_LINE, `export const API_URL = ${JSON.stringify(apiOrigin)};`));

const zipPath = join(DIST, `squat-overflow-${manifest.version}.zip`);
rmSync(zipPath, { force: true });
execFileSync("zip", ["-r", "-X", "-q", zipPath, "."], { cwd: OUT, stdio: "inherit" });

const kb = Math.round(statSync(zipPath).size / 1024);
console.log(`Built ${manifest.name} ${manifest.version}, ${apiOrigin ? `API server ${apiOrigin}` : "local only (no API server)"}`);
console.log(`  unpacked: ${OUT}`);
console.log(`  zip:      ${zipPath} (${kb} KB)`);
