#!/usr/bin/env node
// Makes an exercise's demo video: turns a short clip of someone doing a move into
// server/demos/<move>.mp4, which the API server serves at /demos/<move>.mp4. The break window, the
// Practice page, the desktop app and the phone play it in place of the drawn figure. Deploying the
// server (docs/aws-free-plan.md) publishes it. Needs ffmpeg (brew install ffmpeg).
//
//   node extension/scripts/make-demo-video.mjs seated_march ~/Movies/march.mov --from 1.2 --to 5.4
//   node extension/scripts/make-demo-video.mjs --remove seated_march
//
// Use footage you made, have written permission to use, or found under an open license that allows it
// (scrape-demo-videos.mjs finds those): the server publishes it. Film with the
// phone level, the person in the middle of the frame (the video keeps the middle square), the whole
// body in view and a plain wall behind, and trim to one rep (or one rep each side) so it loops cleanly.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { exerciseCatalog } from "../lib/pose/index.js";
import { DEMO_VIDEOS } from "../lib/demo-video.js";
import { licenseVerdict } from "./scrape-demo-videos.mjs";

/** A demo video is square, this many pixels a side: sharp in the break window's panel, still small. */
export const SIZE = 480;
/** One rep, or one each side: a demo is short. */
export const MAX_SECONDS = 8;
/** And small: the server sends one each time someone opens a demo. */
export const MAX_BYTES = 500 * 1024;
/** Smooth enough for a slow move; every frame costs bytes. */
const FPS = 24;
/** x264 quality (lower is sharper and bigger): clear at SIZE px, and a few hundred KB for one rep. */
const CRF = 28;

/** @param {number} bytes */
const kb = (bytes) => `${Math.round(bytes / 1024)} KB`;

/**
 * What an MP4 is, read from its boxes (nothing is decoded): the video track's size and codec, the
 * length, whether there is an audio track, and whether the index (moov) comes before the media
 * (mdat), so playback can start before the whole file has loaded ("fast start").
 * @param {Uint8Array} bytes
 */
export function mp4Info(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const fourcc = (at) => String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
  const short = () => new Error("the MP4 is cut short");
  /** The boxes between `start` and `end`, each with where its payload starts and where it ends. */
  const boxes = (start, end) => {
    const out = [];
    for (let at = start; at < end; ) {
      if (at + 8 > end) throw short();
      let size = view.getUint32(at);
      let head = 8;
      if (size === 1) {
        if (at + 16 > end) throw short();
        size = Number(view.getBigUint64(at + 8));
        head = 16;
      } else if (size === 0) size = end - at;
      if (size < head || at + size > end) throw short();
      out.push({ type: fourcc(at + 4), start: at + head, end: at + size });
      at += size;
    }
    return out;
  };
  const child = (box, type) => {
    const found = boxes(box.start, box.end).find((b) => b.type === type);
    if (!found) throw new Error(`the MP4 has no ${type} box`);
    return found;
  };

  if (bytes.length < 8 || fourcc(4) !== "ftyp") throw new Error("not an MP4");
  const top = boxes(0, bytes.length);
  const moov = top.find((b) => b.type === "moov");
  if (!moov) throw short();
  const mdat = top.findIndex((b) => b.type === "mdat");
  const mvhd = child(moov, "mvhd");
  const long = bytes[mvhd.start] === 1;
  const timescale = view.getUint32(mvhd.start + (long ? 20 : 12));
  const duration = long ? Number(view.getBigUint64(mvhd.start + 24)) : view.getUint32(mvhd.start + 16);
  const tracks = boxes(moov.start, moov.end)
    .filter((b) => b.type === "trak")
    .map((trak) => {
      const tkhd = child(trak, "tkhd");
      const size = tkhd.start + (bytes[tkhd.start] === 1 ? 88 : 76);
      const mdia = child(trak, "mdia");
      const stsd = child(child(child(mdia, "minf"), "stbl"), "stsd");
      return {
        handler: fourcc(child(mdia, "hdlr").start + 8),
        codec: fourcc(stsd.start + 12),
        width: view.getUint32(size) / 65536,
        height: view.getUint32(size + 4) / 65536,
      };
    });
  const video = tracks.find((t) => t.handler === "vide");
  if (!video) throw new Error("the MP4 has no video track");
  return {
    width: video.width,
    height: video.height,
    seconds: duration / timescale,
    codec: video.codec,
    audio: tracks.some((t) => t.handler === "soun"),
    faststart: mdat < 0 || top.indexOf(moov) < mdat,
  };
}

/**
 * What's wrong with the demo videos in a checkout's server/demos/, as lines to print (none when all
 * is well). Each file is <move>.mp4 for a catalog move: H.264 (every browser, WebView and phone plays
 * it), silent, SIZE×SIZE, at most MAX_SECONDS long and MAX_BYTES big, and able to start playing
 * before it has all loaded. Dotfiles (.gitkeep) are left alone: the server never serves them.
 * @param {string} root
 */
