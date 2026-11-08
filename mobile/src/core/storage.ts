// A small stand-in for chrome.storage.local: JSON values in AsyncStorage, an
// in-memory copy so reads after the first are cheap, and change listeners so
// screens re-render when the engine writes (like chrome.storage.onChanged).
import AsyncStorage from '@react-native-async-storage/async-storage';

const PREFIX = 'so:';
type Listener = (keys: string[]) => void;

const cache = new Map<string, unknown>();
const listeners = new Set<Listener>();
let loaded: Promise<void> | null = null;

function load(): Promise<void> {
  loaded ??= (async () => {
    const keys = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(PREFIX));
    for (const [k, raw] of await AsyncStorage.multiGet(keys)) {
      if (raw == null) continue;
      try {
        cache.set(k.slice(PREFIX.length), JSON.parse(raw));
      } catch {
        // A corrupt value reads as missing; the next write replaces it.
      }
    }
  })();
  return loaded;
}

export async function getItems<T extends Record<string, unknown>>(keys: (keyof T & string)[]): Promise<Partial<T>> {
  await load();
  const out: Partial<T> = {};
  for (const k of keys) if (cache.has(k)) out[k] = structuredClone(cache.get(k)) as T[typeof k];
  return out;
}

export async function getItem<T>(key: string): Promise<T | undefined> {
  await load();
  return cache.has(key) ? (structuredClone(cache.get(key)) as T) : undefined;
}

export async function setItems(patch: Record<string, unknown>): Promise<void> {
  await load();
  const keys = Object.keys(patch);
  for (const k of keys) cache.set(k, structuredClone(patch[k]));
  await AsyncStorage.multiSet(keys.map((k) => [PREFIX + k, JSON.stringify(patch[k])]));
  for (const l of listeners) l(keys);
}

export async function removeItems(keys: string[]): Promise<void> {
  await load();
  for (const k of keys) cache.delete(k);
  await AsyncStorage.multiRemove(keys.map((k) => PREFIX + k));
  for (const l of listeners) l(keys);
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
