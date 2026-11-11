#!/usr/bin/env node
// Finds openly licensed clips of each move to make its demo video from. It searches Wikimedia Commons
// (no key), and Pexels and Pixabay when PEXELS_API_KEY / PIXABAY_API_KEY are set (free keys:
// https://www.pexels.com/api/ and https://pixabay.com/api/docs/), through their APIs, not their pages:
// their terms allow the API, and the API says who made each clip and under what license.
//
//   node extension/scripts/scrape-demo-videos.mjs                     every move
//   node extension/scripts/scrape-demo-videos.mjs seated_march sit_to_stand --download 3
//
// It keeps a clip only when its license lets us trim it and ship it (licenseVerdict), it is about the
// move (relevance), it is short enough to hold one rep and big enough for a SIZE px square. It saves
// the best few to demo-sources/<move>/ (gitignored) with demo-sources/manifest.json (source page,
// author, license, whether it needs credit) and demo-sources/index.html to watch them side by side.
// Then make the demo video from the one you pick:
//
//   node extension/scripts/make-demo-video.mjs seated_march demo-sources/seated_march/pexels-123.mp4 --from 2 --to 6
//
// A clip under CC BY or CC BY-SA needs its credit shown wherever the video is; CC BY-SA also makes
// our trimmed video CC BY-SA. The manifest says which.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { exerciseCatalog } from "../lib/pose/index.js";
import { SIZE } from "./make-demo-video.mjs";

/**
 * Search terms for each move, most specific first. Stock libraries describe footage loosely, so
 * these say what the move looks like, not what we call it. A new move needs its terms here (the
 * checks fail until it has them).
 * @type {Record<string, string[]>}
 */
export const QUERIES = {
  neck_tilt: ["neck side stretch", "neck stretch"],
  head_turn: ["neck rotation stretch", "head turn neck exercise"],
  chin_to_chest: ["chin to chest neck stretch", "neck flexion stretch"],
  shoulder_shrug: ["shoulder shrugs", "shoulder shrug exercise"],
  chin_tuck: ["chin tuck exercise", "chin tuck posture"],
  levator_stretch: ["levator scapulae stretch", "neck stretch armpit"],
  cross_swing: ["arm swings warm up", "arm cross swing exercise"],
  wy_raise: ["wall angel exercise", "arm raise exercise"],
  shoulder_roll: ["shoulder rolls", "shoulder roll stretch"],
  thoracic_extension: ["chair back extension stretch", "thoracic extension stretch"],
  clasp_opener: ["chest opener stretch", "clasped hands behind back stretch"],
  shoulder_blade_squeeze: ["shoulder blade squeeze", "scapular retraction exercise"],
  seated_row: ["seated row exercise", "resistance band row"],
  t_raise: ["arms out to the side raise", "lateral arm raise exercise"],
  desk_punch: ["punching air exercise", "shadow boxing"],
  rhomboid_stretch: ["upper back stretch", "rhomboid stretch"],
  desk_row: ["one arm row exercise", "single arm row"],
  trunk_rotation: ["seated trunk rotation", "seated spinal twist"],
  scaption: ["scaption exercise", "arm raise exercise"],
  front_raise: ["front arm raise", "front raise exercise"],
  overhead_reach: ["overhead reach stretch", "arms overhead stretch"],
  external_rotation: ["shoulder external rotation exercise", "shoulder rotation exercise"],
  cross_body_stretch: ["cross body shoulder stretch", "shoulder stretch"],
  seated_jacks: ["seated jumping jacks", "chair jumping jacks"],
  seated_side_bend: ["seated side bend stretch", "chair side stretch"],
  knee_to_chest: ["seated knee to chest stretch", "knee hug stretch"],
  hip_hinge: ["hip hinge exercise", "hip hinge"],
  standing_side_bend: ["standing side bend stretch", "side bend stretch"],
  back_extension: ["standing back extension stretch", "standing backbend stretch"],
  seated_hip_hinge: ["seated forward bend stretch", "chair forward fold stretch"],
  wrist_flex: ["wrist flexion extension exercise", "wrist exercise"],
  extensor_stretch: ["wrist extensor stretch", "forearm stretch"],
  flexor_stretch: ["wrist flexor stretch", "forearm stretch"],
  prayer_stretch: ["prayer stretch wrists", "wrist prayer stretch"],
  nerve_glide: ["median nerve glide", "nerve glide exercise"],
  palm_flip: ["forearm rotation exercise", "palm flip exercise"],
  seated_knee_ext: ["seated leg extension chair", "seated knee extension exercise"],
  heel_slide: ["seated heel slide exercise", "heel slide exercise"],
  sit_to_stand: ["sit to stand exercise", "chair stand exercise"],
  mini_squat: ["mini squat exercise", "bodyweight squat"],
  hamstring_curl: ["standing hamstring curl", "standing leg curl exercise"],
  seated_march: ["seated marching exercise", "chair march exercise"],
  palming: ["eye palming", "palms over eyes relaxation"],
  temple_massage: ["temple massage", "massaging temples headache"],
  look_far: ["looking out window into distance", "looking into the distance"],
  near_far_focus: ["eye focus exercise", "near far focus eye exercise"],
  eye_track_vertical: ["eye tracking exercise thumb", "eye exercise"],
  eye_track_horizontal: ["eye movement exercise side to side", "eye exercise"],
};

