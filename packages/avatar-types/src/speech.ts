import {
  isFiniteNumber,
  isPositive,
  isRecord,
  isUnit,
  oneOfMessage,
  type ParseResult,
} from './parse.ts';
import { VISEMES, isVisemeId, type VisemeId } from './visemes.ts';

/**
 * One mouth shape over a stretch of the audio. Times are milliseconds from the start of the audio;
 * the avatar samples them against the audio's own playback position, never a separate timer.
 */
export interface VisemeEvent {
  /** When the shape starts, in ms from the start of the audio. 0 or more. */
  readonly timestamp: number;
  /** How long it lasts, in ms. Above 0. Events may overlap (coarticulation). */
  readonly duration: number;
  readonly viseme: VisemeId;
  /** How far the shape opens, 0 to 1. */
  readonly weight: number;
}

/** What the speech service returns for one utterance. */
export interface SpeechResponse {
  /** Where the audio plays from: https:, blob:, or a file packaged with the client. */
  readonly audioUrl: string;
  /** Length of the audio in ms. Above 0. */
  readonly duration: number;
  /** In time order (by timestamp); every event ends within the audio. */
  readonly visemes: readonly VisemeEvent[];
}

/** Slack for floating-point sums when checking that an event ends within the audio. */
const END_TOLERANCE_MS = 1e-6;

/** Checks a speech response from the network. The value it returns has only the known fields. */
export function parseSpeechResponse(input: unknown): ParseResult<SpeechResponse> {
  return parseSpeech(input, '');
}

/**
 * parseSpeechResponse for a response nested in other data: `at` prefixes every error path
 * ('speech' gives 'speech.audioUrl: …'). Internal to avatar-types.
 */
export function parseSpeech(input: unknown, at: string): ParseResult<SpeechResponse> {
  const path = (field: string) => (at ? `${at}.${field}` : field);
  if (!isRecord(input)) return { ok: false, errors: [`${at || 'response'}: must be an object`] };
  const audioUrl = input['audioUrl'];
  const duration = input['duration'];
  const visemes = input['visemes'];

  const errors: string[] = [];
  const urlOk = typeof audioUrl === 'string' && audioUrl !== '';
  if (!urlOk) errors.push(`${path('audioUrl')}: must be a non-empty string`);
  const durationOk = isPositive(duration);
  if (!durationOk) errors.push(`${path('duration')}: must be a finite number above 0`);
  let events: VisemeEvent[] = [];
  if (Array.isArray(visemes)) {
    events = parseVisemeEvents(visemes, path('visemes'), durationOk ? duration : undefined, errors);
  } else {
    errors.push(`${path('visemes')}: must be an array`);
  }

  if (!urlOk || !durationOk || errors.length > 0) return { ok: false, errors };
  return { ok: true, value: { audioUrl, duration, visemes: events } };
}

/** Checks each event, and that the events are in time order and end within the audio (when known). */
function parseVisemeEvents(
  items: readonly unknown[],
  at: string,
  audioEnd: number | undefined,
  errors: string[]
): VisemeEvent[] {
  const events: VisemeEvent[] = [];
  items.forEach((item, i) => {
    const path = `${at}[${i}]`;
    const event = parseVisemeEvent(item, path, errors);
    if (!event) return;
    const end = event.timestamp + event.duration;
    if (audioEnd !== undefined && end > audioEnd + END_TOLERANCE_MS) {
      errors.push(`${path}: ends at ${end} ms, after the audio ends (${audioEnd} ms)`);
    }
    const previous = events.at(-1);
    if (previous && event.timestamp < previous.timestamp) {
      errors.push(
        `${path}: starts at ${event.timestamp} ms, before the event above it (${previous.timestamp} ms); events must be in time order`
      );
    }
    events.push(event);
  });
  return events;
}

function parseVisemeEvent(item: unknown, path: string, errors: string[]): VisemeEvent | undefined {
  if (!isRecord(item)) {
    errors.push(`${path}: must be an object`);
    return undefined;
  }
  const timestamp = item['timestamp'];
  const duration = item['duration'];
  const viseme = item['viseme'];
  const weight = item['weight'];

  const timestampOk = isFiniteNumber(timestamp) && timestamp >= 0;
  if (!timestampOk) errors.push(`${path}.timestamp: must be a finite number of 0 or more`);
  const durationOk = isPositive(duration);
  if (!durationOk) errors.push(`${path}.duration: must be a finite number above 0`);
  const visemeOk = isVisemeId(viseme);
  if (!visemeOk) errors.push(oneOfMessage(`${path}.viseme`, VISEMES));
  const weightOk = isUnit(weight);
  if (!weightOk) errors.push(`${path}.weight: must be a number from 0 to 1`);
  if (!timestampOk || !durationOk || !visemeOk || !weightOk) return undefined;

  return { timestamp, duration, viseme, weight };
}
