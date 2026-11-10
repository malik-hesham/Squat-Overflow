import type {
  AvatarEvent,
  AvatarEventType,
  AvatarFrame,
  CommandOutcome,
  EyeCentres,
  Vec3,
} from '@squat-overflow/avatar-types';
import { describe, expect, it } from 'vitest';
import type { AvatarClips } from './animation.ts';
import {
  DEFAULT_REACTION_MS,
  MAX_FRAME_STEP_MS,
  createAvatarController,
  type CoreAvatar,
} from './controller.ts';
import { EXPRESSION_SHAPES } from './face.ts';
import { POSTURES } from './procedural.ts';
import { FakeAudio, FakeClock, SeededRandom, settle } from './testing/fakes.ts';

const CLIPS: AvatarClips = {
  idle: { durationMs: 4000, loop: true },
  listening: { durationMs: 3000, loop: true },
  thinking: { durationMs: 3000, loop: true },
  talking: { durationMs: 2000, loop: true },
  'react.happy': { durationMs: 1200, loop: false },
};

const ALL_EVENTS: AvatarEventType[] = [
  'stateChanged',
  'speechStarted',
  'speechEnded',
  'error',
  'disposed',
];

const EYES: EyeCentres = { left: [0.03, 1.69, 0.137], right: [-0.03, 1.69, 0.137] };

function setup(seed = 1) {
  const clock = new FakeClock();
  const audio = new FakeAudio();
  const random = new SeededRandom(seed);
  const avatar = createAvatarController({ clock, audio, clips: CLIPS, random, eyes: EYES });
  const events: AvatarEvent[] = [];
  for (const type of ALL_EVENTS) avatar.on(type, (e) => events.push(e));
  return { clock, audio, avatar, events };
}

/** Tracks a command's promise without awaiting it. */
function track(promise: Promise<CommandOutcome>) {
  const result: { outcome?: CommandOutcome; error?: unknown } = {};
  promise.then(
    (outcome) => (result.outcome = outcome),
    (error: unknown) => (result.error = error)
  );
  return result;
}

describe('avatar controller: activities', () => {
  it('starts idle in the rest pose, playing the idle clip', () => {
    const { avatar } = setup();

    expect(avatar.state).toBe('idle');
    expect(avatar.frame()).toEqual({
      blendshapes: {},
      visemes: {},
      head: { yaw: 0, pitch: 0, roll: 0 },
      neck: { yaw: 0, pitch: 0, roll: 0 },
      eyes: { left: { yaw: 0, pitch: 0 }, right: { yaw: 0, pitch: 0 } },
      breath: 0,
      clips: [{ slot: 'idle', weight: 1, timeMs: 0 }],
    });
  });

  it.each([
    ['listen', 'listening'],
    ['think', 'thinking'],
  ] as const)(
    '%s: changes state once and completes as soon as it is entered',
    async (type, state) => {
      const { avatar, events } = setup();

      await expect(avatar.execute({ type })).resolves.toBe('completed');

      expect(avatar.state).toBe(state);
      expect(events).toEqual([{ type: 'stateChanged', from: 'idle', to: state }]);
    }
  );

  it('emits nothing for a command to stay in the current state', async () => {
    const { avatar, events } = setup();
    await avatar.execute({ type: 'listen' });
    events.length = 0;

    await expect(avatar.execute({ type: 'listen' })).resolves.toBe('completed');
    await expect(avatar.execute({ type: 'idle' })).resolves.toBe('completed');
    await expect(avatar.execute({ type: 'idle' })).resolves.toBe('completed');

    expect(events).toEqual([{ type: 'stateChanged', from: 'listening', to: 'idle' }]);
  });
});

const HELLO = {
  audioUrl: 'blob:hello',
  duration: 420,
  visemes: [{ timestamp: 0, duration: 420, viseme: 'aa' as const, weight: 1 }],
};
const BYE = { ...HELLO, audioUrl: 'blob:bye', duration: 300 };

