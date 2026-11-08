/**
 * Wire protocol on /ws (unchanged from the original Python server, so existing clients keep working):
 *
 *   client -> server  text   {"type": "config", "exercise": "neck_tilt"}
 *                     text   {"type": "reset"}
 *                     text   {"type": "privacy", "enabled": true}
 *                     text   {"type": "angles", "mode": "3d"}         2d | 3d
 *                     text   {"type": "calibrate", "action": "start"}  start | cancel
 *                     text   {"type": "config", "exercise": "...",
 *                             "calibration": {"rest": 150, "target": 110}}  optional
 *                     binary JPEG frame
 *   server -> client  {"type": "ready", ...}      once, after connect
 *                     {"type": "config", ...}     after config/reset
 *                     {"type": "privacy", ...}    after privacy
 *                     {"type": "angles", ...}     after angles
 *                     {"type": "calibrate", ...}  after calibrate
 *                     {"type": "frame", ...}      one per binary frame; with privacy on it
 *                                                 carries "mask": a PNG data URL whose alpha
 *                                                 is the person, or null. While calibrating it
 *                                                 carries "calibration": {"status": ...}
 *                     {"type": "error", ...}
 *
 * The client should keep one frame in flight at a time (send the next frame when the
 * previous result arrives); that gives natural back-pressure.
 *
 * Nest's WsAdapter routes {event, data} messages to @SubscribeMessage handlers. The parser
 * below maps this protocol onto that: a binary message becomes the "frame" event, a JSON
 * object becomes the event named by its "type", and anything malformed becomes "invalid"
 * (with the error text as data) so the gateway can answer it.
 */
import type { INestApplicationContext } from '@nestjs/common';
import { WsAdapter } from '@nestjs/platform-ws';

export const TEXT_EVENTS = ['config', 'reset', 'privacy', 'angles', 'calibrate'] as const;
export type TextEvent = (typeof TEXT_EVENTS)[number];
export type ClientPayload = Record<string, unknown>;

export type ParsedMessage =
  | { event: 'frame'; data: Buffer }
  | { event: TextEvent; data: ClientPayload }
  | { event: 'invalid'; data: string };

export function parseClientMessage(raw: unknown): ParsedMessage {
  if (typeof raw !== 'string') {
    // ws hands binary messages over as a Buffer (or Buffer[] / ArrayBuffer for other binaryTypes).
    const data = Buffer.isBuffer(raw)
      ? raw
      : Array.isArray(raw)
        ? Buffer.concat(raw as Buffer[])
        : Buffer.from(raw as ArrayBuffer);
    return { event: 'frame', data };
  }
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return { event: 'invalid', data: 'invalid JSON' };
  }
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return { event: 'invalid', data: 'expected a JSON object' };
  }
  const kind = (payload as ClientPayload).type;
  if (typeof kind === 'string' && (TEXT_EVENTS as readonly string[]).includes(kind)) {
    return { event: kind as TextEvent, data: payload as ClientPayload };
  }
  return { event: 'invalid', data: `unknown message type ${pyRepr(kind)}` };
}

/** Python-style repr for error texts, matching the FastAPI server's f"{x!r}" messages. */
export function pyRepr(value: unknown): string {
  if (value === undefined || value === null) return 'None';
  if (typeof value === 'string') return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  if (typeof value === 'boolean') return value ? 'True' : 'False';
  if (Array.isArray(value)) return `[${value.map(pyRepr).join(', ')}]`;
  if (typeof value === 'object') {
    return `{${Object.entries(value).map(([k, v]) => `${pyRepr(k)}: ${pyRepr(v)}`).join(', ')}}`;
  }
  return String(value);
}

/**
 * The stock ws adapter with this protocol's parser. maxConcurrentMessages: 1 handles each
 * client's messages strictly in order, so a reply never overtakes the one before it (a
 * "config" sent between two frames applies to the second frame only).
 */
export class PoseWsAdapter extends WsAdapter {
  constructor(app: INestApplicationContext) {
    super(app, { messageParser: parseClientMessage, maxConcurrentMessages: 1 });
  }
}
