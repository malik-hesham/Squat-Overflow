/** Expressions the avatar can react with (the REACTING state). */
export const REACTIONS = ['neutral', 'happy', 'sad', 'surprised', 'confused'] as const;

export type Reaction = (typeof REACTIONS)[number];

/** Every face preset: the reactions, plus the face the THINKING state wears. */
export const AVATAR_EXPRESSIONS = [...REACTIONS, 'thinking'] as const;

export type AvatarExpression = (typeof AVATAR_EXPRESSIONS)[number];
