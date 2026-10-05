from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_, select

from app.deps import DB, CurrentUser, require
from app.models import Order, OrderTest, Patient, Test, User
from app.schemas import OrderSummary, Page, PatientCreate, PatientOut, PatientUpdate, TrendPoint
from app.services.audit import audit
from app.services.numbering import next_value
from app.services.orders import summarize

router = APIRouter(prefix="/patients", tags=["patients"])


@router.get("", response_model=Page[PatientOut])
def list_patients(
    db: DB,
    _: CurrentUser,
    q: str | None = None,
    limit: Annotated[int, Query(le=200)] = 50,
    offset: int = 0,
) -> Page[PatientOut]:
    query = select(Patient)
    if q:
        terms = q.strip().split()
        for term in terms:
            like = f"%{term}%"
            query = query.where(
                or_(Patient.mrn.ilike(like), Patient.first_name.ilike(like), Patient.last_name.ilike(like))
            )
    total = db.scalar(select(func.count()).select_from(query.subquery()))
    items = db.scalars(query.order_by(Patient.last_name, Patient.first_name).limit(limit).offset(offset)).all()
    return Page(items=items, total=total)


@router.post("", response_model=PatientOut, status_code=201)
def create_patient(db: DB, body: PatientCreate, user: Annotated[User, Depends(require("patients:write"))]) -> Patient:
    data = body.model_dump()
    if not data["mrn"]:
        data["mrn"] = f"MRN{next_value(db, 'mrn'):07d}"
    elif db.scalar(select(Patient).where(Patient.mrn == data["mrn"])):
        raise HTTPException(409, f"A patient with MRN {data['mrn']} already exists")
    patient = Patient(**data)
    db.add(patient)
    db.flush()
    audit(db, user, "patient.created", "patient", patient.id, mrn=patient.mrn)
    db.commit()
    return patient


def _get(db: DB, patient_id: int) -> Patient:
    patient = db.get(Patient, patient_id)
    if patient is None:
        raise HTTPException(404, "Patient not found")
    return patient


@router.get("/{patient_id}", response_model=PatientOut)
def get_patient(db: DB, _: CurrentUser, patient_id: int) -> Patient:
    return _get(db, patient_id)


@router.put("/{patient_id}", response_model=PatientOut)
def update_patient(
    db: DB, patient_id: int, body: PatientUpdate, user: Annotated[User, Depends(require("patients:write"))]
) -> Patient:
    patient = _get(db, patient_id)
    data = body.model_dump()
    if not data["mrn"]:
        data["mrn"] = patient.mrn
    elif data["mrn"] != patient.mrn and db.scalar(select(Patient).where(Patient.mrn == data["mrn"])):
        raise HTTPException(409, f"A patient with MRN {data['mrn']} already exists")
    for key, value in data.items():
        setattr(patient, key, value)
    audit(db, user, "patient.updated", "patient", patient.id)
    db.commit()
    return patient


@router.get("/{patient_id}/orders", response_model=list[OrderSummary])
def patient_orders(db: DB, _: CurrentUser, patient_id: int) -> list[OrderSummary]:
    _get(db, patient_id)
    orders = db.scalars(select(Order).where(Order.patient_id == patient_id).order_by(Order.created_at.desc())).all()
    return [summarize(o) for o in orders]


@router.get("/{patient_id}/trend/{test_code}", response_model=list[TrendPoint])
def patient_trend(db: DB, _: CurrentUser, patient_id: int, test_code: str) -> list[TrendPoint]:
    """Verified results of one test over time, oldest first, for cumulative views and charts."""
    _get(db, patient_id)
    rows = db.execute(
        select(OrderTest, Order)
        .join(Order)
        .join(Test)
        .where(Order.patient_id == patient_id, Test.code == test_code.upper(), OrderTest.status == "verified")
        .order_by(OrderTest.verified_at)
    ).all()
    return [
        TrendPoint(
            order_id=order.id,
            order_number=order.order_number,
            at=(ot.specimen.collected_at if ot.specimen and ot.specimen.collected_at else ot.verified_at),
            value_numeric=ot.value_numeric,
            value_text=ot.value_text,
            flag=ot.flag,
            ref_low=ot.ref_low,
            ref_high=ot.ref_high,
            unit=ot.unit,
        )
        for ot, order in rows
    ]
