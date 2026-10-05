"""The result engine: interpretation, delta checks, calculations, autoverification
and verification. Every path that writes a result (manual entry, instrument
interface, amendment) goes through `record_result`.
"""

import re
from datetime import date, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import utcnow
from app.models import (
    CriticalNotification,
    Order,
    OrderTest,
    QCResult,
    QCTarget,
    ReferenceRange,
    ResultHistory,
    Test,
    User,
)
from app.services.audit import audit
from app.services.calculations import CALCULATIONS, calculate

NOT_CALCULABLE = "not_calculable"

_NUMERIC = re.compile(r"^\s*([<>]=?)?\s*(-?\d+(?:\.\d+)?)\s*$")


class ResultError(ValueError):
    pass


def age_in_days(dob: date, at: datetime | None) -> int:
    return ((at.date() if at else utcnow().date()) - dob).days


def find_reference_range(test: Test, sex: str, age_days: int) -> ReferenceRange | None:
    candidates = [
        r for r in test.reference_ranges if r.age_min_days <= age_days <= r.age_max_days and r.sex in (sex, None)
    ]
    # A sex-specific range beats a range for any sex.
    candidates.sort(key=lambda r: r.sex is None)
    return candidates[0] if candidates else None


def format_value(value: float, decimals: int) -> str:
    return f"{value:.{decimals}f}"


def interpret(numeric: float | None, text: str | None, rr: ReferenceRange | None) -> tuple[str | None, bool]:
    """Return (flag, is_critical) for a value against a reference range."""
    if rr is None:
        return None, False
    if numeric is None:
        if rr.normal_text and text is not None:
            return ("N" if text.strip().lower() == rr.normal_text.lower() else "A"), False
        return None, False
    if rr.critical_low is not None and numeric < rr.critical_low:
        return "LL", True
    if rr.critical_high is not None and numeric > rr.critical_high:
        return "HH", True
    if rr.low is not None and numeric < rr.low:
        return "L", False
    if rr.high is not None and numeric > rr.high:
        return "H", False
    return "N", False


def reference_text(rr: ReferenceRange | None, decimals: int) -> str | None:
    if rr is None:
        return None
    if rr.normal_text:
        return rr.normal_text
    if rr.low is not None and rr.high is not None:
        return f"{format_value(rr.low, decimals)} - {format_value(rr.high, decimals)}"
    if rr.low is not None:
        return f">= {format_value(rr.low, decimals)}"
    if rr.high is not None:
        return f"<= {format_value(rr.high, decimals)}"
    return None


def previous_result(db: Session, ot: OrderTest) -> OrderTest | None:
    return db.scalar(
        select(OrderTest)
        .join(Order)
        .where(
            Order.patient_id == ot.order.patient_id,
            OrderTest.test_id == ot.test_id,
            OrderTest.id != ot.id,
            OrderTest.status == "verified",
            OrderTest.value_numeric.is_not(None),
        )
        .order_by(OrderTest.verified_at.desc())
        .limit(1)
    )


def qc_blocks(db: Session, test_id: int) -> bool:
    """True when the latest QC run of any active control for this test was rejected."""
    targets = db.scalars(select(QCTarget).where(QCTarget.test_id == test_id)).all()
    for target in targets:
        if not target.material.is_active:
            continue
        latest = db.scalar(
            select(QCResult).where(QCResult.target_id == target.id).order_by(QCResult.run_at.desc()).limit(1)
        )
        if latest is not None and latest.status == "rejected":
            return True
    return False


def _snapshot_history(db: Session, ot: OrderTest, user: User | None, reason: str) -> None:
    db.add(
        ResultHistory(
            order_test_id=ot.id,
            value_text=ot.value_text,
            flag=ot.flag,
            verified_at=ot.verified_at,
            verified_by_id=ot.verified_by_id,
            amended_by_id=user.id if user else None,
            reason=reason,
        )
    )
    ot.is_amended = True
    ot.verified_at = None
    ot.verified_by_id = None
    ot.auto_verified = False


def _apply(
    db: Session,
    ot: OrderTest,
    numeric: float | None,
    text: str,
    user: User | None,
    source: str,
    instrument: str | None = None,
) -> None:
    test = ot.test
    patient = ot.order.patient
    collected_at = ot.specimen.collected_at if ot.specimen else None
    rr = find_reference_range(test, patient.sex, age_in_days(patient.date_of_birth, collected_at))

    ot.value_numeric = numeric
    ot.value_text = text
    ot.unit = test.unit
    ot.ref_low = rr.low if rr else None
    ot.ref_high = rr.high if rr else None
    ot.ref_text = reference_text(rr, test.decimals)
    ot.flag, ot.is_critical = interpret(numeric, text, rr)
    ot.outside_amr = numeric is not None and (
        (test.amr_low is not None and numeric < test.amr_low) or (test.amr_high is not None and numeric > test.amr_high)
    )

    ot.delta_failed = False
    ot.previous_value = None
    prev = previous_result(db, ot) if numeric is not None else None
    if prev is not None:
        ot.previous_value = prev.value_numeric
        if test.delta_percent and prev.value_numeric:
            change = abs(numeric - prev.value_numeric) / abs(prev.value_numeric) * 100
            ot.delta_failed = change > test.delta_percent

    ot.status = "resulted"
    ot.source = source
    ot.instrument = instrument
    ot.entered_by_id = user.id if user else None
    ot.entered_at = utcnow()


def parse_value(test: Test, raw: str) -> tuple[float | None, str]:
    raw = raw.strip()
    if not raw:
        raise ResultError(f"{test.code}: value is empty")
    if test.result_type == "text":
        return None, raw
    match = _NUMERIC.match(raw)
    if not match:
        raise ResultError(f"{test.code}: '{raw}' is not a number")
    qualifier, number = match.groups()
    numeric = float(number)
    if qualifier:
        return numeric, f"{qualifier}{number}"
    return numeric, format_value(numeric, test.decimals)


