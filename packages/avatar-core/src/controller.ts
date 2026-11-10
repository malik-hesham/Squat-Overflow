import type {
  AnimationSlot,
  AudioPlayback,
  AudioPort,
  AvatarCommand,
  AvatarController,
  AvatarEvent,
  AvatarEventListener,
  AvatarEventType,
  AvatarFrame,
  AvatarFrameSource,
  AvatarState,
  CommandOutcome,
  MonotonicClock,
  Reaction,
  SpeechEndReason,
  SpeechResponse,
} from '@squat-overflow/avatar-types';
import { AnimationManager, type AvatarClips } from './animation.ts';
import { AvatarEvents } from './events.ts';
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
}

interface ActiveReaction {
  /** Clock time when it ends on its own. */
  readonly endsAt: number;
  readonly settle: (outcome: CommandOutcome) => void;
}

class Controller implements CoreAvatar {
  readonly #clock: MonotonicClock;
  readonly #audio: AudioPort;
  readonly #events: AvatarEvents;
  readonly #animation: AnimationManager;
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
    this.#lastFrameAt = options.clock.now();
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
        return this.#speak(command.speech);
      case 'react':
        return this.#react(command.reaction, command.durationMs ?? DEFAULT_REACTION_MS);
    }
  }

  interrupt(): void {
    if (this.#disposed) return;
    this.#expireReaction();
    this.#apply({ kind: 'interrupt' });
    this.#flush();
  }

  // The eye and face layers come in Phase 4 (docs/digital-human/architecture.md). Until then these
  // fail loudly instead of accepting a value and doing nothing.
  setGaze(): void {
    throw new Error('setGaze: the eye layer is built in Phase 4');
  }

  setExpression(): void {
    throw new Error('setExpression: the face layer is built in Phase 4');
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
    if (!this.#disposed) {
      // After dispose the avatar stands still: the renderer may ask once more while tearing down.
      const now = this.#clock.now();
      this.#expireReaction();
      this.#animation.advance(Math.min(Math.max(now - this.#lastFrameAt, 0), MAX_FRAME_STEP_MS));
      this.#lastFrameAt = now;
      this.#flush();
    }
    return {
      blendshapes: {},
      visemes: {},
      head: STILL,
      neck: STILL,
      eyes: { left: AHEAD, right: AHEAD },
      breath: 0,
      clips: this.#animation.clips(),
    };
  }

  #speak(speech: SpeechResponse): Promise<CommandOutcome> {
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
      const current: Speech = { playback, settle };
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

  #react(reaction: Reaction, durationMs: number): Promise<CommandOutcome> {
    return new Promise((settle) => {
      this.#apply({ kind: 'react', reaction }); // cuts short the reaction before, if any
      this.#reaction = { endsAt: this.#clock.now() + durationMs, settle };
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
