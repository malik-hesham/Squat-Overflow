// ---------------------------------------------------------------------------
// Demo videos
// ---------------------------------------------------------------------------
// A move can have a demo video: a short, silent MP4 of a person doing it, which the API server
// (server/) serves from server/demos/. The break window, the Practice page, the desktop app and the
// phone show the drawn figure (demo-model.js) first, and switch to the video once it plays. With no
// server (a local-only build), no video for the move, or no network, the figure stays. The video is
// asked for only when the user opens the demo, and the request carries no account details.

/**
 * @typedef {object} DemoCredit  whose footage a video is cut from, shown under the video
 * @property {string} title the original video's title
 * @property {string} author who made it
 * @property {string} url where it is
 * @property {string} license e.g. "CC BY 3.0"
 * @property {string} licenseUrl
 */

/** YouTube's "Creative Commons Attribution license (reuse allowed)". */
const YOUTUBE_CC_BY = { license: "CC BY 3.0", licenseUrl: "https://creativecommons.org/licenses/by/3.0/" };

/**
 * The moves with a video in server/demos, and whose footage each is: a credit for a clip cut from
 * someone else's video under an open license (the apps show it under the video), null for footage
 * of our own. Only these moves ask the server for a video, so no app shows a video without its
 * credit. The checks keep this list and server/demos the same (make-demo-video.mjs makes the videos).
 * @type {Readonly<Record<string, DemoCredit | null>>}
 */
