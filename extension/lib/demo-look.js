// ---------------------------------------------------------------------------
// How the exercise demo's person looks
// ---------------------------------------------------------------------------
// The one file to edit to restyle the demo figure. Every client draws lib/demo-model.js's scene:
// the extension's pages, the desktop app (which runs those pages) and the phone (react-native-svg),
// so a change here shows up in all three. Nothing to install or build: edit a value and reload.
//
// - colors: "#rrggbb".
// - wear: what each body part is dressed in, one of the names in `colors`. Long sleeves: forearm:
//   "top". Trousers: shin: "bottoms". No hair: give `hair` the skin colour.
// - size: how thick each part is drawn, as a radius in metres on a life-size figure. It never moves
//   a joint, so the moves, and the coach's check that each demo counts its reps, stay the same.
//
// tests/check.mjs checks this file: a colour that isn't "#rrggbb", a part dressed in a colour that
// isn't in `colors`, or a misspelt or missing part fails it.

/** @typedef {{ colors: Record<string, string>, wear: Record<string, string>, size: Record<string, number> }} DemoLook */

/** @type {DemoLook} */
export const DEMO_LOOK = {
  colors: {
    skin: "#e0b08a",
    hair: "#33261d",
    eyes: "#2b2018",
    top: "#f2f1ec", // a white tee
    bottoms: "#4d6a92", // denim shorts
    shoes: "#24262a", // black trainers
  },
  wear: {
    head: "skin",
    neck: "skin",
    shoulders: "top",
    torso: "top",
    upperArm: "top",
    forearm: "skin",
    hand: "skin",
    hips: "bottoms",
    thigh: "bottoms",
    shin: "skin",
    foot: "shoes",
  },
  size: {
    head: 0.105,
    neck: 0.045,
    shoulders: 0.06,
    torso: 0.12,
    upperArm: 0.045,
    forearm: 0.038,
    hand: 0.028,
    hips: 0.085,
    thigh: 0.065,
    shin: 0.05,
    foot: 0.034,
  },
};
