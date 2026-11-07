"""Short demo videos (under 20 s) for each exercise, shown in the trainer on request.

Picked from YouTube per exercise: public, embeddable, not age-restricted and
shorter than 20 seconds, preferring physio / rehab clinics, exercise libraries
and seated or desk versions of the move. Checked on 2026-11-06 with yt-dlp; the
pain-area moves added on 2026-11-07 were checked with yt-dlp too, except
`flexor_stretch`, `temple_massage` and `near_far_focus`, whose length comes from
the YouTube search listing and whose embedding was confirmed with oEmbed.
The videos belong to their channels; the UI credits the channel and links to it.
"""

from __future__ import annotations

from dataclasses import dataclass

MAX_DEMO_SECONDS = 20


@dataclass(frozen=True)
class DemoVideo:
    youtube_id: str
    seconds: int
    channel: str
    title: str

    @property
    def url(self) -> str:
        return f"https://www.youtube.com/watch?v={self.youtube_id}"

    def to_json(self) -> dict:
        return {"youtube_id": self.youtube_id, "seconds": self.seconds, "channel": self.channel,
                "title": self.title, "url": self.url}


DEMOS: dict[str, DemoVideo] = {
    "squat": DemoVideo("l83R5PblSMA", 17, "PureGym",
        "Leg exercise - How to bodyweight squat"),
    "pushup": DemoVideo("WDIpL0pjun0", 14, "National Academy of Sports Medicine (NASM)",
        "How to do a Push-Up | Proper Form & Technique | NASM"),
    "curl": DemoVideo("W3GrFfEWBJM", 8, "Fitness By Physio",
        "Dumbbell Supinated Bicep Curls - Quick Technique Demo"),
    "press": DemoVideo("HzIiNhHhhtA", 13, "Renaissance Periodization",
        "Seated Dumbbell Shoulder Press"),
    "neck_tilt": DemoVideo("gBL3gYNtun0", 13, "Armin Moridi",
        "Neck Side to Side Tilt Active Stretch"),
    "head_turn": DemoVideo("TBjOVrkpBy0", 16, "Wibbi",
        "Sitting, active cervical rotation"),
    "chin_to_chest": DemoVideo("jpW6X3zffuM", 15, "NeuStrength",
        "Chin to Chest Stretch"),
    "shoulder_shrug": DemoVideo("9tFavSFK7UY", 13, "Kara Shaffer Moves",
        "Seated Shoulder Shrugs"),
    "chin_tuck": DemoVideo("kUuU2augcxg", 15, "Heafner Health Physical Therapy",
        "Seated Cervical Retraction Repeated"),
    "cross_swing": DemoVideo("FBg8ilWkEK8", 14, "Dr. Christy Lee",
        "Arm Swings - Hugs"),
    "wy_raise": DemoVideo("HBCE9Ek0jLw", 10, "Powered By Movement Physical Therapy & Performance",
        "Seated Wall Angel for Thoracic Mobility"),
    "shoulder_roll": DemoVideo("c-UmFZ8A_1Q", 11, "Lift Your Life Academy",
        "Backward Shoulder Rolls"),
    "thoracic_extension": DemoVideo("qtFE6CHGK5Q", 17, "Phyx Physio",
        "Thoracic Extension Over Chair"),
    "clasp_opener": DemoVideo("kxvUpG69uUc", 7, "Reps and Steps",
        "Chest Stretch (Hands Behind Back) | Open Your Chest & Improve Posture"),
    "seated_row": DemoVideo("zw3fZKVS4tQ", 5, "LiftSpan",
        "Best Back Exercises To Do At Home: Seated Row with Band"),
    "t_raise": DemoVideo("XPPfnSEATJA", 18, "National Academy of Sports Medicine (NASM)",
        "How to do a Dumbbell Lateral Raise"),
    "desk_punch": DemoVideo("FyaEGllqGDc", 12, "A Pocket Full of Exercise",
        "Seated Punches"),
    "rhomboid_stretch": DemoVideo("IxAI_7vL-aw", 15, "Patient Exercises",
        "Rhomboid and Middle Trap Stretch - Clasped Hands"),
    "desk_row": DemoVideo("gzDJWs1kTlQ", 14, "Felicia Soria",
        "Chair Single Arm Row"),
    "scaption": DemoVideo("pPenE8MnVgU", 12, "Triumph Physio",
        "Shoulder Scaption | Rotator Cuff strengthening"),
    "front_raise": DemoVideo("E-E0EqERFBg", 11, "OPEX Fitness",
        "Dumbbell Front Raise"),
    "overhead_reach": DemoVideo("JLWVzoM9cxQ", 11, "The Diary of a Physio",
        "Overhead Reaches - Sitting Home Health Exercise"),
    "external_rotation": DemoVideo("PzX0v9JQJVA", 13, "E3 Rehab Exercise Library",
        "Banded Bilateral Shoulder External Rotation"),
    "cross_body_stretch": DemoVideo("RcQM08F8xvI", 12, "Personalized Orthopedics",
        "POPB Crossover Arm Stretch"),
    "seated_side_bend": DemoVideo("G6MnSiYRYkU", 12, "A Pocket Full of Exercise",
        "Seated Side Bend"),
    "knee_to_chest": DemoVideo("MwFslmc6k0U", 15, "E3 Rehab Exercise Library",
        "Seated Single Knee to Chest"),
    "hip_hinge": DemoVideo("RNgwXYQ4F0s", 13, "KP Movement Institute",
        "Level 1 (Beginner) - Bodyweight Hip Hinge | No Gym Required"),
    "standing_side_bend": DemoVideo("8dAH_w94pDU", 8, "Nexoft Fitness",
        "Standing Side Bend"),
    "back_extension": DemoVideo("IAMfLvZqAhs", 14, "Performance Driven Physical Therapy",
        "Standing Back Extension"),
    "wrist_flex": DemoVideo("TjYzzl_RbbM", 17, "Husky Orthopaedics",
        "Exercise and Arthritis: Wrist flexion and extension"),
    "extensor_stretch": DemoVideo("tySyj745A0A", 14, "South Sherbrook Therapy Inc.",
        "Forearm (Wrist) Extensor Stretch"),
    "flexor_stretch": DemoVideo("z_C50jktRbU", 13, "South Sherbrook Therapy Inc.",
        "Forearm (Wrist) Flexor Stretch"),
    "prayer_stretch": DemoVideo("_x9CCeFtuZ4", 10, "Dr. Aliyyah Alidina",
        "Prayer Stretch for Carpal Tunnel"),
    "nerve_glide": DemoVideo("frl-Ca2aYV8", 17, "Resilience RX",
        "Standing Median Nerve Glide | Waukesha's Best Physical Therapy"),
    "seated_knee_ext": DemoVideo("grE0Gbhh7pg", 15, "GLORY SPORT PHYSIO",
        "Extensión de rodilla sentado - Seated knee extension | Rehab rodilla"),
    "heel_slide": DemoVideo("g-BVnc8mE9Y", 15, "CafePhysio",
        "Seated Heel Slides"),
    "sit_to_stand": DemoVideo("Dg20pIkkzh8", 16, "NHS University Hospitals Plymouth Physiotherapy",
        "Sit to stand"),
    "mini_squat": DemoVideo("NDdzXVxrh-U", 17, "Trak Videos",
        "45 - Mini squat"),
    "hamstring_curl": DemoVideo("PpnhMmx56ag", 12, "Concept Move",
        "Rehab Exercise - Standing Hamstring Curl Body weight"),
    "palming": DemoVideo("G1za5_1eCIw", 7, "Dr. Sunil Dachepalli - Orthopaedic Surgeon",
        "Palming | Target: Eyes and Facial Muscles Relaxation"),
    "temple_massage": DemoVideo("1-hVj9Zqcjk", 17, "Benefit Corporate Health",
        "Tension Headache? Try this Temple Massage"),
    "look_far": DemoVideo("6Qgp1eXmXkg", 17, "Low Vision Calgary - Neuro-Concussion Optometry",
        "20 20 20 Rule - Digital Eye Strain"),
    "near_far_focus": DemoVideo("rkZqDNQvblc", 19, "Brain Balance Achievement Center of Bergen County",
        "Near Far Focusing"),
    "eye_track_vertical": DemoVideo("3Iu4tlovL-E", 15, "Glycemia Anti Diabetic Clinic",
        "Exercise 1 - Eye up and down"),
}
