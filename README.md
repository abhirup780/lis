# LIS: Laboratory Information System

A modern laboratory information system for **clinical chemistry** and **hematology**, covering the full
workflow from patient registration and ordering through specimen tracking, result entry, autoverification,
critical value notification, quality control and the final report.

![Dashboard](docs/screenshots/dashboard.png)

## Quick start

```bash
cp .env.example .env        # optional: change the secret key and database password
docker compose up --build
```

Open <http://localhost:8080>. The API and its interactive docs are at <http://localhost:8000/api/docs>.

On first start the backend runs migrations and seeds the test catalog, default users and (with
`LIS_SEED_DEMO=true`, the default) demo patients, orders in every stage, and 30 days of QC history.

| Username    | Password      | Role          |
| ----------- | ------------- | ------------- |
| `tech`      | `Tech1234!`   | Technologist  |
| `frontdesk` | `Front123!`   | Front desk    |
| `manager`   | `Manager123!` | Lab manager   |
| `admin`     | `Admin123!`   | Administrator |
| `doctor`    | `Doctor123!`  | Physician     |

These are demo credentials. Change them, `LIS_SECRET_KEY` and `POSTGRES_PASSWORD` before using the system with real data.

## Features

**Front office**
- Patient registry with generated MRNs and search by name or MRN.
- Ordering by panel (BMP, CMP, hepatic, lipid, renal, electrolytes, CBC, CBC with differential) or single test, routine or STAT, with a live preview of the tubes needed.
- Automatic specimen splitting: one tube per specimen type and department, each with a 10-digit Code 128 accession number and printable 2" x 1" labels.
- Collection, receipt by barcode scan, and rejection with a reason. A rejected tube gets a replacement accession and its open tests move to it.

**Laboratory**
- Result entry worklist per department, STAT first, with turnaround-time due and overdue indicators and keyboard-driven entry.
- Age- and sex-specific reference intervals (adult and pediatric), critical limits, analytical measuring range checks and delta checks against the patient's previous result.
- Calculated tests: anion gap, eGFR (CKD-EPI 2021, race-free), LDL (NIH equation 2 / Sampson), non-HDL, globulin, A/G ratio, BUN/creatinine ratio, and absolute neutrophil and lymphocyte counts. Calculations that don't apply (eGFR for a child, LDL with triglycerides over 800) are reported as not calculated.
- Autoverification of instrument results that are normal, within the measuring range, pass the delta check, and whose QC is in control. Everything else waits for a technologist.
- Critical value workflow: a verified critical result must be phoned through with a documented read-back before it clears.
- Amendments keep the previous value, who verified it and the reason, and the report marks the result as corrected.
- Instrument interface: JSON batch upload and HL7 v2 `ORU^R01` messages with an HL7 `ACK` reply.

**Quality control**
- QC lots with per-analyte target mean and SD.
- Westgard multirule evaluation: 1-2s warning; 1-3s, 2-2s, R-4s, 4-1s and 10x reject.
- A rejected QC run pauses autoverification for that test until a passing run.
- Levey-Jennings charts with ±1/2/3 SD limits.

**Administration**
- Test catalog with LOINC codes, editable reference and critical ranges, turnaround targets, delta limits and autoverification switches.
- Role-based access (admin, lab manager, technologist, front desk, physician).
- Audit trail of every sign-in, order, specimen event, result entry, verification, amendment and configuration change.
- Live dashboard: critical values waiting, QC failures, overdue specimens, STAT orders, workload by department, autoverification rate and median turnaround time.
- Printable patient report with lab header, flags, reference ranges and critical value footnote.

| Result entry | Quality control |
| --- | --- |
| ![Worklist](docs/screenshots/worklist.png) | ![QC](docs/screenshots/qc.png) |
| **Patient trend** | **Report** |
| ![Patient](docs/screenshots/patient.png) | ![Report](docs/screenshots/report.png) |

## Architecture

```
frontend/   React 19 + TypeScript (Vite), TanStack Query, Tailwind CSS, Recharts
backend/    FastAPI, SQLAlchemy 2, Alembic, PostgreSQL 16, JWT auth
```

- `backend/app/models.py`: the data model. An `OrderTest` is one requested test and also holds its result, so a result's whole lifecycle lives on one row; `ResultHistory` keeps amended values.
- `backend/app/services/results.py`: the result engine. Every way of writing a result (manual entry, instrument upload, HL7, amendment) goes through `record_result`, which interprets the value, runs delta and measuring range checks, updates calculated tests and tries autoverification.
- `backend/app/services/calculations.py`, `westgard.py`, `hl7.py`: calculated tests, QC rules and the HL7 parser, each small and unit tested.
- `backend/app/seed.py`: the test catalog (45 tests, 8 panels) and demo data.

## Development

Backend (needs a local PostgreSQL):

```bash
cd backend
python -m venv .venv && . .venv/bin/activate
pip install -r requirements-dev.txt
export LIS_DATABASE_URL=postgresql+psycopg://postgres:postgres@localhost:5432/lis
alembic upgrade head
python -m app.seed --demo
uvicorn app.main:app --reload
```

Tests run against a separate database (`LIS_TEST_DATABASE_URL`, default `lis_test` on localhost), which they recreate:

```bash
createdb lis_test
pytest
```

Frontend (proxies `/api` to `localhost:8000`):

```bash
cd frontend
npm install
npm run dev     # http://localhost:5173
```

## Instrument interface

JSON:

```bash
curl -X POST localhost:8000/api/instruments/results \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"instrument": "Cobas c503", "results": [{"accession": "2610050001", "test_code": "NA", "value": "140"}]}'
```

HL7 v2 (the accession goes in OBR-3 or SPM-2, the test code in OBX-3):

```
MSH|^~\&|COBAS|LAB|LIS|LAB|20261005101500||ORU^R01|MSG0001|P|2.5.1
OBR|1||2610050001
OBX|1|NM|NA^Sodium||141|mmol/L
OBX|2|NM|K^Potassium||4.2|mmol/L
```

Post it as `text/plain` to `/api/instruments/hl7`; the reply is an HL7 ACK (`AA`, or `AE` listing the rejected observations).

## Configuration

Backend settings are environment variables with the `LIS_` prefix (see `backend/app/config.py`):
`LIS_DATABASE_URL`, `LIS_SECRET_KEY`, `LIS_ACCESS_TOKEN_EXPIRE_MINUTES`, `LIS_CORS_ORIGINS`, `LIS_LAB_NAME`,
`LIS_LAB_ADDRESS`, `LIS_LAB_DIRECTOR`, and `LIS_SEED_DEMO` for the container entrypoint.

Reference intervals and critical limits in the seed data are typical adult and pediatric values for
demonstration. Each laboratory must replace them with its own validated intervals before clinical use.
