/**
 * Short demo videos (under 20 s) for each exercise, shown in the trainer on
 * request (port of server/analysis/demos.py).
 *
 * Picked from YouTube per exercise: public, embeddable, not age-restricted and
 * shorter than 20 seconds, preferring physio / rehab clinics, exercise libraries
 * and seated or desk versions of the move. Checked on 2026-11-06 with yt-dlp;
 * the pain-area moves added on 2026-11-07 were checked with yt-dlp too, except
 * `flexor_stretch`, `temple_massage` and `near_far_focus`, whose length comes
 * from the YouTube search listing and whose embedding was confirmed with oEmbed.
 * The videos belong to their channels; the UI credits the channel and links to it.
 */
export const MAX_DEMO_SECONDS = 20;

/** @typedef {{ readonly youtube_id: string, readonly seconds: number, readonly channel: string, readonly title: string }} DemoVideo */
/** The JSON a client gets for a demo (`DemoVideo.to_json()`). @typedef {DemoVideo & { url: string }} DemoVideoJson */

/** @param {DemoVideo} d */
export function demoUrl(d) {
  return `https://www.youtube.com/watch?v=${d.youtube_id}`;
}

/**
 * @param {DemoVideo} d
 * @returns {DemoVideoJson}
 */
export function demoToJson(d) {
  return { youtube_id: d.youtube_id, seconds: d.seconds, channel: d.channel, title: d.title, url: demoUrl(d) };
}

/**
 * @param {string} youtube_id
 * @param {number} seconds
 * @param {string} channel
 * @param {string} title
 * @returns {DemoVideo}
 */
function demo(youtube_id, seconds, channel, title) {
  return { youtube_id, seconds, channel, title };
}

