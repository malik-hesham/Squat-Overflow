// Hermes has no structuredClone; the shared XP and challenge code clones plain
// JSON profiles with it, so a JSON round trip is an exact stand-in.
if (typeof globalThis.structuredClone !== 'function') {
  globalThis.structuredClone = (<T>(value: T): T =>
    value === undefined ? value : JSON.parse(JSON.stringify(value))) as typeof structuredClone;
}

export {};
