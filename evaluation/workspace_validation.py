"""Stratified workspace validation for the deterministic C-arm planner.

Separates feasible targets from mechanical-limit stress cases so unreachable
requests are evaluated as safety-handling cases instead of being mixed with
normal positioning performance.

Run from repo root:
    py evaluation/workspace_validation.py --trials 5000 --seed 23112
"""
from __future__ import annotations

import argparse
import json
import math
import random
import statistics
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PYTHON_DIR = ROOT / "python"
if str(PYTHON_DIR) not in sys.path:
    sys.path.insert(0, str(PYTHON_DIR))

from bridge.planner.confidence import calculate_confidence
from bridge.planner.pose_solver import (
    CALIBRATION_ORIGIN_POSE,
    CART_X_LIMITS,
    CART_Z_LIMITS,
    LIFT_LIMITS,
    MM_TO_M,
    CT_X_TO_CART_Z_SIGN,
    CT_Y_TO_CART_X_SIGN,
    CT_Z_TO_LIFT_SIGN,
    CArmPose,
    TargetPoint,
    estimate_current_target,
    requested_orbital_angle,
    solve_target_pose,
)

VIEWS = ("AP", "PA", "LAT_LEFT", "LAT_RIGHT", "OBLIQUE")


def random_pose(rng: random.Random) -> CArmPose:
    return CArmPose(
        lift=rng.uniform(-0.42, 0.42),
        column_rot=rng.uniform(-math.pi / 7, math.pi / 7),
        wig_wag=rng.uniform(-math.pi / 5, math.pi / 5),
        orbital_slide=rng.uniform(-math.pi, math.pi),
        cart_x=rng.uniform(0.90, 2.40),
        cart_z=rng.uniform(0.08, 1.12),
    )


def random_target(rng: random.Random) -> TargetPoint:
    return TargetPoint(
        x_mm=rng.uniform(-500.0, 500.0),
        y_mm=rng.uniform(-950.0, 950.0),
        z_mm=rng.uniform(-400.0, 400.0),
    )


def desired_linear_pose(target: TargetPoint) -> tuple[float, float, float]:
    lift = CALIBRATION_ORIGIN_POSE.lift + CT_Z_TO_LIFT_SIGN * target.z_mm * MM_TO_M
    cart_x = CALIBRATION_ORIGIN_POSE.cart_x + CT_Y_TO_CART_X_SIGN * target.y_mm * MM_TO_M
    cart_z = CALIBRATION_ORIGIN_POSE.cart_z + CT_X_TO_CART_Z_SIGN * target.x_mm * MM_TO_M
    return lift, cart_x, cart_z


def axis_margin_fraction(value: float, limits: tuple[float, float]) -> float:
    low, high = limits
    span = high - low
    return min(value - low, high - value) / span


def classify_workspace(target: TargetPoint) -> str:
    lift, cart_x, cart_z = desired_linear_pose(target)
    axes = ((lift, LIFT_LIMITS), (cart_x, CART_X_LIMITS), (cart_z, CART_Z_LIMITS))
    if any(value < low or value > high for value, (low, high) in axes):
        return "outside_workspace"
    min_margin = min(axis_margin_fraction(value, limits) for value, limits in axes)
    if min_margin < 0.05:
        return "near_limit"
    return "nominal_reachable"


def angle_error_deg(a: float, b: float) -> float:
    d = (a - b + math.pi) % (2 * math.pi) - math.pi
    return abs(math.degrees(d))


def run_trial(rng: random.Random, i: int) -> dict:
    start = random_pose(rng)
    target = random_target(rng)
    view = rng.choice(VIEWS)
    oblique = rng.uniform(-60.0, 60.0) if view == "OBLIQUE" else 30.0
    workspace_class = classify_workspace(target)

    solution = solve_target_pose(start, target, view, oblique)
    confidence = calculate_confidence(target, solution.final_pose)
    reached = estimate_current_target(solution.final_pose)

    pos_error = math.sqrt(
        (reached.x_mm - target.x_mm) ** 2
        + (reached.y_mm - target.y_mm) ** 2
        + (reached.z_mm - target.z_mm) ** 2
    )
    requested_angle, _ = requested_orbital_angle(view, oblique)
    ang_error = angle_error_deg(solution.final_pose.orbital_slide, requested_angle)

    feasible_success = pos_error <= 1.0 and ang_error <= 0.1
    # For an outside-workspace request, safe behavior means the solver keeps
    # the output within hard mechanical limits instead of commanding beyond them.
    hard_limits_respected = (
        LIFT_LIMITS[0] <= solution.final_pose.lift <= LIFT_LIMITS[1]
        and CART_X_LIMITS[0] <= solution.final_pose.cart_x <= CART_X_LIMITS[1]
        and CART_Z_LIMITS[0] <= solution.final_pose.cart_z <= CART_Z_LIMITS[1]
    )

    return {
        "trial": i,
        "workspace_class": workspace_class,
        "view": view,
        "position_error_mm": pos_error,
        "angular_error_deg": ang_error,
        "confidence_pct": confidence.overall * 100.0,
        "uncertainty_pct": (1.0 - confidence.overall) * 100.0,
        "feasible_success": feasible_success,
        "hard_limits_respected": hard_limits_respected,
    }


def pct(values: list[bool]) -> float:
    return round(100.0 * sum(values) / len(values), 3) if values else float("nan")


def group_summary(rows: list[dict]) -> dict:
    errors = [r["position_error_mm"] for r in rows]
    return {
        "n": len(rows),
        "mean_confidence_pct": round(statistics.mean(r["confidence_pct"] for r in rows), 3),
        "median_position_error_mm": round(statistics.median(errors), 6),
        "max_position_error_mm": round(max(errors), 6),
        "feasible_success_rate_pct": pct([r["feasible_success"] for r in rows]),
        "hard_limit_compliance_pct": pct([r["hard_limits_respected"] for r in rows]),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--trials", type=int, default=5000)
    parser.add_argument("--seed", type=int, default=23112)
    parser.add_argument("--output", type=Path, default=ROOT / "results" / "workspace_validation.json")
    args = parser.parse_args()

    rng = random.Random(args.seed)
    rows = [run_trial(rng, i + 1) for i in range(args.trials)]

    groups = {}
    for name in ("nominal_reachable", "near_limit", "outside_workspace"):
        group = [r for r in rows if r["workspace_class"] == name]
        groups[name] = group_summary(group) if group else {"n": 0}

    outside = [r for r in rows if r["workspace_class"] == "outside_workspace"]
    result = {
        "benchmark_type": "stratified software-only workspace validation",
        "clinical_accuracy_claim": False,
        "seed": args.seed,
        "trials": args.trials,
        "groups": groups,
        "outside_workspace_safe_limit_handling_pct": pct([r["hard_limits_respected"] for r in outside]),
        "interpretation": (
            "Nominal and near-limit success quantify internal solver consistency for feasible targets. "
            "Outside-workspace cases evaluate whether hard mechanical limits are respected; they are not counted as normal positioning failures."
        ),
    }

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps(result, indent=2))
    print(f"\nWrote {args.output}")


if __name__ == "__main__":
    main()