export function demoVideoProblems(root) {
  const dir = join(root, "server/demos");
  if (!existsSync(dir)) return [];
  const problems = [];
  for (const name of readdirSync(dir).filter((f) => !f.startsWith("."))) {
    const key = /^([a-z0-9_]+)\.mp4$/.exec(name)?.[1];
    if (!key) problems.push(`${name}: a demo is <move>.mp4`);
    else problems.push(...videoProblems(key, readFileSync(join(dir, name))));
  }
  return problems;
}

/**
 * Where server/demos/ and DEMO_VIDEOS (extension/lib/demo-video.js) disagree, as lines to print:
 * every video needs its entry (the apps ask only for listed moves, and show the credit under it),
 * every entry its video, and a credit says whose footage it is (title, author, an https link to the
 * original and to the license) under a license that lets us cut it and serve it.
 * @param {string} root
 * @param {Record<string, import("../lib/demo-video.js").DemoCredit | null>} [videos]
 */
export function demoCreditProblems(root, videos = DEMO_VIDEOS) {
  const dir = join(root, "server/demos");
  const files = existsSync(dir) ? readdirSync(dir).map((f) => /^([a-z0-9_]+)\.mp4$/.exec(f)?.[1]).filter(Boolean) : [];
  const https = (url) => /^https:\/\/\S+$/.test(url ?? "");
  const problems = [];
  for (const [key, credit] of Object.entries(videos)) {
    if (credit) {
      if (!credit.title?.trim()) problems.push(`${key}: its credit needs a title`);
      if (!credit.author?.trim()) problems.push(`${key}: its credit needs the author`);
      if (!https(credit.url)) problems.push(`${key}: its credit's link must be https`);
      const verdict = licenseVerdict(credit.license);
      if (!verdict.ok) problems.push(`${key}: ${verdict.reason}`);
      if (!https(credit.licenseUrl)) problems.push(`${key}: its credit needs an https link to the license`);
    }
    if (!files.includes(key)) problems.push(`${key}: DEMO_VIDEOS lists it, but server/demos has no ${key}.mp4`);
  }
  for (const key of files)
    if (!Object.prototype.hasOwnProperty.call(videos, key))
      problems.push(`${key}.mp4 has no entry in DEMO_VIDEOS (extension/lib/demo-video.js): add its credit, or null for our own footage`);
  return problems;
}

/**
 * What's wrong with one move's video.
 * @param {string} key
 * @param {Uint8Array} bytes
 */
function videoProblems(key, bytes) {
  const name = `${key}.mp4`;
  const problems = [];
  if (!isMove(key)) problems.push(`${name}: "${key}" is not a move in the catalog`);
  let info;
  try {
    info = mp4Info(bytes);
  } catch (err) {
    return [...problems, `${name}: ${err.message}`];
  }
  if (info.width !== SIZE || info.height !== SIZE) problems.push(`${name} is ${info.width}×${info.height}, not ${SIZE}×${SIZE}`);
  if (info.seconds > MAX_SECONDS) problems.push(`${name} is ${info.seconds.toFixed(1)} s, over ${MAX_SECONDS} s`);
  if (info.codec !== "avc1") problems.push(`${name} is ${info.codec}, not H.264 (avc1)`);
  if (info.audio) problems.push(`${name} has sound: a demo is silent`);
  if (!info.faststart) problems.push(`${name} can't start playing until it has all loaded (needs -movflags +faststart)`);
  if (bytes.length > MAX_BYTES) problems.push(`${name} is ${kb(bytes.length)}, over the ${kb(MAX_BYTES)} cap`);
  return problems;
}

/** @param {string} key */
const isMove = (key) => exerciseCatalog().some((e) => e.key === key);

/**
 * Turns `clip` (any video ffmpeg reads, e.g. a phone's .mov) into server/demos/<key>.mp4 under
 * `root`: `from`–`to` seconds of it, no sound, cropped to the middle square, SIZE px a side, FPS
 * frames a second, H.264 with the index first so it starts playing at once. A video that fails a
 * check (too long, too big) is not kept.
 * @param {{ root: string, key: string, clip: string, from?: number, to?: number }} opts
 */
