"""Reproducible software-only validation for the C-arm planner.

This benchmark does NOT measure clinical or physical C-arm accuracy. It tests
internal consistency of the deterministic simulator across randomized starting
poses, targets, projections, and waypoint counts.

Run from repository root:
    py evaluation/simulated_validation.py --trials 1000 --seed 23112
"""
from __future__ import annotations

import argparse
import csv
import json
import math
import random
import statistics
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PYTHON_DIR = ROOT / "python"
if str(PYTHON_DIR) not in sys.path:
    sys.path.insert(0, str(PYTHON_DIR))

from bridge.planner.confidence import calculate_confidence
from bridge.planner.path_planner import create_path
from bridge.planner.pose_solver import (
    CArmPose,
    TargetPoint,
    estimate_current_target,
    requested_orbital_angle,
    solve_target_pose,
)

VIEWS = ("AP", "PA", "LAT_LEFT", "LAT_RIGHT", "OBLIQUE")
POSE_TOL = 1e-9


def angle_error_deg(a: float, b: float) -> float:
    d = (a - b + math.pi) % (2 * math.pi) - math.pi
    return abs(math.degrees(d))


def pose_max_abs_error(a: CArmPose, b: CArmPose) -> float:
    return max(abs(getattr(a, name) - getattr(b, name)) for name in (
        "lift", "column_rot", "wig_wag", "orbital_slide", "cart_x", "cart_z"
    ))


def pose_path_length(start: CArmPose, end: CArmPose) -> tuple[float, float]:
    linear_m = math.sqrt(
        (end.lift - start.lift) ** 2
        + (end.cart_x - start.cart_x) ** 2
        + (end.cart_z - start.cart_z) ** 2
    )
    angular_deg = math.degrees(math.sqrt(
        (end.column_rot - start.column_rot) ** 2
        + (end.wig_wag - start.wig_wag) ** 2
        + (end.orbital_slide - start.orbital_slide) ** 2
    ))
    return linear_m, angular_deg


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
    # Calibrated envelope plus near-boundary stress cases.
    return TargetPoint(
        x_mm=rng.uniform(-430.0, 430.0),
        y_mm=rng.uniform(-820.0, 870.0),
        z_mm=rng.uniform(-260.0, 260.0),
    )


def run_trial(rng: random.Random, index: int) -> dict:
    start = random_pose(rng)
    target = random_target(rng)
    view = rng.choice(VIEWS)
    oblique = rng.uniform(-60.0, 60.0) if view == "OBLIQUE" else 30.0
    waypoint_count = rng.randint(5, 60)

    t0 = time.perf_counter()
    solution = solve_target_pose(start, target, view, oblique)
    path = create_path(start, solution.final_pose, waypoint_count)
    confidence = calculate_confidence(target, solution.final_pose)
    elapsed_ms = (time.perf_counter() - t0) * 1000.0

    reached = estimate_current_target(solution.final_pose)
    position_error_mm = math.sqrt(
        (reached.x_mm - target.x_mm) ** 2
        + (reached.y_mm - target.y_mm) ** 2
        + (reached.z_mm - target.z_mm) ** 2
    )
    requested_angle, _ = requested_orbital_angle(view, oblique)
    angular_error = angle_error_deg(solution.final_pose.orbital_slide, requested_angle)

    linear_path_m, angular_path_deg = pose_path_length(start, solution.final_pose)
    start_endpoint_error = pose_max_abs_error(path[0].pose, start)
    final_endpoint_error = pose_max_abs_error(path[-1].pose, solution.final_pose)
    endpoints_within_tolerance = start_endpoint_error <= POSE_TOL and final_endpoint_error <= POSE_TOL
    monotonic = all(path[i].progress <= path[i + 1].progress for i in range(len(path) - 1))

    position_ok = position_error_mm <= 1.0
    angle_ok = angular_error <= 0.1
    success = position_ok and angle_ok and endpoints_within_tolerance and monotonic

    failure_reasons = []
    if not position_ok:
        failure_reasons.append("position_residual")
    if not angle_ok:
        failure_reasons.append("angular_residual")
    if not endpoints_within_tolerance:
        failure_reasons.append("path_endpoint")
    if not monotonic:
        failure_reasons.append("non_monotonic_progress")

    return {
        "trial": index,
        "view": view,
        "oblique_angle_deg": round(oblique, 4),
        "waypoint_count": waypoint_count,
        "target_x_mm": round(target.x_mm, 4),
        "target_y_mm": round(target.y_mm, 4),
        "target_z_mm": round(target.z_mm, 4),
        "position_error_mm": round(position_error_mm, 6),
        "angular_error_deg": round(angular_error, 6),
        "linear_pose_change_m": round(linear_path_m, 6),
        "angular_pose_change_deg": round(angular_path_deg, 6),
        "planning_time_ms": round(elapsed_ms, 6),
        "confidence": confidence.overall,
        "confidence_pct": round(confidence.overall * 100.0, 2),
        "uncertainty_pct": round((1.0 - confidence.overall) * 100.0, 2),
        "target_reachability": confidence.target_reachability,
        "mechanical_feasibility": confidence.mechanical_feasibility,
        "path_smoothness": confidence.path_smoothness,
        "registration_certainty": confidence.registration_certainty,
        "start_endpoint_error": start_endpoint_error,
        "final_endpoint_error": final_endpoint_error,
        "endpoints_within_tolerance": endpoints_within_tolerance,
        "progress_monotonic": monotonic,
        "failure_reasons": ";".join(failure_reasons),
        "success": success,
    }


