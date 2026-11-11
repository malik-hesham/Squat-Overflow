import {
  AVATAR_EXPRESSIONS,
  REACTIONS,
  type AvatarExpression,
  type Reaction,
} from './expressions.ts';
import { isOneOf, isPositive, isRecord, isUnit, oneOfMessage, type ParseResult } from './parse.ts';
import { parseSpeech, type SpeechResponse } from './speech.ts';

export const AVATAR_COMMAND_TYPES = ['idle', 'listen', 'think', 'speak', 'react'] as const;

export type AvatarCommandType = (typeof AVATAR_COMMAND_TYPES)[number];

export type AvatarCommand =
  | { readonly type: 'idle' }
  | { readonly type: 'listen' }
  | { readonly type: 'think' }
  | {
      readonly type: 'speak';
      readonly speech: SpeechResponse;
      readonly expression?: AvatarExpression;
    }
  | {
      readonly type: 'react';
      readonly reaction: Reaction;
      readonly intensity?: number;
      readonly durationMs?: number;
    };

type Input = Readonly<Record<string, unknown>>;

/**
 * Checks a command that arrives as data (an extension message, a Tauri IPC payload). The value it
 * returns has only the known fields.
 */
export function parseAvatarCommand(input: unknown): ParseResult<AvatarCommand> {
  if (!isRecord(input)) return { ok: false, errors: ['command: must be an object'] };
  const type = input['type'];
  if (!isOneOf(AVATAR_COMMAND_TYPES, type)) {
    return { ok: false, errors: [oneOfMessage('type', AVATAR_COMMAND_TYPES)] };
  }
  switch (type) {
    case 'idle':
    case 'listen':
    case 'think':
      return { ok: true, value: { type } };
    case 'speak':
      return parseSpeak(input);
    case 'react':
      return parseReact(input);
  }
}

function parseSpeak(input: Input): ParseResult<AvatarCommand> {
  const errors: string[] = [];
  const speech = parseSpeech(input['speech'], 'speech');
  if (!speech.ok) errors.push(...speech.errors);
  const expression = input['expression'];
  const expressionOk = expression === undefined || isOneOf(AVATAR_EXPRESSIONS, expression);
  if (!expressionOk) errors.push(oneOfMessage('expression', AVATAR_EXPRESSIONS));
  if (!speech.ok || !expressionOk) return { ok: false, errors };

  return {
    ok: true,
    value: {
      type: 'speak',
      speech: speech.value,
      ...(expression === undefined ? {} : { expression }),
    },
  };
}

function parseReact(input: Input): ParseResult<AvatarCommand> {
  const errors: string[] = [];
  const reaction = input['reaction'];
  const intensity = input['intensity'];
  const durationMs = input['durationMs'];
  const reactionOk = isOneOf(REACTIONS, reaction);
  if (!reactionOk) errors.push(oneOfMessage('reaction', REACTIONS));
  const intensityOk = intensity === undefined || isUnit(intensity);
  if (!intensityOk) errors.push('intensity: must be a number from 0 to 1');
  const durationOk = durationMs === undefined || isPositive(durationMs);
  if (!durationOk) errors.push('durationMs: must be a finite number above 0');
  if (!reactionOk || !intensityOk || !durationOk) return { ok: false, errors };

  return {
    ok: true,
    value: {
      type: 'react',
      reaction,
      ...(intensity === undefined ? {} : { intensity }),
      ...(durationMs === undefined ? {} : { durationMs }),
    },
  };
}