describe('avatar controller: speech', () => {
  it('plays the audio, then completes and goes back to idle when the audio ends', async () => {
    const { audio, avatar, events } = setup();

    const speak = track(avatar.execute({ type: 'speak', speech: HELLO }));
    expect(audio.played.map((p) => p.url)).toEqual(['blob:hello']);
    expect(avatar.state).toBe('speaking');
    await settle();
    expect(speak).toEqual({});

    audio.last.end();
    await settle();

    expect(speak).toEqual({ outcome: 'completed' });
    expect(avatar.state).toBe('idle');
    expect(events).toEqual([
      { type: 'stateChanged', from: 'idle', to: 'speaking' },
      { type: 'speechStarted', durationMs: 420 },
      { type: 'speechEnded', reason: 'completed' },
      { type: 'stateChanged', from: 'speaking', to: 'idle' },
    ]);
  });

  it('stops the audio and listens when told to listen mid-speech (barge-in)', async () => {
    const { audio, avatar, events } = setup();
    const speak = track(avatar.execute({ type: 'speak', speech: HELLO }));
    events.length = 0;

    await avatar.execute({ type: 'listen' });
    await settle();
    audio.last.end(); // a late "ended" from the stopped audio changes nothing
    await settle();

    expect(audio.last.stopCalls).toBe(1);
    expect(speak).toEqual({ outcome: 'interrupted' });
    expect(avatar.state).toBe('listening');
    expect(events).toEqual([
      { type: 'speechEnded', reason: 'interrupted' },
      { type: 'stateChanged', from: 'speaking', to: 'listening' },
    ]);
  });

  it('replaces the speech with a new one: the old audio stops, the state stays speaking', async () => {
    const { audio, avatar, events } = setup();
    const first = track(avatar.execute({ type: 'speak', speech: HELLO }));
    events.length = 0;

    const second = track(avatar.execute({ type: 'speak', speech: BYE }));
    await settle();

    expect(audio.played.map((p) => [p.url, p.stopCalls])).toEqual([
      ['blob:hello', 1],
      ['blob:bye', 0],
    ]);
    expect(first).toEqual({ outcome: 'interrupted' });
    expect(second).toEqual({});
    expect(events).toEqual([
      { type: 'speechEnded', reason: 'interrupted' },
      { type: 'speechStarted', durationMs: 300 },
    ]);
  });

  it('interrupt() stops the speech and goes idle', async () => {
    const { audio, avatar, events } = setup();
    const speak = track(avatar.execute({ type: 'speak', speech: HELLO }));
    events.length = 0;

    avatar.interrupt();
    await settle();

    expect(audio.last.stopCalls).toBe(1);
    expect(speak).toEqual({ outcome: 'interrupted' });
    expect(events).toEqual([
      { type: 'speechEnded', reason: 'interrupted' },
      { type: 'stateChanged', from: 'speaking', to: 'idle' },
    ]);
  });

  it('ends the speech as interrupted when the system stops the audio (e.g. a phone call)', async () => {
    const { audio, avatar, events } = setup();
    const speak = track(avatar.execute({ type: 'speak', speech: HELLO }));
    events.length = 0;

    audio.last.stop();
    await settle();

    expect(speak).toEqual({ outcome: 'interrupted' });
    expect(avatar.state).toBe('idle');
    expect(events).toEqual([
      { type: 'speechEnded', reason: 'interrupted' },
      { type: 'stateChanged', from: 'speaking', to: 'idle' },
    ]);
  });

  const FAILED_SPEECH: AvatarEvent[] = [
    { type: 'stateChanged', from: 'idle', to: 'speaking' },
    { type: 'speechStarted', durationMs: 420 },
    { type: 'speechEnded', reason: 'failed' },
    { type: 'stateChanged', from: 'speaking', to: 'idle' },
  ];

  it('rejects, ends the speech as failed and goes idle when the audio fails to load', async () => {
    const { audio, avatar, events } = setup();
    const error = new Error('no audio');

    const speak = track(avatar.execute({ type: 'speak', speech: HELLO }));
    audio.last.fail(error);
    await settle();

    expect(speak).toEqual({ error });
    expect(avatar.state).toBe('idle');
    expect(events).toEqual(FAILED_SPEECH);
  });

  it('always rejects with an Error, even when the audio fails with something else', async () => {
    const { audio, avatar } = setup();

    const speak = avatar.execute({ type: 'speak', speech: HELLO });
    audio.last.fail('decode error');

    await expect(speak).rejects.toThrow(new Error('audio failed: decode error'));
  });

  it('does the same when the audio throws as soon as it is asked to play', async () => {
    const { audio, avatar, events } = setup();
    const error = new Error('no audio output');
    audio.throwOnPlay = error;

    const speak = track(avatar.execute({ type: 'speak', speech: HELLO }));
    await settle();

    expect(speak).toEqual({ error });
    expect(avatar.state).toBe('idle');
    expect(events).toEqual(FAILED_SPEECH);
  });
});

