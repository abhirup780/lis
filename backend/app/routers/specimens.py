from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_, select

from app.db import utcnow
from app.deps import DB, CurrentUser, require
from app.models import Order, Patient, Specimen, User
from app.schemas import Page, SpecimenAction, SpecimenOut
from app.services.audit import audit
from app.services.numbering import next_accession
from app.services.results import refresh_order_status

router = APIRouter(prefix="/specimens", tags=["specimens"])


def specimen_out(s: Specimen) -> SpecimenOut:
    return SpecimenOut.model_validate(
        {
            **{k: getattr(s, k) for k in SpecimenOut.model_fields if hasattr(s, k) and k != "tests"},
            "order_number": s.order.order_number,
            "priority": s.order.priority,
            "patient": s.order.patient,
            "tests": [t.test for t in s.tests if t.status != "cancelled"],
        }
    )


@router.get("", response_model=Page[SpecimenOut])
def list_specimens(
    db: DB,
    _: CurrentUser,
    status: str | None = None,
    q: str | None = None,
    limit: Annotated[int, Query(le=200)] = 100,
    offset: int = 0,
) -> Page[SpecimenOut]:
    query = select(Specimen).join(Order).join(Patient).where(Order.status != "cancelled")
    if status:
        query = query.where(Specimen.status.in_(status.split(",")))
    if q:
        like = f"%{q.strip()}%"
        query = query.where(
            or_(
                Specimen.accession.ilike(like),
                Order.order_number.ilike(like),
                Patient.mrn.ilike(like),
                Patient.last_name.ilike(like),
            )
        )
    total = db.scalar(select(func.count()).select_from(query.subquery()))
    # STAT first, then oldest first, so the worklist reads top to bottom.
    rows = db.scalars(
        query.order_by((Order.priority == "stat").desc(), Specimen.created_at).limit(limit).offset(offset)
    ).all()
    return Page(items=[specimen_out(s) for s in rows], total=total)


@router.get("/by-accession/{accession}", response_model=SpecimenOut)
def by_accession(db: DB, _: CurrentUser, accession: str) -> SpecimenOut:
    specimen = db.scalar(select(Specimen).where(Specimen.accession == accession.strip()))
    if specimen is None:
        raise HTTPException(404, f"No specimen with accession {accession}")
    return specimen_out(specimen)


@router.post("/{specimen_id}/action", response_model=SpecimenOut)
def specimen_action(
    db: DB, specimen_id: int, body: SpecimenAction, user: Annotated[User, Depends(require("specimens:write"))]
) -> SpecimenOut:
    specimen = db.get(Specimen, specimen_id)
    if specimen is None:
        raise HTTPException(404, "Specimen not found")
    if specimen.order.status == "cancelled":
        raise HTTPException(400, "The order is cancelled")
    now = utcnow()

    if body.action == "collect":
        if specimen.status != "pending":
            raise HTTPException(400, f"Specimen is already {specimen.status}")
        specimen.status = "collected"
        specimen.collected_at = now
        specimen.collected_by_id = user.id
    elif body.action == "receive":
        if specimen.status not in ("pending", "collected"):
            raise HTTPException(400, f"Specimen is already {specimen.status}")
        if specimen.collected_at is None:
            specimen.collected_at = now
            specimen.collected_by_id = user.id
        specimen.status = "received"
        specimen.received_at = now
        specimen.received_by_id = user.id
    else:
        if specimen.status == "rejected":
            raise HTTPException(400, "Specimen is already rejected")
        if not body.reason:
            raise HTTPException(400, "A rejection reason is required")
        if any(t.status == "verified" for t in specimen.tests):
            raise HTTPException(400, "Specimen has verified results and can't be rejected")
        specimen.status = "rejected"
        specimen.rejected_at = now
        specimen.rejection_reason = body.reason
        # Ask for a new tube: the open tests move to a fresh specimen awaiting collection.
        open_tests = [t for t in specimen.tests if t.status != "cancelled"]
        if open_tests:
            replacement = Specimen(
                accession=next_accession(db), order=specimen.order, specimen_type=specimen.specimen_type
            )
            db.add(replacement)
            for t in open_tests:
                t.specimen = replacement
                t.status = "pending"
                t.value_text = t.value_numeric = t.flag = None
                t.is_critical = t.delta_failed = t.outside_amr = False

    db.flush()
    refresh_order_status(specimen.order)
    audit(
        db, user, f"specimen.{body.action}", "specimen", specimen.id, accession=specimen.accession, reason=body.reason
    )
    db.commit()
    db.refresh(specimen)
    return specimen_out(specimen)
