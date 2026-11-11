import {
  AVATAR_EXPRESSIONS,
  type AnimationSlot,
  type AudioPlayback,
  type AudioPort,
  type AvatarCommand,
  type AvatarController,
  type AvatarEvent,
  type AvatarEventListener,
  type AvatarEventType,
  type AvatarExpression,
  type AvatarFrame,
  type AvatarFrameSource,
  type AvatarState,
  type CommandOutcome,
  type EyeCentres,
  type HeadRotation,
  type MonotonicClock,
  type RandomSource,
  type Reaction,
  type SpeechEndReason,
  type SpeechResponse,
  type Vec3,
} from '@squat-overflow/avatar-types';
import { AnimationManager, type AvatarClips } from './animation.ts';
import { AvatarEvents } from './events.ts';
import { EyeController } from './eyes.ts';
import { FacialController, type FaceShapes, type FaceTarget } from './face.ts';
import { NECK_SHARE, ProceduralAnimation } from './procedural.ts';
import {
  INITIAL_STATE,
  transition,
  visibleState,
  type MachineInput,
  type MachineState,
} from './state-machine.ts';

export interface AvatarCoreOptions {
  readonly clock: MonotonicClock;
  readonly audio: AudioPort;
  /** The model's clips, from its manifest. */
  readonly clips: AvatarClips;
  /** Random numbers for blinks, glances, breaths and drift (Math.random; seeded in tests). */
  readonly random: RandomSource;
  /** Where the model's eyes are, from its manifest; setGaze aims from here. */
  readonly eyes: EyeCentres;
  /** Where errors thrown by event listeners go (the client's logger). */
  readonly reportError?: (error: unknown) => void;
}

/** avatar-core's controller: the shared AvatarController API, plus what renderers pull each frame. */
export interface CoreAvatar extends AvatarController, AvatarFrameSource {
  readonly state: AvatarState;
}

export function createAvatarController(options: AvatarCoreOptions): CoreAvatar {
  return new Controller(options);
}

/** How long a reaction lasts when the command doesn't say. */
export const DEFAULT_REACTION_MS = 1500;

/**
 * The most the animation moves on in one frame. After a long gap (a hidden page, a stalled app) the
 * body carries on smoothly instead of jumping; timed things like reactions still use the real time.
 */
export const MAX_FRAME_STEP_MS = 100;

const STILL = { yaw: 0, pitch: 0, roll: 0 } as const;
const AHEAD = { yaw: 0, pitch: 0 } as const;

/** The speech the avatar is playing itself (not external speech from setSpeaking). */
interface Speech {
  readonly playback: AudioPlayback;
  readonly settle: (outcome: CommandOutcome) => void;
  /** The face the speak command asked for. */
  readonly expression: AvatarExpression | undefined;
}

interface ActiveReaction {
  /** Clock time when it ends on its own. */
  readonly endsAt: number;
  readonly intensity: number;
  readonly settle: (outcome: CommandOutcome) => void;
}

class Controller implements CoreAvatar {
  readonly #clock: MonotonicClock;
  readonly #audio: AudioPort;
  readonly #events: AvatarEvents;
  readonly #animation: AnimationManager;
  readonly #face = new FacialController();
  readonly #eyes: EyeController;
  readonly #body: ProceduralAnimation;
  /** setGaze's target and setExpression's face (rank 4 in section 4's priority table). */
  #gaze: Vec3 | null = null;
  #expression: AvatarExpression = 'neutral';
  /** The pose last handed out; after dispose the avatar keeps it. */
  #pose: AvatarFrame;
  #machine: MachineState = INITIAL_STATE;
  #speech: Speech | null = null;
  #reaction: ActiveReaction | null = null;
  #disposed = false;
  /** Events wait here until the controller is consistent; see #flush. */
  readonly #queue: AvatarEvent[] = [];
  #flushing = false;
  #lastFrameAt: number;

