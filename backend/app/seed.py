"""Seed the test catalog and default users, and optionally demo data.

    python -m app.seed            # catalog + users (safe to re-run)
    python -m app.seed --demo     # also demo patients, orders, results and QC history
"""

import argparse
import random
from datetime import date, timedelta

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.db import SessionLocal, utcnow
from app.models import (
    Counter,
    Department,
    Order,
    Panel,
    PanelTest,
    Patient,
    QCMaterial,
    QCResult,
    QCTarget,
    ReferenceRange,
    SpecimenType,
    Test,
    User,
)
from app.schemas import OrderCreate
from app.security import hash_password
from app.services.numbering import next_value
from app.services.orders import create_order
from app.services.results import record_result, verify_result
from app.services.westgard import evaluate

YEAR = 365
ADULT = 18 * YEAR

DEPARTMENTS = [("CHEM", "Clinical Chemistry"), ("HEME", "Hematology")]

SPECIMEN_TYPES = [
    ("SST", "Serum", "Gold top SST", "#d4a017"),
    ("EDTA", "Whole blood (EDTA)", "Lavender top", "#8e6bbf"),
]


def R(low=None, high=None, crit_low=None, crit_high=None, sex=None, age_min=0, age_max=200 * YEAR):
    return dict(
        low=low, high=high, critical_low=crit_low, critical_high=crit_high, sex=sex, age_min_days=age_min, age_max_days=age_max
    )


