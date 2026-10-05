from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_, select

from app.config import get_settings
from app.deps import DB, CurrentUser, require
from app.models import Order, Patient, User
from app.schemas import HistoryOut, LabInfo, OrderCreate, OrderOut, OrderSummary, Page
from app.services.audit import audit
from app.services.orders import OrderError, create_order, order_out, summarize

router = APIRouter(prefix="/orders", tags=["orders"])


@router.get("", response_model=Page[OrderSummary])
def list_orders(
    db: DB,
    _: CurrentUser,
    q: str | None = None,
    status: str | None = None,
    priority: str | None = None,
    limit: Annotated[int, Query(le=200)] = 50,
    offset: int = 0,
) -> Page[OrderSummary]:
    query = select(Order).join(Patient)
    if q:
        like = f"%{q.strip()}%"
        query = query.where(
            or_(
                Order.order_number.ilike(like),
                Patient.mrn.ilike(like),
                Patient.last_name.ilike(like),
                Patient.first_name.ilike(like),
                Order.ordering_provider.ilike(like),
            )
        )
    if status:
        query = query.where(Order.status.in_(status.split(",")))
    if priority:
        query = query.where(Order.priority == priority)
    total = db.scalar(select(func.count()).select_from(query.subquery()))
    orders = db.scalars(query.order_by(Order.created_at.desc()).limit(limit).offset(offset)).all()
    return Page(items=[summarize(o) for o in orders], total=total)


@router.post("", response_model=OrderOut, status_code=201)
def new_order(db: DB, body: OrderCreate, user: Annotated[User, Depends(require("orders:write"))]) -> OrderOut:
    try:
        order = create_order(db, body, user)
    except OrderError as e:
        raise HTTPException(400, str(e))
    db.commit()
    db.refresh(order)
    return order_out(order)


def _get(db: DB, order_id: int) -> Order:
    order = db.get(Order, order_id)
    if order is None:
        raise HTTPException(404, "Order not found")
    return order


@router.get("/lab-info", response_model=LabInfo)
def lab_info(_: CurrentUser) -> LabInfo:
    s = get_settings()
    return LabInfo(name=s.lab_name, address=s.lab_address, director=s.lab_director)


@router.get("/{order_id}", response_model=OrderOut)
def get_order(db: DB, _: CurrentUser, order_id: int) -> OrderOut:
    return order_out(_get(db, order_id))


@router.post("/{order_id}/cancel", response_model=OrderOut)
def cancel_order(db: DB, order_id: int, user: Annotated[User, Depends(require("orders:write"))]) -> OrderOut:
    order = _get(db, order_id)
    if any(t.status == "verified" for t in order.tests):
        raise HTTPException(400, "Orders with verified results can't be cancelled; cancel individual tests instead")
    order.status = "cancelled"
    for t in order.tests:
        t.status = "cancelled"
    for s in order.specimens:
        if s.status == "pending":
            s.status = "rejected"
            s.rejection_reason = "Order cancelled"
    audit(db, user, "order.cancelled", "order", order.id, order_number=order.order_number)
    db.commit()
    return order_out(order)


@router.post("/{order_id}/tests/{order_test_id}/cancel", response_model=OrderOut)
def cancel_test(
    db: DB, order_id: int, order_test_id: int, user: Annotated[User, Depends(require("orders:write"))]
) -> OrderOut:
    from app.services.results import refresh_order_status

    order = _get(db, order_id)
    ot = next((t for t in order.tests if t.id == order_test_id), None)
    if ot is None:
        raise HTTPException(404, "Test not found on this order")
    if ot.status == "verified":
        raise HTTPException(400, "Verified results can't be cancelled; amend them instead")
    ot.status = "cancelled"
    refresh_order_status(order)
    audit(db, user, "order_test.cancelled", "order_test", ot.id, test=ot.test.code)
    db.commit()
    return order_out(order)


@router.get("/{order_id}/tests/{order_test_id}/history", response_model=list[HistoryOut])
def result_history(db: DB, _: CurrentUser, order_id: int, order_test_id: int) -> list:
    order = _get(db, order_id)
    ot = next((t for t in order.tests if t.id == order_test_id), None)
    if ot is None:
        raise HTTPException(404, "Test not found on this order")
    return ot.history
