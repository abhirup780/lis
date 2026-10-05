"""Westgard multirule QC evaluation on a single control's series of z-scores."""

WARNING_RULES = {"1-2s"}


def evaluate(z: float, history: list[float]) -> tuple[str, list[str]]:
    """Evaluate a new z-score against the previous ones (most recent first).

    Returns the run status (accepted | warning | rejected) and the rules violated.
    """
    series = [z, *history]
    violations: list[str] = []

    if abs(z) > 3:
        violations.append("1-3s")
    if len(series) >= 2:
        a, b = series[0], series[1]
        if (a > 2 and b > 2) or (a < -2 and b < -2):
            violations.append("2-2s")
        if (a > 2 and b < -2) or (a < -2 and b > 2):
            violations.append("R-4s")
    if len(series) >= 4:
        last4 = series[:4]
        if all(v > 1 for v in last4) or all(v < -1 for v in last4):
            violations.append("4-1s")
    if len(series) >= 10:
        last10 = series[:10]
        if all(v > 0 for v in last10) or all(v < 0 for v in last10):
            violations.append("10x")

    if violations:
        return "rejected", violations
    if abs(z) > 2:
        return "warning", ["1-2s"]
    return "accepted", []
