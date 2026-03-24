from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse

from app.api.routes.rubric import router as rubric_router
from app.core.config import settings


STATIC_DIR = Path(__file__).resolve().parents[1] / "static"

app = FastAPI(
    title="Campus Rubric Assistant",
    description="AI-driven grading rubric analysis and refinement for teachers.",
)

app.include_router(rubric_router)


@app.get("/", include_in_schema=False)
def index():
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/health")
@app.get(f"{settings.api_v1_str}/health")
def health() -> dict:
    return {
        "status": "ok",
        "vllm_configured": bool(settings.vllm_model_name),
    }


@app.get("/ui-config")
def ui_config() -> dict:
    return {
        "api_base_url": settings.frontend_api_base_url.rstrip("/"),
    }