/** @type {Readonly<Record<string, DemoVideo>>} */
export const DEMOS = {
  squat: demo("l83R5PblSMA", 17, "PureGym", "Leg exercise - How to bodyweight squat"),
  pushup: demo(
    "WDIpL0pjun0",
    14,
    "National Academy of Sports Medicine (NASM)",
    "How to do a Push-Up | Proper Form & Technique | NASM",
  ),
  curl: demo("W3GrFfEWBJM", 8, "Fitness By Physio", "Dumbbell Supinated Bicep Curls - Quick Technique Demo"),
  press: demo("HzIiNhHhhtA", 13, "Renaissance Periodization", "Seated Dumbbell Shoulder Press"),
  neck_tilt: demo("gBL3gYNtun0", 13, "Armin Moridi", "Neck Side to Side Tilt Active Stretch"),
  head_turn: demo("TBjOVrkpBy0", 16, "Wibbi", "Sitting, active cervical rotation"),
  chin_to_chest: demo("jpW6X3zffuM", 15, "NeuStrength", "Chin to Chest Stretch"),
  shoulder_shrug: demo("9tFavSFK7UY", 13, "Kara Shaffer Moves", "Seated Shoulder Shrugs"),
  chin_tuck: demo("kUuU2augcxg", 15, "Heafner Health Physical Therapy", "Seated Cervical Retraction Repeated"),
  cross_swing: demo("FBg8ilWkEK8", 14, "Dr. Christy Lee", "Arm Swings - Hugs"),
  wy_raise: demo(
    "HBCE9Ek0jLw",
    10,
    "Powered By Movement Physical Therapy & Performance",
    "Seated Wall Angel for Thoracic Mobility",
  ),
  shoulder_roll: demo("c-UmFZ8A_1Q", 11, "Lift Your Life Academy", "Backward Shoulder Rolls"),
  thoracic_extension: demo("qtFE6CHGK5Q", 17, "Phyx Physio", "Thoracic Extension Over Chair"),
  clasp_opener: demo(
    "kxvUpG69uUc",
    7,
    "Reps and Steps",
    "Chest Stretch (Hands Behind Back) | Open Your Chest & Improve Posture",
  ),
  seated_row: demo("zw3fZKVS4tQ", 5, "LiftSpan", "Best Back Exercises To Do At Home: Seated Row with Band"),
  t_raise: demo("XPPfnSEATJA", 18, "National Academy of Sports Medicine (NASM)", "How to do a Dumbbell Lateral Raise"),
  desk_punch: demo("FyaEGllqGDc", 12, "A Pocket Full of Exercise", "Seated Punches"),
  rhomboid_stretch: demo("IxAI_7vL-aw", 15, "Patient Exercises", "Rhomboid and Middle Trap Stretch - Clasped Hands"),
  desk_row: demo("gzDJWs1kTlQ", 14, "Felicia Soria", "Chair Single Arm Row"),
  scaption: demo("pPenE8MnVgU", 12, "Triumph Physio", "Shoulder Scaption | Rotator Cuff strengthening"),
  front_raise: demo("E-E0EqERFBg", 11, "OPEX Fitness", "Dumbbell Front Raise"),
  overhead_reach: demo("JLWVzoM9cxQ", 11, "The Diary of a Physio", "Overhead Reaches - Sitting Home Health Exercise"),
  external_rotation: demo(
    "PzX0v9JQJVA",
    13,
    "E3 Rehab Exercise Library",
    "Banded Bilateral Shoulder External Rotation",
  ),
  cross_body_stretch: demo("RcQM08F8xvI", 12, "Personalized Orthopedics", "POPB Crossover Arm Stretch"),
  seated_side_bend: demo("G6MnSiYRYkU", 12, "A Pocket Full of Exercise", "Seated Side Bend"),
  knee_to_chest: demo("MwFslmc6k0U", 15, "E3 Rehab Exercise Library", "Seated Single Knee to Chest"),
  hip_hinge: demo(
    "RNgwXYQ4F0s",
    13,
    "KP Movement Institute",
    "Level 1 (Beginner) - Bodyweight Hip Hinge | No Gym Required",
  ),
  standing_side_bend: demo("8dAH_w94pDU", 8, "Nexoft Fitness", "Standing Side Bend"),
  back_extension: demo("IAMfLvZqAhs", 14, "Performance Driven Physical Therapy", "Standing Back Extension"),
  wrist_flex: demo("TjYzzl_RbbM", 17, "Husky Orthopaedics", "Exercise and Arthritis: Wrist flexion and extension"),
  extensor_stretch: demo("tySyj745A0A", 14, "South Sherbrook Therapy Inc.", "Forearm (Wrist) Extensor Stretch"),
  flexor_stretch: demo("z_C50jktRbU", 13, "South Sherbrook Therapy Inc.", "Forearm (Wrist) Flexor Stretch"),
  prayer_stretch: demo("_x9CCeFtuZ4", 10, "Dr. Aliyyah Alidina", "Prayer Stretch for Carpal Tunnel"),
  nerve_glide: demo(
    "frl-Ca2aYV8",
    17,
    "Resilience RX",
    "Standing Median Nerve Glide | Waukesha's Best Physical Therapy",
  ),
  seated_knee_ext: demo(
    "grE0Gbhh7pg",
    15,
    "GLORY SPORT PHYSIO",
    "Extensión de rodilla sentado - Seated knee extension | Rehab rodilla",
  ),
  heel_slide: demo("g-BVnc8mE9Y", 15, "CafePhysio", "Seated Heel Slides"),
  sit_to_stand: demo("Dg20pIkkzh8", 16, "NHS University Hospitals Plymouth Physiotherapy", "Sit to stand"),
  mini_squat: demo("NDdzXVxrh-U", 17, "Trak Videos", "45 - Mini squat"),
  hamstring_curl: demo("PpnhMmx56ag", 12, "Concept Move", "Rehab Exercise - Standing Hamstring Curl Body weight"),
  palming: demo(
    "G1za5_1eCIw",
    7,
    "Dr. Sunil Dachepalli - Orthopaedic Surgeon",
    "Palming | Target: Eyes and Facial Muscles Relaxation",
  ),
  temple_massage: demo("1-hVj9Zqcjk", 17, "Benefit Corporate Health", "Tension Headache? Try this Temple Massage"),
  look_far: demo(
    "6Qgp1eXmXkg",
    17,
    "Low Vision Calgary - Neuro-Concussion Optometry",
    "20 20 20 Rule - Digital Eye Strain",
  ),
  near_far_focus: demo("rkZqDNQvblc", 19, "Brain Balance Achievement Center of Bergen County", "Near Far Focusing"),
  eye_track_vertical: demo("3Iu4tlovL-E", 15, "Glycemia Anti Diabetic Clinic", "Exercise 1 - Eye up and down"),
};
