import type { AvatarCommand } from './commands.ts';
import type { AvatarEventListener, AvatarEventType } from './events.ts';
import type { AvatarExpression } from './expressions.ts';
import type { Vec3 } from './math.ts';

/** How a command ended: on its own, or cut short by a newer command, interrupt() or dispose(). */
export type CommandOutcome = 'completed' | 'interrupted';

/**
 * The one API every client uses to drive the avatar. Platform-independent: avatar-core implements
 * it, and the same calls work in the extension, the desktop app and the mobile app.
 */
export interface AvatarController {
  /**
   * Runs a command (docs/digital-human/architecture.md, section 4). Settles with 'completed' when it
   * finishes on its own (speech played to the end, reaction over; idle, listen and think as soon as
   * they're entered) and 'interrupted' when cut short. Rejects only when it fails, e.g. audio that
   * can't be played.
   */
  execute(command: AvatarCommand): Promise<CommandOutcome>;
  /** Stops speech and any reaction, and goes back to idle. */
  interrupt(): void;
  /** Look at a point in avatar space; null goes back to the state's own gaze. */
  setGaze(target: Vec3 | null): void;
  /** The face to wear on top of the state's own; 'neutral' clears it. */
  setExpression(expression: AvatarExpression): void;
  /** Speaking body language for audio the avatar doesn't play itself. No lip sync without visemes. */
  setSpeaking(enabled: boolean): void;
  /** Subscribes to events; returns the function that unsubscribes. */
  on<K extends AvatarEventType>(type: K, listener: AvatarEventListener<K>): () => void;
  /** Stops everything and releases resources. Later calls do nothing. */
  dispose(): void;
}