export const DEMO_VIDEOS = Object.freeze({
  neck_tilt: { title: "AW MOBILITE Inclinaison tête", author: "Athomic Wellness", url: "https://www.youtube.com/watch?v=xUGeEFrGaeg", ...YOUTUBE_CC_BY },
  head_turn: { title: "AW MOBILITE Rotation tête", author: "Athomic Wellness", url: "https://www.youtube.com/watch?v=IGFyeU3hXSo", ...YOUTUBE_CC_BY },
  chin_to_chest: { title: "AW MOBILITE Flexion tête", author: "Athomic Wellness", url: "https://www.youtube.com/watch?v=JS4LlXK0Lr8", ...YOUTUBE_CC_BY },
  chin_tuck: { title: "Neck Retraction", author: "Dr. Mike Mills", url: "https://www.youtube.com/watch?v=F3q-mg3bSGI", ...YOUTUBE_CC_BY },
  levator_stretch: {
    title: "Levator Scapulae Stretch - Relieve Neck & Shoulder Tension!",
    author: "Ott Physical Therapy",
    url: "https://www.youtube.com/watch?v=RQZ2kEiKm3c",
    ...YOUTUBE_CC_BY,
  },
  cross_swing: { title: "Arm Hug Dynamic Stretch", author: "Get Strong with Emily", url: "https://www.youtube.com/watch?v=IkGj5OPDWsc", ...YOUTUBE_CC_BY },
  wy_raise: { title: "Wall Angels", author: "Larry Callaway", url: "https://www.youtube.com/watch?v=p-TmHf-cMtU", ...YOUTUBE_CC_BY },
  shoulder_roll: { title: "How to do Shoulder Rolls", author: "Get Strong with Emily", url: "https://www.youtube.com/watch?v=z-SWWhwL2w0", ...YOUTUBE_CC_BY },
  thoracic_extension: { title: "Seated thoracic stretch 1", author: "H2 Health", url: "https://www.youtube.com/watch?v=IRTF0Y1JIIM", ...YOUTUBE_CC_BY },
  seated_row: { title: "Seated Band Rows", author: "Get Fit Done", url: "https://www.youtube.com/watch?v=1qJJgDcVgWo", ...YOUTUBE_CC_BY },
  t_raise: { title: "How to do a Dumbbell Lateral Raise", author: "Get Strong with Emily", url: "https://www.youtube.com/watch?v=_nWpctnfY1A", ...YOUTUBE_CC_BY },
  desk_row: {
    title: "Dumbbell Single Arm Bent Over Row on Chair",
    author: "Get Strong with Emily",
    url: "https://www.youtube.com/watch?v=Pf2HlcJC7x0",
    ...YOUTUBE_CC_BY,
  },
  trunk_rotation: {
    title: "Seated Trunk Rotation with Prisoner Hands",
    author: "Lance Goyke",
    url: "https://www.youtube.com/watch?v=ZmjD_KBGmno",
    ...YOUTUBE_CC_BY,
  },
  scaption: {
    title: "Shoulder Scaption - Strengthen Your Rotator Cuff & Shoulder Stability!",
    author: "Ott Physical Therapy",
    url: "https://www.youtube.com/watch?v=Mo2bx_aV8Hg",
    ...YOUTUBE_CC_BY,
  },
  front_raise: {
    title: "How to do a Dumbbell Front Raise with Overhand Grip",
    author: "Get Strong with Emily",
    url: "https://www.youtube.com/watch?v=LsMLd6Pwwvw",
    ...YOUTUBE_CC_BY,
  },
  overhead_reach: {
    title: "Home Activity Program Level 1.3 Sitting (Arm Raises and Breathing)",
    author: "Vancouver Coastal Health",
    url: "https://www.youtube.com/watch?v=t93Ykj3EzfM",
    ...YOUTUBE_CC_BY,
  },
  external_rotation: {
    title: "External Shoulder Rotation with Band",
    author: "Get Strong with Emily",
    url: "https://www.youtube.com/watch?v=fXX9zyP3HaY",
    ...YOUTUBE_CC_BY,
  },
  cross_body_stretch: { title: "Cross-Body Arm Stretch", author: "Fitness Volt", url: "https://www.youtube.com/watch?v=nsH0OZSNj3w", ...YOUTUBE_CC_BY },
  seated_jacks: {
    title: "CARDIO sur chaise : 4 exercices simples pour booster votre coeur !",
    author: "Martine fait sa GYM douce adpatée 60 ans",
    url: "https://www.youtube.com/watch?v=5ZqjecCRUiI",
    ...YOUTUBE_CC_BY,
  },
  seated_side_bend: {
    title: "Seated Spine Stretch - Flexion (Forward) + Lateral (Side)",
    author: "Get Fit Done",
    url: "https://www.youtube.com/watch?v=RodUxuVz5iU",
    ...YOUTUBE_CC_BY,
  },
  knee_to_chest: {
    title: "Do These Seated Stretches at Your Desk - Follow Along for the Office",
    author: "Dr. Kimbra Runyan",
    url: "https://www.youtube.com/watch?v=R-IzXqdvNzI",
    ...YOUTUBE_CC_BY,
  },
  hip_hinge: { title: "How to do a Hip Hinge", author: "Get Strong with Emily", url: "https://www.youtube.com/watch?v=m01v541-cpQ", ...YOUTUBE_CC_BY },
  standing_side_bend: {
    title: "How to do a Standing Side Reach Dynamic Stretch",
    author: "Get Strong with Emily",
    url: "https://www.youtube.com/watch?v=XNVmD7PduXw",
    ...YOUTUBE_CC_BY,
  },
  back_extension: { title: "Back Extension", author: "Paleo University", url: "https://www.youtube.com/watch?v=92yO1Q8zc_Y", ...YOUTUBE_CC_BY },
  seated_hip_hinge: {
    title: "Seated Good Morning",
    author: "THP - Total Health Performance",
    url: "https://www.youtube.com/watch?v=27ps-aDQPB8",
    ...YOUTUBE_CC_BY,
  },
  // Ott names these by how the wrist bends, we name them by the muscle stretched: their "Wrist Flexion
  // Stretch" (hand bent down) stretches the extensors, their "Wrist Extension Stretch" the flexors.
  extensor_stretch: {
    title: "Wrist Flexion Stretch - Relieve Wrist Pain Fast!",
    author: "Ott Physical Therapy",
    url: "https://www.youtube.com/watch?v=Md2C9ZjQyB4",
    ...YOUTUBE_CC_BY,
  },
  flexor_stretch: {
    title: "Wrist Extension Stretch - Stretch Tight Forearms & Wrists",
    author: "Ott Physical Therapy",
    url: "https://www.youtube.com/watch?v=ilPSaPNpIFQ",
    ...YOUTUBE_CC_BY,
  },
  prayer_stretch: {
    title: "Prayer Stretch - Stretch Wrists & Forearms Easily!",
    author: "Ott Physical Therapy",
    url: "https://www.youtube.com/watch?v=9ARrkXkikzg",
    ...YOUTUBE_CC_BY,
  },
  palm_flip: {
    title: "Range of Motion (Elbows) - MSK Chapter",
    author: "opennursing",
    url: "https://www.youtube.com/watch?v=pFtCvfMP1JQ",
    ...YOUTUBE_CC_BY,
  },
  seated_knee_ext: { title: "Seated Knee Flexion", author: "Motion", url: "https://www.youtube.com/watch?v=G0EdB5vwmJY", ...YOUTUBE_CC_BY },
  sit_to_stand: { title: "Chair Sit to Stand", author: "Get Strong with Emily", url: "https://www.youtube.com/watch?v=8oIjQ4AKmhM", ...YOUTUBE_CC_BY },
  mini_squat: { title: "Mini Squats", author: "Motion", url: "https://www.youtube.com/watch?v=wqCvuhfRXRU", ...YOUTUBE_CC_BY },
  hamstring_curl: { title: "Hamstring Curl Standing", author: "Motion", url: "https://www.youtube.com/watch?v=WzJHR8B-JIk", ...YOUTUBE_CC_BY },
  seated_march: {
    title: "CARDIO sur chaise : 4 exercices simples pour booster votre coeur !",
    author: "Martine fait sa GYM douce adpatée 60 ans",
    url: "https://www.youtube.com/watch?v=5ZqjecCRUiI",
    ...YOUTUBE_CC_BY,
  },
  palming: {
    title: "Exercises for EYE STRAIN | 10 Minute Daily Routines",
    author: "Brain Education TV",
    url: "https://www.youtube.com/watch?v=_M7tlXb4yWs",
    ...YOUTUBE_CC_BY,
  },
  temple_massage: {
    title: "Exercises for EYE STRAIN | 10 Minute Daily Routines",
    author: "Brain Education TV",
    url: "https://www.youtube.com/watch?v=_M7tlXb4yWs",
    ...YOUTUBE_CC_BY,
  },
  near_far_focus: {
    title: "10 minute eye exercises - yoga for eyes",
    author: "Yogic Tara",
    url: "https://www.youtube.com/watch?v=5vobQOZmBS4",
    ...YOUTUBE_CC_BY,
  },
  eye_track_vertical: {
    title: "10 minute eye exercises - yoga for eyes",
    author: "Yogic Tara",
    url: "https://www.youtube.com/watch?v=5vobQOZmBS4",
    ...YOUTUBE_CC_BY,
  },
  eye_track_horizontal: {
    title: "10 minute eye exercises - yoga for eyes",
    author: "Yogic Tara",
    url: "https://www.youtube.com/watch?v=5vobQOZmBS4",
    ...YOUTUBE_CC_BY,
  },
});

/** @param {string} key */
const hasVideo = (key) => Object.prototype.hasOwnProperty.call(DEMO_VIDEOS, key);

/**
 * Where the move's demo video is, or null when it has none or there is no server to ask.
 * @param {string} apiUrl the API server's origin (config.js's API_URL), "" for none
 * @param {string} key
 * @returns {string | null}
 */
export function demoVideoUrl(apiUrl, key) {
  return apiUrl && hasVideo(key) ? `${apiUrl}/demos/${encodeURIComponent(key)}.mp4` : null;
}

/**
 * Whose footage the move's video is cut from, to show under it; null for our own or no video.
 * @param {string} key
 * @returns {DemoCredit | null}
 */
export function demoCredit(key) {
  return hasVideo(key) ? DEMO_VIDEOS[key] : null;
}
