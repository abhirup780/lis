"""Database models for the LIS.

The core workflow is: Patient -> Order -> (Specimen, OrderTest). Each OrderTest is
one requested test and also holds its result, so a result's whole lifecycle
(pending -> resulted -> verified, plus amendments) lives on a single row.
"""

from datetime import date, datetime
from typing import Any

from sqlalchemy import (
    JSON,
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base, utcnow


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


# --- Users -------------------------------------------------------------------


class User(TimestampMixin, Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    full_name: Mapped[str] = mapped_column(String(128))
    email: Mapped[str | None] = mapped_column(String(255))
    hashed_password: Mapped[str] = mapped_column(String(255))
    # admin | manager | technologist | front_desk | physician
    role: Mapped[str] = mapped_column(String(32), default="technologist")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


# --- Patients ----------------------------------------------------------------


class Patient(TimestampMixin, Base):
    __tablename__ = "patients"

    id: Mapped[int] = mapped_column(primary_key=True)
    mrn: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    first_name: Mapped[str] = mapped_column(String(64))
    last_name: Mapped[str] = mapped_column(String(64), index=True)
    date_of_birth: Mapped[date] = mapped_column(Date)
    sex: Mapped[str] = mapped_column(String(1))  # M | F | U
    phone: Mapped[str | None] = mapped_column(String(32))
    email: Mapped[str | None] = mapped_column(String(255))
    address: Mapped[str | None] = mapped_column(Text)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    orders: Mapped[list["Order"]] = relationship(back_populates="patient")


# --- Test catalog ------------------------------------------------------------


class Department(Base):
    __tablename__ = "departments"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(16), unique=True)
    name: Mapped[str] = mapped_column(String(64))


class SpecimenType(Base):
    __tablename__ = "specimen_types"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(16), unique=True)
    name: Mapped[str] = mapped_column(String(64))
    container: Mapped[str] = mapped_column(String(64))
    cap_color: Mapped[str] = mapped_column(String(16), default="#999999")


