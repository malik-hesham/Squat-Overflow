/**
 * A point in metres, in avatar space: +Y up, +Z out of the avatar's face (towards the viewer),
 * +X to the avatar's left, origin on the floor between its feet.
 */
export type Vec3 = readonly [x: number, y: number, z: number];

/**
 * A head or neck rotation from the bind pose, in radians. Positive yaw turns to the avatar's left,
 * positive pitch looks up, positive roll tilts the head towards its left shoulder. Renderers convert
 * this to their engine's own axes.
 */
export interface HeadRotation {
  readonly yaw: number;
  readonly pitch: number;
  readonly roll: number;
}

/** An eye rotation from straight ahead, in radians; same signs as HeadRotation. */
export interface EyeRotation {
  readonly yaw: number;
  readonly pitch: number;
}