# code, name, LOINC, department, specimen, unit, decimals, delta %, AMR (low, high), calc_key, ranges
TESTS = [
    ("NA", "Sodium", "2951-2", "CHEM", "SST", "mmol/L", 0, 5, (100, 200), None, [R(136, 145, 120, 160)]),
    ("K", "Potassium", "2823-3", "CHEM", "SST", "mmol/L", 1, 20, (1.0, 10.0), None, [R(3.5, 5.1, 2.5, 6.5)]),
    ("CL", "Chloride", "2075-0", "CHEM", "SST", "mmol/L", 0, 10, (60, 140), None, [R(98, 107, 80, 120)]),
    ("CO2", "Carbon dioxide (bicarbonate)", "2028-9", "CHEM", "SST", "mmol/L", 0, 30, (5, 50), None, [R(22, 29, 10, 40)]),
    ("BUN", "Urea nitrogen", "3094-0", "CHEM", "SST", "mg/dL", 0, 50, (2, 150), None, [R(7, 20)]),
    ("CREA", "Creatinine", "2160-0", "CHEM", "SST", "mg/dL", 2, 50, (0.1, 25),
     None, [R(0.74, 1.35, sex="M", age_min=ADULT), R(0.59, 1.04, sex="F", age_min=ADULT), R(0.2, 0.7, age_max=ADULT - 1)]),
    ("GLU", "Glucose", "2345-7", "CHEM", "SST", "mg/dL", 0, None, (10, 800), None, [R(70, 99, 40, 500)]),
    ("CA", "Calcium", "17861-6", "CHEM", "SST", "mg/dL", 1, 20, (4, 18), None, [R(8.6, 10.3, 6.0, 13.0)]),
    ("TP", "Total protein", "2885-2", "CHEM", "SST", "g/dL", 1, 20, (2, 12), None, [R(6.0, 8.3)]),
    ("ALB", "Albumin", "1751-7", "CHEM", "SST", "g/dL", 1, 20, (1, 7), None, [R(3.5, 5.0)]),
    ("TBIL", "Bilirubin, total", "1975-2", "CHEM", "SST", "mg/dL", 1, None, (0.1, 30), None, [R(0.1, 1.2, crit_high=15)]),
    ("ALP", "Alkaline phosphatase", "6768-6", "CHEM", "SST", "U/L", 0, None, (5, 1500), None, [R(44, 147)]),
    ("AST", "Aspartate aminotransferase", "1920-8", "CHEM", "SST", "U/L", 0, None, (5, 1000), None, [R(10, 40)]),
    ("ALT", "Alanine aminotransferase", "1742-6", "CHEM", "SST", "U/L", 0, None, (5, 1000), None, [R(7, 56)]),
    ("MG", "Magnesium", "19123-9", "CHEM", "SST", "mg/dL", 1, None, (0.5, 8), None, [R(1.7, 2.2, 1.0, 4.9)]),
    ("PHOS", "Phosphorus", "2777-1", "CHEM", "SST", "mg/dL", 1, None, (0.5, 20), None, [R(2.5, 4.5, 1.0, 9.0)]),
    ("URIC", "Uric acid", "3084-1", "CHEM", "SST", "mg/dL", 1, None, (0.5, 25), None,
     [R(3.4, 7.0, sex="M"), R(2.4, 6.0, sex="F")]),
    ("CHOL", "Cholesterol, total", "2093-3", "CHEM", "SST", "mg/dL", 0, None, (25, 700), None, [R(None, 199)]),
    ("TRIG", "Triglycerides", "2571-8", "CHEM", "SST", "mg/dL", 0, None, (10, 1000), None, [R(None, 149)]),
    ("HDL", "HDL cholesterol", "2085-9", "CHEM", "SST", "mg/dL", 0, None, (5, 150), None,
     [R(40, None, sex="M"), R(50, None, sex="F")]),
    ("HBA1C", "Hemoglobin A1c", "4548-4", "CHEM", "EDTA", "%", 1, None, (3.0, 18.0), None, [R(4.0, 5.6)]),
    # Calculated chemistry
    ("AGAP", "Anion gap", "33037-3", "CHEM", "SST", "mmol/L", 0, None, (None, None), "anion_gap", [R(8, 16)]),
    ("EGFR", "eGFR (CKD-EPI 2021)", "98979-8", "CHEM", "SST", "mL/min/1.73m2", 0, None, (None, None), "egfr",
     [R(60, None, age_min=ADULT)]),
    ("BUNCR", "BUN/creatinine ratio", "3097-3", "CHEM", "SST", "ratio", 0, None, (None, None), "bun_crea", [R(10, 20)]),
    ("GLOB", "Globulin", "10834-0", "CHEM", "SST", "g/dL", 1, None, (None, None), "globulin", [R(2.0, 3.5)]),
    ("AGR", "Albumin/globulin ratio", "1759-0", "CHEM", "SST", "ratio", 1, None, (None, None), "ag_ratio", [R(1.1, 2.5)]),
    ("LDL", "LDL cholesterol (calculated)", "13457-7", "CHEM", "SST", "mg/dL", 0, None, (None, None), "ldl_sampson",
     [R(None, 99)]),
    ("NHDL", "Non-HDL cholesterol", "43396-1", "CHEM", "SST", "mg/dL", 0, None, (None, None), "non_hdl", [R(None, 129)]),
    # Hematology
    ("WBC", "White blood cell count", "6690-2", "HEME", "EDTA", "10^3/uL", 2, 50, (0.1, 400),
     None, [R(4.5, 11.0, 2.0, 30.0, age_min=ADULT), R(9.0, 30.0, 2.0, 40.0, age_max=30), R(5.0, 15.0, 2.0, 35.0, age_min=31, age_max=ADULT - 1)]),
    ("RBC", "Red blood cell count", "789-8", "HEME", "EDTA", "10^6/uL", 2, 20, (0.2, 9),
     None, [R(4.5, 5.9, sex="M", age_min=ADULT), R(4.1, 5.1, sex="F", age_min=ADULT), R(3.9, 5.3, age_max=ADULT - 1)]),
    ("HGB", "Hemoglobin", "718-7", "HEME", "EDTA", "g/dL", 1, 20, (1, 26),
     None, [R(13.5, 17.5, 7.0, 20.0, sex="M", age_min=ADULT), R(12.0, 15.5, 7.0, 20.0, sex="F", age_min=ADULT),
            R(14.0, 24.0, 9.0, 25.0, age_max=30), R(11.0, 15.5, 7.0, 20.0, age_min=31, age_max=ADULT - 1)]),
    ("HCT", "Hematocrit", "4544-3", "HEME", "EDTA", "%", 1, 20, (5, 75),
     None, [R(41, 53, 20, 60, sex="M", age_min=ADULT), R(36, 46, 20, 60, sex="F", age_min=ADULT), R(33, 45, 20, 65, age_max=ADULT - 1)]),
    ("MCV", "Mean corpuscular volume", "787-2", "HEME", "EDTA", "fL", 1, 10, (50, 150), None, [R(80, 100)]),
    ("MCH", "Mean corpuscular hemoglobin", "785-6", "HEME", "EDTA", "pg", 1, None, (15, 50), None, [R(27, 33)]),
    ("MCHC", "Mean corpuscular hemoglobin concentration", "786-4", "HEME", "EDTA", "g/dL", 1, None, (20, 45), None, [R(32, 36)]),
    ("RDW", "Red cell distribution width", "788-0", "HEME", "EDTA", "%", 1, None, (8, 35), None, [R(11.5, 14.5)]),
    ("PLT", "Platelet count", "777-3", "HEME", "EDTA", "10^3/uL", 0, 50, (5, 3000), None, [R(150, 400, 50, 1000)]),
    ("MPV", "Mean platelet volume", "32623-1", "HEME", "EDTA", "fL", 1, None, (5, 20), None, [R(7.5, 11.5)]),
    ("NEUT", "Neutrophils %", "770-8", "HEME", "EDTA", "%", 1, None, (0, 100), None, [R(40, 70)]),
    ("LYMPH", "Lymphocytes %", "736-9", "HEME", "EDTA", "%", 1, None, (0, 100), None, [R(20, 40)]),
    ("MONO", "Monocytes %", "5905-5", "HEME", "EDTA", "%", 1, None, (0, 100), None, [R(2, 8)]),
    ("EOS", "Eosinophils %", "713-8", "HEME", "EDTA", "%", 1, None, (0, 100), None, [R(1, 4)]),
    ("BASO", "Basophils %", "706-2", "HEME", "EDTA", "%", 1, None, (0, 100), None, [R(0, 1)]),
    ("ANC", "Neutrophils, absolute", "751-8", "HEME", "EDTA", "10^3/uL", 2, None, (None, None), "anc",
     [R(1.8, 7.7, 0.5, None)]),
    ("ALC", "Lymphocytes, absolute", "731-0", "HEME", "EDTA", "10^3/uL", 2, None, (None, None), "alc", [R(1.0, 4.8)]),
]

