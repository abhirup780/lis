"""Calculated (derived) tests.

Each calculation names the test codes it needs and a function that returns the
derived value, or None when it can't be calculated (missing sex, out of the
equation's validity range, division by zero).
"""

from collections.abc import Callable
from dataclasses import dataclass


@dataclass(frozen=True)
class Calculation:
    inputs: tuple[str, ...]
    fn: Callable[[dict[str, float], str, float], float | None]
    description: str


def _egfr_ckd_epi_2021(v: dict[str, float], sex: str, age: float) -> float | None:
    """CKD-EPI 2021 creatinine equation (race-free), mL/min/1.73m2. Adults only."""
    if sex not in ("M", "F") or age < 18 or v["CREA"] <= 0:
        return None
    kappa, alpha = (0.7, -0.241) if sex == "F" else (0.9, -0.302)
    ratio = v["CREA"] / kappa
    egfr = 142 * min(ratio, 1) ** alpha * max(ratio, 1) ** -1.200 * 0.9938**age
    return egfr * 1.012 if sex == "F" else egfr


def _ldl_sampson(v: dict[str, float], sex: str, age: float) -> float | None:
    """NIH equation 2 (Sampson 2020), mg/dL. Valid for triglycerides up to 800 mg/dL."""
    tc, hdl, tg = v["CHOL"], v["HDL"], v["TRIG"]
    if tg > 800:
        return None
    non_hdl = tc - hdl
    return tc / 0.948 - hdl / 0.971 - (tg / 8.56 + tg * non_hdl / 2140 - tg**2 / 16100) - 9.44


def _ratio(num: str, den: str) -> Callable[[dict[str, float], str, float], float | None]:
    return lambda v, sex, age: v[num] / v[den] if v[den] else None


def _absolute(pct: str) -> Callable[[dict[str, float], str, float], float | None]:
    return lambda v, sex, age: v["WBC"] * v[pct] / 100


CALCULATIONS: dict[str, Calculation] = {
    "anion_gap": Calculation(("NA", "CL", "CO2"), lambda v, s, a: v["NA"] - (v["CL"] + v["CO2"]), "Na - (Cl + CO2)"),
    "egfr": Calculation(("CREA",), _egfr_ckd_epi_2021, "CKD-EPI 2021 (creatinine, race-free)"),
    "ldl_sampson": Calculation(("CHOL", "HDL", "TRIG"), _ldl_sampson, "NIH equation 2 (Sampson)"),
    "non_hdl": Calculation(("CHOL", "HDL"), lambda v, s, a: v["CHOL"] - v["HDL"], "Total cholesterol - HDL"),
    "globulin": Calculation(("TP", "ALB"), lambda v, s, a: v["TP"] - v["ALB"], "Total protein - albumin"),
    "ag_ratio": Calculation(("ALB", "GLOB"), _ratio("ALB", "GLOB"), "Albumin / globulin"),
    "bun_crea": Calculation(("BUN", "CREA"), _ratio("BUN", "CREA"), "BUN / creatinine"),
    "anc": Calculation(("WBC", "NEUT"), _absolute("NEUT"), "WBC x neutrophil %"),
    "alc": Calculation(("WBC", "LYMPH"), _absolute("LYMPH"), "WBC x lymphocyte %"),
}


def calculate(calc_key: str, values: dict[str, float], sex: str, age_years: float) -> float | None:
    calc = CALCULATIONS[calc_key]
    if any(code not in values for code in calc.inputs):
        return None
    return calc.fn(values, sex, age_years)