class Test(Base):
    __tablename__ = "tests"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(16), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(128))
    loinc: Mapped[str | None] = mapped_column(String(16))
    department_id: Mapped[int] = mapped_column(ForeignKey("departments.id"))
    specimen_type_id: Mapped[int] = mapped_column(ForeignKey("specimen_types.id"))
    unit: Mapped[str | None] = mapped_column(String(32))
    result_type: Mapped[str] = mapped_column(String(16), default="numeric")  # numeric | text
    decimals: Mapped[int] = mapped_column(Integer, default=1)
    # Calculated tests are derived from other results (see services/calculations.py).
    calc_key: Mapped[str | None] = mapped_column(String(32))
    is_orderable: Mapped[bool] = mapped_column(Boolean, default=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    autoverify: Mapped[bool] = mapped_column(Boolean, default=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    tat_routine_minutes: Mapped[int] = mapped_column(Integer, default=240)
    tat_stat_minutes: Mapped[int] = mapped_column(Integer, default=60)
    # Delta check: flag when the change from the previous result exceeds this percent.
    delta_percent: Mapped[float | None] = mapped_column(Float)
    # Analytical measuring range; results outside it can't be auto-verified.
    amr_low: Mapped[float | None] = mapped_column(Float)
    amr_high: Mapped[float | None] = mapped_column(Float)

    department: Mapped[Department] = relationship()
    specimen_type: Mapped[SpecimenType] = relationship()
    reference_ranges: Mapped[list["ReferenceRange"]] = relationship(
        back_populates="test", cascade="all, delete-orphan", order_by="ReferenceRange.id"
    )

    @property
    def is_calculated(self) -> bool:
        return self.calc_key is not None


class ReferenceRange(Base):
    __tablename__ = "reference_ranges"

    id: Mapped[int] = mapped_column(primary_key=True)
    test_id: Mapped[int] = mapped_column(ForeignKey("tests.id", ondelete="CASCADE"))
    sex: Mapped[str | None] = mapped_column(String(1))  # None applies to any sex
    age_min_days: Mapped[int] = mapped_column(Integer, default=0)
    age_max_days: Mapped[int] = mapped_column(Integer, default=200 * 365)
    low: Mapped[float | None] = mapped_column(Float)
    high: Mapped[float | None] = mapped_column(Float)
    critical_low: Mapped[float | None] = mapped_column(Float)
    critical_high: Mapped[float | None] = mapped_column(Float)
    normal_text: Mapped[str | None] = mapped_column(String(64))

    test: Mapped[Test] = relationship(back_populates="reference_ranges")


class Panel(Base):
    __tablename__ = "panels"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(16), unique=True)
    name: Mapped[str] = mapped_column(String(128))
    department_id: Mapped[int] = mapped_column(ForeignKey("departments.id"))
    description: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    department: Mapped[Department] = relationship()
    items: Mapped[list["PanelTest"]] = relationship(
        cascade="all, delete-orphan", order_by="PanelTest.sort_order"
    )


class PanelTest(Base):
    __tablename__ = "panel_tests"

    panel_id: Mapped[int] = mapped_column(ForeignKey("panels.id", ondelete="CASCADE"), primary_key=True)
    test_id: Mapped[int] = mapped_column(ForeignKey("tests.id"), primary_key=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    test: Mapped[Test] = relationship()


# --- Orders, specimens and results ------------------------------------------


class Counter(Base):
    """Named sequences used for accession and order numbers."""

    __tablename__ = "counters"

    name: Mapped[str] = mapped_column(String(32), primary_key=True)
    value: Mapped[int] = mapped_column(Integer, default=0)


class Order(TimestampMixin, Base):
    __tablename__ = "orders"

    id: Mapped[int] = mapped_column(primary_key=True)
    order_number: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    patient_id: Mapped[int] = mapped_column(ForeignKey("patients.id"), index=True)
    ordering_provider: Mapped[str] = mapped_column(String(128))
    priority: Mapped[str] = mapped_column(String(16), default="routine")  # routine | stat
    # ordered | in_progress | completed | cancelled
    status: Mapped[str] = mapped_column(String(16), default="ordered", index=True)
    clinical_info: Mapped[str | None] = mapped_column(Text)
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    patient: Mapped[Patient] = relationship(back_populates="orders")
    created_by: Mapped[User | None] = relationship()
    specimens: Mapped[list["Specimen"]] = relationship(back_populates="order", order_by="Specimen.id")
    tests: Mapped[list["OrderTest"]] = relationship(back_populates="order", order_by="OrderTest.id")


class Specimen(TimestampMixin, Base):
    __tablename__ = "specimens"

    id: Mapped[int] = mapped_column(primary_key=True)
    accession: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id"), index=True)
    specimen_type_id: Mapped[int] = mapped_column(ForeignKey("specimen_types.id"))
    # pending | collected | received | rejected
    status: Mapped[str] = mapped_column(String(16), default="pending", index=True)
    collected_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    collected_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    received_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    received_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    rejected_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    rejection_reason: Mapped[str | None] = mapped_column(String(255))

    order: Mapped[Order] = relationship(back_populates="specimens")
    specimen_type: Mapped[SpecimenType] = relationship()
    collected_by: Mapped[User | None] = relationship(foreign_keys=[collected_by_id])
    received_by: Mapped[User | None] = relationship(foreign_keys=[received_by_id])
    tests: Mapped[list["OrderTest"]] = relationship(back_populates="specimen", order_by="OrderTest.id")


class OrderTest(Base):
    __tablename__ = "order_tests"

    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id"), index=True)
    test_id: Mapped[int] = mapped_column(ForeignKey("tests.id"))
    panel_id: Mapped[int | None] = mapped_column(ForeignKey("panels.id"))
    specimen_id: Mapped[int | None] = mapped_column(ForeignKey("specimens.id"), index=True)
    # pending | resulted | verified | cancelled
    status: Mapped[str] = mapped_column(String(16), default="pending", index=True)

    value_text: Mapped[str | None] = mapped_column(String(255))
    value_numeric: Mapped[float | None] = mapped_column(Float)
    unit: Mapped[str | None] = mapped_column(String(32))
    ref_low: Mapped[float | None] = mapped_column(Float)
    ref_high: Mapped[float | None] = mapped_column(Float)
    ref_text: Mapped[str | None] = mapped_column(String(64))
    # N normal | L low | H high | LL critical low | HH critical high | A abnormal (text)
    flag: Mapped[str | None] = mapped_column(String(4))
    is_critical: Mapped[bool] = mapped_column(Boolean, default=False)
    delta_failed: Mapped[bool] = mapped_column(Boolean, default=False)
    previous_value: Mapped[float | None] = mapped_column(Float)
    outside_amr: Mapped[bool] = mapped_column(Boolean, default=False)
    comment: Mapped[str | None] = mapped_column(Text)
    source: Mapped[str | None] = mapped_column(String(16))  # manual | instrument | calculated
    instrument: Mapped[str | None] = mapped_column(String(64))
    entered_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    entered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    verified_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    auto_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    is_amended: Mapped[bool] = mapped_column(Boolean, default=False)

    order: Mapped[Order] = relationship(back_populates="tests")
    test: Mapped[Test] = relationship()
    panel: Mapped[Panel | None] = relationship()
    specimen: Mapped[Specimen | None] = relationship(back_populates="tests")
    entered_by: Mapped[User | None] = relationship(foreign_keys=[entered_by_id])
    verified_by: Mapped[User | None] = relationship(foreign_keys=[verified_by_id])
    history: Mapped[list["ResultHistory"]] = relationship(order_by="ResultHistory.id")


class ResultHistory(Base):
    """Previous values of a result, kept when a verified result is amended."""

    __tablename__ = "result_history"

    id: Mapped[int] = mapped_column(primary_key=True)
    order_test_id: Mapped[int] = mapped_column(ForeignKey("order_tests.id"), index=True)
    value_text: Mapped[str | None] = mapped_column(String(255))
    flag: Mapped[str | None] = mapped_column(String(4))
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    verified_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    amended_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    amended_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    reason: Mapped[str] = mapped_column(Text)


class CriticalNotification(TimestampMixin, Base):
    """A critical result that must be phoned through and documented."""

    __tablename__ = "critical_notifications"

    id: Mapped[int] = mapped_column(primary_key=True)
    order_test_id: Mapped[int] = mapped_column(ForeignKey("order_tests.id"), unique=True)
    status: Mapped[str] = mapped_column(String(16), default="pending", index=True)  # pending | notified
    notified_person: Mapped[str | None] = mapped_column(String(128))
    read_back: Mapped[bool] = mapped_column(Boolean, default=False)
    notes: Mapped[str | None] = mapped_column(Text)
    notified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    notified_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))

    order_test: Mapped[OrderTest] = relationship()
    notified_by: Mapped[User | None] = relationship()


