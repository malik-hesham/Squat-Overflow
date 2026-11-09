import type { IncomingMessage } from 'node:http';

import { Logger, type OnModuleInit } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  type OnGatewayConnection,
  type OnGatewayDisconnect,
} from '@nestjs/websockets';
import type { WebSocket } from 'ws';

import { validate as validateCalibration } from '../analysis/calibration';
import { CATALOG, DEFAULT_EXERCISE } from '../analysis/exercises';
import { CONNECTIONS } from '../analysis/geometry';
import { Session } from '../analysis/session';
import { exerciseCatalog } from '../catalog';
import { MAX_FRAME_BYTES, WS_MAX_PAYLOAD, maxSessions, originAllowed } from '../config';
import { encodeMask } from './mask';
import { PoseEngine, decodeImage, warmUp, type Landmarks } from './pose-engine';
import { pyRepr, type ClientPayload } from './protocol';

type Reply = Record<string, unknown>;

/** Per-WebSocket state. */
class Connection {
  readonly session = new Session(DEFAULT_EXERCISE);
  readonly t0 = performance.now();
  privacy = false; // true: include a person mask with each frame result
  closed = false;
  /** Loaded on the first frame, so catalog-only clients stay cheap. */
  private engine: Promise<PoseEngine> | null = null;

  getEngine(): Promise<PoseEngine> {
    this.engine ??= PoseEngine.create();
    return this.engine;
  }

  close(): void {
    this.closed = true;
    this.engine?.then((e) => e.close()).catch(() => undefined);
  }
}

const error = (message: string): Reply => ({ type: 'error', message });

/** WebSocket close code 1013 "Try Again Later": the server is at its session cap. */
export const CLOSE_BUSY = 1013;

@WebSocketGateway({
  path: '/ws',
  maxPayload: WS_MAX_PAYLOAD,
  // Refuse the handshake (HTTP 403) for web pages that aren't the extension or a loopback page.
  verifyClient: (info: { origin?: string; req: IncomingMessage }, done: (ok: boolean, code?: number) => void) =>
    done(originAllowed(info.req.headers.origin), 403),
})
export class PoseGateway implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit {
  private readonly logger = new Logger(PoseGateway.name);
  private readonly connections = new WeakMap<WebSocket, Connection>();
  /** Read when the gateway is created; an invalid FORMCOACH_MAX_SESSIONS stops the server from starting. */
  private readonly maxSessions = maxSessions();
  private sessions = 0;

  async onModuleInit(): Promise<void> {
    const started = performance.now();
    const backend = await warmUp();
    this.logger.log(`TF.js ${backend} backend and BlazePose models ready in ${Math.round(performance.now() - started)} ms`);
  }

  handleConnection(client: WebSocket): void {
    if (this.sessions >= this.maxSessions) {
      // Closed after the handshake rather than refused in it, so the client sees why (browsers
      // hide a refused handshake's status). No "ready", no Connection, no slot taken.
      this.logger.warn(`session cap (${this.maxSessions}) reached; closing a new client`);
      client.close(CLOSE_BUSY, 'server busy');
      return;
    }
    this.sessions++;
    this.connections.set(client, new Connection());
    client.send(
      JSON.stringify({ type: 'ready', exercises: exerciseCatalog(), connections: CONNECTIONS, exercise: DEFAULT_EXERCISE }),
    );
  }

  handleDisconnect(client: WebSocket): void {
    const conn = this.connections.get(client);
    if (!conn) return; // a client closed for the cap never took a slot
    conn.close();
    this.connections.delete(client);
    this.sessions--;
  }

  private conn(client: WebSocket): Connection {
    const conn = this.connections.get(client);
    if (!conn) throw new Error('message from an unknown client');
    return conn;
  }

  @SubscribeMessage('invalid')
  onInvalid(@MessageBody() message: string): Reply {
    return error(message);
  }

  @SubscribeMessage('privacy')
  onPrivacy(@ConnectedSocket() client: WebSocket, @MessageBody() payload: ClientPayload): Reply {
    const conn = this.conn(client);
    conn.privacy = payload.enabled === true;
    return { type: 'privacy', enabled: conn.privacy };
  }

  @SubscribeMessage('angles')
  onAngles(@ConnectedSocket() client: WebSocket, @MessageBody() payload: ClientPayload): Reply {
    const { session } = this.conn(client);
    const mode = payload.mode;
    if (mode !== '2d' && mode !== '3d') return error(`unknown angle mode ${pyRepr(mode)}`);
    session.setAngleMode(mode === '3d');
    return { type: 'angles', mode, exercise: session.exercise.key };
  }

  @SubscribeMessage('calibrate')
  onCalibrate(@ConnectedSocket() client: WebSocket, @MessageBody() payload: ClientPayload): Reply {
    const { session } = this.conn(client);
    const action = payload.action;
    if (action === 'start') session.startCalibration();
    else if (action === 'cancel') session.cancelCalibration();
    else return error(`unknown calibrate action ${pyRepr(action)}`);
    return { type: 'calibrate', action, exercise: session.exercise.key };
  }

  @SubscribeMessage('config')
  onConfig(@ConnectedSocket() client: WebSocket, @MessageBody() payload: ClientPayload): Reply {
    const { session } = this.conn(client);
    const key = 'exercise' in payload ? payload.exercise : '';
    // Workout exercises exist server-side but are not offered.
    if (typeof key !== 'string' || !CATALOG.has(key)) return error(`unknown exercise ${pyRepr(key)}`);
    let thresholds = null;
    const cal = payload.calibration;
    if (cal !== undefined && cal !== null) {
      const { rest, target } = typeof cal === 'object' && !Array.isArray(cal) ? (cal as ClientPayload) : {};
      thresholds = validateCalibration(CATALOG.get(key)!, rest, target);
      // Report the bad calibration, then fall through with defaults: the exercise switch itself is valid.
      if (thresholds === null) client.send(JSON.stringify(error('invalid calibration')));
    }
    session.setExercise(key, thresholds);
    return this.configReply(session);
  }

  @SubscribeMessage('reset')
  onReset(@ConnectedSocket() client: WebSocket): Reply {
    const { session } = this.conn(client);
    session.reset();
    return this.configReply(session);
  }

  private configReply(session: Session): Reply {
    return { type: 'config', exercise: session.exercise.key, calibrated: session.thresholds !== null };
  }

  @SubscribeMessage('frame')
  async onFrame(@ConnectedSocket() client: WebSocket, @MessageBody() data: Buffer): Promise<Reply | undefined> {
    const conn = this.conn(client);
    if (data.length === 0) return undefined;
    if (data.length > MAX_FRAME_BYTES) return error('frame too large');

    const started = performance.now();
    const engine = await conn.getEngine();
    const image = await decodeImage(data);
    if (!image) return error('could not decode frame');
    const now = (performance.now() - conn.t0) / 1000;
    const { landmarks, world, mask } = await engine.detect(image, Math.trunc(now * 1000));
    if (conn.closed) return undefined;

    const result: Reply = conn.session.process(landmarks, image.width, image.height, now, world);
    result.type = 'frame';
    result.landmarks = landmarks ? roundLandmarks(landmarks) : null;
    if (conn.privacy) {
      // null = no person found; the client then blurs the whole frame.
      result.mask = mask ? encodeMask(mask, landmarks) : null;
    }
    result.latency_ms = Math.round((performance.now() - started) * 10) / 10;
    return result;
  }
}

function roundLandmarks(landmarks: Landmarks): number[][] {
  const r = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;
  return landmarks.map(([x, y, v]) => [r(x, 4), r(y, 4), r(v, 3)]);
}
