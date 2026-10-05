from datetime import datetime, time, timedelta
from statistics import median
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select

from app.db import utcnow
from app.deps import DB, CurrentUser, require
from app.models import AuditLog, CriticalNotification, Department, Order, OrderTest, Specimen, Test
from app.routers.qc import qc_status
from app.schemas import AuditOut, DashboardOut, DepartmentWorkload, Page
from app.services.orders import due_at, summarize

router = APIRouter(tags=["dashboard"])


@router.get("/dashboard", response_model=DashboardOut)
def dashboard(db: DB, user: CurrentUser) -> DashboardOut:
    now = utcnow()
    today = datetime.combine(now.date(), time.min, tzinfo=now.tzinfo)
    open_orders = db.scalars(select(Order).where(Order.status.in_(("ordered", "in_progress")))).all()

    def count(query) -> int:
        return db.scalar(select(func.count()).select_from(query.subquery())) or 0

    overdue = 0
    for order in open_orders:
        for specimen in order.specimens:
            if specimen.status == "received" and any(t.status != "verified" for t in specimen.tests if t.status != "cancelled"):
                due = due_at(order, specimen)
                if due and due < now:
                    overdue += 1

    verified_today = db.scalars(
        select(OrderTest).where(OrderTest.status == "verified", OrderTest.verified_at >= today)
    ).all()

    # Turnaround time: lab receipt to verification, over the last 7 days.
    week = db.execute(
        select(OrderTest.verified_at, Specimen.received_at)
        .join(Specimen, OrderTest.specimen_id == Specimen.id)
        .join(Test)
        .where(OrderTest.verified_at >= now - timedelta(days=7), Test.calc_key.is_(None))
    ).all()
    tats = [(v - r).total_seconds() / 60 for v, r in week if v and r]

    workload = []
    for dept in db.scalars(select(Department).order_by(Department.name)):
        base = select(OrderTest).join(Test).join(Order).where(Test.department_id == dept.id, Order.status != "cancelled")
        workload.append(
            DepartmentWorkload(
                department=dept.name,
                pending=count(base.where(OrderTest.status == "pending")),
                resulted=count(base.where(OrderTest.status == "resulted")),
                verified_today=sum(1 for t in verified_today if t.test.department_id == dept.id),
            )
        )

    recent = db.scalars(select(Order).order_by(Order.created_at.desc()).limit(8)).all()
    return DashboardOut(
        orders_today=count(select(Order).where(Order.created_at >= today)),
        awaiting_collection=count(
            select(Specimen).join(Order).where(Specimen.status.in_(("pending", "collected")), Order.status != "cancelled")
        ),
        in_lab=count(
            select(Specimen)
            .join(Order)
            .where(Specimen.status == "received", Order.status.in_(("ordered", "in_progress")))
        ),
        stat_open=sum(1 for o in open_orders if o.priority == "stat"),
        awaiting_verification=count(select(OrderTest).where(OrderTest.status == "resulted")),
        critical_pending=count(select(CriticalNotification).where(CriticalNotification.status == "pending")),
        qc_rejected=sum(1 for q in qc_status(db, user) if q.last_status == "rejected"),
        overdue=overdue,
        autoverified_today=sum(1 for t in verified_today if t.auto_verified and not t.test.is_calculated),
        verified_today=sum(1 for t in verified_today if not t.test.is_calculated),
        median_tat_minutes=round(median(tats), 1) if tats else None,
        workload=workload,
        recent_orders=[summarize(o) for o in recent],
    )


@router.get("/audit", response_model=Page[AuditOut], dependencies=[Depends(require("audit:read"))])
def audit_log(
    db: DB,
    entity_type: str | None = None,
    entity_id: int | None = None,
    action: str | None = None,
    limit: Annotated[int, Query(le=500)] = 100,
    offset: int = 0,
) -> Page[AuditOut]:
    query = select(AuditLog)
    if entity_type:
        query = query.where(AuditLog.entity_type == entity_type)
    if entity_id is not None:
        query = query.where(AuditLog.entity_id == entity_id)
    if action:
        query = query.where(AuditLog.action.ilike(f"{action}%"))
    total = db.scalar(select(func.count()).select_from(query.subquery()))
    rows = db.scalars(query.order_by(AuditLog.at.desc()).limit(limit).offset(offset)).all()
    return Page(items=rows, total=total)