/**
 * Whether a clip's license lets us trim it, crop it and serve it in the apps, and what it asks in
 * return. Non-commercial and no-derivatives licenses don't (the apps are a product, and we cut every
 * clip), and neither does anything we don't recognise.
 * @param {string | undefined} name a license's name as the source gives it: "CC BY-SA 4.0", "cc0", "Pexels License"
 * @returns {{ ok: boolean, credit?: boolean, shareAlike?: boolean, reason?: string }} credit and
 *   shareAlike when ok, the reason when not
 */
export function licenseVerdict(name) {
  const id = String(name ?? "").trim().toLowerCase().replace(/[\s_]+/g, "-");
  if (!id) return { ok: false, reason: "no license given" };
  if (/(^|-)nc(-|$)|non-?commercial/.test(id)) return { ok: false, reason: `${name}: non-commercial only` };
  if (/(^|-)nd(-|$)|no-?deriv/.test(id)) return { ok: false, reason: `${name}: no derivatives (we trim and crop every clip)` };
  if (/^(cc0|cc-zero|pd|public-domain)(-|$)/.test(id)) return { ok: true, credit: false, shareAlike: false };
  if (id === "pexels-license" || id === "pixabay-content-license") return { ok: true, credit: false, shareAlike: false };
  if (/^cc-by(-sa)?(-\d|$)/.test(id)) return { ok: true, credit: true, shareAlike: id.startsWith("cc-by-sa") };
  return { ok: false, reason: `${name}: not a license we take` };
}

/** Words that say nothing about the move. */
const STOP_WORDS = new Set(["a", "an", "and", "at", "for", "her", "his", "in", "into", "of", "on", "or", "the", "to", "while", "with", "your"]);

/**
 * A text's words, folded so "stretches", "stretching" and "stretch" are one word.
 * @param {string} text
 */
function words(text) {
  return String(text ?? "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w))
    .map((w) => {
      if (w.length > 5 && w.endsWith("ing")) w = w.slice(0, -3);
      if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) w = w.slice(0, -1);
      if (w.length > 3 && w.endsWith("e")) w = w.slice(0, -1);
      return w;
    });
}

/**
 * How well a clip's title and tags match a search, 0 to 1: the share of the search's words they
 * carry, or 0 when that is under half (or a single word of a longer search: "neck" alone isn't a neck
 * stretch). Stock search ranks loosely, so this is what keeps "Neck nanowire" out.
 * @param {string} query
 * @param {string} text
 */