  constructor(options: AvatarCoreOptions) {
    this.#clock = options.clock;
    this.#audio = options.audio;
    this.#events = new AvatarEvents(options.reportError);
    this.#animation = new AnimationManager(options.clips);
    this.#eyes = new EyeController(options.random, options.eyes);
    this.#body = new ProceduralAnimation(options.random);
    this.#lastFrameAt = options.clock.now();
    this.#pose = {
      blendshapes: {},
      visemes: {},
      head: STILL,
      neck: STILL,
      eyes: { left: AHEAD, right: AHEAD },
      breath: 0,
      clips: this.#animation.clips(),
    };
  }

  get state(): AvatarState {
    return visibleState(this.#machine);
  }

  execute(command: AvatarCommand): Promise<CommandOutcome> {
    if (this.#disposed) return Promise.resolve('interrupted');
    this.#expireReaction();
    const outcome = this.#run(command);
    this.#flush();
    return outcome;
  }

  #run(command: AvatarCommand): Promise<CommandOutcome> {
    switch (command.type) {
      case 'idle':
      case 'listen':
      case 'think':
        this.#apply({ kind: command.type });
        return Promise.resolve('completed');
      case 'speak':
        return this.#speak(command.speech, command.expression);
      case 'react':
        return this.#react(
          command.reaction,
          command.durationMs ?? DEFAULT_REACTION_MS,
          command.intensity ?? 1
        );
    }
  }

  interrupt(): void {
    if (this.#disposed) return;
    this.#expireReaction();
    this.#apply({ kind: 'interrupt' });
    this.#flush();
  }

  setGaze(target: Vec3 | null): void {
    // Plain-JavaScript clients (the extension) call this too: a bad point would turn into NaN eyes.
    if (target !== null && !isPoint(target)) {
      throw new TypeError('setGaze: target must be [x, y, z] in metres (finite numbers), or null');
    }
    if (this.#disposed) return;
    this.#gaze = target === null ? null : [target[0], target[1], target[2]];
  }

  setExpression(expression: AvatarExpression): void {
    if (!(AVATAR_EXPRESSIONS as readonly unknown[]).includes(expression)) {
      throw new TypeError(
        `setExpression: expression must be one of ${AVATAR_EXPRESSIONS.join(', ')}`
      );
    }
    if (this.#disposed) return;
    this.#expression = expression;
  }

  setSpeaking(enabled: boolean): void {
    if (this.#disposed) return;
    this.#expireReaction();
    const speaking = this.#machine.activity === 'speaking';
    // On: speaking body language for audio played elsewhere (no lip sync without visemes).
    // Off: leaves speaking, stopping the avatar's own speech if that's what is playing.
    if (enabled && !speaking) this.#apply({ kind: 'speak' });
    if (!enabled && speaking) this.#apply({ kind: 'idle' });
    this.#flush();
  }

  on<K extends AvatarEventType>(type: K, listener: AvatarEventListener<K>): () => void {
    if (this.#disposed) return () => undefined;
    return this.#events.on(type, listener);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#expireReaction();
    this.#apply({ kind: 'interrupt' });
    this.#disposed = true;
    this.#queue.push({ type: 'disposed' });
    this.#flush();
  }

  frame(): AvatarFrame {
    // After dispose the avatar stands still: the renderer may ask once more while tearing down.
    if (this.#disposed) return this.#pose;
    const now = this.#clock.now();
    this.#expireReaction();
    const step = Math.min(Math.max(now - this.#lastFrameAt, 0), MAX_FRAME_STEP_MS);
    this.#lastFrameAt = now;
    this.#animation.advance(step);
    this.#pose = this.#compose(step);
    this.#flush();
    return this.#pose;
  }

  /**
   * One frame of the face, eyes and body. The procedural layer moves the head first; the eyes then
   * take the gaze, add their share of the head turn, and make up the rest so the gaze stays put.
   */
  #compose(step: number): AvatarFrame {
    const { activity, reaction } = this.#machine;
    const intensity = this.#reaction?.intensity ?? 1;
    const face = this.#face.update(step, this.#faceTarget());
    const body = this.#body.update(step, { activity, reaction, intensity });
    const eyes = this.#eyes.update(step, {
      mode: visibleState(this.#machine),
      target: this.#gaze,
      head: add(body.neck, body.head),
      eyeWide: ((face.eyeWideLeft ?? 0) + (face.eyeWideRight ?? 0)) / 2,
    });
    return {
      blendshapes: withBlink(face, eyes.blink),
      visemes: {},
      neck: add(body.neck, eyes.headTurn, NECK_SHARE),
      head: add(body.head, eyes.headTurn, 1 - NECK_SHARE),
      eyes: { left: eyes.left, right: eyes.right },
      breath: body.breath,
      clips: this.#animation.clips(),
    };
  }

  /**
   * Which face to wear, highest first (section 4): the reaction (also as an overlay on speech), the
   * speak command's expression, setExpression, the state's own (thinking).
   */
  #faceTarget(): FaceTarget {
    const { activity, reaction } = this.#machine;
    if (reaction !== null)
      return { expression: reaction, intensity: this.#reaction?.intensity ?? 1 };
    const spoken = this.#speech?.expression;
    if (spoken !== undefined) return { expression: spoken, intensity: 1 };
    if (this.#expression !== 'neutral') return { expression: this.#expression, intensity: 1 };
    return { expression: activity === 'thinking' ? 'thinking' : 'neutral', intensity: 1 };
  }

  #speak(
    speech: SpeechResponse,
    expression: AvatarExpression | undefined
  ): Promise<CommandOutcome> {
    return new Promise((settle, fail) => {
      this.#apply({ kind: 'speak' });
      this.#queue.push({ type: 'speechStarted', durationMs: speech.duration });
      let playback: AudioPlayback;
      try {
        playback = this.#audio.play(speech.audioUrl);
      } catch (error) {
        this.#endSpeech('failed');
        fail(asError(error));
        return;
      }
      const current: Speech = { playback, settle, expression };
      this.#speech = current;
      playback.finished.then(
        (how) => {
          if (this.#speech !== current) return; // already cut short by a command
          this.#speech = null;
          const outcome = how === 'ended' ? 'completed' : 'interrupted';
          this.#endSpeech(outcome);
          this.#flush();
          settle(outcome);
        },
        (error: unknown) => {
          if (this.#speech !== current) return;
          this.#speech = null;
          this.#endSpeech('failed');
          this.#flush();
          fail(asError(error));
        }
      );
    });
  }

  #react(reaction: Reaction, durationMs: number, intensity: number): Promise<CommandOutcome> {
    return new Promise((settle) => {
      this.#apply({ kind: 'react', reaction }); // cuts short the reaction before, if any
      this.#reaction = { endsAt: this.#clock.now() + durationMs, intensity, settle };
    });
  }

  /**
   * Ends a reaction whose time is up. Runs before every call and frame, so a reaction counts as
   * completed even when no frame ran in time (a hidden page).
   */
  #expireReaction(): void {
    const reaction = this.#reaction;
    if (!reaction || this.#clock.now() < reaction.endsAt) return;
    this.#reaction = null;
    this.#apply({ kind: 'reactionEnded' });
    reaction.settle('completed');
  }

  /** A reaction cut short by a command. */
  #cutReaction(): void {
    const reaction = this.#reaction;
    this.#reaction = null;
    reaction?.settle('interrupted');
  }

  /** Speech that ended on its own (or failed): announce it, then leave the speaking state. */
  #endSpeech(reason: SpeechEndReason): void {
    this.#queue.push({ type: 'speechEnded', reason });
    this.#apply({ kind: 'speechEnded' });
  }

  /** Speech cut short by a command: stop the audio, announce it, settle its command. */
  #stopSpeech(): void {
    const speech = this.#speech;
    if (!speech) return; // external speech (setSpeaking) has nothing to stop
    this.#speech = null;
    speech.playback.stop();
    this.#queue.push({ type: 'speechEnded', reason: 'interrupted' });
    speech.settle('interrupted');
  }

  /**
   * Delivers queued events. Each public method changes state first and calls this last, so a
   * listener always sees a consistent avatar. A command a listener issues runs in full, and its
   * events join the end of the queue (this loop delivers them; the nested call returns at once).
   */
  #flush(): void {
    if (this.#flushing) return;
    this.#flushing = true;
    try {
      for (let event = this.#queue.shift(); event; event = this.#queue.shift()) {
        this.#events.emit(event);
      }
    } finally {
      this.#flushing = false;
    }
    if (this.#disposed) this.#events.clear();
  }

  /** Moves the state machine, carries out its effects, and queues the change. */
  #apply(input: MachineInput): void {
    const before = visibleState(this.#machine);
    const next = transition(this.#machine, input);
    this.#machine = next.state;
    if (next.stopSpeech) this.#stopSpeech();
    if (next.endReaction) this.#cutReaction();
    const after = visibleState(this.#machine);
    if (after !== before) this.#queue.push({ type: 'stateChanged', from: before, to: after });
    this.#animation.play(slotFor(this.#machine));
  }
}

function isPoint(value: unknown): value is Vec3 {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((n) => typeof n === 'number' && Number.isFinite(n))
  );
}

/** `a + b × share`, axis by axis. */
function add(a: HeadRotation, b: HeadRotation, share = 1): HeadRotation {
  return {
    yaw: a.yaw + b.yaw * share,
    pitch: a.pitch + b.pitch * share,
    roll: a.roll + b.roll * share,
  };
}

/** The face with the blink on both eyes (left out while the eyes are open). */
function withBlink(face: FaceShapes, blink: number): FaceShapes {
  if (blink === 0) return face;
  return {
    ...face,
    eyeBlinkLeft: Math.min(1, (face.eyeBlinkLeft ?? 0) + blink),
    eyeBlinkRight: Math.min(1, (face.eyeBlinkRight ?? 0) + blink),
  };
}

/** Audio layers fail with anything; callers of speak always get an Error. */
function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(`audio failed: ${String(error)}`);
}

const ACTIVITY_SLOT = {
  idle: 'idle',
  listening: 'listening',
  thinking: 'thinking',
  speaking: 'talking',
} as const;

/** The body clip for a state: the reaction's clip while reacting, else the activity's. */
function slotFor(state: MachineState): AnimationSlot {
  const { reaction } = state;
  if (visibleState(state) === 'reacting' && reaction !== null && reaction !== 'neutral') {
    return `react.${reaction}`;
  }
  return ACTIVITY_SLOT[state.activity];
}
