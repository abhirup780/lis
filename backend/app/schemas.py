from datetime import date, datetime
from typing import Generic, Literal, TypeVar

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

T = TypeVar("T")

Role = Literal["admin", "manager", "technologist", "front_desk", "physician"]
Sex = Literal["M", "F", "U"]
Priority = Literal["routine", "stat"]


class ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class Page(BaseModel, Generic[T]):
    items: list[T]
    total: int


# --- Auth / users ------------------------------------------------------------


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserOut(ORM):
    id: int
    username: str
    full_name: str
    email: str | None
    role: str
    is_active: bool
    permissions: list[str] = []


class UserBrief(ORM):
    id: int
    username: str
    full_name: str


class UserCreate(BaseModel):
    username: str = Field(min_length=3, max_length=64)
    full_name: str = Field(min_length=1, max_length=128)
    email: EmailStr | None = None
    role: Role
    password: str = Field(min_length=8)


class UserUpdate(BaseModel):
    full_name: str | None = None
    email: EmailStr | None = None
    role: Role | None = None
    is_active: bool | None = None
    password: str | None = Field(default=None, min_length=8)


# --- Patients ----------------------------------------------------------------


class PatientBase(BaseModel):
    mrn: str | None = Field(default=None, max_length=32, description="Generated when left empty")
    first_name: str = Field(min_length=1, max_length=64)
    last_name: str = Field(min_length=1, max_length=64)
    date_of_birth: date
    sex: Sex
    phone: str | None = None
    email: EmailStr | None = None
    address: str | None = None

    @field_validator("date_of_birth")
    @classmethod
    def not_in_future(cls, v: date) -> date:
        if v > date.today():
            raise ValueError("date of birth can't be in the future")
        return v


class PatientCreate(PatientBase):
    pass


class PatientUpdate(PatientBase):
    pass


class PatientOut(ORM):
    id: int
    mrn: str
    first_name: str
    last_name: str
    date_of_birth: date
    sex: str
    phone: str | None
    email: str | None
    address: str | None
    created_at: datetime


# --- Catalog -----------------------------------------------------------------


class DepartmentOut(ORM):
    id: int
    code: str
    name: str


class SpecimenTypeOut(ORM):
    id: int
    code: str
    name: str
    container: str
    cap_color: str


class ReferenceRangeIn(BaseModel):
    sex: Literal["M", "F"] | None = None
    age_min_days: int = Field(default=0, ge=0)
    age_max_days: int = Field(default=200 * 365, ge=0)
    low: float | None = None
    high: float | None = None
    critical_low: float | None = None
    critical_high: float | None = None
    normal_text: str | None = None


class ReferenceRangeOut(ORM, ReferenceRangeIn):
    id: int


class TestOut(ORM):
    id: int
    code: str
    name: str
    loinc: str | None
    department: DepartmentOut
    specimen_type: SpecimenTypeOut
    unit: str | None
    result_type: str
    decimals: int
    calc_key: str | None
    is_calculated: bool
    is_orderable: bool
    is_active: bool
    autoverify: bool
    sort_order: int
    tat_routine_minutes: int
    tat_stat_minutes: int
    delta_percent: float | None
    amr_low: float | None
    amr_high: float | None
    reference_ranges: list[ReferenceRangeOut]


class TestBrief(ORM):
    id: int
    code: str
    name: str
    unit: str | None
    decimals: int
    result_type: str
    is_calculated: bool
    department: DepartmentOut


class TestUpdate(BaseModel):
    name: str | None = None
    loinc: str | None = None
    unit: str | None = None
    decimals: int | None = Field(default=None, ge=0, le=6)
    is_orderable: bool | None = None
    is_active: bool | None = None
    autoverify: bool | None = None
    tat_routine_minutes: int | None = Field(default=None, gt=0)
    tat_stat_minutes: int | None = Field(default=None, gt=0)
    delta_percent: float | None = None
    amr_low: float | None = None
    amr_high: float | None = None
    reference_ranges: list[ReferenceRangeIn] | None = None


class PanelOut(ORM):
    id: int
    code: str
    name: str
    description: str | None
    department: DepartmentOut
    tests: list[TestBrief]


# --- Orders / specimens / results -------------------------------------------


class OrderCreate(BaseModel):
    patient_id: int
    ordering_provider: str = Field(min_length=1, max_length=128)
    priority: Priority = "routine"
    clinical_info: str | None = None
    panel_codes: list[str] = []
    test_codes: list[str] = []


class SpecimenBrief(ORM):
    id: int
    accession: str
    status: str
    specimen_type: SpecimenTypeOut
    collected_at: datetime | None
    received_at: datetime | None
    rejection_reason: str | None


class ResultOut(ORM):
    id: int
    test: TestBrief
    panel_id: int | None
    specimen_id: int | None
    status: str
    value_text: str | None
    value_numeric: float | None
    unit: str | None
    ref_text: str | None
    ref_low: float | None
    ref_high: float | None
    flag: str | None
    is_critical: bool
    delta_failed: bool
    previous_value: float | None
    outside_amr: bool
    comment: str | None
    source: str | None
    instrument: str | None
    entered_at: datetime | None
    entered_by: UserBrief | None
    verified_at: datetime | None
    verified_by: UserBrief | None
    auto_verified: bool
    is_amended: bool


