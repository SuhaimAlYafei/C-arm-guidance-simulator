from __future__ import annotations

from dataclasses import asdict, dataclass
from math import pi
from typing import Literal


ViewName = Literal["AP", "PA", "LAT_LEFT", "LAT_RIGHT", "OBLIQUE"]


@dataclass(frozen=True)
class CArmPose:
    """
    C-arm controls in the same units used by App.jsx.

    Linear controls:
        lift, cart_x, cart_z -> metres

    Angular controls:
        column_rot, wig_wag, orbital_slide -> radians
    """

    lift: float
    column_rot: float
    wig_wag: float
    orbital_slide: float
    cart_x: float
    cart_z: float

    def to_dict(self) -> dict[str, float]:
        return asdict(self)


@dataclass(frozen=True)
class TargetPoint:
    """Target point in centred CT coordinates, expressed in millimetres."""

    x_mm: float
    y_mm: float
    z_mm: float


@dataclass(frozen=True)
class PoseSolution:
    final_pose: CArmPose
    target: TargetPoint
    view: ViewName
    explanation: list[str]


# Encoder pose corresponding to CT target (0, 0, 0).
#
# This is a calibration origin, not a pose from which every trajectory starts.
# Every trajectory starts from the live current_pose supplied by the frontend.
CALIBRATION_ORIGIN_POSE = CArmPose(
    lift=-0.178,
    column_rot=0.0,
    wig_wag=0.0,
    orbital_slide=0.0,
    cart_x=1.700,
    cart_z=0.600,
)

MM_TO_M = 0.001

# Validated simulator axis mapping.
#
# The patient head is reached by DECREASING cart_x. Therefore CT +Y maps to
# negative cart_x. This sign is what prevents a head target from moving away
# from the patient.
CT_X_TO_CART_Z_SIGN = +1.0
CT_Y_TO_CART_X_SIGN = -1.0
CT_Z_TO_LIFT_SIGN = +1.0

LIFT_LIMITS = (-0.50, 0.50)
COLUMN_LIMITS = (-pi / 6.0, pi / 6.0)
WIG_WAG_LIMITS = (-pi / 4.0, pi / 4.0)
ORBITAL_LIMITS = (-pi, pi)
CART_X_LIMITS = (0.80, 2.50)
CART_Z_LIMITS = (0.00, 1.20)


def clamp(value: float, minimum: float, maximum: float) -> float:
    return max(minimum, min(maximum, value))


def estimate_current_target(current_pose: CArmPose) -> TargetPoint:
    """
    Estimate the point currently centred by the beam from live encoder values.

    This is the inverse of the calibrated CT-to-control translation mapping.
    It allows each new target to be expressed as a correction from the current
    measured pose rather than as a command from a fixed home pose.
    """

    x_mm = (
        (current_pose.cart_z - CALIBRATION_ORIGIN_POSE.cart_z)
        / (CT_X_TO_CART_Z_SIGN * MM_TO_M)
    )
    y_mm = (
        (current_pose.cart_x - CALIBRATION_ORIGIN_POSE.cart_x)
        / (CT_Y_TO_CART_X_SIGN * MM_TO_M)
    )
    z_mm = (
        (current_pose.lift - CALIBRATION_ORIGIN_POSE.lift)
        / (CT_Z_TO_LIFT_SIGN * MM_TO_M)
    )

    return TargetPoint(x_mm=x_mm, y_mm=y_mm, z_mm=z_mm)


def nearest_equivalent_angle(target_angle: float, current_angle: float) -> float:
    """
    Choose the equivalent commanded angle nearest to the live encoder angle.

    This avoids unnecessary long rotations when crossing the -pi/+pi boundary.
    """
    candidates = [
        target_angle - 2.0 * pi,
        target_angle,
        target_angle + 2.0 * pi,
    ]
    valid = [
        angle
        for angle in candidates
        if ORBITAL_LIMITS[0] <= angle <= ORBITAL_LIMITS[1]
    ]
    return min(valid or [target_angle], key=lambda angle: abs(angle - current_angle))


