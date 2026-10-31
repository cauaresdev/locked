"""Exercise demo photos for the app, from free-exercise-db (public domain, The Unlicense).

Each exercise of the backend catalog maps to one dataset entry with two photos (start
and end position). The photos are downloaded, resized to 600 px and saved as WebP in
assets/exercises/, and src/engine/exerciseMedia.ts gets a static require() per frame.

    python3 -I scripts/gen_exercise_media.py            # needs Pillow and network access

Exercises without a match (mobility drills, burpee...) get written steps in
src/engine/howTo.ts instead.
"""

from __future__ import annotations

import os
import re
import sys
import urllib.request

from PIL import Image

SOURCE = "https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/{}/{}.jpg"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, "assets", "exercises")
MODULE = os.path.join(ROOT, "src", "engine", "exerciseMedia.ts")
WIDTH = 600
QUALITY = 62

# our exercise id -> free-exercise-db id
MAPPING = {
    "elliptical": "Elliptical_Trainer", "airdyne_easy": "Air_Bike", "airdyne_sprint": "Air_Bike",
    "incline_treadmill_walk": "Walking_Treadmill", "mountain_climber_sprint": "Mountain_Climbers",
    "rumble_roller_lower": "Iliotibial_Tract-SMR", "rumble_roller_full": "Latissimus_Dorsi-SMR",
    "worlds_greatest_stretch": "Worlds_Greatest_Stretch", "inchworm": "Inchworm",
    "strict_pull_up": "Pullups", "neutral_grip_pull_up": "V-Bar_Pullup", "chin_up": "Chin-Up",
    "scapular_pull_up": "Scapular_Pull-Up", "v_grip_lat_pulldown": "V-Bar_Pulldown",
    "wide_grip_lat_pulldown": "Wide-Grip_Lat_Pulldown", "supinated_pulldown": "Underhand_Cable_Pulldowns",
    "single_arm_cable_pulldown": "One_Arm_Lat_Pulldown", "straight_arm_pulldown": "Straight-Arm_Pulldown",
    "half_kneeling_cable_row": "Seated_One-arm_Cable_Pulley_Rows", "chest_supported_db_row": "Dumbbell_Incline_Row",
    "inverted_row": "Inverted_Row", "single_arm_db_row": "One-Arm_Dumbbell_Row",
    "barbell_bent_over_row": "Bent_Over_Barbell_Row", "smith_row": "Smith_Machine_Bent_Over_Row",
    "seated_machine_row": "Leverage_Iso_Row", "seated_cable_row": "Seated_Cable_Rows",
    "db_bench_press": "Dumbbell_Bench_Press", "db_floor_press": "Dumbbell_Floor_Press", "push_up": "Pushups",
    "decline_push_up": "Decline_Push-Up", "diamond_push_up": "Push-Ups_-_Close_Triceps_Position",
    "half_kneeling_cable_press": "Cable_Chest_Press", "barbell_bench_press": "Barbell_Bench_Press_-_Medium_Grip",
    "chest_press_machine": "Machine_Bench_Press", "smith_bench_press": "Smith_Machine_Bench_Press",
    "smith_incline_press": "Smith_Machine_Incline_Bench_Press", "incline_db_press": "Incline_Dumbbell_Press",
    "barbell_incline_press": "Barbell_Incline_Bench_Press_-_Medium_Grip", "dips": "Dips_-_Chest_Version",
    "bench_dip": "Bench_Dips", "pec_deck_fly": "Butterfly", "cable_crossover": "Cable_Crossover",
    "low_cable_fly": "Low_Cable_Crossover", "db_fly": "Dumbbell_Flyes", "med_ball_chest_pass": "Medicine_Ball_Chest_Pass",
    "seated_db_shoulder_press": "Seated_Dumbbell_Press", "shoulder_press_machine": "Machine_Shoulder_Military_Press",
    "smith_shoulder_press": "Smith_Machine_Overhead_Shoulder_Press", "barbell_overhead_press": "Standing_Military_Press",
    "barbell_push_press": "Push_Press", "db_lateral_raise": "Side_Lateral_Raise",
    "cable_lateral_raise": "Cable_Seated_Lateral_Raise", "face_pull": "Face_Pull", "band_pull_apart": "Band_Pull_Apart",
    "reverse_pec_deck": "Reverse_Machine_Flyes", "cable_rear_delt_fly": "Cable_Rear_Delt_Fly",
    "db_rear_delt_fly": "Seated_Bent-Over_Rear_Delt_Raise", "db_shrug": "Dumbbell_Shrug", "trap_bar_shrug": "Dumbbell_Shrug",
    "smith_shrug": "Barbell_Shrug", "barbell_shrug": "Barbell_Shrug",
    "plate_neck_curl": "Lying_Face_Up_Plate_Neck_Resistance", "plate_neck_extension": "Lying_Face_Down_Plate_Neck_Resistance",
    "band_neck_iso": "Isometric_Neck_Exercise_-_Front_And_Back", "manual_neck_iso": "Isometric_Neck_Exercise_-_Sides",
    "goblet_squat": "Goblet_Squat", "front_squat": "Front_Barbell_Squat", "jump_squat": "Freehand_Jump_Squat",
    "kb_front_rack_squat": "Front_Squats_With_Two_Kettlebells", "air_squat": "Bodyweight_Squat", "back_squat": "Barbell_Squat",
    "hack_squat": "Hack_Squat", "smith_squat": "Smith_Machine_Squat", "leg_press": "Leg_Press", "leg_press_single": "Leg_Press",
    "box_jump": "Front_Box_Jump", "trap_bar_deadlift": "Trap_Bar_Deadlift", "db_romanian_deadlift": "Stiff-Legged_Dumbbell_Deadlift",
    "barbell_rdl": "Romanian_Deadlift", "smith_rdl": "Smith_Machine_Stiff-Legged_Deadlift",
    "single_leg_rdl": "Kettlebell_One-Legged_Deadlift", "kb_swing": "One-Arm_Kettlebell_Swings",
    "barbell_hip_thrust": "Barbell_Hip_Thrust", "smith_hip_thrust": "Barbell_Hip_Thrust",
    "single_leg_hip_thrust": "Single_Leg_Glute_Bridge", "cable_pull_through": "Pull_Through", "broad_jump": "Standing_Long_Jump",
    "med_ball_slam": "One-Arm_Medicine_Ball_Slam", "db_reverse_lunge": "Dumbbell_Rear_Lunge",
    "rfe_split_squat": "Split_Squat_with_Dumbbells", "smith_split_squat": "Smith_Single-Leg_Split_Squat",
    "jumping_lunge": "Split_Jump", "db_walking_lunge": "Dumbbell_Lunges", "alternating_lunge": "Bodyweight_Walking_Lunge",
    "box_step_up": "Dumbbell_Step_Ups", "leg_extension": "Leg_Extensions", "single_leg_extension": "Single-Leg_Leg_Extension",
    "lying_leg_curl": "Lying_Leg_Curls", "seated_leg_curl": "Seated_Leg_Curl", "nordic_curl": "Natural_Glute_Ham_Raise",
    "standing_calf_raise": "Standing_Calf_Raises", "seated_calf_raise": "Seated_Calf_Raise",
    "leg_press_calf_raise": "Calf_Press_On_The_Leg_Press_Machine", "smith_calf_raise": "Smith_Machine_Calf_Raise",
    "single_leg_calf_raise": "Standing_Dumbbell_Calf_Raise", "hip_abduction": "Thigh_Abductor", "hip_adduction": "Thigh_Adductor",
    "cable_kickback": "One-Legged_Cable_Kickback", "db_farmers_walk": "Farmers_Walk", "trap_bar_carry": "Farmers_Walk",
    "sled_push": "Sled_Push", "short_sprint": "Wind_Sprints", "double_under": "Rope_Jumping",
    "pallof_press": "Pallof_Press", "cable_woodchop": "Standing_Cable_Wood_Chop", "landmine_rotation": "Landmine_180s",
    "side_plank": "Side_Bridge", "plank": "Plank", "dead_bug": "Dead_Bug", "ab_wheel_rollout": "Ab_Roller",
    "alt_hanging_knee_up": "Hanging_Leg_Raise", "hanging_leg_raise": "Hanging_Leg_Raise", "v_up": "Jackknife_Sit-Up",
    "reverse_crunch": "Reverse_Crunch", "cable_crunch": "Cable_Crunch",
    "alt_db_open_curl_complex": "Dumbbell_Alternate_Bicep_Curl", "db_hammer_curl": "Hammer_Curls", "barbell_curl": "Barbell_Curl",
    "cable_curl": "Standing_Biceps_Cable_Curl", "incline_db_curl": "Incline_Dumbbell_Curl",
    "cable_triceps_pressdown": "Triceps_Pushdown", "overhead_cable_extension": "Cable_Rope_Overhead_Triceps_Extension",
    "db_overhead_extension": "Standing_Dumbbell_Triceps_Extension", "db_skullcrusher": "Lying_Dumbbell_Tricep_Extension",
    "cable_skullcrusher": "Cable_Lying_Triceps_Extension", "close_grip_smith_press": "Smith_Machine_Close-Grip_Bench_Press",
    "db_thruster": "Kettlebell_Thruster",
    "conventional_deadlift": "Barbell_Deadlift", "box_squat": "Box_Squat", "good_morning": "Good_Morning",
    "back_extension": "Hyperextensions_Back_Extensions", "barbell_floor_press": "Floor_Press",
    "pendlay_row": "Bent_Over_Barbell_Row", "single_leg_curl": "Lying_Leg_Curls",
    "alt_db_curl": "Dumbbell_Alternate_Bicep_Curl", "reverse_curl": "Reverse_Barbell_Curl",
}



def slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", s.lower()).strip("_")


def main() -> None:
    os.makedirs(ASSETS, exist_ok=True)
    total = 0
    for src in sorted(set(MAPPING.values())):
        for n in (0, 1):
            dst = os.path.join(ASSETS, f"{slug(src)}_{n}.webp")
            if not os.path.exists(dst):
                tmp, _ = urllib.request.urlretrieve(SOURCE.format(src, n))
                im = Image.open(tmp).convert("RGB")
                im.thumbnail((WIDTH, WIDTH))
                im.save(dst, "WEBP", quality=QUALITY, method=6)
            total += os.path.getsize(dst)
    lines = [
        "// Generated by scripts/gen_exercise_media.py from free-exercise-db (public domain photos).",
        "// Two frames per exercise, start and end position. Regenerate instead of editing by hand.",
        "",
        "import type { ImageSourcePropType } from 'react-native';",
        "",
        "export const EXERCISE_FRAMES: Record<string, [ImageSourcePropType, ImageSourcePropType]> = {",
    ]
    for ours, src in sorted(MAPPING.items()):
        s = slug(src)
        lines.append(f"  {ours}: [require('../../assets/exercises/{s}_0.webp'), "
                     f"require('../../assets/exercises/{s}_1.webp')],")
    lines.append("};")
    with open(MODULE, "w") as f:
        f.write("\n".join(lines) + "\n")
    print(f"{len(MAPPING)} exercises, {len(set(MAPPING.values()))} photo pairs, {total / 1e6:.1f} MB", file=sys.stderr)


if __name__ == "__main__":
    main()
