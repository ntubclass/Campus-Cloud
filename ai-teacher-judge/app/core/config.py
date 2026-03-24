from __future__ import annotations

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(PROJECT_ROOT / ".env"),
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    host: str = Field(default="0.0.0.0")
    port: int = Field(default=8010, ge=1, le=65535)
    api_v1_str: str = Field(default="/api/v1")
    frontend_api_base_url: str = Field(default="")

    # vLLM settings
    vllm_base_url: str = Field(default="http://localhost:8000/v1")
    vllm_api_key: str = Field(default="vllm-secret-key-change-me")
    vllm_model_name: str = Field(default="")
    vllm_enable_thinking: bool = Field(default=False)
    vllm_timeout: int = Field(default=60, ge=3, le=300)
    vllm_temperature: float = Field(default=0.2, ge=0.0, le=2.0)
    vllm_chat_temperature: float = Field(default=0.7, ge=0.0, le=2.0)
    vllm_top_p: float = Field(default=0.95, ge=0.0, le=1.0)
    vllm_top_k: int = Field(default=20, ge=0, le=200)
    vllm_min_p: float = Field(default=0.0, ge=0.0, le=1.0)
    vllm_max_tokens: int = Field(default=2048, ge=256, le=300000)
    vllm_chat_max_tokens: int = Field(default=1024, ge=256, le=300000)
    vllm_repetition_penalty: float = Field(default=1.0, ge=0.0, le=2.0)


settings = Settings()