# --- Quality control ---------------------------------------------------------


class QCMaterial(TimestampMixin, Base):
    __tablename__ = "qc_materials"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(128))
    lot_number: Mapped[str] = mapped_column(String(64))
    level: Mapped[int] = mapped_column(Integer, default=1)
    expiry_date: Mapped[date | None] = mapped_column(Date)
    department_id: Mapped[int] = mapped_column(ForeignKey("departments.id"))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    department: Mapped[Department] = relationship()
    targets: Mapped[list["QCTarget"]] = relationship(back_populates="material", cascade="all, delete-orphan")


class QCTarget(Base):
    """The expected mean and SD of one analyte in one QC material lot."""

    __tablename__ = "qc_targets"
    __table_args__ = (UniqueConstraint("material_id", "test_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    material_id: Mapped[int] = mapped_column(ForeignKey("qc_materials.id", ondelete="CASCADE"))
    test_id: Mapped[int] = mapped_column(ForeignKey("tests.id"))
    mean: Mapped[float] = mapped_column(Float)
    sd: Mapped[float] = mapped_column(Float)

    material: Mapped[QCMaterial] = relationship(back_populates="targets")
    test: Mapped[Test] = relationship()


class QCResult(Base):
    __tablename__ = "qc_results"

    id: Mapped[int] = mapped_column(primary_key=True)
    target_id: Mapped[int] = mapped_column(ForeignKey("qc_targets.id", ondelete="CASCADE"), index=True)
    value: Mapped[float] = mapped_column(Float)
    z_score: Mapped[float] = mapped_column(Float)
    status: Mapped[str] = mapped_column(String(16))  # accepted | warning | rejected
    violations: Mapped[list[str]] = mapped_column(JSON, default=list)
    comment: Mapped[str | None] = mapped_column(Text)
    run_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    entered_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))

    target: Mapped[QCTarget] = relationship()
    entered_by: Mapped[User | None] = relationship()


# --- Audit -------------------------------------------------------------------


class AuditLog(Base):
    __tablename__ = "audit_log"

    id: Mapped[int] = mapped_column(primary_key=True)
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    action: Mapped[str] = mapped_column(String(64), index=True)
    entity_type: Mapped[str] = mapped_column(String(32))
    entity_id: Mapped[int | None] = mapped_column(Integer)
    details: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)

    user: Mapped[User | None] = relationship()
