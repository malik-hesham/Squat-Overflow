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
    "shoulder_shrug": DemoVideo("zgToz5FiI-E", 12, "Renaissance Periodization",
        "Seated Dumbbell Shrug"),
    "chin_tuck": DemoVideo("kUuU2augcxg", 15, "Heafner Health Physical Therapy",
        "Seated Cervical Retraction Repeated"),
    "cross_swing": DemoVideo("3xTdpyuQ8G4", 17, "Range of Motion",
        "Cross body arm swings"),
    "wy_raise": DemoVideo("eKgiimUTPS4", 16, "Seaton Humphreys",
        "Scap Stabilisation - Mini Band WY"),
    "shoulder_roll": DemoVideo("c-UmFZ8A_1Q", 11, "Lift Your Life Academy",
        "Backward Shoulder Rolls"),
    "thoracic_extension": DemoVideo("2h33KDVoPII", 13, "E3 Rehab Exercise Library",
        "Seated Thoracic Extension with Head Supported"),
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
    "desk_row": DemoVideo("DmUX88nWClo", 16, "National Academy of Sports Medicine (NASM)",
        "How to do a Supported Bent-Over Dumbbell Row"),
    "scaption": DemoVideo("g4SrHMSsZpM", 14, "RoyPumphrey",
        "Scaption Shoulder Raise"),
    "front_raise": DemoVideo("kdw9T-FOpvg", 13, "Exercise Library dot com",
        "Dumbbell Front Raise | Exercise Demo | Male"),
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
    "standing_side_bend": DemoVideo("JRKA8ehSGnQ", 14, "Fitness By Physio",
        "Standing Lumbar Lateral Flexion — Quick Technique Demo"),
    "back_extension": DemoVideo("IAMfLvZqAhs", 14, "Performance Driven Physical Therapy",
        "Standing Back Extension"),
    "wrist_flex": DemoVideo("TjYzzl_RbbM", 17, "Husky Orthopaedics",
        "Exercise and Arthritis: Wrist flexion and extension"),
    "extensor_stretch": DemoVideo("tySyj745A0A", 14, "South Sherbrook Therapy Inc.",
        "Forearm (Wrist) Extensor Stretch"),
    "flexor_stretch": DemoVideo("z_C50jktRbU", 13, "South Sherbrook Therapy Inc.",
        "Forearm (Wrist) Flexor Stretch"),
    "prayer_stretch": DemoVideo("a0iuZ6eLJaQ", 10, "Nick O'Brien",
        "Stretching - Wrist Stretch - 'Prayer'"),
    "nerve_glide": DemoVideo("des6ap7WxcU", 18, "ALTA Physical Therapy & Pilates",
        "Median Nerve Glide Bilateral"),
    "seated_knee_ext": DemoVideo("w2cmxrw9PhA", 11, "CHESM",
        "2A Quadriceps: seated knee extension (ankle weight)"),
    "heel_slide": DemoVideo("8uExtPIZibA", 17, "HEP2go Inc",
        "SEATED HEEL SLIDES -hep2go"),
    "sit_to_stand": DemoVideo("9BpfezQ5Xyg", 13, "Total Rehab App",
        "Sit to Stand No Hands, Bottom Touch"),
    "mini_squat": DemoVideo("NDdzXVxrh-U", 17, "Trak Videos",
        "45 - Mini squat"),
    "hamstring_curl": DemoVideo("PpnhMmx56ag", 12, "Concept Move",
        "Rehab Exercise - Standing Hamstring Curl Body weight"),
    "palming": DemoVideo("G1za5_1eCIw", 7, "Dr. Sunil Dachepalli - Orthopaedic Surgeon",
        "Palming | Target: Eyes and Facial Muscles Relaxation"),
    "temple_massage": DemoVideo("1S3icphtJ8w", 17, "Taichi Workout",
        "TCM Acupoint Wellness Temple Massage - for tension headaches and eye strain"),
    "look_far": DemoVideo("6Qgp1eXmXkg", 17, "Low Vision Calgary - Neuro-Concussion Optometry",
        "20 20 20 Rule - Digital Eye Strain"),
    "near_far_focus": DemoVideo("ZdPxEabf-9M", 13, "PRO Caveman Athletes",
        "Pencil Push Up"),
    "eye_track_vertical": DemoVideo("aTUzkkGckw0", 15, "HomeFit",
        "Eyes Vertical Smooth Pursuit"),
}
