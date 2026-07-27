from __future__ import annotations

from dataclasses import dataclass

from .pose_solver import CArmPose


@dataclass(frozen=True)
class PathWaypoint:
    index: int
    progress: float
    pose: CArmPose
    phase: str

    def to_dict(self) -> dict:
        return {
            "index": self.index,
            "progress": self.progress,
            "phase": self.phase,
            "pose": self.pose.to_dict(),
        }


def interpolate(start: float, end: float, t: float) -> float:
    return start + (end - start) * t


def smootherstep(t: float) -> float:
    """
    Quintic easing with zero velocity and zero acceleration at both ends.

    Compared with cubic smoothstep, this reduces endpoint jerk and provides
    a stronger baseline for preview and hardware-in-the-loop motion.
    """
    t = max(0.0, min(1.0, t))
    return t * t * t * (t * (t * 6.0 - 15.0) + 10.0)


def interpolate_pose(
    start: CArmPose,
    end: CArmPose,
    t: float,
) -> CArmPose:
    eased = smootherstep(t)

    return CArmPose(
        lift=interpolate(start.lift, end.lift, eased),
        column_rot=interpolate(start.column_rot, end.column_rot, eased),
        wig_wag=interpolate(start.wig_wag, end.wig_wag, eased),
        orbital_slide=interpolate(start.orbital_slide, end.orbital_slide, eased),
        cart_x=interpolate(start.cart_x, end.cart_x, eased),
        cart_z=interpolate(start.cart_z, end.cart_z, eased),
    )


def create_path(
    current_pose: CArmPose,
    final_pose: CArmPose,
    waypoint_count: int = 21,
) -> list[PathWaypoint]:
    """
    Create a smooth baseline path.

    The path is kinematically smooth but collision checking and measured
    hardware feedback must still be applied before physical execution.
    """
    if waypoint_count < 2:
        raise ValueError("waypoint_count must be at least 2.")

    waypoints: list[PathWaypoint] = []

    for index in range(waypoint_count):
        progress = index / (waypoint_count - 1)
        pose = interpolate_pose(current_pose, final_pose, progress)

        if index == 0:
            phase = "start"
        elif index == waypoint_count - 1:
            phase = "final_alignment"
        elif progress < 0.30:
            phase = "departure"
        elif progress < 0.75:
            phase = "coordinated_motion"
        else:
            phase = "fine_alignment"

        waypoints.append(
            PathWaypoint(
                index=index,
                progress=progress,
                pose=pose,
                phase=phase,
            )
        )

    return waypoints
