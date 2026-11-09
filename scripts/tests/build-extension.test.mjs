// node --test scripts/tests/   Builds the extension into a temp folder and checks the result.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const SCRIPT = new URL("../build-extension.mjs", import.meta.url).pathname;

/** Runs the build with `env` into a fresh dist folder; returns the result and that folder. */
function build(env = {}) {
  const dist = mkdtempSync(join(tmpdir(), "so-build-"));
  const { POSE_SERVER_URL, API_URL, ...rest } = process.env;
  const res = spawnSync(process.execPath, [SCRIPT], { env: { ...rest, DIST_DIR: dist, ...env }, encoding: "utf8" });
  return { ...res, dist, out: join(dist, "extension"), done: () => rmSync(dist, { recursive: true, force: true }) };
}
const read = (dir, file) => readFileSync(join(dir, file), "utf8");
const csp = (out) => JSON.parse(read(out, "manifest.json")).content_security_policy.extension_pages;
const walk = (dir) => readdirSync(dir, { recursive: true }).map(String);

test("with no API server, the build is local-only: no API URL, no loopback or server in the CSP", () => {
  const b = build();
  try {
    assert.equal(b.status, 0, b.stderr);
    assert.match(read(b.out, "config.js"), /^export const API_URL = "";$/m);
    assert.doesNotMatch(read(b.out, "config.js"), /POSE_SERVER_URL/);
    assert.doesNotMatch(csp(b.out), /127\.0\.0\.1|localhost|wss?:/);
    assert.match(csp(b.out), /'wasm-unsafe-eval'/);
    assert.ok(readdirSync(b.dist).some((f) => /^squat-overflow-.*\.zip$/.test(f)));
  } finally {
    b.done();
  }
});

test("the package carries the pose model and runtime, and none of the dev files", () => {
  const b = build();
  try {
    assert.equal(b.status, 0, b.stderr);
    for (const f of ["vision_bundle.mjs", "vision_wasm_internal.wasm", "pose_landmarker_lite.task"]) {
      assert.ok(existsSync(join(b.out, "lib/vendor/mediapipe", f)), f);
    }
    const files = walk(b.out);
    assert.deepEqual(files.filter((f) => /(^|\/)(tests|scripts|node_modules)(\/|$)|\.d\.m?ts$|package(-lock)?\.json$|tsconfig/.test(f)), []);
  } finally {
    b.done();
  }
});

test("with API_URL, sign-in and sync point at it and the CSP lets the pages reach it", () => {
  const b = build({ API_URL: "https://api.example.com" });
  try {
    assert.equal(b.status, 0, b.stderr);
    assert.match(read(b.out, "config.js"), /^export const API_URL = "https:\/\/api\.example\.com";$/m);
    assert.match(csp(b.out), /connect-src [^;]*https:\/\/api\.example\.com/);
    assert.doesNotMatch(csp(b.out), /127\.0\.0\.1|localhost/);
  } finally {
    b.done();
  }
});

test("API_URL must be https, and the old POSE_SERVER_URL is refused with a pointer to the change", () => {
  for (const env of [{ API_URL: "http://api.example.com" }, { API_URL: "not a url" }, { POSE_SERVER_URL: "wss://pose.example.com/ws" }]) {
    const b = build(env);
    try {
      assert.notEqual(b.status, 0, JSON.stringify(env));
      assert.match(b.stderr, /build-extension:/);
    } finally {
      b.done();
    }
  }
});