BMP = ["NA", "K", "CL", "CO2", "BUN", "CREA", "GLU", "CA", "AGAP", "BUNCR", "EGFR"]
HEPATIC = ["TP", "ALB", "GLOB", "AGR", "TBIL", "ALP", "AST", "ALT"]
CBC = ["WBC", "RBC", "HGB", "HCT", "MCV", "MCH", "MCHC", "RDW", "PLT", "MPV"]
DIFF = ["NEUT", "LYMPH", "MONO", "EOS", "BASO", "ANC", "ALC"]

PANELS = [
    ("BMP", "Basic metabolic panel", "CHEM", BMP, "Electrolytes, renal function and glucose"),
    ("CMP", "Comprehensive metabolic panel", "CHEM", BMP + HEPATIC, "BMP plus liver function and proteins"),
    ("LFT", "Hepatic function panel", "CHEM", HEPATIC, "Liver enzymes, bilirubin and proteins"),
    ("LIPID", "Lipid panel", "CHEM", ["CHOL", "TRIG", "HDL", "LDL", "NHDL"], "LDL by NIH equation 2 (Sampson)"),
    ("RENAL", "Renal function panel", "CHEM", BMP + ["PHOS", "ALB"], "BMP plus phosphorus and albumin"),
    ("LYTES", "Electrolyte panel", "CHEM", ["NA", "K", "CL", "CO2", "AGAP"], None),
    ("CBC", "Complete blood count", "HEME", CBC, "Without differential"),
    ("CBCD", "CBC with differential", "HEME", CBC + DIFF, "CBC plus 5-part automated differential"),
]

