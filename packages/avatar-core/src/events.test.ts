import type { AvatarEvent } from '@squat-overflow/avatar-types';
import { describe, expect, it } from 'vitest';
import { AvatarEvents } from './events.ts';

const STARTED: AvatarEvent = { type: 'speechStarted', durationMs: 420 };

describe('AvatarEvents', () => {
  it('delivers an event only to listeners of its type', () => {
    const events = new AvatarEvents();
    const started: AvatarEvent[] = [];
    const changed: AvatarEvent[] = [];
    events.on('speechStarted', (e) => started.push(e));
    events.on('stateChanged', (e) => changed.push(e));

    events.emit(STARTED);

    expect(started).toEqual([STARTED]);
    expect(changed).toEqual([]);
  });

  it('stops delivering once unsubscribed; unsubscribing twice is harmless', () => {
    const events = new AvatarEvents();
    const seen: AvatarEvent[] = [];
    const off = events.on('speechStarted', (e) => seen.push(e));

    off();
    off();
    events.emit(STARTED);

    expect(seen).toEqual([]);
  });

  it("hands a listener's error to reportError and still calls the other listeners", () => {
    const errors: unknown[] = [];
    const events = new AvatarEvents((error) => errors.push(error));
    const seen: AvatarEvent[] = [];
    const boom = new Error('listener bug');
    events.on('speechStarted', () => {
      throw boom;
    });
    events.on('speechStarted', (e) => seen.push(e));

    events.emit(STARTED);

    expect(errors).toEqual([boom]);
    expect(seen).toEqual([STARTED]);
  });

  it('delivers an event to everyone subscribed when it was emitted, even if one unsubscribes a later one', () => {
    const events = new AvatarEvents();
    const calls: string[] = [];
    let offLater: () => void = () => undefined;
    events.on('speechStarted', () => {
      calls.push('first');
      offLater();
    });
    offLater = events.on('speechStarted', () => calls.push('later'));

    events.emit(STARTED);
    events.emit(STARTED);

    expect(calls).toEqual(['first', 'later', 'first']);
  });

  it('removes every listener on clear()', () => {
    const events = new AvatarEvents();
    const seen: AvatarEvent[] = [];
    events.on('speechStarted', (e) => seen.push(e));

    events.clear();
    events.emit(STARTED);

    expect(seen).toEqual([]);
  });
});