export function relevance(query, text) {
  const wanted = [...new Set(words(query))];
  const have = new Set(words(text));
  const found = wanted.filter((w) => have.has(w)).length;
  if (!wanted.length || found / wanted.length < 0.5 || (wanted.length > 1 && found < 2)) return 0;
  return found / wanted.length;
}

/** A clip longer than this is rarely one move: a demo is one rep, under MAX_SECONDS. */
export const MAX_SOURCE_SECONDS = 60;
/** Clips bigger than this aren't worth fetching to cut a few hundred KB out of. */
export const MAX_SOURCE_BYTES = 50 * 1024 * 1024;

/**
 * @typedef {object} Clip  a video a source offers, the same shape whatever the source
 * @property {string} source "wikimedia", "pexels" or "pixabay"
 * @property {string} id the source's id for it
 * @property {string} title
 * @property {string} text what relevance() reads: its title, tags or description
 * @property {string} pageUrl where a person sees it, its author and its license
 * @property {string} fileUrl the file we'd fetch
 * @property {string} ext
 * @property {number} width
 * @property {number} height
 * @property {number | null} seconds
 * @property {number | null} bytes null when the source doesn't say
 * @property {string} author
 * @property {string} authorUrl
 * @property {string} license
 * @property {string} licenseUrl
 * @property {string} note anything the source flags about using it
 */

const EXTENSIONS = { "video/webm": "webm", "video/ogg": "ogv", "video/mp4": "mp4", "video/mpeg": "mpg", "video/quicktime": "mov" };

/** @param {string} html */
const plain = (html) => String(html ?? "").replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/\s+/g, " ").trim();

/**
 * Of several renditions of one video, the smallest that still fills a SIZE px square (less to fetch,
 * nothing lost), or the biggest when none does.
 * @param {any[]} renditions each with a width and height, in pixels
 * @returns {any}
 */
function bestRendition(renditions) {
  const sized = renditions.filter((r) => r.width > 0 && r.height > 0).sort((a, b) => a.width * a.height - b.width * b.height);
  return sized.find((r) => Math.min(r.width, r.height) >= SIZE) ?? sized.at(-1);
}

/**
 * The videos in a Commons search (generator=search, prop=imageinfo with extmetadata, formatversion=2),
 * in search order.
 * @param {any} json
 * @returns {Clip[]}
 */
export function parseWikimedia(json) {
  const pages = [...(json?.query?.pages ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  return pages.flatMap((page) => {
    const info = page.imageinfo?.[0];
    if (!info?.mime?.startsWith("video/")) return [];
    const meta = (key) => String(info.extmetadata?.[key]?.value ?? "");
    const title = plain(meta("ObjectName")) || String(page.title).replace(/^File:/, "").replace(/\.[a-z0-9]+$/i, "");
    const file = new URL(info.url);
    for (const key of [...file.searchParams.keys()]) if (key.startsWith("utm_")) file.searchParams.delete(key);
    const href = /href="([^"]+)"/.exec(meta("Artist"))?.[1] ?? "";
    const restrictions = meta("Restrictions");
    return [{
      source: "wikimedia",
      id: String(page.pageid),
      title,
      text: title,
      pageUrl: info.descriptionurl,
      fileUrl: file.toString(),
      ext: EXTENSIONS[info.mime] ?? "video",
      width: info.width,
      height: info.height,
      seconds: info.duration ?? null,
      bytes: info.size ?? null,
      author: plain(meta("Artist")),
      authorUrl: href.startsWith("//") ? `https:${href}` : href,
      license: meta("NonFree") === "true" ? "non-free" : meta("LicenseShortName") || meta("License"),
      licenseUrl: meta("LicenseUrl"),
      note: restrictions ? `Commons restrictions: ${restrictions} (see the file page)` : "",
    }];
  });
}