USERS = [
    ("admin", "System Administrator", "admin", "Admin123!"),
    ("manager", "Lab Manager", "manager", "Manager123!"),
    ("tech", "Medical Technologist", "technologist", "Tech1234!"),
    ("frontdesk", "Front Desk / Phlebotomy", "front_desk", "Front123!"),
    ("doctor", "Dr. Ordering Physician", "physician", "Doctor123!"),
]


def seed_catalog(db: Session) -> None:
    if db.scalar(select(Department).limit(1)):
        print("Catalog already present, skipping")
        return
    depts = {code: Department(code=code, name=name) for code, name in DEPARTMENTS}
    types = {code: SpecimenType(code=code, name=n, container=c, cap_color=col) for code, n, c, col in SPECIMEN_TYPES}
    db.add_all([*depts.values(), *types.values()])
    tests: dict[str, Test] = {}
    for i, (code, name, loinc, dept, spec, unit, dec, delta, (amr_lo, amr_hi), calc, ranges) in enumerate(TESTS):
        tests[code] = Test(
            code=code,
            name=name,
            loinc=loinc,
            department=depts[dept],
            specimen_type=types[spec],
            unit=unit,
            decimals=dec,
            delta_percent=delta,
            amr_low=amr_lo,
            amr_high=amr_hi,
            calc_key=calc,
            is_orderable=calc is None,
            autoverify=calc is None,
            sort_order=(i + 1) * 10,
            tat_routine_minutes=240 if dept == "CHEM" else 120,
            tat_stat_minutes=60 if dept == "CHEM" else 30,
            reference_ranges=[ReferenceRange(**r) for r in ranges],
        )
    tests["HBA1C"].tat_routine_minutes = 24 * 60
    db.add_all(tests.values())
    for code, name, dept, codes, desc in PANELS:
        db.add(
            Panel(
                code=code,
                name=name,
                department=depts[dept],
                description=desc,
                items=[PanelTest(test=tests[c], sort_order=tests[c].sort_order) for c in codes],
            )
        )
    db.flush()
    print(f"Seeded {len(tests)} tests and {len(PANELS)} panels")


def seed_users(db: Session) -> None:
    for username, full_name, role, password in USERS:
        if not db.scalar(select(User).where(User.username == username)):
            db.add(User(username=username, full_name=full_name, role=role, hashed_password=hash_password(password)))
    db.flush()


# --- Demo data ---------------------------------------------------------------

DEMO_PATIENTS = [
    ("Maria", "Garcia", date(1958, 3, 14), "F"),
    ("James", "Okafor", date(1972, 11, 2), "M"),
    ("Priya", "Raman", date(1990, 6, 21), "F"),
    ("Wei", "Chen", date(1945, 1, 30), "M"),
    ("Fatima", "Al-Sayed", date(1983, 9, 9), "F"),
    ("Liam", "O'Brien", date(2016, 4, 12), "M"),
    ("Ana", "Kowalski", date(1967, 12, 25), "F"),
    ("Kenji", "Sato", date(1999, 2, 17), "M"),
    ("Grace", "Mensah", date(1951, 7, 4), "F"),
    ("Arjun", "Mehta", date(1978, 5, 28), "M"),
]

PROVIDERS = ["Dr. S. Patel", "Dr. L. Nguyen", "Dr. R. Johnson", "Dr. M. Rossi"]


