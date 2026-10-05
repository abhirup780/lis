from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Order, OrderTest, Panel, Patient, Specimen, Test, User
from app.schemas import OrderCreate, OrderOut, OrderSummary
from app.services.audit import audit
from app.services.numbering import next_accession, next_order_number


class OrderError(ValueError):
    pass


def create_order(db: Session, body: OrderCreate, user: User) -> Order:
    patient = db.get(Patient, body.patient_id)
    if patient is None:
        raise OrderError("Patient not found")
    if not body.panel_codes and not body.test_codes:
        raise OrderError("Select at least one panel or test")

    # (test, panel) pairs, de-duplicated by test so a test in two panels is run once.
    requested: dict[int, tuple[Test, Panel | None]] = {}
    for code in body.panel_codes:
        panel = db.scalar(select(Panel).where(Panel.code == code.upper(), Panel.is_active))
        if panel is None:
            raise OrderError(f"Unknown panel '{code}'")
        for item in panel.items:
            if item.test.is_active:
                requested.setdefault(item.test.id, (item.test, panel))
    for code in body.test_codes:
        test = db.scalar(select(Test).where(Test.code == code.upper(), Test.is_active))
        if test is None:
            raise OrderError(f"Unknown test '{code}'")
        if not test.is_orderable:
            raise OrderError(f"Test '{code}' can't be ordered on its own")
        requested.setdefault(test.id, (test, None))

    order = Order(
        order_number=next_order_number(db),
        patient=patient,
        ordering_provider=body.ordering_provider,
        priority=body.priority,
        clinical_info=body.clinical_info,
        created_by=user,
    )
    db.add(order)

    # One tube per specimen type and department, since each department runs its own tube.
    specimens: dict[tuple[int, int], Specimen] = {}
    for test, panel in sorted(requested.values(), key=lambda tp: (tp[0].department_id, tp[0].sort_order)):
        key = (test.specimen_type_id, test.department_id)
        specimen = specimens.get(key)
        if specimen is None:
            specimen = Specimen(accession=next_accession(db), order=order, specimen_type=test.specimen_type)
            db.add(specimen)
            specimens[key] = specimen
        db.add(OrderTest(order=order, test=test, panel=panel, specimen=specimen))

    db.flush()
    audit(
        db,
        user,
        "order.created",
        "order",
        order.id,
        order_number=order.order_number,
        tests=[t.code for t, _ in requested.values()],
        priority=order.priority,
    )
    return order


def due_at(order: Order, specimen: Specimen | None = None):
    """When results are due, measured from receipt in the lab (or ordering, before receipt)."""
    start = (specimen.received_at if specimen and specimen.received_at else None) or order.created_at
    tests = specimen.tests if specimen else order.tests
    minutes = [
        (t.test.tat_stat_minutes if order.priority == "stat" else t.test.tat_routine_minutes)
        for t in tests
        if t.status != "cancelled"
    ]
    return start + timedelta(minutes=max(minutes)) if minutes else None


def summarize(order: Order) -> OrderSummary:
    active = [t for t in order.tests if t.status != "cancelled"]
    summary = OrderSummary.model_validate(order)
    summary.test_count = len(active)
    summary.verified_count = sum(t.status == "verified" for t in active)
    summary.has_critical = any(t.is_critical and t.status in ("resulted", "verified") for t in active)
    summary.has_abnormal = any(t.flag not in (None, "N") and t.status in ("resulted", "verified") for t in active)
    return summary


def order_out(order: Order) -> OrderOut:
    summary = summarize(order)
    out = OrderOut.model_validate(order)
    for field in ("test_count", "verified_count", "has_critical", "has_abnormal"):
        setattr(out, field, getattr(summary, field))
    out.tests = sorted(out.tests, key=lambda r: next(t.test.sort_order for t in order.tests if t.id == r.id))
    return out