export function makeDemoVideo({ root, key, clip, from, to }) {
  if (!isMove(key)) throw new Error(`"${key}" is not a move in the catalog`);
  if (!existsSync(clip)) throw new Error(`no clip at ${clip}`);
  const work = mkdtempSync(join(tmpdir(), "make-demo-video-"));
  try {
    const out = join(work, `${key}.mp4`);
    const trim = [...(from != null ? ["-ss", String(from)] : []), ...(to != null ? ["-to", String(to)] : [])];
    const picture = `fps=${FPS},crop='min(iw,ih)':'min(iw,ih)',scale=${SIZE}:${SIZE}:flags=lanczos,format=yuv420p`;
    const h264 = ["-c:v", "libx264", "-profile:v", "high", "-preset", "slow", "-crf", String(CRF), "-tag:v", "avc1"];
    execFileSync("ffmpeg", ["-v", "error", "-y", ...trim, "-i", clip, "-an", "-vf", picture, ...h264, "-movflags", "+faststart", out]);
    const bytes = readFileSync(out);
    const problems = videoProblems(key, bytes);
    if (problems.length) throw new Error(`${problems.join("\n")}\nShorten the clip with --from and --to (one rep is enough).`);
    mkdirSync(join(root, "server/demos"), { recursive: true });
    copyFileSync(out, join(root, "server/demos", `${key}.mp4`));
    return { ...mp4Info(bytes), bytes: bytes.length };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/**
 * Takes a move's video off the server (from the next deploy), so the move shows the drawn figure.
 * @param {{ root: string, key: string }} opts
 */
export function removeDemoVideo({ root, key }) {
  const file = join(root, "server/demos", `${key}.mp4`);
  if (!existsSync(file)) throw new Error(`${key} has no demo video`);
  rmSync(file);
}

/** A move's how-to that does one side, then the other: film a rep each side. */
const BOTH_SIDES = /each side|other side|then the other|switch sides/i;

/**
 * What to film for each move, from the catalog, by area: whether the person sits or stands, which
 * way they face the camera (the angle the pose model reads the move from), one rep or one each side,
 * any hold, and the how-to the apps show. A move with a video in `root`/server/demos is ticked.
 * @param {string} root
 */
export function shotList(root) {
  const moves = exerciseCatalog();
  const filmed = (key) => existsSync(join(root, "server/demos", `${key}.mp4`));
  const width = Math.max(...moves.map((m) => m.key.length));
  const lines = [
    `Demo videos: ${moves.filter((m) => filmed(m.key)).length} of ${moves.length} filmed. Film one rep (one each side where it says so)`,
    `in under ${MAX_SECONDS} s: phone level, the person in the middle of the frame (the video keeps the middle square),`,
    "the whole body in view, a plain wall behind. Then: node extension/scripts/make-demo-video.mjs <move> <clip>",
  ];
  let area = "";
  for (const move of moves) {
    if (move.category !== area) lines.push("", (area = move.category));
    const sides = BOTH_SIDES.test(move.how_to) ? 2 : 1;
    const plan = [
      move.stance,
      move.camera === "front" ? "facing the camera" : "side-on to the camera",
      sides === 2 ? "one rep each side" : "one rep",
      ...(move.hold > 0
        ? [`hold ${move.hold} s${sides * (move.hold + 2) > MAX_SECONDS ? ` (shorter on camera: the clip is at most ${MAX_SECONDS} s)` : ""}`]
        : []),
    ];
    lines.push(`  [${filmed(move.key) ? "x" : " "}] ${move.key.padEnd(width)} ${move.label}: ${plan.join(", ")}`, `      ${move.how_to}`);
  }
  return `${lines.join("\n")}\n`;
}

const USAGE = `usage:
  node extension/scripts/make-demo-video.mjs <move> <clip> [--from <s>] [--to <s>]   make a move's demo video
  node extension/scripts/make-demo-video.mjs --remove <move>                          back to the drawn figure
  node extension/scripts/make-demo-video.mjs --list                                   what to film for each move, and which have a video`;

/** @param {string[]} argv */
function main(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { from: { type: "string" }, to: { type: "string" }, remove: { type: "string" }, list: { type: "boolean" } },
  });
  const root = fileURLToPath(new URL("../..", import.meta.url));
  if (values.list) return void process.stdout.write(shotList(root));
  const seconds = (v) => {
    if (v == null) return undefined;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) throw new Error(`not a time in seconds: ${v}`);
    return n;
  };
  if (values.remove) {
    removeDemoVideo({ root, key: values.remove });
    console.log(`removed server/demos/${values.remove}.mp4`);
  } else if (positionals.length === 2) {
    const [key, clip] = positionals;
    const made = makeDemoVideo({ root, key, clip, from: seconds(values.from), to: seconds(values.to) });
    console.log(`server/demos/${key}.mp4: ${made.seconds.toFixed(1)} s, ${kb(made.bytes)}`);
  } else throw new Error(USAGE);
  const problems = demoVideoProblems(root);
  if (problems.length) throw new Error(problems.join("\n"));
  // Not an error yet: the entry comes next. Until it is there, the apps don't ask for the video.
  for (const line of demoCreditProblems(root)) console.warn(`to do: ${line}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