def _value(test: Test, patient: Patient, rng: random.Random, abnormal: float) -> str | None:
    if test.calc_key:
        return None
    age_days = (date.today() - patient.date_of_birth).days
    rr = next(
        (r for r in test.reference_ranges if r.age_min_days <= age_days <= r.age_max_days and r.sex in (patient.sex, None)),
        None,
    )
    low = rr.low if rr and rr.low is not None else (rr.high * 0.4 if rr and rr.high else 1)
    high = rr.high if rr and rr.high is not None else low * 1.8
    mid, half = (low + high) / 2, (high - low) / 2
    value = rng.gauss(mid, half / 2.5)
    if rng.random() < abnormal:
        value = mid + rng.choice((-1, 1)) * half * rng.uniform(1.15, 1.6)
    if test.code in ("NEUT", "LYMPH", "MONO", "EOS", "BASO"):
        return None  # filled in together below so the differential sums to 100
    return f"{max(value, 0):.{test.decimals}f}"


def _differential(rng: random.Random) -> dict[str, str]:
    lymph, mono, eos, baso = rng.uniform(18, 38), rng.uniform(3, 8), rng.uniform(1, 4), rng.uniform(0.2, 1)
    return {
        "NEUT": f"{100 - lymph - mono - eos - baso:.1f}",
        "LYMPH": f"{lymph:.1f}",
        "MONO": f"{mono:.1f}",
        "EOS": f"{eos:.1f}",
        "BASO": f"{baso:.1f}",
    }


def _run_order(db: Session, order: Order, user: User, rng: random.Random, stage: str, abnormal: float, when, overrides=None):
    """Advance an order to a stage: ordered | collected | received | resulted | verified."""
    order.created_at = when
    if when.date() != utcnow().date():
        # Number backdated orders and tubes for the day they were placed.
        day = when.strftime("%y%m%d")
        order.order_number = f"ORD-{day}-{next_value(db, f'order-{day}'):04d}"
        for s in order.specimens:
            s.accession = f"{day}{next_value(db, f'accession-{day}'):04d}"
            s.created_at = when
    if stage == "ordered":
        return
    for s in order.specimens:
        s.status = "collected"
        s.collected_at = when + timedelta(minutes=10)
        s.collected_by_id = user.id
        if stage != "collected":
            s.status = "received"
            s.received_at = when + timedelta(minutes=35)
            s.received_by_id = user.id
    if stage in ("collected", "received"):
        from app.services.results import refresh_order_status

        refresh_order_status(order)
        return
    diff = _differential(rng)
    for ot in order.tests:
        value = (overrides or {}).get(ot.test.code) or diff.get(ot.test.code) or _value(ot.test, order.patient, rng, abnormal)
        if value is not None:
            analyzer = "Cobas c503" if ot.test.department.code == "CHEM" else "Sysmex XN-1000"
            record_result(db, ot, value, user, source="instrument", instrument=analyzer)
    for ot in order.tests:
        if ot.entered_at:
            ot.entered_at = when + timedelta(minutes=rng.randint(50, 90))
    if stage == "verified":
        for ot in order.tests:
            if ot.status == "resulted":
                verify_result(db, ot, user)
        for ot in order.tests:
            if ot.verified_at:
                ot.verified_at = when + timedelta(minutes=rng.randint(60, 110))
                if order.completed_at:
                    order.completed_at = ot.verified_at