describe('avatar controller: reactions', () => {
  it('reacts for 1500 ms by default, then returns to the activity underneath and completes', async () => {
    expect(DEFAULT_REACTION_MS).toBe(1500);
    const { avatar, clock, events } = setup();
    await avatar.execute({ type: 'listen' });
    events.length = 0;

    const react = track(avatar.execute({ type: 'react', reaction: 'happy' }));
    clock.advance(1499);
    avatar.frame();
    expect(avatar.state).toBe('reacting');
    clock.advance(1);
    avatar.frame();
    await settle();

    expect(react).toEqual({ outcome: 'completed' });
    expect(avatar.state).toBe('listening');
    expect(events).toEqual([
      { type: 'stateChanged', from: 'listening', to: 'reacting' },
      { type: 'stateChanged', from: 'reacting', to: 'listening' },
    ]);
  });

  it('lasts durationMs when the command gives one', async () => {
    const { avatar, clock } = setup();
    const react = track(avatar.execute({ type: 'react', reaction: 'sad', durationMs: 400 }));

    clock.advance(400);
    avatar.frame();
    await settle();

    expect(react).toEqual({ outcome: 'completed' });
    expect(avatar.state).toBe('idle');
  });

  it('is an overlay during speech: the state stays speaking and the audio keeps playing', async () => {
    const { audio, avatar, clock, events } = setup();
    void avatar.execute({ type: 'speak', speech: HELLO });
    events.length = 0;

    const react = track(avatar.execute({ type: 'react', reaction: 'surprised', durationMs: 300 }));
    clock.advance(300);
    avatar.frame();
    await settle();

    expect(react).toEqual({ outcome: 'completed' });
    expect(avatar.state).toBe('speaking');
    expect(audio.last.stopCalls).toBe(0);
    expect(events).toEqual([]);
  });

  it('is replaced by a new reaction: the old one is interrupted, the new one gets its full time', async () => {
    const { avatar, clock } = setup();
    const first = track(avatar.execute({ type: 'react', reaction: 'happy' }));
    clock.advance(1000);

    const second = track(avatar.execute({ type: 'react', reaction: 'confused' }));
    clock.advance(1000);
    avatar.frame();
    await settle();
    expect(first).toEqual({ outcome: 'interrupted' });
    expect(avatar.state).toBe('reacting');

    clock.advance(500);
    avatar.frame();
    await settle();
    expect(second).toEqual({ outcome: 'completed' });
    expect(avatar.state).toBe('idle');
  });

  it.each([
    [
      'another command',
      (avatar: CoreAvatar): void => {
        void avatar.execute({ type: 'think' });
      },
    ],
    [
      'interrupt()',
      (avatar: CoreAvatar): void => {
        avatar.interrupt();
      },
    ],
  ] as const)('is interrupted by %s', async (_name, cut) => {
    const { avatar } = setup();
    const react = track(avatar.execute({ type: 'react', reaction: 'happy' }));

    cut(avatar);
    await settle();

    expect(react).toEqual({ outcome: 'interrupted' });
  });

  it('counts as completed once its time is up, even if no frame ran before the next command', async () => {
    const { avatar, clock, events } = setup();
    const react = track(avatar.execute({ type: 'react', reaction: 'happy', durationMs: 400 }));
    clock.advance(500); // e.g. the page was hidden, so no frames

    await avatar.execute({ type: 'listen' });
    await settle();

    expect(react).toEqual({ outcome: 'completed' });
    expect(events).toEqual([
      { type: 'stateChanged', from: 'idle', to: 'reacting' },
      { type: 'stateChanged', from: 'reacting', to: 'idle' },
      { type: 'stateChanged', from: 'idle', to: 'listening' },
    ]);
  });
});

