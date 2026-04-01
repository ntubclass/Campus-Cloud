"""
AI Proxy API Routes - 代理到 VLLM 的 API 端点
"""

import logging
from datetime import datetime, timedelta

import httpx
from fastapi import APIRouter, HTTPException, status
from fastapi.responses import StreamingResponse

from app.api.deps import AIAPIUserDep, SessionDep
from app.schemas.ai_proxy import (
    ChatCompletionRequest,
    ChatCompletionResponse,
    ModelInfo,
    ModelsResponse,
    RateLimitStatusResponse,
    UsageStatsResponse,
)
from app.services import ai_api_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ai-proxy", tags=["ai_proxy"])


@router.post(
    "/chat/completions",
    response_model=ChatCompletionResponse,
    summary="聊天补全",
    description="OpenAI 兼容的聊天补全接口，支持流式和非流式响应",
)
async def chat_completions(
    request: ChatCompletionRequest,
    user_and_credential: AIAPIUserDep,
    session: SessionDep,
):
    """
    聊天补全接口

    需要在 Authorization header 中提供 API Key:
    Authorization: Bearer ccai_xxx

    支持流式响应（stream=true）和非流式响应（stream=false）
    """
    user, credential = user_and_credential

    # 1. 速率限制检查
    allowed, rate_info = ai_api_service.check_rate_limit(
        session=session, user_id=user.id
    )

    if not allowed:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={
                "error": {
                    "message": f"Rate limit exceeded. Please try again in {rate_info['reset_at'].strftime('%Y-%m-%d %H:%M:%S')}",
                    "type": "rate_limit_error",
                    "limit": rate_info["limit"],
                    "remaining": rate_info["remaining"],
                    "reset_at": rate_info["reset_at"].isoformat(),
                }
            },
        )

    # 2. 转换为 dict（用于代理）
    request_data = request.model_dump(exclude_none=True)

    try:
        # 3. 判断是否流式
        if request.stream:
            # 流式响应
            return StreamingResponse(
                ai_api_service.proxy_to_vllm_chat_completion_stream(
                    session=session,
                    user=user,
                    credential=credential,
                    request_data=request_data,
                ),
                media_type="text/event-stream",
            )
        else:
            # 非流式响应
            result = await ai_api_service.proxy_to_vllm_chat_completion(
                session=session,
                user=user,
                credential=credential,
                request_data=request_data,
            )
            return result

    except httpx.HTTPStatusError as e:
        # VLLM 返回的 HTTP 错误
        logger.error(
            "VLLM error for user %s: status=%d, body=%s",
            user.email,
            e.response.status_code,
            e.response.text,
        )
        raise HTTPException(
            status_code=e.response.status_code,
            detail=f"Upstream model service error: {e.response.text}",
        )

    except httpx.RequestError as e:
        # 网络连接错误
        logger.error("VLLM connection error for user %s: %s", user.email, str(e))
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Model service is temporarily unavailable. Please try again later.",
        )

    except Exception as e:
        # 其他未知错误
        logger.exception("Unexpected error for user %s: %s", user.email, str(e))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An unexpected error occurred. Please contact support.",
        )


@router.get(
    "/models",
    response_model=ModelsResponse,
    summary="列出可用模型",
    description="获取所有可用的 AI 模型列表",
)
async def list_models(
    user_and_credential: AIAPIUserDep,
):
    """
    列出可用模型

    从 VLLM Gateway 获取可用模型列表
    """
    user, credential = user_and_credential

    from app.ai_api.config import settings as ai_api_settings

    try:
        # 从 VLLM Gateway 获取模型列表
        url = f"{ai_api_settings.resolved_vllm_base_url}/v1/models"
        headers = {
            "Authorization": f"Bearer {ai_api_settings.ai_api_api_key}",
        }

        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.get(url, headers=headers)
            response.raise_for_status()
            result = response.json()

        logger.info("User %s queried model list", user.email)
        return result

    except httpx.RequestError as e:
        logger.error("Failed to fetch models: %s", str(e))
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Model service is temporarily unavailable",
        )


@router.get(
    "/usage/my",
    response_model=UsageStatsResponse,
    summary="查看我的使用统计",
    description="查看当前用户的 AI API 使用统计",
)
async def get_my_usage_stats(
    start_date: datetime | None = None,
    end_date: datetime | None = None,
    user_and_credential: AIAPIUserDep = None,
    session: SessionDep = None,
):
    """
    查看我的使用统计

    Query 参数:
    - start_date: 开始日期（默认 30 天前）
    - end_date: 结束日期（默认今天）
    """
    user, credential = user_and_credential

    # 默认查询最近 30 天
    if not end_date:
        end_date = datetime.utcnow()
    if not start_date:
        start_date = end_date - timedelta(days=30)

    stats = ai_api_service.get_user_usage_stats(
        session=session, user_id=user.id, start_date=start_date, end_date=end_date
    )

    logger.info("User %s queried usage stats", user.email)
    return stats


@router.get(
    "/rate-limit/status",
    response_model=RateLimitStatusResponse,
    summary="查看速率限制状态",
    description="查看当前用户的速率限制状态",
)
async def get_rate_limit_status(
    user_and_credential: AIAPIUserDep,
    session: SessionDep,
):
    """
    查看速率限制状态

    返回当前分钟的请求配额使用情况
    """
    user, credential = user_and_credential

    from app.ai_api.config import settings as ai_api_settings
    from app.models import AIAPIRateLimit, get_datetime_utc

    # 获取当前分钟的 key
    now = get_datetime_utc()
    minute_key = now.strftime("%Y-%m-%d-%H-%M")

    # 查询当前计数
    from sqlmodel import select

    record = session.exec(
        select(AIAPIRateLimit)
        .where(AIAPIRateLimit.user_id == user.id)
        .where(AIAPIRateLimit.minute_key == minute_key)
    ).first()

    limit = ai_api_settings.ai_api_rate_limit_per_minute
    current_usage = record.request_count if record else 0

    return RateLimitStatusResponse(
        limit_per_minute=limit,
        current_usage=current_usage,
        remaining=max(0, limit - current_usage),
        reset_at=(now + timedelta(minutes=1)).replace(second=0, microsecond=0),
    )
