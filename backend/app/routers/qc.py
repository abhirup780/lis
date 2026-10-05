from datetime import timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select

from app.db import utcnow
from app.deps import DB, CurrentUser, require
from app.models import Department, QCMaterial, QCResult, QCTarget, Test, User
from app.schemas import QCMaterialCreate, QCMaterialOut, QCResultCreate, QCResultOut, QCStatusItem
from app.services.audit import audit
from app.services.westgard import evaluate

router = APIRouter(prefix="/qc", tags=["quality control"])


@router.get("/materials", response_model=list[QCMaterialOut])
def materials(db: DB, _: CurrentUser, include_inactive: bool = False) -> list:
    query = select(QCMaterial).order_by(QCMaterial.name, QCMaterial.level)
    if not include_inactive:
        query = query.where(QCMaterial.is_active)
    return db.scalars(query).all()


@router.post("/materials", response_model=QCMaterialOut, status_code=201)
def create_material(
    db: DB, body: QCMaterialCreate, user: Annotated[User, Depends(require("qc:manage"))]
) -> QCMaterial:
    dept = db.scalar(select(Department).where(Department.code == body.department_code.upper()))
    if dept is None:
        raise HTTPException(400, f"Unknown department '{body.department_code}'")
    material = QCMaterial(
        name=body.name, lot_number=body.lot_number, level=body.level, expiry_date=body.expiry_date, department=dept
    )
    for t in body.targets:
        test = db.scalar(select(Test).where(Test.code == t.test_code.upper()))
        if test is None:
            raise HTTPException(400, f"Unknown test '{t.test_code}'")
        material.targets.append(QCTarget(test=test, mean=t.mean, sd=t.sd))
    db.add(material)
    db.flush()
    audit(db, user, "qc.material_created", "qc_material", material.id, lot=material.lot_number)
    db.commit()
    return material


@router.post("/materials/{material_id}/deactivate", response_model=QCMaterialOut)
def deactivate_material(db: DB, material_id: int, user: Annotated[User, Depends(require("qc:manage"))]) -> QCMaterial:
    material = db.get(QCMaterial, material_id)
    if material is None:
        raise HTTPException(404, "QC material not found")
    material.is_active = False
    audit(db, user, "qc.material_deactivated", "qc_material", material.id)
    db.commit()
    return material


@router.post("/results", response_model=QCResultOut, status_code=201)
def add_result(db: DB, body: QCResultCreate, user: Annotated[User, Depends(require("qc:write"))]) -> QCResult:
    target = db.get(QCTarget, body.target_id)
    if target is None:
        raise HTTPException(404, "QC target not found")
    if not target.material.is_active:
        raise HTTPException(400, "This QC lot is no longer active")
    history = db.scalars(
        select(QCResult.z_score).where(QCResult.target_id == target.id).order_by(QCResult.run_at.desc()).limit(9)
    ).all()
    z = (body.value - target.mean) / target.sd
    status, violations = evaluate(z, list(history))
    result = QCResult(
        target=target,
        value=body.value,
        z_score=round(z, 3),
        status=status,
        violations=violations,
        comment=body.comment,
        entered_by=user,
    )
    db.add(result)
    db.flush()
    audit(db, user, "qc.result", "qc_result", result.id, test=target.test.code, status=status, violations=violations)
    db.commit()
    return result


@router.get("/targets/{target_id}/results", response_model=list[QCResultOut])
def target_results(db: DB, _: CurrentUser, target_id: int, days: int = 60) -> list:
    since = utcnow() - timedelta(days=days)
    return db.scalars(
        select(QCResult).where(QCResult.target_id == target_id, QCResult.run_at >= since).order_by(QCResult.run_at)
    ).all()


@router.get("/status", response_model=list[QCStatusItem])
def qc_status(db: DB, _: CurrentUser) -> list[QCStatusItem]:
    """Latest QC run for every active control, so the bench can see what is in or out."""
    items = []
    targets = db.scalars(
        select(QCTarget).join(QCMaterial).join(Test).where(QCMaterial.is_active).order_by(Test.sort_order, QCMaterial.level)
    ).all()
    for target in targets:
        latest = db.scalar(
            select(QCResult).where(QCResult.target_id == target.id).order_by(QCResult.run_at.desc()).limit(1)
        )
        items.append(
            QCStatusItem(
                test=target.test,
                material=f"{target.material.name} (lot {target.material.lot_number})",
                level=target.material.level,
                target_id=target.id,
                last_run_at=latest.run_at if latest else None,
                last_value=latest.value if latest else None,
                last_status=latest.status if latest else None,
                violations=latest.violations if latest else [],
            )
        )
    return items
