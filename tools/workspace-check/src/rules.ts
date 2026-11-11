// The package boundaries of the digital human engine (docs/digital-human/architecture.md, section 2).
// Every workspace package needs an entry here; packages of later phases already have theirs.
import type { BoundaryRule, Rules } from './boundaries.ts';

const S = '@squat-overflow';
const TYPES = `${S}/avatar-types`;
const CORE = `${S}/avatar-core`;
const ASSETS = `${S}/avatar-assets`;

/** Native and desktop shells: never in shared or web code. */
const NATIVE = ['expo', 'expo-*', '@expo/*', 'react-native', 'react-native-*', '@react-native/*'];
const TAURI = ['@tauri-apps/*'];
/** Rendering and UI: never in the platform-independent packages. */
const UI = [
  'react',
  'react-dom',
  '@types/react',
  'three',
  '@types/three',
  '@react-three/*',
  'zustand',
];

/** No platform at all: core logic and contracts that run unchanged on every client. */
function platformFree(internal: readonly string[]): BoundaryRule {
  return { internal, forbidden: [...UI, ...NATIVE, ...TAURI], pure: true };
}

export const RULES: Rules = {
  [TYPES]: platformFree([]),
  [CORE]: platformFree([TYPES]),
  [ASSETS]: platformFree([TYPES]),
  [`${S}/speech-client`]: platformFree([TYPES]),
  [`${S}/avatar-renderer-web`]: {
    internal: [CORE, ASSETS, TYPES],
    forbidden: [...NATIVE, ...TAURI],
    pure: false,
  },
  [`${S}/avatar-renderer-native`]: {
    internal: [CORE, ASSETS, TYPES],
    forbidden: ['react-dom', ...TAURI],
    pure: false,
  },
  // Services run on the server; no package may depend on one (none lists them as internal).
  [`${S}/speech-api`]: { internal: [TYPES], forbidden: [...UI, ...NATIVE, ...TAURI], pure: false },
  [`${S}/conversation-api`]: {
    internal: [TYPES],
    forbidden: [...UI, ...NATIVE, ...TAURI],
    pure: false,
  },
  [`${S}/asset-delivery`]: {
    internal: [TYPES],
    forbidden: [...UI, ...NATIVE, ...TAURI],
    pure: false,
  },
  [`${S}/workspace-check`]: { internal: [], forbidden: [], pure: false },
};
