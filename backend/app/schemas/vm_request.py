"""虛擬機申請 schemas"""

import unicodedata
import uuid
from datetime import date, datetime
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, Field

from app.models.user import UserRole
from app.models.vm_request import VMRequestStatus


def _validate_unicode_hostname(v: str) -> str:
    """Validate hostname while allowing Unicode letters and digits."""
    if not v:
        raise ValueError("Hostname cannot be empty")
    if v.startswith("-") or v.endswith("-"):
        raise ValueError("Hostname cannot start or end with a hyphen")
    for ch in v:
        if ch == "-":
            continue
        cat = unicodedata.category(ch)
        if not (cat.startswith("L") or cat.startswith("N")):
            raise ValueError(
                "Only Unicode letters, digits, and hyphens are allowed in hostname"
            )
    return v


UnicodeHostname = Annotated[str, AfterValidator(_validate_unicode_hostname)]


class VMRequestCreate(BaseModel):
    """提交虛擬機申請"""

    reason: str = Field(min_length=10)
    resource_type: str
    hostname: UnicodeHostname = Field(min_length=1, max_length=63)
    cores: int = 2
    memory: int = 2048
    password: str = Field(min_length=8, max_length=128)
    storage: str = "local-lvm"
    environment_type: str = "一般環境"
    os_info: str | None = None
    expiry_date: date | None = None
    start_at: datetime
    end_at: datetime

    ostemplate: str | None = None
    rootfs_size: int | None = None

    template_id: int | None = None
    disk_size: int | None = None
    username: str | None = None


class VMRequestReview(BaseModel):
    """審核虛擬機申請"""

    status: VMRequestStatus
    review_comment: str | None = None


class VMRequestPublic(BaseModel):
    """公開的虛擬機申請資訊"""

    id: uuid.UUID
    user_id: uuid.UUID
    user_email: str | None = None
    user_full_name: str | None = None
    reason: str
    resource_type: str
    hostname: str
    cores: int
    memory: int
    storage: str
    environment_type: str
    os_info: str | None = None
    expiry_date: date | None = None
    start_at: datetime | None = None
    end_at: datetime | None = None

    ostemplate: str | None = None
    rootfs_size: int | None = None

    template_id: int | None = None
    disk_size: int | None = None
    username: str | None = None

    status: VMRequestStatus
    reviewer_id: uuid.UUID | None = None
    review_comment: str | None = None
    reviewed_at: datetime | None = None
    vmid: int | None = None
    assigned_node: str | None = None
    placement_strategy_used: str | None = None
    created_at: datetime


class VMRequestsPublic(BaseModel):
    """虛擬機申請列表"""

    data: list[VMRequestPublic]
    count: int


class VMRequestAvailabilityRequest(BaseModel):
    resource_type: Literal["lxc", "vm"] = "lxc"
    cores: int = Field(default=2, ge=1, le=256)
    memory: int = Field(default=2048, ge=128, le=1048576, description="MB")
    disk_size: int | None = Field(default=None, ge=1, le=65536)
    rootfs_size: int | None = Field(default=None, ge=1, le=65536)
    instance_count: int = Field(default=1, ge=1, le=100)
    gpu_required: int = Field(default=0, ge=0, le=16)
    days: int = Field(default=7, ge=1, le=14)
    timezone: str = Field(default="Asia/Taipei", min_length=1, max_length=64)
    policy_role: UserRole | None = None


class VMRequestAvailabilitySlot(BaseModel):
    start_at: datetime
    end_at: datetime
    date: date
    hour: int = Field(ge=0, le=23)
    within_policy: bool
    feasible: bool
    status: Literal["available", "limited", "unavailable", "policy_blocked"]
    label: str
    summary: str
    reasons: list[str] = Field(default_factory=list)
    recommended_nodes: list[str] = Field(default_factory=list)
    target_node: str | None = None
    placement_strategy: str | None = None
    node_snapshots: list["VMRequestAvailabilityNodeSnapshot"] = Field(default_factory=list)


class VMRequestAvailabilityStackItem(BaseModel):
    name: str
    count: int = Field(default=0, ge=0)
    pending: bool = False


class VMRequestAvailabilityNodeSnapshot(BaseModel):
    node: str
    status: str
    candidate: bool
    priority: int = Field(default=5, ge=1, le=10)
    is_target: bool = False
    placement_count: int = Field(default=0, ge=0)
    running_resources: int = Field(default=0, ge=0)
    projected_running_resources: int = Field(default=0, ge=0)
    dominant_share: float = Field(default=0.0, ge=0.0)
    average_share: float = Field(default=0.0, ge=0.0)
    cpu_share: float = Field(default=0.0, ge=0.0)
    memory_share: float = Field(default=0.0, ge=0.0)
    disk_share: float = Field(default=0.0, ge=0.0)
    remaining_cpu_cores: float = Field(default=0.0, ge=0.0)
    remaining_memory_gb: float = Field(default=0.0, ge=0.0)
    remaining_disk_gb: float = Field(default=0.0, ge=0.0)
    vm_stack: list[VMRequestAvailabilityStackItem] = Field(default_factory=list)


class VMRequestAvailabilityDay(BaseModel):
    date: date
    available_hours: list[int] = Field(default_factory=list)
    limited_hours: list[int] = Field(default_factory=list)
    blocked_hours: list[int] = Field(default_factory=list)
    unavailable_hours: list[int] = Field(default_factory=list)
    best_hours: list[int] = Field(default_factory=list)
    slots: list[VMRequestAvailabilitySlot] = Field(default_factory=list)


class VMRequestAvailabilitySummary(BaseModel):
    timezone: str
    role: str
    role_label: str
    policy_window: str
    checked_days: int = Field(ge=1, le=14)
    feasible_slot_count: int = Field(default=0, ge=0)
    recommended_slot_count: int = Field(default=0, ge=0)
    current_status: str


class VMRequestAvailabilityResponse(BaseModel):
    summary: VMRequestAvailabilitySummary
    recommended_slots: list[VMRequestAvailabilitySlot] = Field(default_factory=list)
    days: list[VMRequestAvailabilityDay] = Field(default_factory=list)


class VMRequestPlacementPreview(BaseModel):
    request_id: uuid.UUID
    start_at: datetime | None = None
    end_at: datetime | None = None
    duration_hours: int = Field(default=0, ge=0)
    feasible: bool = False
    placement_strategy: str
    selected_status: str
    selected_node: str | None = None
    fallback_node: str | None = None
    summary: str
    warnings: list[str] = Field(default_factory=list)
    recommended_nodes: list[str] = Field(default_factory=list)
    slot_details: list[VMRequestAvailabilitySlot] = Field(default_factory=list)


VMRequestAvailabilitySlot.model_rebuild()
