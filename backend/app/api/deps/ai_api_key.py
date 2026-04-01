"""
AI API Key 认证依赖
"""

import hashlib
from typing import Annotated

from fastapi import Depends, Header, HTTPException, status
from sqlmodel import Session, select

from app.api.deps.database import SessionDep
from app.core.security import decrypt_value
from app.models import AIAPICredential, User, get_datetime_utc


def get_current_user_by_ai_api_key(
    authorization: str = Header(..., description="Bearer ccai_xxx"),
    session: SessionDep = Depends(),
) -> tuple[User, AIAPICredential]:
    """
    通过 AI API Key (ccai_xxx) 验证用户身份

    Returns:
        tuple[User, AIAPICredential]: 用户对象和凭证对象

    Raises:
        HTTPException: 401 如果认证失败
    """
    # 1. 提取 token
    if not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authorization header format. Expected: Bearer <api_key>",
        )

    api_key = authorization.replace("Bearer ", "").strip()

    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="API key is required",
        )

    # 2. 计算 hash
    api_key_hash = hashlib.sha256(api_key.encode()).hexdigest()

    # 3. 查询凭证（使用 hash 快速查找）
    statement = (
        select(AIAPICredential)
        .where(AIAPICredential.api_key_hash == api_key_hash)
        .where(AIAPICredential.revoked_at.is_(None))
    )
    credential = session.exec(statement).first()

    if not credential:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or revoked API key",
        )

    # 4. 验证完整性（解密后比对，防止 hash 碰撞）
    try:
        decrypted_key = decrypt_value(credential.api_key_encrypted)
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="API key decryption failed",
        )

    if decrypted_key != api_key:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid API key",
        )

    # 5. 检查过期
    if credential.expires_at and credential.expires_at < get_datetime_utc():
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="API key has expired",
        )

    # 6. 获取用户并检查状态
    user = session.get(User, credential.user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User account is inactive",
        )

    return user, credential


# 类型标注（用于依赖注入）
AIAPIUserDep = Annotated[tuple[User, AIAPICredential], Depends(get_current_user_by_ai_api_key)]


__all__ = ["get_current_user_by_ai_api_key", "AIAPIUserDep"]
