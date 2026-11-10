import type { AvatarState } from './states.ts';

/** completed: played to the end. interrupted: cut short (a command, interrupt(), or the system stopped the audio). failed: the audio couldn't be loaded or played. */
export type SpeechEndReason = 'completed' | 'interrupted' | 'failed';

export type AvatarEvent =
  | { readonly type: 'stateChanged'; readonly from: AvatarState; readonly to: AvatarState }
  | { readonly type: 'speechStarted'; readonly durationMs: number }
  | { readonly type: 'speechEnded'; readonly reason: SpeechEndReason }
  /** Something failed without a caller to tell (a command's own failure rejects its promise). */
  | { readonly type: 'error'; readonly message: string }
  | { readonly type: 'disposed' };

export type AvatarEventType = AvatarEvent['type'];

export type AvatarEventOf<K extends AvatarEventType> = Extract<AvatarEvent, { readonly type: K }>;

export type AvatarEventListener<K extends AvatarEventType> = (event: AvatarEventOf<K>) => void;
