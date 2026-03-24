from __future__ import annotations

from typing import Any

from fastapi import APIRouter

from app.ai.template_recommendation.catalog_service import get_catalog
from app.ai.template_recommendation.node_service import (
    build_resource_option_bundle,
    load_live_device_nodes,
)
from app.ai.template_recommendation.recommendation_service import (
    extract_intent_from_chat,
    generate_ai_plan,
    normalize_ai_result,
)
from app.ai.template_recommendation.schemas import ChatRequest, RecommendationRequest
from app.api.deps import CurrentUser


router = APIRouter(
    prefix="/ai/template-recommendation",
    tags=["ai-template-recommendation"],
)


@router.post("/recommend", response_model=dict[str, Any])
async def recommend(request: ChatRequest, current_user: CurrentUser) -> dict[str, Any]:
    live_nodes = load_live_device_nodes()
    extracted_intent = await extract_intent_from_chat(request)
    merged_request = RecommendationRequest(
        goal=extracted_intent.goal_summary,
        role=extracted_intent.role,
        course_context=extracted_intent.course_context,
        budget_mode=extracted_intent.budget_mode,
        needs_public_web=extracted_intent.needs_public_web,
        needs_database=extracted_intent.needs_database,
        requires_gpu=extracted_intent.requires_gpu,
        needs_windows=extracted_intent.needs_windows,
        device_nodes=live_nodes or request.device_nodes,
        top_k=request.top_k,
    )
    del current_user

    catalog = get_catalog()
    resource_options = build_resource_option_bundle()
    ai_result, ai_metrics = await generate_ai_plan(
        merged_request,
        merged_request.device_nodes,
        catalog,
        request.messages,
        resource_options=resource_options,
    )
    result = normalize_ai_result(
        ai_result,
        merged_request,
        merged_request.device_nodes,
        catalog,
        resource_options=resource_options,
    )
    result["live_device_nodes"] = [node.model_dump() for node in merged_request.device_nodes]
    result["ai_metrics"] = ai_metrics
    result["resource_options"] = resource_options
    return result
