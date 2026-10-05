from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import func, select

from app.deps import DB, CurrentUser, require
from app.models import User
from app.schemas import Token, UserCreate, UserOut, UserUpdate
from app.security import PERMISSIONS, create_access_token, hash_password, verify_password
from app.services.audit import audit

router = APIRouter(tags=["auth"])


def user_out(user: User) -> UserOut:
    out = UserOut.model_validate(user)
    out.permissions = sorted(PERMISSIONS.get(user.role, set()))
    return out


@router.post("/auth/login", response_model=Token)
def login(db: DB, form: Annotated[OAuth2PasswordRequestForm, Depends()]) -> Token:
    user = db.scalar(select(User).where(func.lower(User.username) == form.username.lower()))
    if user is None or not user.is_active or not verify_password(form.password, user.hashed_password):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Incorrect username or password")
    audit(db, user, "auth.login", "user", user.id)
    db.commit()
    return Token(access_token=create_access_token(user.username, user.role))


@router.get("/auth/me", response_model=UserOut)
def me(user: CurrentUser) -> UserOut:
    return user_out(user)


@router.get("/users", response_model=list[UserOut], dependencies=[Depends(require("users:write"))])
def list_users(db: DB) -> list[UserOut]:
    return [user_out(u) for u in db.scalars(select(User).order_by(User.username))]


@router.post("/users", response_model=UserOut, status_code=201)
def create_user(db: DB, body: UserCreate, admin: Annotated[User, Depends(require("users:write"))]) -> UserOut:
    if db.scalar(select(User).where(func.lower(User.username) == body.username.lower())):
        raise HTTPException(409, "Username already exists")
    user = User(
        username=body.username,
        full_name=body.full_name,
        email=body.email,
        role=body.role,
        hashed_password=hash_password(body.password),
    )
    db.add(user)
    db.flush()
    audit(db, admin, "user.created", "user", user.id, username=user.username, role=user.role)
    db.commit()
    return user_out(user)


@router.patch("/users/{user_id}", response_model=UserOut)
def update_user(
    db: DB, user_id: int, body: UserUpdate, admin: Annotated[User, Depends(require("users:write"))]
) -> UserOut:
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(404, "User not found")
    changes = body.model_dump(exclude_unset=True)
    if user.id == admin.id and (changes.get("is_active") is False or changes.get("role", "admin") != "admin"):
        raise HTTPException(400, "You can't deactivate or demote your own account")
    password = changes.pop("password", None)
    for key, value in changes.items():
        setattr(user, key, value)
    if password:
        user.hashed_password = hash_password(password)
    audit(db, admin, "user.updated", "user", user.id, fields=sorted(body.model_fields_set))
    db.commit()
    return user_out(user)
