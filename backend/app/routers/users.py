from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.user import User
from app.schemas.user import UserOut, UserUpdate
from app.core.auth import get_current_user

router = APIRouter()


@router.get("/me", response_model=UserOut)
def get_me(current_user: User = Depends(get_current_user)):
    return current_user


@router.get("/{username}", response_model=UserOut)
def get_user(username: str, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == username).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user


@router.patch("/me", response_model=UserOut)
def update_me(
    payload: UserUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    for field, value in payload.model_dump(exclude_none=True).items():
        setattr(current_user, field, value)
    db.commit()
    db.refresh(current_user)
    return current_user


@router.post("/{user_id}/follow", status_code=204)
def follow_user(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if user_id == current_user.id:
        raise HTTPException(status_code=400, detail="Cannot follow yourself")
    target = db.query(User).filter(User.id == user_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if target in current_user.following:
        raise HTTPException(status_code=400, detail="Already following")
    current_user.following.append(target)
    db.commit()


@router.delete("/{user_id}/follow", status_code=204)
def unfollow_user(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    target = db.query(User).filter(User.id == user_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if target not in current_user.following:
        raise HTTPException(status_code=400, detail="Not following")
    current_user.following.remove(target)
    db.commit()


@router.delete("/me", status_code=204)
def delete_me(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    db.delete(current_user)
    db.commit()
