import os

# Tests always run against their own database, never the one in LIS_DATABASE_URL.
os.environ["LIS_DATABASE_URL"] = os.environ.get(
    "LIS_TEST_DATABASE_URL", "postgresql+psycopg://postgres@localhost:5432/lis_test"
)

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import text  # noqa: E402

from app.db import Base, SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.seed import seed_catalog, seed_users  # noqa: E402

TRANSACTIONAL_TABLES = [
    "audit_log",
    "critical_notifications",
    "result_history",
    "order_tests",
    "specimens",
    "orders",
    "patients",
    "qc_results",
    "qc_targets",
    "qc_materials",
    "counters",
]

PASSWORDS = {"admin": "Admin123!", "tech": "Tech1234!", "frontdesk": "Front123!", "manager": "Manager123!", "doctor": "Doctor123!"}


@pytest.fixture(scope="session", autouse=True)
def database():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    with SessionLocal() as db:
        seed_catalog(db)
        seed_users(db)
        db.commit()
    yield


@pytest.fixture(autouse=True)
def clean_tables(database):
    with engine.begin() as conn:
        conn.execute(text(f"TRUNCATE {', '.join(TRANSACTIONAL_TABLES)} RESTART IDENTITY CASCADE"))
    yield


@pytest.fixture(scope="session")
def tokens() -> dict[str, str]:
    client = TestClient(app)
    out = {}
    for username, password in PASSWORDS.items():
        r = client.post("/api/auth/login", data={"username": username, "password": password})
        assert r.status_code == 200, r.text
        out[username] = r.json()["access_token"]
    return out


class Api:
    def __init__(self, client: TestClient, token: str):
        self.client = client
        self.headers = {"Authorization": f"Bearer {token}"}

    def get(self, url, **kw):
        return self.client.get(f"/api{url}", headers=self.headers, **kw)

    def post(self, url, **kw):
        return self.client.post(f"/api{url}", headers=self.headers, **kw)

    def patch(self, url, **kw):
        return self.client.patch(f"/api{url}", headers=self.headers, **kw)

    def put(self, url, **kw):
        return self.client.put(f"/api{url}", headers=self.headers, **kw)


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def tech(client, tokens) -> Api:
    return Api(client, tokens["tech"])


@pytest.fixture
def frontdesk(client, tokens) -> Api:
    return Api(client, tokens["frontdesk"])


@pytest.fixture
def manager(client, tokens) -> Api:
    return Api(client, tokens["manager"])


@pytest.fixture
def admin(client, tokens) -> Api:
    return Api(client, tokens["admin"])
