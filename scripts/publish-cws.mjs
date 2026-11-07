#!/usr/bin/env node
// Uploads a zip to an existing Chrome Web Store item and submits it for review,
// using the Chrome Web Store API v2 with a service account. No dependencies (Node 20+).
//
//   CWS_SERVICE_ACCOUNT_JSON='{"client_email": ..., "private_key": ...}' \
//   CWS_PUBLISHER_ID=... CWS_ITEM_ID=... \
//   node scripts/publish-cws.mjs dist/squat-overflow-0.4.0.zip
//
// The item must already exist: the API cannot create one, so the first upload, the
// store listing and the Privacy tab are done by hand in the Developer Dashboard.
// See docs/deployment.md.
import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";

const SCOPE = "https://www.googleapis.com/auth/chromewebstore";
const API = "https://chromewebstore.googleapis.com";
const POLL_MS = 5_000;
const POLL_LIMIT = 60; // 5 minutes
// The reference pages spell the in-progress state both ways; accept either.
const IN_PROGRESS = new Set(["IN_PROGRESS", "UPLOAD_IN_PROGRESS"]);

function fail(message) {
  console.error(`publish-cws: ${message}`);
  process.exit(1);
}

function env(name) {
  const value = process.env[name]?.trim();
  if (!value) fail(`${name} is not set`);
  return value;
}

const b64url = (text) => Buffer.from(text).toString("base64url");

// Service-account JWT bearer grant: https://developers.google.com/identity/protocols/oauth2/service-account#httprest
async function accessToken(key) {
  if (!key.client_email || !key.private_key) fail("CWS_SERVICE_ACCOUNT_JSON has no client_email/private_key");
  const tokenUri = key.token_uri || "https://oauth2.googleapis.com/token";
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64url(
    JSON.stringify({ iss: key.client_email, scope: SCOPE, aud: tokenUri, iat: now, exp: now + 600 }),
  )}`;
  const signature = createSign("RSA-SHA256").update(unsigned).sign(key.private_key, "base64url");
  const res = await fetch(tokenUri, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${signature}` }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) fail(`token exchange failed (HTTP ${res.status}): ${body.error_description || body.error || "no access_token"}`);
  return body.access_token;
}

async function call(token, method, url, { body, contentType } = {}) {
  const res = await fetch(url, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(contentType ? { "content-type": contentType } : {}) },
    body,
  });
  const text = await res.text();
  if (!res.ok) fail(`${method} ${url} -> HTTP ${res.status}: ${text}`);
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    fail(`${method} ${url} returned non-JSON: ${text.slice(0, 200)}`);
  }
}

const zipPath = process.argv[2] || fail("usage: node scripts/publish-cws.mjs <zip>");
let key;
try {
  key = JSON.parse(env("CWS_SERVICE_ACCOUNT_JSON"));
} catch {
  fail("CWS_SERVICE_ACCOUNT_JSON is not valid JSON");
}
const name = `publishers/${encodeURIComponent(env("CWS_PUBLISHER_ID"))}/items/${encodeURIComponent(env("CWS_ITEM_ID"))}`;
const token = await accessToken(key);

console.log(`Uploading ${zipPath} to ${name}`);
const upload = await call(token, "POST", `${API}/upload/v2/${name}:upload`, {
  body: readFileSync(zipPath),
  contentType: "application/zip",
});
let state = upload.uploadState;
for (let i = 0; IN_PROGRESS.has(state); i++) {
  if (i >= POLL_LIMIT) fail(`upload still processing after ${(POLL_LIMIT * POLL_MS) / 1000} s`);
  await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  state = (await call(token, "GET", `${API}/v2/${name}:fetchStatus`)).lastAsyncUploadState;
}
if (state !== "SUCCEEDED") fail(`upload ended in state ${state}: ${JSON.stringify(upload)}`);
console.log(`Uploaded${upload.crxVersion ? ` version ${upload.crxVersion}` : ""}`);

// DEFAULT_PUBLISH: goes live automatically once review approves it.
const published = await call(token, "POST", `${API}/v2/${name}:publish`, {
  body: JSON.stringify({ publishType: "DEFAULT_PUBLISH" }),
  contentType: "application/json",
});
for (const warning of published.warningInfo?.warnings ?? []) console.warn(`warning: ${warning.reason}: ${warning.description}`);
if (["REJECTED", "CANCELLED"].includes(published.state)) fail(`publish returned state ${published.state}`);
console.log(`Submitted: item state ${published.state}`);