def record_result(
    db: Session,
    ot: OrderTest,
    raw: str,
    user: User | None,
    source: str = "manual",
    instrument: str | None = None,
    comment: str | None = None,
    amend_reason: str | None = None,
) -> OrderTest:
    """Enter or change a result, then update calculated tests and try autoverification."""
    if ot.status == "cancelled":
        raise ResultError(f"{ot.test.code}: test is cancelled")
    if ot.test.is_calculated:
        raise ResultError(f"{ot.test.code}: calculated tests can't be entered directly")
    if ot.specimen is None or ot.specimen.status != "received":
        raise ResultError(f"{ot.test.code}: specimen has not been received in the lab")
    if ot.status == "verified":
        if not amend_reason:
            raise ResultError(f"{ot.test.code}: result is verified; a reason is needed to amend it")
        _snapshot_history(db, ot, user, amend_reason)

    numeric, text = parse_value(ot.test, raw)
    _apply(db, ot, numeric, text, user, source, instrument)
    if comment is not None:
        ot.comment = comment
    audit(
        db,
        user,
        "result.amended" if amend_reason else "result.entered",
        "order_test",
        ot.id,
        test=ot.test.code,
        value=text,
        flag=ot.flag,
        source=source,
        reason=amend_reason,
    )
    db.flush()

    update_calculated(db, ot.order, user)
    if source == "instrument":
        try_autoverify(db, ot)
    refresh_order_status(ot.order)
    return ot


def update_calculated(db: Session, order: Order, user: User | None) -> None:
    patient = order.patient
    age_years = age_in_days(patient.date_of_birth, None) / 365.25
    calculated = [
        t for t in order.tests if t.test.is_calculated and (t.status != "cancelled" or t.source == NOT_CALCULABLE)
    ]
    # Calculations can depend on other calculations (A/G ratio needs globulin), so
    # run passes until nothing changes.
    for _ in range(len(calculated) + 1):
        changed = False
        values = {
            t.test.code: t.value_numeric
            for t in order.tests
            if t.value_numeric is not None and t.status in ("resulted", "verified")
        }
        for ot in calculated:
            result = calculate(ot.test.calc_key, values, patient.sex, age_years)
            if result is None:
                inputs_present = all(code in values for code in CALCULATIONS[ot.test.calc_key].inputs)
                if inputs_present and ot.source != NOT_CALCULABLE:
                    # E.g. eGFR for a child: report it as not calculated so the order can complete.
                    if ot.status == "verified":
                        _snapshot_history(db, ot, user, "Calculation no longer applies")
                    ot.status = "cancelled"
                    ot.source = NOT_CALCULABLE
                    ot.value_text = ot.value_numeric = ot.flag = None
                    ot.is_critical = False
                    ot.comment = "Not calculated: the equation does not apply to this patient or these results"
                    changed = True
                continue
            if ot.source == NOT_CALCULABLE:
                ot.comment = None
            text = format_value(result, ot.test.decimals)
            if text == ot.value_text:
                continue
            if ot.specimen is not None and ot.specimen.status != "received":
                continue
            if ot.status == "verified":
                _snapshot_history(db, ot, user, "Recalculated after an input result changed")
            _apply(db, ot, round(result, ot.test.decimals), text, user, "calculated")
            changed = True
        if not changed:
            break
    db.flush()


def try_autoverify(db: Session, ot: OrderTest) -> bool:
    test = ot.test
    if (
        ot.status != "resulted"
        or not test.autoverify
        or ot.value_numeric is None
        or ot.flag != "N"
        or ot.delta_failed
        or ot.outside_amr
        or ot.is_amended
        or qc_blocks(db, test.id)
    ):
        return False
    verify_result(db, ot, None, auto=True)
    return True


def verify_result(db: Session, ot: OrderTest, user: User | None, auto: bool = False) -> None:
    if ot.status != "resulted":
        raise ResultError(f"{ot.test.code}: only resulted tests can be verified (status is {ot.status})")
    ot.status = "verified"
    ot.verified_at = utcnow()
    ot.verified_by_id = user.id if user else None
    ot.auto_verified = auto
    if ot.is_critical:
        existing = db.scalar(select(CriticalNotification).where(CriticalNotification.order_test_id == ot.id))
        if existing is None:
            db.add(CriticalNotification(order_test_id=ot.id))
        else:
            existing.status = "pending"
            existing.notified_at = None
    audit(db, user, "result.autoverified" if auto else "result.verified", "order_test", ot.id, test=ot.test.code)
    db.flush()
    _verify_ready_calculations(db, ot.order)
    refresh_order_status(ot.order)


def _verify_ready_calculations(db: Session, order: Order) -> None:
    """A calculated result is verified once every result it is derived from is verified."""
    by_code = {t.test.code: t for t in order.tests if t.status != "cancelled"}
    for ot in list(by_code.values()):
        if not ot.test.is_calculated or ot.status != "resulted":
            continue
        inputs = CALCULATIONS[ot.test.calc_key].inputs
        if all(code in by_code and by_code[code].status == "verified" for code in inputs):
            verify_result(db, ot, None, auto=True)


def refresh_order_status(order: Order) -> None:
    if order.status == "cancelled":
        return
    active = [t for t in order.tests if t.status != "cancelled"]
    if active and all(t.status == "verified" for t in active):
        if order.status != "completed":
            order.status = "completed"
            order.completed_at = utcnow()
    elif any(s.status == "received" for s in order.specimens) or any(t.status != "pending" for t in active):
        order.status = "in_progress"
        order.completed_at = None
    else:
        order.status = "ordered"