class PatientBrief(ORM):
    id: int
    mrn: str
    first_name: str
    last_name: str
    date_of_birth: date
    sex: str


class OrderSummary(ORM):
    id: int
    order_number: str
    patient: PatientBrief
    ordering_provider: str
    priority: str
    status: str
    created_at: datetime
    completed_at: datetime | None
    test_count: int = 0
    verified_count: int = 0
    has_critical: bool = False
    has_abnormal: bool = False


class OrderOut(OrderSummary):
    clinical_info: str | None
    created_by: UserBrief | None
    specimens: list[SpecimenBrief]
    tests: list[ResultOut]


class SpecimenOut(SpecimenBrief):
    order_id: int
    order_number: str
    priority: str
    patient: PatientBrief
    tests: list[TestBrief]
    collected_by: UserBrief | None
    received_by: UserBrief | None
    created_at: datetime


class SpecimenAction(BaseModel):
    action: Literal["collect", "receive", "reject"]
    reason: str | None = None


class ResultEntry(BaseModel):
    order_test_id: int
    value: str
    comment: str | None = None
    amend_reason: str | None = None


class ResultEntryBatch(BaseModel):
    results: list[ResultEntry]


class ResultEntryError(BaseModel):
    order_test_id: int
    error: str


class ResultEntryResponse(BaseModel):
    updated: list[ResultOut]
    errors: list[ResultEntryError]


class VerifyRequest(BaseModel):
    order_test_ids: list[int]


class WorklistItem(BaseModel):
    specimen: SpecimenBrief
    order_id: int
    order_number: str
    priority: str
    patient: PatientBrief
    results: list[ResultOut]
    due_at: datetime | None


class CriticalOut(ORM):
    id: int
    status: str
    created_at: datetime
    notified_person: str | None
    read_back: bool
    notes: str | None
    notified_at: datetime | None
    notified_by: UserBrief | None
    result: ResultOut
    order_id: int
    order_number: str
    ordering_provider: str
    patient: PatientBrief


class CriticalAcknowledge(BaseModel):
    notified_person: str = Field(min_length=1, max_length=128)
    read_back: bool
    notes: str | None = None


class HistoryOut(ORM):
    id: int
    value_text: str | None
    flag: str | None
    verified_at: datetime | None
    amended_at: datetime
    reason: str


class TrendPoint(BaseModel):
    order_id: int
    order_number: str
    at: datetime
    value_numeric: float | None
    value_text: str | None
    flag: str | None
    ref_low: float | None
    ref_high: float | None
    unit: str | None


# --- Instruments -------------------------------------------------------------


class InstrumentResult(BaseModel):
    accession: str
    test_code: str
    value: str


class InstrumentUpload(BaseModel):
    instrument: str
    results: list[InstrumentResult]


class InstrumentResultStatus(BaseModel):
    accession: str
    test_code: str
    status: Literal["accepted", "autoverified", "error"]
    error: str | None = None
    flag: str | None = None


class InstrumentUploadResponse(BaseModel):
    accepted: int
    autoverified: int
    errors: int
    results: list[InstrumentResultStatus]


# --- QC ----------------------------------------------------------------------


class QCTargetIn(BaseModel):
    test_code: str
    mean: float
    sd: float = Field(gt=0)


class QCMaterialCreate(BaseModel):
    name: str
    lot_number: str
    level: int = Field(ge=1, le=3)
    expiry_date: date | None = None
    department_code: str
    targets: list[QCTargetIn]


class QCTargetOut(ORM):
    id: int
    test: TestBrief
    mean: float
    sd: float


class QCMaterialOut(ORM):
    id: int
    name: str
    lot_number: str
    level: int
    expiry_date: date | None
    is_active: bool
    department: DepartmentOut
    targets: list[QCTargetOut]


class QCResultCreate(BaseModel):
    target_id: int
    value: float
    comment: str | None = None


class QCResultOut(ORM):
    id: int
    target_id: int
    value: float
    z_score: float
    status: str
    violations: list[str]
    comment: str | None
    run_at: datetime
    entered_by: UserBrief | None


class QCStatusItem(BaseModel):
    test: TestBrief
    material: str
    level: int
    target_id: int
    last_run_at: datetime | None
    last_value: float | None
    last_status: str | None
    violations: list[str]


# --- Dashboard / audit -------------------------------------------------------


class DepartmentWorkload(BaseModel):
    department: str
    pending: int
    resulted: int
    verified_today: int


class DashboardOut(BaseModel):
    orders_today: int
    awaiting_collection: int
    in_lab: int
    stat_open: int
    awaiting_verification: int
    critical_pending: int
    qc_rejected: int
    overdue: int
    autoverified_today: int
    verified_today: int
    median_tat_minutes: float | None
    workload: list[DepartmentWorkload]
    recent_orders: list[OrderSummary]


class AuditOut(ORM):
    id: int
    at: datetime
    user: UserBrief | None
    action: str
    entity_type: str
    entity_id: int | None
    details: dict


class LabInfo(BaseModel):
    name: str
    address: str
    director: str
