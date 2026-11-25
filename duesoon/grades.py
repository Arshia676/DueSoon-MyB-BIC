"""Grade math. Pure functions over (weight %, score %) pairs."""
from __future__ import annotations

from typing import Iterable, Optional, Tuple

Item = Tuple[float, Optional[float]]  # (weight in %, score in % or None if ungraded)


def summarize(items: Iterable[Item], target: float) -> dict:
    """Current standing and the average needed on everything not yet graded.

    `items` should cover the whole course; weights are percentages of the final
    grade. Only the weight that is actually entered is considered, so a course
    with 60% of its weight entered is treated as having 40% unknown.
    """
    items = list(items)
    graded = [(w, s) for w, s in items if s is not None]
    graded_weight = sum(w for w, _ in graded)
    earned = sum(w * s / 100 for w, s in graded)          # points toward final grade
    current = (earned / graded_weight * 100) if graded_weight else None
    remaining_weight = max(0.0, 100 - graded_weight)

    needed: Optional[float] = None
    if remaining_weight > 0:
        needed = round((target - earned) / remaining_weight * 100, 1)

    return {
        "graded_weight": round(graded_weight, 2),
        "current_average": None if current is None else round(current, 1),
        "points_earned": round(earned, 2),
        "target": target,
        "needed_on_remaining": needed,
        "achievable": None if needed is None else needed <= 100,
        "already_secured": needed is not None and needed <= 0,
    }

