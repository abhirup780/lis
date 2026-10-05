from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="LIS_", extra="ignore")

    app_name: str = "LIS"
    database_url: str = "postgresql+psycopg://postgres:postgres@localhost:5432/lis"
    secret_key: str = "dev-only-secret-key-change-me-in-production"
    access_token_expire_minutes: int = 12 * 60
    cors_origins: list[str] = ["http://localhost:5173", "http://localhost:8080"]
    lab_name: str = "Central Clinical Laboratory"
    lab_address: str = "1 Hospital Road"
    lab_director: str = "Dr. A. Pathologist, MD"


@lru_cache
def get_settings() -> Settings:
    return Settings()
