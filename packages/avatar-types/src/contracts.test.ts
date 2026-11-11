import { assertType, describe, expect, expectTypeOf, it } from 'vitest';
import {
  ANIMATION_SLOTS,
  HUMANOID_BONES,
  type AvatarCommand,
  type AvatarController,
  type AvatarEventListener,
  type AvatarFrame,
  type AvatarState,
  type CommandOutcome,
  type SpeechEndReason,
  type Vec3,
  type VisemeEvent,
  type VisemeId,
} from './index.ts';

describe('asset contract', () => {
  it('needs only the bones the procedural layer moves', () => {
    expect(HUMANOID_BONES).toEqual([
      'hips',
      'spine',
      'chest',
      'neck',
      'head',
      'leftEye',
      'rightEye',
    ]);
  });

  it('has a clip slot for each state and each reaction except neutral', () => {
    expect(ANIMATION_SLOTS).toEqual([
      'idle',
      'listening',
      'thinking',
      'talking',
      'nod',
      'react.happy',
      'react.sad',
      'react.surprised',
      'react.confused',
    ]);
  });
});

// The rest are checked by the compiler (`pnpm typecheck`); at run time they do nothing.
describe('type contracts', () => {
  it('tells commands apart by type, and a switch over them can be exhaustive', () => {
    function label(command: AvatarCommand): string {
      switch (command.type) {
        case 'idle':
        case 'listen':
        case 'think':
          return command.type;
        case 'speak':
          return command.speech.audioUrl;
        case 'react':
          return command.reaction;
        default:
          return command satisfies never;
      }
    }
    expectTypeOf(label).returns.toEqualTypeOf<string>();
  });

  it('gives each event listener the payload of its event type', () => {
    expectTypeOf<Parameters<AvatarEventListener<'stateChanged'>>[0]>().toEqualTypeOf<{
      readonly type: 'stateChanged';
      readonly from: AvatarState;
      readonly to: AvatarState;
    }>();
  });

  it('ends every speech with a reason, failure included, so listeners can pair start and end', () => {
    expectTypeOf<SpeechEndReason>().toEqualTypeOf<'completed' | 'interrupted' | 'failed'>();
  });

  it('types a viseme as a VisemeId, not any string', () => {
    expectTypeOf<VisemeEvent['viseme']>().toEqualTypeOf<VisemeId>();
    // @ts-expect-error 'viseme_aa' is not a viseme id
    assertType<VisemeEvent>({ timestamp: 0, duration: 1, viseme: 'viseme_aa', weight: 1 });
  });

  it("keeps the spec's controller API; execute settles with an outcome", () => {
    expectTypeOf<AvatarController['execute']>().toEqualTypeOf<
      (command: AvatarCommand) => Promise<CommandOutcome>
    >();
    expectTypeOf<CommandOutcome>().toEqualTypeOf<'completed' | 'interrupted'>();
    expectTypeOf<AvatarController['interrupt']>().toEqualTypeOf<() => void>();
    expectTypeOf<AvatarController['setGaze']>().parameter(0).toEqualTypeOf<Vec3 | null>();
    expectTypeOf<AvatarController['setSpeaking']>().toEqualTypeOf<(enabled: boolean) => void>();
    expectTypeOf<AvatarController['dispose']>().toEqualTypeOf<() => void>();
  });

  it('makes Vec3 a read-only tuple of three numbers', () => {
    expectTypeOf<Vec3>().toEqualTypeOf<readonly [x: number, y: number, z: number]>();
  });

  it('keys frame weights by canonical names only', () => {
    // @ts-expect-error 'jaw_open' is not an ARKit blendshape
    assertType<AvatarFrame['blendshapes']>({ jaw_open: 1 });
    assertType<AvatarFrame['visemes']>({ aa: 0.7, sil: 0.3 });
  });
});