def pearson(xs: list[float], ys: list[float]) -> float | None:
    if len(xs) < 2:
        return None
    mx, my = statistics.mean(xs), statistics.mean(ys)
    num = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    den = math.sqrt(sum((x - mx) ** 2 for x in xs) * sum((y - my) ** 2 for y in ys))
    return num / den if den > 0 else None


def percentile(values: list[float], p: float) -> float:
    ordered = sorted(values)
    k = (len(ordered) - 1) * p
    lo, hi = math.floor(k), math.ceil(k)
    if lo == hi:
        return ordered[lo]
    return ordered[lo] * (hi - k) + ordered[hi] * (k - lo)


def calibration_bins(rows: list[dict]) -> list[dict]:
    bins = []
    for low in range(0, 100, 10):
        high = low + 10
        group = [r for r in rows if low <= r["confidence_pct"] < high or (high == 100 and r["confidence_pct"] == 100)]
        if group:
            bins.append({
                "confidence_bin": f"{low}-{high}%",
                "n": len(group),
                "mean_confidence_pct": round(statistics.mean(r["confidence_pct"] for r in group), 3),
                "software_success_rate_pct": round(100 * statistics.mean(1.0 if r["success"] else 0.0 for r in group), 3),
                "median_position_error_mm": round(statistics.median(r["position_error_mm"] for r in group), 6),
            })
    return bins


def summarize(rows: list[dict], seed: int) -> dict:
    errors = [r["position_error_mm"] for r in rows]
    angular = [r["angular_error_deg"] for r in rows]
    times = [r["planning_time_ms"] for r in rows]
    confidences = [r["confidence"] for r in rows]
    successes = [1.0 if r["success"] else 0.0 for r in rows]

    reason_counts: dict[str, int] = {}
    for row in rows:
        for reason in filter(None, row["failure_reasons"].split(";")):
            reason_counts[reason] = reason_counts.get(reason, 0) + 1

    by_view = {}
    for view in VIEWS:
        group = [r for r in rows if r["view"] == view]
        by_view[view] = {
            "n": len(group),
            "success_rate_pct": round(100 * statistics.mean(1.0 if r["success"] else 0.0 for r in group), 3),
            "median_position_error_mm": round(statistics.median(r["position_error_mm"] for r in group), 6),
        }

    return {
        "benchmark_type": "software-only internal simulator validation",
        "clinical_accuracy_claim": False,
        "seed": seed,
        "trials": len(rows),
        "software_success_rate_pct": round(100 * statistics.mean(successes), 3),
        "failure_reason_counts": reason_counts,
        "by_view": by_view,
        "position_error_mm": {
            "median": round(statistics.median(errors), 6),
            "mean": round(statistics.mean(errors), 6),
            "p95": round(percentile(errors, 0.95), 6),
            "p99": round(percentile(errors, 0.99), 6),
            "max": round(max(errors), 6),
        },
        "angular_error_deg": {
            "median": round(statistics.median(angular), 6),
            "p95": round(percentile(angular, 0.95), 6),
            "max": round(max(angular), 6),
        },
        "planning_time_ms": {
            "median": round(statistics.median(times), 6),
            "p95": round(percentile(times, 0.95), 6),
        },
        "confidence": {
            "mean_pct": round(100 * statistics.mean(confidences), 3),
            "confidence_vs_position_error_pearson_r": pearson(confidences, errors),
            "confidence_vs_software_success_pearson_r": pearson(confidences, successes),
            "calibration_bins": calibration_bins(rows),
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--trials", type=int, default=1000)
    parser.add_argument("--seed", type=int, default=23112)
    parser.add_argument("--output", type=Path, default=ROOT / "results" / "simulated_validation")
    args = parser.parse_args()
    if args.trials < 1:
        raise SystemExit("--trials must be >= 1")

    rng = random.Random(args.seed)
    rows = [run_trial(rng, i + 1) for i in range(args.trials)]
    summary = summarize(rows, args.seed)

    args.output.mkdir(parents=True, exist_ok=True)
    csv_path = args.output / "trials.csv"
    json_path = args.output / "summary.json"
    with csv_path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)
    json_path.write_text(json.dumps(summary, indent=2), encoding="utf-8")

    print(json.dumps(summary, indent=2))
    print(f"\nWrote {csv_path}")
    print(f"Wrote {json_path}")


if __name__ == "__main__":
    main()