/**
 * The videos in a Pexels search (GET /v1/videos/search). Pexels gives no title; the page's address
 * describes the video, so that stands in.
 * @param {any} json
 * @returns {Clip[]}
 */
export function parsePexels(json) {
  return (json?.videos ?? []).flatMap((video) => {
    const file = bestRendition((video.video_files ?? []).filter((f) => f.file_type === "video/mp4"));
    if (!file) return [];
    const title = (/\/video\/(.+?)-\d+\/?$/.exec(video.url)?.[1] ?? "").replace(/-/g, " ");
    return [{
      source: "pexels",
      id: String(video.id),
      title,
      text: title,
      pageUrl: video.url,
      fileUrl: file.link,
      ext: "mp4",
      width: file.width,
      height: file.height,
      seconds: video.duration ?? null,
      bytes: null,
      author: video.user?.name ?? "",
      authorUrl: video.user?.url ?? "",
      license: "Pexels License",
      licenseUrl: "https://www.pexels.com/license/",
      note: "",
    }];
  });
}

/**
 * The videos in a Pixabay search (GET /api/videos/). Its tags are the only description it gives.
 * @param {any} json
 * @returns {Clip[]}
 */
export function parsePixabay(json) {
  return (json?.hits ?? []).flatMap((hit) => {
    const file = bestRendition(["tiny", "small", "medium", "large"].map((k) => hit.videos?.[k]).filter((r) => r?.url));
    if (!file) return [];
    return [{
      source: "pixabay",
      id: String(hit.id),
      title: hit.tags ?? "",
      text: hit.tags ?? "",
      pageUrl: hit.pageURL,
      fileUrl: file.url,
      ext: "mp4",
      width: file.width,
      height: file.height,
      seconds: hit.duration ?? null,
      bytes: file.size || null,
      author: hit.user ?? "",
      authorUrl: `https://pixabay.com/users/${hit.user}-${hit.user_id}/`,
      license: "Pixabay Content License",
      licenseUrl: "https://pixabay.com/service/license-summary/",
      note: "",
    }];
  });
}

/** @param {number} bytes */
const mb = (bytes) => `${Math.round(bytes / 1024 / 1024)} MB`;

/**
 * @typedef {Clip & { score: number, credit: boolean, shareAlike: boolean }} Ranked
 */

/**
 * Of the clips a search found, the ones worth making a demo from, best first (most on topic, then
 * shortest, then smallest), and why each of the rest isn't.
 * @param {string} query
 * @param {Clip[]} clips
 * @returns {{ kept: Ranked[], dropped: { source: string, id: string, title: string, reason: string }[] }}
 */
export function rankCandidates(query, clips) {
  /** @type {Ranked[]} */
  const kept = [];
  const dropped = [];
  for (const clip of clips) {
    const license = licenseVerdict(clip.license);
    const score = relevance(query, clip.text);
    const reason =
      !license.ok ? license.reason
      : clip.seconds != null && clip.seconds > MAX_SOURCE_SECONDS ? `${Math.round(clip.seconds)} s long: a demo is one rep`
      : Math.min(clip.width, clip.height) < SIZE ? `${clip.width}×${clip.height}: too small for a ${SIZE} px square`
      : clip.bytes != null && clip.bytes > MAX_SOURCE_BYTES ? `${mb(clip.bytes)}: too big to fetch`
      : score === 0 ? "not about the move"
      : null;
    if (reason) dropped.push({ source: clip.source, id: clip.id, title: clip.title, reason });
    else if (license.ok) kept.push({ ...clip, score, credit: license.credit, shareAlike: license.shareAlike });
  }
  return { kept: kept.sort(better), dropped };
}

const LAST = Number.POSITIVE_INFINITY;
/** Best first: most on topic, then shortest (closest to one rep), then smallest. @param {Ranked} a @param {Ranked} b */
const better = (a, b) => b.score - a.score || (a.seconds ?? LAST) - (b.seconds ?? LAST) || (a.bytes ?? LAST) - (b.bytes ?? LAST);