def requested_orbital_angle(
    view: ViewName,
    oblique_angle_deg: float,
) -> tuple[float, str]:
    if view == "AP":
        return 0.0, "Applied the calibrated AP projection."

    if view == "PA":
        return pi, "Applied the calibrated PA projection."

    if view == "LAT_LEFT":
        return pi / 2.0, "Applied the left-lateral projection."

    if view == "LAT_RIGHT":
        return -pi / 2.0, "Applied the right-lateral projection."

    if view == "OBLIQUE":
        angle = oblique_angle_deg * pi / 180.0
        return angle, f"Applied an oblique angle of {oblique_angle_deg:.1f} degrees."

    raise ValueError(f"Unsupported view: {view}")


def solve_target_pose(
    current_pose: CArmPose,
    target: TargetPoint,
    view: ViewName,
    oblique_angle_deg: float = 30.0,
) -> PoseSolution:
    """
    Solve from the live measured/encoder pose.

    Pipeline:
        live encoder pose
        -> estimate current beam-centred CT point
        -> calculate target error in CT millimetres
        -> convert only that error into control-axis corrections
        -> command the nearest valid projection orientation

    This is deterministic closed-loop-style positioning. It is not yet a
    collision-aware inverse-kinematics solver.
    """

    current_target = estimate_current_target(current_pose)

    error_x_mm = target.x_mm - current_target.x_mm
    error_y_mm = target.y_mm - current_target.y_mm
    error_z_mm = target.z_mm - current_target.z_mm

    requested_cart_x = (
        current_pose.cart_x
        + CT_Y_TO_CART_X_SIGN * error_y_mm * MM_TO_M
    )
    requested_cart_z = (
        current_pose.cart_z
        + CT_X_TO_CART_Z_SIGN * error_x_mm * MM_TO_M
    )
    requested_lift = (
        current_pose.lift
        + CT_Z_TO_LIFT_SIGN * error_z_mm * MM_TO_M
    )

    raw_orbital, view_note = requested_orbital_angle(
        view=view,
        oblique_angle_deg=oblique_angle_deg,
    )
    requested_orbital = nearest_equivalent_angle(
        raw_orbital,
        current_pose.orbital_slide,
    )

    # Preserve axes that are not part of this request. Region-specific lift and
    # cranial/caudal wig-wag presets may still be applied by the frontend.
    requested_column = current_pose.column_rot
    requested_wig_wag = current_pose.wig_wag

    final_pose = CArmPose(
        lift=clamp(requested_lift, *LIFT_LIMITS),
        column_rot=clamp(requested_column, *COLUMN_LIMITS),
        wig_wag=clamp(requested_wig_wag, *WIG_WAG_LIMITS),
        orbital_slide=clamp(requested_orbital, *ORBITAL_LIMITS),
        cart_x=clamp(requested_cart_x, *CART_X_LIMITS),
        cart_z=clamp(requested_cart_z, *CART_Z_LIMITS),
    )

    explanation = [
        "Used the live current pose as the measured encoder state.",
        (
            "Estimated current beam target at "
            f"({current_target.x_mm:.1f}, {current_target.y_mm:.1f}, "
            f"{current_target.z_mm:.1f}) mm."
        ),
        (
            "Computed live target correction of "
            f"dX={error_x_mm:.1f} mm, dY={error_y_mm:.1f} mm, "
            f"dZ={error_z_mm:.1f} mm."
        ),
        "Converted the target error into incremental cart/lift corrections.",
        view_note,
    ]

    unclamped = {
        "lift": requested_lift,
        "column_rot": requested_column,
        "wig_wag": requested_wig_wag,
        "orbital_slide": requested_orbital,
        "cart_x": requested_cart_x,
        "cart_z": requested_cart_z,
    }
    clamped = final_pose.to_dict()
    limited_axes = [
        axis for axis, value in unclamped.items()
        if abs(value - clamped[axis]) > 1e-9
    ]
    if limited_axes:
        explanation.append(
            "Mechanical limit applied to: " + ", ".join(limited_axes) + "."
        )

    return PoseSolution(
        final_pose=final_pose,
        target=target,
        view=view,
        explanation=explanation,
    )
