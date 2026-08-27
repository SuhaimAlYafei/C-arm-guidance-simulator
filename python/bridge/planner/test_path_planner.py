from __future__ import annotations

import unittest

from .path_planner import create_path, smootherstep
from .pose_solver import CArmPose


class PathPlannerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.start = CArmPose(
            lift=-0.20,
            column_rot=0.0,
            wig_wag=0.0,
            orbital_slide=0.0,
            cart_x=1.70,
            cart_z=0.50,
        )
        self.final = CArmPose(
            lift=-0.05,
            column_rot=0.20,
            wig_wag=-0.10,
            orbital_slide=0.50,
            cart_x=1.25,
            cart_z=0.75,
        )

    def test_path_preserves_requested_endpoints(self) -> None:
        path = create_path(self.start, self.final, waypoint_count=21)
        self.assertEqual(path[0].pose, self.start)
        self.assertEqual(path[-1].pose, self.final)
        self.assertEqual(path[0].phase, "start")
        self.assertEqual(path[-1].phase, "final_alignment")

    def test_waypoint_progress_is_monotonic(self) -> None:
        path = create_path(self.start, self.final, waypoint_count=31)
        progress = [waypoint.progress for waypoint in path]
        self.assertEqual(progress[0], 0.0)
        self.assertEqual(progress[-1], 1.0)
        self.assertTrue(all(a < b for a, b in zip(progress, progress[1:])))

    def test_smootherstep_is_bounded_and_endpoint_exact(self) -> None:
        self.assertEqual(smootherstep(-1.0), 0.0)
        self.assertEqual(smootherstep(0.0), 0.0)
        self.assertEqual(smootherstep(1.0), 1.0)
        self.assertEqual(smootherstep(2.0), 1.0)
        self.assertGreater(smootherstep(0.75), smootherstep(0.25))

    def test_rejects_too_few_waypoints(self) -> None:
        with self.assertRaises(ValueError):
            create_path(self.start, self.final, waypoint_count=1)


if __name__ == "__main__":
    unittest.main()
