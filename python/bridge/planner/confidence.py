from __future__ import annotations

from dataclasses import dataclass
from math import pi

from .pose_solver import CArmPose, TargetPoint


@dataclass(frozen=True)
class ConfidenceResult:
    overall: float
    target_reachability: float
    mechanical_feasibility: float
    path_smoothness: float
    registration_certainty: float
    notes: list[str]

    def to_dict(self) -> dict:
        return {
            "overall": self.overall,
            "percentage": round(self.overall * 100.0, 1),
            "components": {
                "target_reachability": self.target_reachability,
                "mechanical_feasibility": self.mechanical_feasibility,
                "path_smoothness": self.path_smoothness,
                "registration_certainty": self.registration_certainty,
            },
            "notes": self.notes,
        }


def clamp(value: float, minimum: float = 0.0, maximum: float = 1.0) -> float:
    return max(minimum, min(maximum, value))


def axis_workspace_score(
    value: float,
    safe_minimum: float,
    safe_maximum: float,
    hard_minimum: float,
    hard_maximum: float,
) -> float:
    """
    Score a target coordinate against a calibrated workspace.

    Values inside the safe workspace receive full credit. Values between
    the safe and hard boundaries taper smoothly. Values outside the hard
    workspace receive zero.
    """
    if hard_minimum >= safe_minimum or safe_maximum >= hard_maximum:
        raise ValueError("Workspace limits must satisfy hard_min < safe_min < safe_max < hard_max.")

    if safe_minimum <= value <= safe_maximum:
        return 1.0

    if hard_minimum <= value < safe_minimum:
        return clamp((value - hard_minimum) / (safe_minimum - hard_minimum))

    if safe_maximum < value <= hard_maximum:
        return clamp((hard_maximum - value) / (hard_maximum - safe_maximum))

    return 0.0


def mechanical_margin_score(
    value: float,
    minimum: float,
    maximum: float,
    preferred_margin_fraction: float = 0.08,
) -> float:
    """
    Score a mechanical axis by validity and distance from its hard limits.

    A pose inside the preferred operating band scores 1.0. A pose close to
    a hard limit tapers to 0.70 rather than being treated as unreachable.
    A pose outside the hard limits scores zero.
    """
    if maximum <= minimum:
        raise ValueError("maximum must be greater than minimum")

    if value < minimum or value > maximum:
        return 0.0

    span = maximum - minimum
    preferred_margin = span * preferred_margin_fraction
    lower_preferred = minimum + preferred_margin
    upper_preferred = maximum - preferred_margin

    if lower_preferred <= value <= upper_preferred:
        return 1.0

    if value < lower_preferred:
        fraction = (value - minimum) / max(preferred_margin, 1e-9)
    else:
        fraction = (maximum - value) / max(preferred_margin, 1e-9)

    return 0.70 + 0.30 * clamp(fraction)


def calculate_confidence(
    target: TargetPoint,
    final_pose: CArmPose,
) -> ConfidenceResult:
    """
    Calculate deterministic simulation-planning confidence.

    This score answers: "How confidently did the digital planner produce a
    reachable, mechanically valid, smooth pose?" It is intentionally not a
    clinical probability and does not claim collision or registration
    validation that has not been performed.
    """

    # Calibrated around the complete 17-landmark mannequin envelope:
    # x: hands approximately +/-336 mm
    # y: feet/head approximately -700 to +766 mm
    # z: current target plane near 0 mm
    target_axis_scores = [
        axis_workspace_score(target.x_mm, -375.0, 375.0, -450.0, 450.0),
        axis_workspace_score(target.y_mm, -750.0, 825.0, -850.0, 900.0),
        axis_workspace_score(target.z_mm, -175.0, 175.0, -300.0, 300.0),
    ]
    target_reachability = sum(target_axis_scores) / len(target_axis_scores)

    # Hard limits remain strict. The score no longer penalizes a valid pose
    # simply because it is not at the exact midpoint of every axis.
    limit_scores = [
        mechanical_margin_score(final_pose.lift, -0.50, 0.50),
        mechanical_margin_score(final_pose.column_rot, -pi / 6.0, pi / 6.0),
        mechanical_margin_score(final_pose.wig_wag, -pi / 4.0, pi / 4.0),
        mechanical_margin_score(final_pose.orbital_slide, -pi / 2.0, pi / 2.0),
        mechanical_margin_score(final_pose.cart_x, 0.80, 2.50),
        mechanical_margin_score(final_pose.cart_z, 0.00, 1.20),
    ]
    mechanical_feasibility = sum(limit_scores) / len(limit_scores)

    # path_planner.py uses quintic smootherstep interpolation, giving zero
    # velocity and zero acceleration at the beginning and end.
    path_smoothness = 0.99

    # Keep this conservative until CT-to-patient registration is physically
    # validated. Its low weight prevents it from incorrectly dominating the
    # digital motion-planning score.
    registration_certainty = 0.60

    # Engineering-planning score:
    # - Reachability and mechanical validity dominate.
    # - Smoothness contributes substantially.
    # - Unvalidated registration is visible but cannot collapse an otherwise
    #   valid simulation plan.
    overall = (
        0.40 * target_reachability
        + 0.40 * mechanical_feasibility
        + 0.15 * path_smoothness
        + 0.05 * registration_certainty
    )

    notes: list[str] = [
        "Deterministic digital motion-planning confidence; not a clinical probability.",
        "Target reachability is calibrated to the complete 17-landmark mannequin workspace.",
        "Mechanical feasibility checks all six commanded C-arm axes.",
        "Collision clearance is not included yet and is reported as not validated.",
        "Registration certainty remains conservative until physical CT alignment is validated.",
    ]

    if target_reachability < 0.90:
        notes.append("Target is near or outside the calibrated landmark workspace.")

    if mechanical_feasibility < 0.90:
        notes.append("One or more axes are near a mechanical limit.")

    return ConfidenceResult(
        overall=round(clamp(overall), 4),
        target_reachability=round(clamp(target_reachability), 4),
        mechanical_feasibility=round(clamp(mechanical_feasibility), 4),
        path_smoothness=round(clamp(path_smoothness), 4),
        registration_certainty=round(clamp(registration_certainty), 4),
        notes=notes,
    )
