from datetime import timedelta

import bcrypt
import jwt

from app.config import get_settings
from app.db import utcnow

ALGORITHM = "HS256"

ROLES = ("admin", "manager", "technologist", "front_desk", "physician")

# What each role may do. Read access to clinical data is granted to every role.
_FRONT_DESK = {"patients:write", "orders:write", "specimens:write"}
_TECH = _FRONT_DESK | {"results:write", "results:verify", "qc:write", "criticals:write"}
_MANAGER = _TECH | {"catalog:write", "qc:manage", "audit:read"}
PERMISSIONS: dict[str, set[str]] = {
    "front_desk": _FRONT_DESK,
    "physician": {"orders:write"},
    "technologist": _TECH,
    "manager": _MANAGER,
    "admin": _MANAGER | {"users:write"},
}


def has_permission(role: str, permission: str) -> bool:
    return permission in PERMISSIONS.get(role, set())


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode(), hashed.encode())
    except ValueError:
        return False


def create_access_token(subject: str, role: str) -> str:
    settings = get_settings()
    expire = utcnow() + timedelta(minutes=settings.access_token_expire_minutes)
    return jwt.encode({"sub": subject, "role": role, "exp": expire}, settings.secret_key, algorithm=ALGORITHM)


def decode_access_token(token: str) -> dict:
    return jwt.decode(token, get_settings().secret_key, algorithms=[ALGORITHM])
