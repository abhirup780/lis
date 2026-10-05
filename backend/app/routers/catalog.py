from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select

from app.deps import DB, CurrentUser, require
from app.models import Department, Panel, ReferenceRange, SpecimenType, Test, User
from app.schemas import DepartmentOut, PanelOut, SpecimenTypeOut, TestOut, TestUpdate
from app.services.audit import audit
from app.services.calculations import CALCULATIONS

router = APIRouter(prefix="/catalog", tags=["catalog"])


@router.get("/departments", response_model=list[DepartmentOut])
def departments(db: DB, _: CurrentUser) -> list:
    return db.scalars(select(Department).order_by(Department.name)).all()


@router.get("/specimen-types", response_model=list[SpecimenTypeOut])
def specimen_types(db: DB, _: CurrentUser) -> list:
    return db.scalars(select(SpecimenType).order_by(SpecimenType.name)).all()


@router.get("/tests", response_model=list[TestOut])
def tests(db: DB, _: CurrentUser, department: str | None = None, orderable: bool | None = None) -> list:
    query = select(Test).join(Department).order_by(Department.name, Test.sort_order)
    if department:
        query = query.where(Department.code == department.upper())
    if orderable is not None:
        query = query.where(Test.is_orderable == orderable, Test.is_active)
    return db.scalars(query).all()


@router.get("/tests/{code}", response_model=TestOut)
def get_test(db: DB, _: CurrentUser, code: str) -> Test:
    test = db.scalar(select(Test).where(Test.code == code.upper()))
    if test is None:
        raise HTTPException(404, "Test not found")
    return test


@router.patch("/tests/{code}", response_model=TestOut)
def update_test(db: DB, code: str, body: TestUpdate, user: Annotated[User, Depends(require("catalog:write"))]) -> Test:
    test = db.scalar(select(Test).where(Test.code == code.upper()))
    if test is None:
        raise HTTPException(404, "Test not found")
    changes = body.model_dump(exclude_unset=True, exclude={"reference_ranges"})
    ranges = [r.model_dump() for r in body.reference_ranges] if body.reference_ranges is not None else None
    for key, value in changes.items():
        setattr(test, key, value)
    if ranges is not None:
        for r in ranges:
            if r["age_min_days"] > r["age_max_days"]:
                raise HTTPException(400, "A reference range's minimum age is greater than its maximum age")
        test.reference_ranges = [ReferenceRange(**r) for r in ranges]
    audit(db, user, "test.updated", "test", test.id, code=test.code, changes={**changes, "ranges_replaced": ranges is not None})
    db.commit()
    db.refresh(test)
    return test


@router.get("/panels", response_model=list[PanelOut])
def panels(db: DB, _: CurrentUser) -> list[PanelOut]:
    rows = db.scalars(select(Panel).where(Panel.is_active).order_by(Panel.department_id, Panel.name)).all()
    return [
        PanelOut.model_validate(
            {
                "id": p.id,
                "code": p.code,
                "name": p.name,
                "description": p.description,
                "department": p.department,
                "tests": [i.test for i in p.items],
            }
        )
        for p in rows
    ]


@router.get("/calculations", response_model=dict[str, dict])
def calculations(_: CurrentUser) -> dict:
    return {k: {"inputs": list(c.inputs), "description": c.description} for k, c in CALCULATIONS.items()}