def seed_demo(db: Session) -> None:
    if db.scalar(select(Patient).limit(1)):
        print("Demo data already present, skipping")
        return
    rng = random.Random(42)
    tech = db.scalar(select(User).where(User.username == "tech"))
    now = utcnow()
    patients = []
    for i, (first, last, dob, sex) in enumerate(DEMO_PATIENTS, start=1):
        p = Patient(mrn=f"MRN{1000000 + i:07d}", first_name=first, last_name=last, date_of_birth=dob, sex=sex,
                    phone=f"555-01{i:02d}")
        db.add(p)
        patients.append(p)
    db.flush()

    def order(p, panels, priority="routine"):
        return create_order(
            db, OrderCreate(patient_id=p.id, ordering_provider=rng.choice(PROVIDERS), priority=priority, panel_codes=panels), tech
        )

    # History: verified orders over the past weeks, so trends and delta checks have data.
    for p in patients:
        for days_ago in (42, 21, 7):
            o = order(p, ["CMP", "CBCD"] if days_ago != 21 else ["BMP", "LIPID", "CBC"])
            _run_order(db, o, tech, rng, "verified", 0.12, now - timedelta(days=days_ago, hours=rng.randint(0, 8)))

    # The history above was renumbered by date, so today's numbering can start at 1.
    today = utcnow().strftime("%y%m%d")
    db.execute(delete(Counter).where(Counter.name.in_([f"order-{today}", f"accession-{today}"])))

    # Today's workload in every stage.
    stages = ["ordered", "ordered", "collected", "verified", "received", "resulted", "resulted", "verified", "received", "resulted"]
    for i, (p, stage) in enumerate(zip(patients, stages)):
        priority = "stat" if i in (3, 5, 9) else "routine"
        panels = [["CMP", "CBCD"], ["BMP"], ["CBCD"], ["BMP", "LIPID"], ["CMP"], ["CBCD", "BMP"],
                  ["RENAL"], ["CBC"], ["LFT"], ["BMP", "CBC"]][i]
        o = order(p, panels, priority)
        overrides = None
        if i == 3:
            overrides = {"K": "6.9", "CREA": "3.10", "BUN": "68"}  # critical potassium, AKI
        if i == 9:
            overrides = {"HGB": "6.4", "HCT": "19.8", "PLT": "38"}  # critical anemia and thrombocytopenia
        _run_order(db, o, tech, rng, stage, 0.15, now - timedelta(minutes=rng.randint(20, 300)), overrides)

    seed_qc(db, tech, rng, now)
    print("Seeded demo patients, orders and QC")


def seed_qc(db: Session, user: User, rng: random.Random, now) -> None:
    depts = {d.code: d for d in db.scalars(select(Department))}
    tests = {t.code: t for t in db.scalars(select(Test))}
    plan = [
        ("Liquichek Unassayed Chemistry", "CHEM", 1, {"NA": (125, 2.0), "K": (3.2, 0.08), "GLU": (62, 2.5), "CREA": (0.85, 0.04)}),
        ("Liquichek Unassayed Chemistry", "CHEM", 2, {"NA": (155, 2.2), "K": (6.1, 0.12), "GLU": (285, 8.0), "CREA": (5.8, 0.18)}),
        ("XN CHECK Hematology", "HEME", 1, {"WBC": (3.1, 0.12), "HGB": (6.2, 0.15), "PLT": (75, 5.0)}),
        ("XN CHECK Hematology", "HEME", 2, {"WBC": (7.4, 0.22), "HGB": (12.4, 0.2), "PLT": (220, 9.0)}),
    ]
    for name, dept, level, targets in plan:
        material = QCMaterial(
            name=name, lot_number=f"{dept[:1]}{2400 + level}", level=level,
            expiry_date=date.today() + timedelta(days=180), department=depts[dept],
        )
        for code, (mean, sd) in targets.items():
            target = QCTarget(test=tests[code], mean=mean, sd=sd)
            material.targets.append(target)
            history: list[float] = []
            for day in range(29, -1, -1):
                z = rng.gauss(0, 0.9)
                # Show a Westgard 2-2s rejection on today's level 2 potassium run.
                if code == "K" and level == 2 and day <= 1:
                    z = 2.4 + day * 0.1
                status, violations = evaluate(z, history[:9])
                history.insert(0, z)
                target_results = QCResult(
                    value=round(mean + z * sd, 3), z_score=round(z, 3), status=status, violations=violations,
                    run_at=now - timedelta(days=day, hours=rng.randint(0, 3)), entered_by=user,
                )
                target_results.target = target
                db.add(target_results)
        db.add(material)
    db.flush()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--demo", action="store_true", help="also load demo patients, orders and QC")
    args = parser.parse_args()
    with SessionLocal() as db:
        seed_catalog(db)
        seed_users(db)
        if args.demo:
            seed_demo(db)
        db.commit()


if __name__ == "__main__":
    main()
