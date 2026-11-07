import { nameText } from '@/src/core/i18n';

// The extension's 3D characters (extension/lib/avatar-characters.js), drawn
// here as emoji until the 3D buddies come to the app. The keys are what the
// leaderboard stores, so phone and extension players share one board.
export const AVATARS = {
  slothbear: { label: 'Sloth bear', emoji: '🐻' },
  bunny: { label: 'Bunny', emoji: '🐰' },
  penguin: { label: 'Penguin', emoji: '🐧' },
  dragon: { label: 'Baby dragon', emoji: '🐲' },
  critter: { label: 'Space critter', emoji: '👽' },
  platypus: { label: 'Platypus', emoji: '🦆' },
  monster: { label: 'Fuzzy monster', emoji: '👾' },
  robot: { label: 'Robot', emoji: '🤖' },
} as const;

export type AvatarKey = keyof typeof AVATARS;

export const avatarKey = (key: string | null | undefined): AvatarKey =>
  key && key in AVATARS ? (key as AvatarKey) : 'bunny';

export const avatarEmoji = (key: string | null | undefined) => (key && key in AVATARS ? AVATARS[key as AvatarKey].emoji : '🙂');

export const avatarName = (lang: string, key: AvatarKey) => nameText(lang, `avatar.${key}`, AVATARS[key].label);