describe('avatar controller: setSpeaking (audio the avatar does not play)', () => {
  it('shows speaking without playing anything, and goes back to idle when turned off', () => {
    const { audio, avatar, events } = setup();

    avatar.setSpeaking(true);
    expect(avatar.state).toBe('speaking');
    avatar.setSpeaking(false);

    expect(audio.played).toEqual([]);
    expect(events).toEqual([
      { type: 'stateChanged', from: 'idle', to: 'speaking' },
      { type: 'stateChanged', from: 'speaking', to: 'idle' },
    ]);
  });

  it("changes nothing when turned on during the avatar's own speech, and stops it when turned off", async () => {
    const { audio, avatar, events } = setup();
    const speak = track(avatar.execute({ type: 'speak', speech: HELLO }));
    events.length = 0;

    avatar.setSpeaking(true);
    expect(events).toEqual([]);
    avatar.setSpeaking(false);
    await settle();

    expect(audio.last.stopCalls).toBe(1);
    expect(speak).toEqual({ outcome: 'interrupted' });
    expect(avatar.state).toBe('idle');
  });

  it('changes nothing when turned off while not speaking', async () => {
    const { avatar, events } = setup();
    await avatar.execute({ type: 'think' });
    events.length = 0;

    avatar.setSpeaking(false);

    expect(avatar.state).toBe('thinking');
    expect(events).toEqual([]);
  });
});

describe('avatar controller: frame', () => {
  const blend = (avatar: CoreAvatar) =>
    Object.fromEntries(avatar.frame().clips.map((c) => [c.slot, Math.round(c.weight * 100) / 100]));

  it("blends the body clip with the state: talking while speaking, the reaction's own clip while reacting", async () => {
    const { avatar, clock } = setup();
    /** Runs frames every 10 ms (a real display runs them every 8 to 33 ms). */
    const run = (ms: number) => {
      for (let t = 0; t < ms; t += 10) {
        clock.advance(10);
        avatar.frame();
      }
      return blend(avatar);
    };

    await avatar.execute({ type: 'listen' });
    expect(run(150)).toEqual({ idle: 0.5, listening: 0.5 });

    void avatar.execute({ type: 'react', reaction: 'happy', durationMs: 5000 });
    expect(run(300)).toEqual({ 'react.happy': 1 });

    void avatar.execute({ type: 'react', reaction: 'neutral', durationMs: 5000 });
    expect(run(300)).toEqual({ listening: 1 }); // neutral has no clip: the activity's plays

    void avatar.execute({ type: 'speak', speech: HELLO });
    expect(run(300)).toEqual({ talking: 1 });
  });

  it('moves the animation on by at most 100 ms after a long pause, such as a hidden page', () => {
    expect(MAX_FRAME_STEP_MS).toBe(100);
    const { avatar, clock } = setup();

    clock.advance(10_000);

    expect(avatar.frame().clips).toEqual([{ slot: 'idle', weight: 1, timeMs: 100 }]);
  });
});

describe('avatar controller: dispose', () => {
  it('ends what is running as interrupted, stops the audio, and announces disposed last', async () => {
    const { audio, avatar, events } = setup();
    const speak = track(avatar.execute({ type: 'speak', speech: HELLO }));
    const react = track(avatar.execute({ type: 'react', reaction: 'happy' }));
    events.length = 0;

    avatar.dispose();
    await settle();

    expect(speak).toEqual({ outcome: 'interrupted' });
    expect(react).toEqual({ outcome: 'interrupted' });
    expect(audio.last.stopCalls).toBe(1);
    expect(events).toEqual([
      { type: 'speechEnded', reason: 'interrupted' },
      { type: 'stateChanged', from: 'speaking', to: 'idle' },
      { type: 'disposed' },
    ]);
  });

  it('does nothing afterwards: commands settle as interrupted, no events, no audio, frames stand still', async () => {
    const { audio, avatar, clock, events } = setup();
    avatar.dispose();
    const still = avatar.frame();
    events.length = 0;
    const late: AvatarEvent[] = [];

    await expect(avatar.execute({ type: 'listen' })).resolves.toBe('interrupted');
    await expect(avatar.execute({ type: 'speak', speech: HELLO })).resolves.toBe('interrupted');
    avatar.on('stateChanged', (e) => late.push(e))();
    avatar.interrupt();
    avatar.setSpeaking(true);
    avatar.dispose();
    clock.advance(1000);

    expect(avatar.state).toBe('idle');
    expect(audio.played).toEqual([]);
    expect(events).toEqual([]);
    expect(late).toEqual([]);
    expect(avatar.frame()).toEqual(still);
  });
});

