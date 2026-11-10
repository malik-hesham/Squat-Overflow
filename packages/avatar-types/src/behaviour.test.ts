import { describe, expect, it } from 'vitest';
import { AVATAR_EXPRESSIONS, REACTIONS } from './expressions.ts';
import { AVATAR_STATES } from './states.ts';

describe('states and expressions', () => {
  it('has the five avatar states, idle first', () => {
    expect(AVATAR_STATES).toEqual(['idle', 'listening', 'thinking', 'speaking', 'reacting']);
  });

  it('can react with five expressions; thinking is an expression but not a reaction', () => {
    expect(REACTIONS).toEqual(['neutral', 'happy', 'sad', 'surprised', 'confused']);
    expect(AVATAR_EXPRESSIONS).toEqual([...REACTIONS, 'thinking']);
  });
});
