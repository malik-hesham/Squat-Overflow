"""Short demo videos (under 20 s) for each exercise, shown in the trainer on request.

Picked from YouTube per exercise: public, embeddable, not age-restricted and
shorter than 20 seconds, preferring physio / rehab clinics, exercise libraries
and seated or desk versions of the move. Checked on 2026-11-06 with yt-dlp.
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
    "overhead_reach": DemoVideo("JLWVzoM9cxQ", 11, "The Diary of a Physio",
        "Overhead Reaches - Sitting Home Health Exercise"),
    "alt_reach": DemoVideo("9nbFnyerlSg", 10, "FTH",
        "Seated Alt Overhead Reach"),
    "t_raise": DemoVideo("XPPfnSEATJA", 18, "National Academy of Sports Medicine (NASM)",
        "How to do a Dumbbell Lateral Raise"),
    "cross_swing": DemoVideo("FBg8ilWkEK8", 14, "Dr. Christy Lee",
        "Arm Swings - Hugs"),
    "triceps_reach": DemoVideo("dxdr8iSRLA8", 11, "OPEX Fitness",
        "Dumbbell Seated Overhead Tricep Extension - OPEX Exercise Library"),
    "air_curl": DemoVideo("3Sb3eedJwQg", 10, "MedicinalMoves",
        "Bicep Curls MedicinalMoves.com"),
    "seated_side_bend": DemoVideo("G6MnSiYRYkU", 12, "A Pocket Full of Exercise",
        "Seated Side Bend"),
    "wrist_flex": DemoVideo("TjYzzl_RbbM", 17, "Husky Orthopaedics",
        "Exercise and Arthritis: Wrist flexion and extension"),
    "seated_row": DemoVideo("zw3fZKVS4tQ", 5, "LiftSpan",
        "Best Back Exercises To Do At Home: Seated Row with Band"),
    "desk_punch": DemoVideo("FyaEGllqGDc", 12, "A Pocket Full of Exercise",
        "Seated Punches"),
    "seated_knee_ext": DemoVideo("grE0Gbhh7pg", 15, "GLORY SPORT PHYSIO",
        "Extensión de rodilla sentado - Seated knee extension | Rehab rodilla"),
    "seated_knee_lift": DemoVideo("8DAW2O3HIbo", 17, "Kendal On Hudson Exercise",
        "Alternating Knee Raise (seated)"),
    "seated_heel_raise": DemoVideo("M5j_CfIobHE", 10, "Northamptonshire Healthcare NHS Foundation Trust (NHFT)",
        "Seated heel raise"),
    "seated_lean_back": DemoVideo("OZ3nMrT3y1g", 10, "Kesson Physio",
        "Beginners Pilates Challenge 2: Seated Lean Backs"),
    "sit_to_stand": DemoVideo("Dg20pIkkzh8", 16, "NHS University Hospitals Plymouth Physiotherapy",
        "Sit to stand"),
    "mini_squat": DemoVideo("NDdzXVxrh-U", 17, "Trak Videos",
        "45 - Mini squat"),
    "desk_pushup": DemoVideo("z9vtn4Y1kL0", 17, "Megan Morse",
        "Desk Exercises: Desk Push Ups"),
    "chair_dip": DemoVideo("xwY4Oqv_OvU", 17, "Megan Morse",
        "Desk Exercises: Chair Dips"),
    "march": DemoVideo("Ac8M_Osjy6s", 11, "A Pocket Full of Exercise",
        "Marching in Place"),
    "hamstring_curl": DemoVideo("PpnhMmx56ag", 12, "Concept Move",
        "Rehab Exercise - Standing Hamstring Curl Body weight"),
    "side_leg_raise": DemoVideo("6gE-aj9uVIQ", 16, "Andrea Wood Wellness",
        "24. Side Leg Lifts (Standing with chair support)"),
    "hip_hinge": DemoVideo("RNgwXYQ4F0s", 13, "KP Movement Institute",
        "Level 1 (Beginner) - Bodyweight Hip Hinge | No Gym Required"),
    "standing_side_bend": DemoVideo("8dAH_w94pDU", 8, "Nexoft Fitness",
        "Standing Side Bend"),
    "calf_raise": DemoVideo("Uyg2QR1WAq8", 8, "FITASTIC",
        "Standing Bodyweight Calf Raise"),
    "leg_swing": DemoVideo("3yCNYviEdIo", 7, "Integrative Fitness",
        "Front Leg Swings (Supported)"),
    "reverse_lunge": DemoVideo("Rd986_TXFXc", 15, "Glute Lab",
        "Bodyweight Reverse Lunge"),
    "step_jack": DemoVideo("JHdVMkRBuRA", 11, "DAREBEE",
        "Exercise Library: Step Jacks"),
    "front_raise": DemoVideo("E-E0EqERFBg", 11, "OPEX Fitness",
        "Dumbbell Front Raise"),
}