describe('avatar controller: commands from inside event listeners', () => {
  it('runs them after the current command; the audio stops and the events stay paired and in order', async () => {
    const { audio, avatar, events } = setup();
    avatar.on('stateChanged', (e) => {
      if (e.to === 'speaking') avatar.interrupt();
    });

    const speak = track(avatar.execute({ type: 'speak', speech: HELLO }));
    await settle();

    expect(speak).toEqual({ outcome: 'interrupted' });
    expect(audio.last.stopCalls).toBe(1);
    expect(avatar.state).toBe('idle');
    expect(events).toEqual([
      { type: 'stateChanged', from: 'idle', to: 'speaking' },
      { type: 'speechStarted', durationMs: 420 },
      { type: 'speechEnded', reason: 'interrupted' },
      { type: 'stateChanged', from: 'speaking', to: 'idle' },
    ]);
  });

  it('a reaction cut short by a listener settles as interrupted, not completed', async () => {
    const { avatar, clock } = setup();
    avatar.on('stateChanged', (e) => {
      if (e.to === 'reacting') void avatar.execute({ type: 'listen' });
    });

    const react = track(avatar.execute({ type: 'react', reaction: 'happy', durationMs: 100 }));
    clock.advance(200);
    avatar.frame();
    await settle();

    expect(react).toEqual({ outcome: 'interrupted' });
    expect(avatar.state).toBe('listening');
  });

  it('still announces disposed when a listener disposes the avatar', () => {
    const { avatar, events } = setup();
    avatar.on('stateChanged', () => {
      avatar.dispose();
    });

    void avatar.execute({ type: 'listen' });

    expect(events).toEqual([
      { type: 'stateChanged', from: 'idle', to: 'listening' },
      { type: 'stateChanged', from: 'listening', to: 'idle' }, // dispose interrupts first
      { type: 'disposed' },
    ]);
  });
});

