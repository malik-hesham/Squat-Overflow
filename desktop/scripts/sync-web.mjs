#!/usr/bin/env node
// Copies the extension's own files into desktop/web/, which the Tauri app embeds and serves to its
// windows. Nothing is rewritten except config.js's API_URL, so the desktop app runs the same pages,
// rules and pose code as the extension. shim/ adds the page that hosts service-worker.js.
//
//   node desktop/scripts/sync-web.mjs                                 local only: no sign-in, leaderboard or sync
//   API_URL=https://api.example.com node desktop/scripts/sync-web.mjs  with the API server for those
//
// The file filter and the API_URL rewrite follow scripts/build-extension.mjs.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DESKTOP = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(DESKTOP, "..", "extension");
const OUT = join(DESKTOP, "web");
const EXCLUDED = new Set(["tests", "scripts", "package.json", "package-lock.json", "tsconfig.json", "node_modules", "manifest.json", ".DS_Store"]);
const API_LINE = /^export const API_URL = ".*";$/gm;

function fail(message) {
  console.error(`sync-web: ${message}`);
  process.exit(1);
}

const apiUrl = process.env.API_URL ?? "";
let apiOrigin = "";
if (apiUrl) {
  try {
    apiOrigin = new URL(apiUrl).origin;
  } catch {
    fail(`API_URL is not a URL: ${apiUrl}`);
  }
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
cpSync(SRC, OUT, { recursive: true, filter: (path) => !EXCLUDED.has(basename(path)) && !/\.d\.m?ts$/.test(path) });
for (const file of ["background.html", "background.js"]) cpSync(join(DESKTOP, "shim", file), join(OUT, file));

const configPath = join(OUT, "config.js");
const config = readFileSync(configPath, "utf8");
const matches = config.match(API_LINE) ?? [];
if (matches.length !== 1) fail(`expected one API_URL line in config.js, found ${matches.length}`);
writeFileSync(configPath, config.replace(API_LINE, `export const API_URL = ${JSON.stringify(apiOrigin)};`));

console.log(`sync-web: copied extension/ to desktop/web/, ${apiOrigin ? `API server ${apiOrigin}` : "local only (no API server)"}`);
