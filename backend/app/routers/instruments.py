from typing import Annotated

from fastapi import APIRouter, Body, Depends
from fastapi.responses import PlainTextResponse
from sqlalchemy import select

from app.deps import DB, require
from app.models import OrderTest, Specimen, Test, User
from app.schemas import InstrumentResultStatus, InstrumentUpload, InstrumentUploadResponse
from app.services.hl7 import HL7Error, build_ack, parse_oru
from app.services.results import ResultError, record_result

router = APIRouter(prefix="/instruments", tags=["instrument interface"])


def _ingest(db: DB, instrument: str, accession: str, test_code: str, value: str, user: User) -> InstrumentResultStatus:
    status = InstrumentResultStatus(accession=accession, test_code=test_code, status="error")
    specimen = db.scalar(select(Specimen).where(Specimen.accession == accession))
    if specimen is None:
        status.error = "Unknown accession"
        return status
    ot = db.scalar(
        select(OrderTest)
        .join(Test)
        .where(OrderTest.specimen_id == specimen.id, Test.code == test_code.upper(), OrderTest.status != "cancelled")
    )
    if ot is None:
        status.error = "Test not ordered on this specimen"
        return status
    try:
        with db.begin_nested():
            record_result(db, ot, value, user, source="instrument", instrument=instrument)
    except ResultError as e:
        status.error = str(e)
        return status
    status.status = "autoverified" if ot.status == "verified" else "accepted"
    status.flag = ot.flag
    return status


@router.post("/results", response_model=InstrumentUploadResponse)
def upload_results(
    db: DB, body: InstrumentUpload, user: Annotated[User, Depends(require("results:write"))]
) -> InstrumentUploadResponse:
    """Accept a batch of analyzer results (JSON). Results on a verified test are rejected, never overwritten."""
    statuses = [_ingest(db, body.instrument, r.accession, r.test_code, r.value, user) for r in body.results]
    db.commit()
    return InstrumentUploadResponse(
        accepted=sum(s.status == "accepted" for s in statuses),
        autoverified=sum(s.status == "autoverified" for s in statuses),
        errors=sum(s.status == "error" for s in statuses),
        results=statuses,
    )


@router.post("/hl7", response_class=PlainTextResponse)
def upload_hl7(
    db: DB,
    user: Annotated[User, Depends(require("results:write"))],
    message: Annotated[str, Body(media_type="text/plain")],
) -> str:
    """Accept an HL7 v2 ORU^R01 message and answer with an HL7 ACK."""
    try:
        parsed = parse_oru(message)
    except HL7Error as e:
        return build_ack(None, "AR", str(e))
    statuses = [
        _ingest(db, parsed.sending_application or "HL7", o.accession, o.test_code, o.value, user)
        for o in parsed.observations
    ]
    db.commit()
    errors = [f"{s.accession}/{s.test_code}: {s.error}" for s in statuses if s.status == "error"]
    if errors:
        return build_ack(parsed, "AE", "; ".join(errors)[:200])
    return build_ack(parsed, "AA", f"{len(statuses)} results accepted")