/** Every request says what sends it (Wikimedia asks for that). Nothing about who runs it. */
const USER_AGENT = "demo-video-scraper/1.0 (Node.js)";
/** A pause before every request: the APIs are for people's searches, not floods (Pexels allows 200 an hour). */
export const PAUSE_MS = 1000;
/** Commons throttles a dozen quick searches; one every few seconds it takes. */
const COMMONS_PAUSE_MS = 3000;
/** A source that answers 429 with a Retry-After up to this is waited for once; longer, it is left for this run. */
const MAX_WAIT_S = 120;
/** Searches are kept this long (Pixabay asks for a day) and asked again after. */
const CACHE_MS = 24 * 60 * 60 * 1000;

/**
 * Each source: the API key it needs (none for Commons), how to ask it for videos, and how to read the
 * answer. `shown` is the request without the key: what the cache and the messages use.
 * @type {Record<string, { key: string | null, signup?: string, pause: number, request: (term: string, count: number, key: string) => { url: string, shown: string, headers: Record<string, string> }, parse: (json: any) => Clip[] }>}
 */
const SOURCES = {
  wikimedia: {
    key: null,
    pause: COMMONS_PAUSE_MS,
    request: (term, count) => {
      const url = `https://commons.wikimedia.org/w/api.php?${new URLSearchParams({
        action: "query", format: "json", formatversion: "2", generator: "search", gsrnamespace: "6", gsrlimit: String(count),
        gsrsearch: `${term} filetype:video`, prop: "imageinfo", iiprop: "url|size|mime|extmetadata",
        iiextmetadatafilter: "ObjectName|Artist|LicenseShortName|License|LicenseUrl|Restrictions|NonFree",
      })}`;
      return { url, shown: url, headers: {} };
    },
    parse: parseWikimedia,
  },
  pexels: {
    key: "PEXELS_API_KEY",
    signup: "https://www.pexels.com/api/",
    pause: PAUSE_MS,
    request: (term, count, key) => {
      const url = `https://api.pexels.com/v1/videos/search?${new URLSearchParams({ query: term, per_page: String(count) })}`;
      return { url, shown: url, headers: { Authorization: key } };
    },
    parse: parsePexels,
  },
  pixabay: {
    key: "PIXABAY_API_KEY",
    signup: "https://pixabay.com/api/docs/",
    pause: PAUSE_MS,
    request: (term, count, key) => {
      const query = new URLSearchParams({ q: term, per_page: String(Math.max(3, count)), safesearch: "true" });
      const shown = `https://pixabay.com/api/videos/?${query}`;
      return { url: `https://pixabay.com/api/videos/?key=${encodeURIComponent(key)}&${query}`, shown, headers: {} };
    },
    parse: parsePixabay,
  },
};

/**
 * @typedef {Ranked & { query: string, file: string | null }} SavedClip  file: where it is under the
 *   output folder, or null when it is listed but not fetched
 * @typedef {{ updated: string, moves: Record<string, { label: string, searched: string[], clips: SavedClip[], dropped: number }>, skipped: string[], problems: string[] }} Manifest
 */

/**
 * Searches each source for each move's terms, keeps the best `keep` clips per move, fetches the top
 * `download` of them into `out`/<move>/, and writes `out`/manifest.json and `out`/index.html (after
 * each move, so a stopped run keeps what it found). Moves an earlier run found and this one didn't
 * search stay in the manifest. A source with no key is skipped; a failed search or fetch is noted in
 * `problems` and the run goes on.
 * @param {{
 *   out: string, moves?: string[], sources?: string[], env?: Record<string, string | undefined>,
 *   fetch?: typeof globalThis.fetch, now?: () => number, sleep?: (ms: number) => Promise<void>,
 *   perSearch?: number, keep?: number, download?: number, dir?: string, log?: (line: string) => void,
 * }} opts dir: how the review page names `out` in its commands, from the repository root
 * @returns {Promise<Manifest>}
 */