describe('avatar controller: face, eyes and body', () => {
  const FRAME = 1000 / 60;
  const DEG = Math.PI / 180;

  /** Runs frames for `ms` and returns them. */
  function frames(avatar: CoreAvatar, clock: FakeClock, ms: number): AvatarFrame[] {
    const out: AvatarFrame[] = [];
    for (let t = 0; t < ms - 1e-9; t += FRAME) {
      clock.advance(FRAME);
      out.push(avatar.frame());
    }
    return out;
  }
  const last = (all: AvatarFrame[]): AvatarFrame => {
    const frame = all.at(-1);
    if (!frame) throw new Error('no frames');
    return frame;
  };
  /** The frame's face without blinks (they come and go at random). */
  const face = (frame: AvatarFrame) => {
    const rest = { ...frame.blendshapes };
    delete rest.eyeBlinkLeft;
    delete rest.eyeBlinkRight;
    return rest;
  };
  const near = (a: object, b: object) => {
    const x = a as Record<string, number>;
    const y = b as Record<string, number>;
    expect(Object.keys(x).sort()).toEqual(Object.keys(y).sort());
    for (const key of Object.keys(y)) expect(x[key]).toBeCloseTo(y[key] ?? 0, 3);
  };

  it('is the same avatar, frame for frame, for the same seed', async () => {
    const a = setup(5);
    const b = setup(5);
    for (const { avatar, clock } of [a, b]) {
      await avatar.execute({ type: 'listen' });
      frames(avatar, clock, 3000);
      void avatar.execute({ type: 'react', reaction: 'surprised' });
      frames(avatar, clock, 3000);
      avatar.setGaze([0.4, 1.5, 1]);
    }

    expect(frames(a.avatar, a.clock, 5000)).toEqual(frames(b.avatar, b.clock, 5000));
  });

  it("wears setExpression's face, and 'neutral' takes it off", () => {
    const { avatar, clock } = setup();

    avatar.setExpression('happy');
    near(face(last(frames(avatar, clock, 3000))), EXPRESSION_SHAPES.happy);

    avatar.setExpression('neutral');
    expect(face(last(frames(avatar, clock, 3000)))).toEqual({});
  });

  it('wears the thinking face while thinking, unless setExpression says otherwise', async () => {
    const { avatar, clock } = setup();

    await avatar.execute({ type: 'think' });
    near(face(last(frames(avatar, clock, 3000))), EXPRESSION_SHAPES.thinking);

    avatar.setExpression('confused');
    near(face(last(frames(avatar, clock, 3000))), EXPRESSION_SHAPES.confused);
  });

  it("shows a reaction's face over setExpression, scaled by its intensity, then goes back", async () => {
    const { avatar, clock } = setup();
    avatar.setExpression('happy');

    const reaction = avatar.execute({
      type: 'react',
      reaction: 'sad',
      intensity: 0.5,
      durationMs: 3000,
    });
    const half = Object.fromEntries(
      Object.entries(EXPRESSION_SHAPES.sad).map(([k, v]) => [k, v / 2])
    );
    near(face(last(frames(avatar, clock, 2500))), half);

    frames(avatar, clock, 600);
    await expect(reaction).resolves.toBe('completed');
    near(face(last(frames(avatar, clock, 3000))), EXPRESSION_SHAPES.happy);
  });

  it("shows a speak command's expression while it speaks, and a reaction over it", async () => {
    const { audio, avatar, clock } = setup();
    void avatar.execute({ type: 'speak', speech: HELLO, expression: 'happy' });
    near(face(last(frames(avatar, clock, 3000))), EXPRESSION_SHAPES.happy);

    void avatar.execute({ type: 'react', reaction: 'surprised', durationMs: 5000 });
    near(face(last(frames(avatar, clock, 3000))), EXPRESSION_SHAPES.surprised);
    expect(avatar.state).toBe('speaking');

    avatar.interrupt();
    audio.last.end();
    await settle();
    expect(face(last(frames(avatar, clock, 3000)))).toEqual({});
  });

  it('rejects an expression it does not know', () => {
    const { avatar } = setup();
    expect(() => {
      avatar.setExpression('angry' as never);
    }).toThrow(TypeError);
  });

  it('turns the eyes and head to a setGaze point, and gives the gaze back on null', () => {
    const { avatar, clock } = setup();
    const left: Vec3 = [1, 1.69, 0.6]; // well to the avatar's left

    avatar.setGaze(left);
    const looking = last(frames(avatar, clock, 2000));
    expect(looking.eyes.left.yaw).toBeGreaterThan(5 * DEG);
    expect(looking.eyes.right.yaw).toBeGreaterThan(5 * DEG);
    expect(looking.neck.yaw + looking.head.yaw).toBeGreaterThan(30 * DEG);
    expect(looking.neck.yaw).toBeGreaterThan(0);

    avatar.setGaze(null);
    const back = last(frames(avatar, clock, 3000));
    expect(Math.abs(back.neck.yaw + back.head.yaw)).toBeLessThan(5 * DEG);
  });

  it('rejects a setGaze target that is not three finite numbers', () => {
    const { avatar } = setup();
    for (const bad of [[0, 1], [0, Number.NaN, 1], [0, 1, Infinity], 'ahead', {}, [0, 1, 2, 3]]) {
      expect(() => {
        avatar.setGaze(bad as never);
      }).toThrow(TypeError);
    }
  });

  it('blinks with both eyes, and not while the eyes are wide', () => {
    const { avatar, clock } = setup();
    const open = frames(avatar, clock, 7000);
    const shut = open.filter((f) => (f.blendshapes.eyeBlinkLeft ?? 0) > 0.9);
    expect(shut.length).toBeGreaterThan(0);
    for (const f of open) expect(f.blendshapes.eyeBlinkLeft).toBe(f.blendshapes.eyeBlinkRight);

    void avatar.execute({ type: 'react', reaction: 'surprised', durationMs: 20_000 });
    frames(avatar, clock, 1000); // the eyes widen
    const surprised = frames(avatar, clock, 15_000);
    expect(surprised.every((f) => f.blendshapes.eyeBlinkLeft === undefined)).toBe(true);
  });

  it('breathes and leans in while listening', async () => {
    const { avatar, clock } = setup();
    await avatar.execute({ type: 'listen' });
    const all = frames(avatar, clock, 6000);

    expect(Math.max(...all.map((f) => f.breath))).toBeGreaterThan(0.9);
    expect(Math.min(...all.slice(-200).map((f) => f.neck.pitch))).toBeLessThan(
      POSTURES.listening.neck.pitch / 2
    );
  });

  it('stands still after dispose, in the last pose it had', () => {
    const { avatar, clock } = setup();
    const before = last(frames(avatar, clock, 2500));

    avatar.dispose();
    clock.advance(1000);

    expect(avatar.frame()).toEqual(before);
    avatar.setGaze([1, 1, 1]);
    avatar.setExpression('happy');
    clock.advance(1000);
    expect(avatar.frame()).toEqual(before);
  });
});
