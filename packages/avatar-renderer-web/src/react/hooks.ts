import type { CoreAvatar } from '@squat-overflow/avatar-core';
import type { AvatarAssetManifest, AvatarState } from '@squat-overflow/avatar-types';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { loadAvatarModel, type LoadedAvatarModel } from '../loader.ts';

/**
 * Loads a model; null until it has loaded. Frees it when the component unmounts or the URL changes.
 * A failed load is thrown during render, for the nearest error boundary.
 */
export function useAvatarModel(
  url: string,
  manifest: AvatarAssetManifest
): LoadedAvatarModel | null {
  const [model, setModel] = useState<LoadedAvatarModel | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    let current = true;
    let loaded: LoadedAvatarModel | undefined;
    loadAvatarModel(url, manifest).then(
      (m) => {
        if (current) {
          loaded = m;
          setModel(m);
        } else {
          m.dispose();
        }
      },
      (e: unknown) => {
        if (current) setError(e);
      }
    );
    return () => {
      current = false;
      loaded?.dispose();
      setModel(null);
    };
  }, [url, manifest]);
  if (error !== null) {
    throw error instanceof Error
      ? error
      : new Error('the avatar model failed to load', { cause: error });
  }
  return model;
}

/** The avatar's state (idle, listening, ...), re-rendering when it changes. */
export function useAvatarState(avatar: CoreAvatar): AvatarState {
  const subscribe = useCallback(
    (onChange: () => void) => avatar.on('stateChanged', onChange),
    [avatar]
  );
  return useSyncExternalStore(subscribe, () => avatar.state);
}
