// The table in docs/digital-human/architecture.md, section 4, row by row.
import { describe, expect, it } from 'vitest';
import {
  INITIAL_STATE,
  transition,
  visibleState,
  type MachineInput,
  type MachineState,
} from './state-machine.ts';

const IDLE: MachineState = { activity: 'idle', reaction: null };
const LISTENING: MachineState = { activity: 'listening', reaction: null };
const THINKING: MachineState = { activity: 'thinking', reaction: null };
const SPEAKING: MachineState = { activity: 'speaking', reaction: null };
/** Reacting (happy) on top of listening: it returns to listening when the reaction ends. */
const REACTING: MachineState = { activity: 'listening', reaction: 'happy' };
/** A reaction during speech is an overlay: still speaking. */
const SPEAKING_HAPPY: MachineState = { activity: 'speaking', reaction: 'happy' };

type Row = [
  string,
  MachineState,
  MachineInput,
  MachineState,
  { stopSpeech: boolean; endReaction: boolean },
];
const NONE = { stopSpeech: false, endReaction: false };
const STOP = { stopSpeech: true, endReaction: false };
const END = { stopSpeech: false, endReaction: true };
const BOTH = { stopSpeech: true, endReaction: true };

describe('avatar state machine', () => {
  it('starts idle', () => {
    expect(INITIAL_STATE).toEqual(IDLE);
    expect(visibleState(INITIAL_STATE)).toBe('idle');
  });

  it.each<Row>([
    ['idle, idle', IDLE, { kind: 'idle' }, IDLE, NONE],
    ['listening, idle', LISTENING, { kind: 'idle' }, IDLE, NONE],
    ['speaking, idle', SPEAKING, { kind: 'idle' }, IDLE, STOP],
    ['reacting, idle', REACTING, { kind: 'idle' }, IDLE, END],
    ['idle, listen', IDLE, { kind: 'listen' }, LISTENING, NONE],
    ['listening, listen', LISTENING, { kind: 'listen' }, LISTENING, NONE],
    ['thinking, listen', THINKING, { kind: 'listen' }, LISTENING, NONE],
    ['speaking, listen (barge-in)', SPEAKING, { kind: 'listen' }, LISTENING, STOP],
    ['reacting, listen', REACTING, { kind: 'listen' }, LISTENING, END],
    ['idle, think', IDLE, { kind: 'think' }, THINKING, NONE],
    ['speaking, think', SPEAKING, { kind: 'think' }, THINKING, STOP],
    ['idle, speak', IDLE, { kind: 'speak' }, SPEAKING, NONE],
    ['thinking, speak', THINKING, { kind: 'speak' }, SPEAKING, NONE],
    ['speaking, speak (replaces the speech)', SPEAKING, { kind: 'speak' }, SPEAKING, STOP],
    ['reacting, speak', REACTING, { kind: 'speak' }, SPEAKING, END],
    ['speaking with a reaction, listen', SPEAKING_HAPPY, { kind: 'listen' }, LISTENING, BOTH],
  ])('activity command: %s', (_name, from, input, to, effects) => {
    expect(transition(from, input)).toEqual({ state: to, ...effects });
  });

  it.each<Row>([
    [
      'idle',
      IDLE,
      { kind: 'react', reaction: 'happy' },
      { activity: 'idle', reaction: 'happy' },
      NONE,
    ],
    [
      'listening',
      LISTENING,
      { kind: 'react', reaction: 'sad' },
      { activity: 'listening', reaction: 'sad' },
      NONE,
    ],
    [
      'thinking',
      THINKING,
      { kind: 'react', reaction: 'confused' },
      { activity: 'thinking', reaction: 'confused' },
      NONE,
    ],
    ['speaking (overlay)', SPEAKING, { kind: 'react', reaction: 'happy' }, SPEAKING_HAPPY, NONE],
    [
      'reacting (replaces it)',
      REACTING,
      { kind: 'react', reaction: 'sad' },
      { activity: 'listening', reaction: 'sad' },
      END,
    ],
  ])('react while %s', (_name, from, input, to, effects) => {
    expect(transition(from, input)).toEqual({ state: to, ...effects });
  });

  it('shows a reaction as the reacting state, except during speech', () => {
    expect(visibleState(REACTING)).toBe('reacting');
    expect(visibleState({ activity: 'idle', reaction: 'neutral' })).toBe('reacting');
    expect(visibleState(SPEAKING_HAPPY)).toBe('speaking');
  });

  it.each<Row>([
    [
      'a reaction ends: back to the activity underneath',
      REACTING,
      { kind: 'reactionEnded' },
      LISTENING,
      NONE,
    ],
    ['speech ends: idle', SPEAKING, { kind: 'speechEnded' }, IDLE, NONE],
    [
      'speech ends during a reaction: the reaction finishes on its own',
      SPEAKING_HAPPY,
      { kind: 'speechEnded' },
      { activity: 'idle', reaction: 'happy' },
      NONE,
    ],
    [
      'a late speech end after leaving speaking changes nothing',
      LISTENING,
      { kind: 'speechEnded' },
      LISTENING,
      NONE,
    ],
    [
      'interrupt: idle, speech and reaction stopped',
      SPEAKING_HAPPY,
      { kind: 'interrupt' },
      IDLE,
      BOTH,
    ],
    ['interrupt when idle changes nothing', IDLE, { kind: 'interrupt' }, IDLE, NONE],
  ])('%s', (_name, from, input, to, effects) => {
    expect(transition(from, input)).toEqual({ state: to, ...effects });
  });
});
