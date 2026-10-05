from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from app.config import get_settings
from app.db import engine
from app.routers import auth, catalog, dashboard, instruments, orders, patients, qc, results, specimens

settings = get_settings()

app = FastAPI(
    title="LIS API",
    description="Laboratory Information System: clinical chemistry and hematology.",
    version="0.1.0",
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

for module in (auth, patients, catalog, orders, specimens, results, instruments, qc, dashboard):
    app.include_router(module.router, prefix="/api")


@app.get("/api/health", tags=["health"])
def health() -> dict:
    with engine.connect() as conn:
        conn.execute(text("SELECT 1"))
    return {"status": "ok"}
