"""
Active liveness decision from head-turn yaw values — a pure function (no OpenCV, no I/O), so it is unit-testable
without a camera (see test_liveness.py).

yaw = (nose_x - eyes_mid_x) / eye_distance, measured on the UN-mirrored camera frame.
When a person turns to THEIR left, the nose moves to the image's right → yaw > 0  (sign convention YAW_SIGN = 1).
If a real camera shows the opposite sign, set FACE_YAW_SIGN=-1 (the service then reports WRONG_DIRECTION with a
hint instead of silently failing).

Challenge = ordered list of directions, e.g. ["RIGHT", "LEFT"]:
  group 0            : the person looks at the camera (at least one frame with |yaw| <= FRONTAL_MAX)
  group i (1..n)     : the head is turned in direction i (at least one frame with |yaw| >= TURN_MIN and the right sign)
A recorded clip that turns only one way, or turns in the wrong order, fails the sequence.
"""
from __future__ import annotations

FRONTAL_MAX = 0.12
TURN_MIN = 0.22


def parse_challenge(challenge) -> list[str]:
    """Accepts "LEFT", "RIGHT", a list of them, or None → ordered list of directions."""
    if challenge is None:
        return []
    items = [challenge] if isinstance(challenge, str) else list(challenge)
    if any(c not in ("LEFT", "RIGHT") for c in items):
        raise ValueError("challenge must contain only LEFT / RIGHT")
    return items


def _want_sign(direction: str, yaw_sign: int) -> int:
    return yaw_sign if direction == "LEFT" else -yaw_sign


def evaluate_liveness(groups: list[list[float]], steps: list[str], *, strict: bool = True, yaw_sign: int = 1,
                      frontal_max: float = FRONTAL_MAX, turn_min: float = TURN_MIN) -> dict:
    """
    groups: yaw values per phase (groups[0] = frontal phase, groups[i] = i-th turn phase).
    Returns {"passed": bool, "reason": str | None, "message": str | None, "detail": {...}}.
    """
    detail = {"steps": steps, "strict": strict, "maxAbsYaw": [round(max((abs(y) for y in g), default=0.0), 3) for g in groups]}
    if not steps:
        return {"passed": True, "reason": None, "message": None, "detail": detail}
    if len(groups) != len(steps) + 1:
        return {"passed": False, "reason": "BAD_LAYOUT", "message": "ترتيب اللقطات غير صالح", "detail": detail}
    if not groups[0] or not any(abs(y) <= frontal_max for y in groups[0]):
        return {"passed": False, "reason": "NO_FRONTAL", "message": "انظر مباشرة إلى الكاميرا في بداية التسجيل", "detail": detail}

    wrong_direction = False
    for i, direction in enumerate(steps, start=1):
        turned = [y for y in groups[i] if abs(y) >= turn_min]
        if not turned:
            return {"passed": False, "reason": "LIVENESS_FAILED", "message": "لم يتم التحقق من الحيوية — حرّك رأسك كما هو مطلوب", "detail": detail}
        if strict:
            want = _want_sign(direction, yaw_sign)
            if not any(y * want > 0 for y in turned):
                wrong_direction = True
    if wrong_direction:
        return {"passed": False, "reason": "WRONG_DIRECTION",
                "message": "اتجاه اللف غير صحيح — اتبع التعليمات على الشاشة بالترتيب", "detail": detail}
    return {"passed": True, "reason": None, "message": None, "detail": detail}


def split_groups(values: list[float | None], layout: list[int]) -> list[list[float]]:
    """Cuts a per-frame yaw list (None = no face in that frame) into the phases of `layout` (frames per phase)."""
    out, pos = [], 0
    for n in layout:
        out.append([y for y in values[pos:pos + n] if y is not None])
        pos += n
    return out
