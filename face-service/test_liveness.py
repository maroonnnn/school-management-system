"""Unit tests of the liveness decision. Run:  face-service/.venv/Scripts/python -m unittest face-service/test_liveness.py"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from liveness import evaluate_liveness, parse_challenge, split_groups  # noqa: E402

FRONT = [0.02, -0.03, 0.05]
LEFT = [0.1, 0.3, 0.35]        # person turns to THEIR left → yaw > 0
RIGHT = [-0.1, -0.3, -0.35]    # person turns to THEIR right → yaw < 0


class Liveness(unittest.TestCase):
    def test_two_step_sequence_in_order_passes(self):
        r = evaluate_liveness([FRONT, RIGHT, LEFT], ["RIGHT", "LEFT"])
        self.assertTrue(r["passed"], r)

    def test_wrong_order_fails(self):
        r = evaluate_liveness([FRONT, LEFT, RIGHT], ["RIGHT", "LEFT"])
        self.assertFalse(r["passed"])
        self.assertEqual(r["reason"], "WRONG_DIRECTION")

    def test_one_direction_clip_fails_a_two_step_challenge(self):
        # a recorded clip that only turns one way
        r = evaluate_liveness([FRONT, RIGHT, RIGHT], ["RIGHT", "LEFT"])
        self.assertFalse(r["passed"])

    def test_no_turn_fails(self):
        r = evaluate_liveness([FRONT, FRONT, FRONT], ["RIGHT", "LEFT"])
        self.assertFalse(r["passed"])
        self.assertEqual(r["reason"], "LIVENESS_FAILED")

    def test_no_frontal_frame_fails(self):
        r = evaluate_liveness([[0.4, 0.5], RIGHT, LEFT], ["RIGHT", "LEFT"])
        self.assertEqual(r["reason"], "NO_FRONTAL")

    def test_strict_off_accepts_any_direction(self):
        r = evaluate_liveness([FRONT, LEFT, LEFT], ["RIGHT", "LEFT"], strict=False)
        self.assertTrue(r["passed"])

    def test_yaw_sign_flip_for_a_camera_with_the_opposite_convention(self):
        self.assertFalse(evaluate_liveness([FRONT, LEFT, RIGHT], ["LEFT", "RIGHT"], yaw_sign=-1)["passed"])
        self.assertTrue(evaluate_liveness([FRONT, RIGHT, LEFT], ["LEFT", "RIGHT"], yaw_sign=-1)["passed"])

    def test_single_step_still_supported(self):
        self.assertTrue(evaluate_liveness([FRONT, LEFT], ["LEFT"])["passed"])
        self.assertFalse(evaluate_liveness([FRONT, RIGHT], ["LEFT"])["passed"])

    def test_layout_mismatch(self):
        self.assertEqual(evaluate_liveness([FRONT, LEFT], ["LEFT", "RIGHT"])["reason"], "BAD_LAYOUT")

    def test_parse_and_split(self):
        self.assertEqual(parse_challenge("LEFT"), ["LEFT"])
        self.assertEqual(parse_challenge(["RIGHT", "LEFT"]), ["RIGHT", "LEFT"])
        self.assertEqual(parse_challenge(None), [])
        with self.assertRaises(ValueError):
            parse_challenge(["UP"])
        self.assertEqual(split_groups([0.0, None, 0.3, 0.4, -0.3], [2, 2, 1]), [[0.0], [0.3, 0.4], [-0.3]])


if __name__ == "__main__":
    unittest.main()
