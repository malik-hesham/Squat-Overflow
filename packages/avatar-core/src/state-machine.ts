// AvatarStateMachine: what each input does to the avatar's state. Pure, so the table in
// docs/digital-human/architecture.md (section 4) is tested row by row. The controller carries out
// the effects (stopping audio, settling promises, emitting events).
import type { AvatarState, Reaction } from '@squat-overflow/avatar-types';

/** One at a time; the newest command wins. */
export type Activity = 'idle' | 'listening' | 'thinking' | 'speaking';

export interface MachineState {
  readonly activity: Activity;
  /** A reaction on top of the activity, or null. */
  readonly reaction: Reaction | null;
}

export type MachineInput =
  | { readonly kind: 'idle' | 'listen' | 'think' | 'speak' }
  | { readonly kind: 'react'; readonly reaction: Reaction }
  /** The speech or the reaction finished on its own. */
  | { readonly kind: 'speechEnded' | 'reactionEnded' }
  | { readonly kind: 'interrupt' };

export interface Transition {
  readonly state: MachineState;
  /** The speech that was playing is cut short. */
  readonly stopSpeech: boolean;
  /** The reaction that was showing is cut short. */
  readonly endReaction: boolean;
}

export const INITIAL_STATE: MachineState = { activity: 'idle', reaction: null };

const ACTIVITY_OF = {
  idle: 'idle',
  listen: 'listening',
  think: 'thinking',
  speak: 'speaking',
} as const;

export function transition(state: MachineState, input: MachineInput): Transition {
  const speaking = state.activity === 'speaking';
  const reacting = state.reaction !== null;
  switch (input.kind) {
    case 'idle':
    case 'listen':
    case 'think':
    case 'speak':
      // Any command but react ends the reaction; leaving or replacing speech stops it.
      return {
        state: { activity: ACTIVITY_OF[input.kind], reaction: null },
        stopSpeech: speaking,
        endReaction: reacting,
      };
    case 'react':
      // On top of the activity: during speech it's an overlay and the speech goes on.
      return {
        state: { activity: state.activity, reaction: input.reaction },
        stopSpeech: false,
        endReaction: reacting,
      };
    case 'speechEnded':
      return {
        state: speaking ? { activity: 'idle', reaction: state.reaction } : state,
        stopSpeech: false,
        endReaction: false,
      };
    case 'reactionEnded':
      return {
        state: { activity: state.activity, reaction: null },
        stopSpeech: false,
        endReaction: false,
      };
    case 'interrupt':
      return { state: INITIAL_STATE, stopSpeech: speaking, endReaction: reacting };
  }
}

/** The state clients see: a reaction shows as 'reacting', except during speech (an overlay). */
export function visibleState(state: MachineState): AvatarState {
  return state.reaction !== null && state.activity !== 'speaking' ? 'reacting' : state.activity;
}