export async function scrapeDemoVideos({
  out, moves, sources = Object.keys(SOURCES), env = process.env, fetch = globalThis.fetch, now = Date.now,
  sleep = (ms) => new Promise((done) => setTimeout(done, ms)), perSearch = 15, keep = 5, download = 2, dir = "demo-sources", log = () => {},
}) {
  const catalog = exerciseCatalog();
  const keys = moves?.length ? moves : catalog.map((e) => e.key);
  for (const key of keys) if (!catalog.some((e) => e.key === key)) throw new Error(`"${key}" is not a move in the catalog`);
  for (const name of sources) if (!SOURCES[name]) throw new Error(`no source "${name}" (there are ${Object.keys(SOURCES).join(", ")})`);

  /** @type {string[]} */
  const skipped = [];
  /** @type {string[]} */
  const problems = [];
  const active = sources.filter((name) => {
    const { key, signup } = SOURCES[name];
    if (key && !env[key]) skipped.push(`${name}: set ${key} to search it (a free key: ${signup})`);
    return !key || Boolean(env[key]);
  });
  /** Sources that said to slow down: not asked again this run. */
  const stopped = new Set();
  /** @param {string} url @param {Record<string, string>} [headers] @param {number} [pause] */
  const get = async (url, headers = {}, pause = PAUSE_MS) => {
    await sleep(pause);
    return fetch(url, { headers: { "User-Agent": USER_AGENT, ...headers } });
  };

  /** A source's clips for a term, from the cache when it is under a day old. */
  const search = async (name, term) => {
    const source = SOURCES[name];
    const request = source.request(term, perSearch, env[source.key] ?? "");
    const cached = join(out, ".cache", name, `${createHash("sha1").update(request.shown).digest("hex")}.json`);
    if (existsSync(cached)) {
      const { fetched, body } = JSON.parse(readFileSync(cached, "utf8"));
      if (now() - fetched < CACHE_MS) return source.parse(body);
    }
    if (stopped.has(name)) return [];
    try {
      let res = await get(request.url, request.headers, source.pause);
      const wait = Number(res.headers.get("retry-after"));
      if (res.status === 429 && wait > 0 && wait <= MAX_WAIT_S) {
        await res.body?.cancel();
        await sleep(wait * 1000);
        res = await get(request.url, request.headers, source.pause);
      }
      if (res.status === 429) {
        await res.body?.cancel();
        stopped.add(name);
        problems.push(`${name}: rate limited; run again later (the searches so far are kept for a day)`);
        return [];
      }
      if (!res.ok) {
        await res.body?.cancel();
        problems.push(`${name} "${term}": HTTP ${res.status}`);
        return [];
      }
      const body = await res.json();
      mkdirSync(dirname(cached), { recursive: true });
      writeFileSync(cached, JSON.stringify({ fetched: now(), url: request.shown, body }));
      return source.parse(body);
    } catch (err) {
      problems.push(`${name} "${term}": ${err.message}`);
      return [];
    }
  };

  /** Fetches a clip to `path`; false (and a note) when it can't or it is too big. */
  const fetchClip = async (clip, path) => {
    const name = `${clip.source}-${clip.id}`;
    try {
      const res = await get(clip.fileUrl);
      if (!res.ok) {
        await res.body?.cancel();
        problems.push(`${name}: HTTP ${res.status}`);
        return false;
      }
      const length = Number(res.headers.get("content-length"));
      if (length > MAX_SOURCE_BYTES) {
        await res.body?.cancel();
        problems.push(`${name}: ${mb(length)}: too big to fetch`);
        return false;
      }
      const bytes = Buffer.from(await res.arrayBuffer());
      if (bytes.length > MAX_SOURCE_BYTES) {
        problems.push(`${name}: ${mb(bytes.length)}: too big to fetch`);
        return false;
      }
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(`${path}.part`, bytes);
      renameSync(`${path}.part`, path);
      return true;
    } catch (err) {
      rmSync(`${path}.part`, { force: true });
      problems.push(`${name}: ${err.message}`);
      return false;
    }
  };

  const manifestFile = join(out, "manifest.json");
  /** @type {Manifest} */
  const manifest = { updated: "", moves: existsSync(manifestFile) ? JSON.parse(readFileSync(manifestFile, "utf8")).moves ?? {} : {}, skipped, problems };
  for (const key of keys) {
    /** @type {Map<string, Ranked & { query: string }>} */
    const found = new Map();
    const passedOver = new Set();
    for (const name of active) {
      for (const term of QUERIES[key]) {
        const { kept, dropped } = rankCandidates(term, await search(name, term));
        for (const clip of kept) {
          const id = `${clip.source}-${clip.id}`;
          if (!found.has(id) || clip.score > found.get(id).score) found.set(id, { ...clip, query: term });
        }
        for (const clip of dropped) passedOver.add(`${clip.source}-${clip.id}`);
      }
    }
    /** @type {SavedClip[]} */
    const clips = [];
    let fetched = 0;
    for (const clip of [...found.values()].sort(better).slice(0, keep)) {
      const file = `${key}/${clip.source}-${clip.id}.${clip.ext}`;
      const have = existsSync(join(out, file)) || (fetched < download && (await fetchClip(clip, join(out, file))));
      if (have) fetched++;
      clips.push({ ...clip, file: have ? file : null });
    }
    for (const id of found.keys()) passedOver.delete(id);
    const label = catalog.find((e) => e.key === key).label;
    manifest.moves[key] = { label, searched: active, clips, dropped: passedOver.size };
    manifest.updated = new Date(now()).toISOString();
    mkdirSync(out, { recursive: true });
    writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
    writeFileSync(join(out, "index.html"), reviewPage(manifest, { dir }));
    log(`${key}: ${clips.length} clip${clips.length === 1 ? "" : "s"} (${fetched} saved), ${passedOver.size} passed over`);
  }
  return manifest;
}

