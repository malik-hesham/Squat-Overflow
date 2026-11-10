import { describe, expect, it } from 'vitest';
import { AVATAR_COMMAND_TYPES, parseAvatarCommand } from './commands.ts';

const SPEECH = {
  audioUrl: 'chrome-extension://abc/mock/hello.mp3',
  duration: 200,
  visemes: [{ timestamp: 0, duration: 200, viseme: 'aa', weight: 1 }],
};

describe('parseAvatarCommand', () => {
  it('knows the five commands', () => {
    expect(AVATAR_COMMAND_TYPES).toEqual(['idle', 'listen', 'think', 'speak', 'react']);
  });

  it.each([
    [{ type: 'idle' }],
    [{ type: 'listen' }],
    [{ type: 'think' }],
    [{ type: 'speak', speech: SPEECH }],
    [{ type: 'speak', speech: SPEECH, expression: 'happy' }],
    [{ type: 'react', reaction: 'surprised' }],
    [{ type: 'react', reaction: 'sad', intensity: 0.5, durationMs: 1200 }],
  ])('accepts %j', (command) => {
    expect(parseAvatarCommand({ ...command, from: 'popup' })).toEqual({ ok: true, value: command });
  });

  const TYPES = 'idle, listen, think, speak, react';
  it.each([
    ['null', null, ['command: must be an object']],
    ['no type', {}, [`type: must be one of ${TYPES}`]],
    ['an unknown type', { type: 'dance' }, [`type: must be one of ${TYPES}`]],
    ['an inherited name as type', { type: 'toString' }, [`type: must be one of ${TYPES}`]],
    ['speak without speech', { type: 'speak' }, ['speech: must be an object']],
    [
      'speak with broken speech',
      {
        type: 'speak',
        speech: { ...SPEECH, audioUrl: '', visemes: [{ ...SPEECH.visemes[0], weight: 3 }] },
      },
      [
        'speech.audioUrl: must be a non-empty string',
        'speech.visemes[0].weight: must be a number from 0 to 1',
      ],
    ],
    [
      'speak with an unknown expression',
      { type: 'speak', speech: SPEECH, expression: 'angry' },
      ['expression: must be one of neutral, happy, sad, surprised, confused, thinking'],
    ],
    [
      'react with an unknown reaction',
      { type: 'react', reaction: 'thinking' },
      ['reaction: must be one of neutral, happy, sad, surprised, confused'],
    ],
    [
      'react with bad options',
      { type: 'react', reaction: 'happy', intensity: 1.5, durationMs: 0 },
      ['intensity: must be a number from 0 to 1', 'durationMs: must be a finite number above 0'],
    ],
  ])('rejects %s', (_name, input, errors) => {
    expect(parseAvatarCommand(input)).toEqual({ ok: false, errors });
  });
});
