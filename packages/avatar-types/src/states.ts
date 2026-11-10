/**
 * What the avatar is doing. idle, listening, thinking and speaking are activities (one at a time,
 * the newest command wins); reacting is a short reaction that returns to the activity underneath.
 * See docs/digital-human/architecture.md, section 4.
 */
export const AVATAR_STATES = ['idle', 'listening', 'thinking', 'speaking', 'reacting'] as const;

export type AvatarState = (typeof AVATAR_STATES)[number];