/** @param {unknown} text */
const esc = (text) => String(text ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/**
 * A page to watch each move's clips side by side: who made each and under what license, and the
 * command that makes the demo video from it. It plays only the clips saved here, never from the
 * source's server.
 * @param {Manifest} manifest
 * @param {{ dir?: string }} [opts] dir: the output folder from the repository root, for the commands
 */
export function reviewPage(manifest, { dir = "demo-sources" } = {}) {
  const link = (href, text) => (href ? `<a href="${esc(href)}">${esc(text)}</a>` : esc(text));
  const card = (key, clip) => {
    const facts = [clip.source, clip.seconds != null ? `${Math.round(clip.seconds)} s` : null, `${clip.width}×${clip.height}`, clip.bytes ? mb(clip.bytes) : null];
    const asks = [clip.credit ? "needs credit" : null, clip.shareAlike ? "share-alike: our video is CC BY-SA too" : null].filter(Boolean);
    return `<article>
${clip.file ? `<video controls muted loop playsinline preload="metadata" src="${esc(clip.file)}"></video>` : `<div class="missing">Not fetched: run again with a higher --download to save it.</div>`}
<h3>${link(clip.pageUrl, clip.title || `${clip.source} ${clip.id}`)}</h3>
<p>${esc(facts.filter(Boolean).join(" · "))} · found by “${esc(clip.query)}”</p>
<p>${link(clip.licenseUrl, clip.license)} · by ${link(clip.authorUrl, clip.author || "unknown")}${asks.map((a) => ` <mark>${esc(a)}</mark>`).join("")}</p>
${clip.note ? `<p class="note">${esc(clip.note)}</p>` : ""}${clip.file ? `<pre><code>node extension/scripts/make-demo-video.mjs ${esc(key)} ${esc(`${dir}/${clip.file}`)} --from 0 --to 6</code></pre>` : ""}
</article>`;
  };
  const order = exerciseCatalog().map((e) => e.key);
  const keys = Object.keys(manifest.moves).sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const sections = keys.filter((key) => manifest.moves[key].clips.length).map((key) => {
    const move = manifest.moves[key];
    return `<section><h2>${esc(move.label)} <code>${esc(key)}</code></h2>\n<div class="grid">\n${move.clips.map((clip) => card(key, clip)).join("\n")}\n</div></section>`;
  });
  const bare = keys.filter((key) => !manifest.moves[key].clips.length);
  if (bare.length)
    sections.push(`<section><h2>Nothing that fits yet (${bare.length})</h2>\n<p>${bare.map((key) => `${esc(manifest.moves[key].label)} <code>${esc(key)}</code>`).join(", ")}</p></section>`);
  const list = (title, lines) => (lines?.length ? `<h2>${esc(title)}</h2><ul>${lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>` : "");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Demo video sources</title>
<style>
:root { color-scheme: light dark; --line: #8884; }
body { font: 15px/1.45 system-ui, sans-serif; margin: 0 auto; max-width: 1200px; padding: 16px; background: Canvas; color: CanvasText; }
.grid { display: grid; gap: 16px; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); }
article { border: 1px solid var(--line); border-radius: 8px; padding: 10px; min-width: 0; }
video, .missing { width: 100%; aspect-ratio: 16 / 9; background: #0002; border-radius: 4px; }
.missing { display: grid; place-items: center; text-align: center; font-size: 13px; padding: 8px; box-sizing: border-box; }
h3 { font-size: 15px; margin: 8px 0 4px; overflow-wrap: anywhere; }
p { margin: 4px 0; font-size: 13px; }
pre { overflow-x: auto; font-size: 12px; background: #0001; padding: 6px; border-radius: 4px; }
mark { border-radius: 3px; padding: 0 4px; }
.note { color: #b45309; }
</style>
</head>
<body>
<h1>Demo video sources</h1>
<p>Found ${esc(manifest.updated)}. Pick one clip per move, find one clean rep in it, and make the demo with the command under it (set --from and --to to that rep). A clip marked “needs credit” must be credited wherever its video is shown.</p>
${list("Skipped", manifest.skipped)}${list("Problems", manifest.problems)}
${sections.join("\n")}
</body>
</html>
`;
}

const USAGE = `usage: node extension/scripts/scrape-demo-videos.mjs [move ...] [--sources wikimedia,pexels,pixabay] [--keep 5] [--download 2] [--out demo-sources]
  Pexels and Pixabay need PEXELS_API_KEY / PIXABAY_API_KEY in the environment.`;

/** @param {string[]} argv */
async function main(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { sources: { type: "string" }, keep: { type: "string" }, download: { type: "string" }, out: { type: "string" }, help: { type: "boolean" } },
  });
  if (values.help) return console.log(USAGE);
  const count = (v, fallback) => {
    if (v == null) return fallback;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0) throw new Error(`not a count: ${v}\n${USAGE}`);
    return n;
  };
  const root = fileURLToPath(new URL("../..", import.meta.url));
  const out = resolve(root, values.out ?? "demo-sources");
  const manifest = await scrapeDemoVideos({
    out,
    moves: positionals,
    sources: values.sources?.split(",").map((s) => s.trim()).filter(Boolean),
    keep: count(values.keep, 5),
    download: count(values.download, 2),
    dir: relative(root, out),
    log: (line) => console.log(line),
  });
  for (const line of manifest.skipped) console.log(`skipped ${line}`);
  for (const line of manifest.problems) console.warn(`problem: ${line}`);
  console.log(`watch them: ${join(out, "index.html")}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
