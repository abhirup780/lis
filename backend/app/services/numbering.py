from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db import utcnow


def next_value(db: Session, name: str) -> int:
    """Atomically increment and return a named counter."""
    return db.execute(
        text(
            "INSERT INTO counters (name, value) VALUES (:name, 1) "
            "ON CONFLICT (name) DO UPDATE SET value = counters.value + 1 RETURNING value"
        ),
        {"name": name},
    ).scalar_one()


def next_order_number(db: Session) -> str:
    day = utcnow().strftime("%y%m%d")
    return f"ORD-{day}-{next_value(db, f'order-{day}'):04d}"


def next_accession(db: Session) -> str:
    """Accession numbers are 10 numeric digits (YYMMDD + sequence) so they scan as Code 128."""
    day = utcnow().strftime("%y%m%d")
    return f"{day}{next_value(db, f'accession-{day}'):04d}"
