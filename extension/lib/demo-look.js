// ---------------------------------------------------------------------------
// How the exercise demo's person looks
// ---------------------------------------------------------------------------
// The one file to edit to restyle the demo figure. Every client draws lib/demo-model.js's scene:
// the extension's pages, the desktop app (which runs those pages) and the phone (react-native-svg),
// so a change here shows up in all three. Nothing to install or build: edit a value and reload.
//
// The figure is drawn flat, like a vector illustration: a bearded man in a tank top, shorts with a
// stripe down the side and trainers.
//
// - colors: "#rrggbb". `beard` and `stripe` are optional: leave `beard` out for a clean-shaven face,
//   `stripe` out for plain shorts.
// - wear: what each body part is dressed in, one of the names in `colors`. A tee: shoulders and
//   upperArm: "top". Long sleeves: forearm: "top" too. Trousers: knee and shin: "bottoms". No hair:
//   give `hair` the skin colour.
// - size: how thick each part is drawn, in metres on a life-size figure (about a part's widest
//   radius). It never moves a joint, so the moves, and the coach's check that each demo counts its
//   reps, stay the same.
//
// tests/check.mjs checks this file: a colour that isn't "#rrggbb", a part dressed in a colour that
// isn't in `colors`, or a misspelt or missing part fails it.

/** @typedef {{ colors: Record<string, string>, wear: Record<string, string>, size: Record<string, number> }} DemoLook */

/** @type {DemoLook} */
export const DEMO_LOOK = {
  colors: {
    skin: "#b9612f",
    hair: "#561c17",
    beard: "#561c17",
    eyes: "#2a1410",
    top: "#b8ae76", // a khaki tank top
    bottoms: "#34363a", // charcoal shorts
    stripe: "#5aa39a", // teal, down the side of the shorts
    shoes: "#5aa077", // mint trainers
  },
  wear: {
    head: "skin",
    neck: "skin",
    shoulders: "skin",
    torso: "top",
    upperArm: "skin",
    forearm: "skin",
    hand: "skin",
    hips: "bottoms",
    thigh: "bottoms",
    knee: "skin",
    shin: "skin",
    foot: "shoes",
  },
  size: {
    head: 0.13,
    neck: 0.05,
    shoulders: 0.06,
    torso: 0.115,
    upperArm: 0.064,
    forearm: 0.052,
    hand: 0.04,
    hips: 0.1,
    thigh: 0.088,
    knee: 0.052,
    shin: 0.058,
    foot: 0.05,
  },
};
