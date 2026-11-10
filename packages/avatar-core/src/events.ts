import type {
  AvatarEvent,
  AvatarEventListener,
  AvatarEventType,
} from '@squat-overflow/avatar-types';

type AnyListener = (event: AvatarEvent) => void;

/**
 * Typed event delivery for the controller. A listener that throws can't break the avatar or the
 * other listeners: its error goes to `reportError` (the client's logger).
 */
export class AvatarEvents {
  readonly #listeners = new Map<AvatarEventType, Set<AnyListener>>();
  readonly #reportError: (error: unknown) => void;

  constructor(reportError: (error: unknown) => void = () => undefined) {
    this.#reportError = reportError;
  }

  on<K extends AvatarEventType>(type: K, listener: AvatarEventListener<K>): () => void {
    let set = this.#listeners.get(type);
    if (!set) this.#listeners.set(type, (set = new Set()));
    const entry = listener as AnyListener;
    set.add(entry);
    return () => {
      set.delete(entry);
    };
  }

  /** Calls everyone subscribed at the moment of the call, in subscription order. */
  emit(event: AvatarEvent): void {
    for (const listener of [...(this.#listeners.get(event.type) ?? [])]) {
      try {
        listener(event);
      } catch (error) {
        this.#reportError(error);
      }
    }
  }

  clear(): void {
    this.#listeners.clear();
  }
}
