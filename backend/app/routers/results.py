from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select

from app.db import utcnow
from app.deps import DB, CurrentUser, require
from app.models import CriticalNotification, Order, OrderTest, Specimen, User
from app.schemas import (
    CriticalAcknowledge,
    CriticalOut,
    ResultEntryBatch,
    ResultEntryError,
    ResultEntryResponse,
    ResultOut,
    VerifyRequest,
    WorklistItem,
)
from app.services.audit import audit
from app.services.orders import due_at
from app.services.results import ResultError, record_result, verify_result

router = APIRouter(tags=["results"])


@router.get("/worklist", response_model=list[WorklistItem])
def worklist(
    db: DB,
    _: CurrentUser,
    department: str | None = None,
    status: str = "open",
) -> list[WorklistItem]:
    """Received specimens with results to enter or verify.

    status=open shows anything not yet verified; status=review shows specimens
    with results waiting for verification.
    """
    query = (
        select(Specimen)
        .join(Order)
        .where(Specimen.status == "received", Order.status != "cancelled")
        .order_by((Order.priority == "stat").desc(), Specimen.received_at)
    )
    items: list[WorklistItem] = []
    for specimen in db.scalars(query):
        tests = [
            t
            for t in specimen.tests
            if t.status != "cancelled" and (department is None or t.test.department.code == department.upper())
        ]
        if not tests:
            continue
        if status == "open" and all(t.status == "verified" for t in tests):
            continue
        if status == "review" and not any(t.status == "resulted" for t in tests):
            continue
        order = specimen.order
        items.append(
            WorklistItem(
                specimen=specimen,
                order_id=order.id,
                order_number=order.order_number,
                priority=order.priority,
                patient=order.patient,
                results=sorted(tests, key=lambda t: t.test.sort_order),
                due_at=due_at(order, specimen),
            )
        )
    return items


@router.post("/results", response_model=ResultEntryResponse)
def enter_results(
    db: DB, body: ResultEntryBatch, user: Annotated[User, Depends(require("results:write"))]
) -> ResultEntryResponse:
    updated: list[OrderTest] = []
    errors: list[ResultEntryError] = []
    for entry in body.results:
        ot = db.get(OrderTest, entry.order_test_id)
        if ot is None:
            errors.append(ResultEntryError(order_test_id=entry.order_test_id, error="Result not found"))
            continue
        try:
            with db.begin_nested():
                record_result(db, ot, entry.value, user, comment=entry.comment, amend_reason=entry.amend_reason)
            updated.append(ot)
        except ResultError as e:
            db.refresh(ot)
            errors.append(ResultEntryError(order_test_id=entry.order_test_id, error=str(e)))
    db.commit()
    # Entering one result can update calculated results on the same order; return those too.
    touched = {o.id: o for ot in updated for o in ot.order.tests if o.status != "pending"}
    return ResultEntryResponse(
        updated=[ResultOut.model_validate(o) for o in touched.values()],
        errors=errors,
    )


@router.post("/results/verify", response_model=ResultEntryResponse)
def verify(db: DB, body: VerifyRequest, user: Annotated[User, Depends(require("results:verify"))]) -> ResultEntryResponse:
    updated: list[OrderTest] = []
    errors: list[ResultEntryError] = []
    for ot_id in body.order_test_ids:
        ot = db.get(OrderTest, ot_id)
        if ot is None:
            errors.append(ResultEntryError(order_test_id=ot_id, error="Result not found"))
            continue
        if ot.status == "verified":
            continue
        try:
            verify_result(db, ot, user)
            updated.append(ot)
        except ResultError as e:
            errors.append(ResultEntryError(order_test_id=ot_id, error=str(e)))
    db.commit()
    touched = {o.id: o for ot in updated for o in ot.order.tests if o.status != "pending"}
    return ResultEntryResponse(updated=[ResultOut.model_validate(o) for o in touched.values()], errors=errors)


def critical_out(n: CriticalNotification) -> CriticalOut:
    order = n.order_test.order
    return CriticalOut.model_validate(
        {
            "id": n.id,
            "status": n.status,
            "created_at": n.created_at,
            "notified_person": n.notified_person,
            "read_back": n.read_back,
            "notes": n.notes,
            "notified_at": n.notified_at,
            "notified_by": n.notified_by,
            "result": n.order_test,
            "order_id": order.id,
            "order_number": order.order_number,
            "ordering_provider": order.ordering_provider,
            "patient": order.patient,
        }
    )


@router.get("/criticals", response_model=list[CriticalOut])
def list_criticals(db: DB, _: CurrentUser, status: str | None = None) -> list[CriticalOut]:
    query = select(CriticalNotification).order_by(CriticalNotification.created_at.desc()).limit(200)
    if status:
        query = query.where(CriticalNotification.status == status)
    return [critical_out(n) for n in db.scalars(query)]


@router.post("/criticals/{notification_id}/acknowledge", response_model=CriticalOut)
def acknowledge_critical(
    db: DB,
    notification_id: int,
    body: CriticalAcknowledge,
    user: Annotated[User, Depends(require("criticals:write"))],
) -> CriticalOut:
    n = db.get(CriticalNotification, notification_id)
    if n is None:
        raise HTTPException(404, "Critical notification not found")
    if not body.read_back:
        raise HTTPException(400, "The recipient must read back the result before it can be documented")
    n.status = "notified"
    n.notified_person = body.notified_person
    n.read_back = body.read_back
    n.notes = body.notes
    n.notified_at = utcnow()
    n.notified_by_id = user.id
    audit(db, user, "critical.notified", "critical_notification", n.id, notified_person=body.notified_person)
    db.commit()
    return critical_out(n)

