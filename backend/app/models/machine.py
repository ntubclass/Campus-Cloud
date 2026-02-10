"""項目相關模型"""

import uuid
from datetime import date, datetime
from typing import TYPE_CHECKING, Optional

from sqlmodel import Column, DateTime, Field, Relationship, SQLModel

if TYPE_CHECKING:
    from .user import User


class NodeSchema(SQLModel):
    """Proxmox node information."""

    node: str
    status: str
    cpu: float | None = None
    maxcpu: int | None = None
    mem: int | None = None
    maxmem: int | None = None
    uptime: int | None = None


class VMSchema(SQLModel):
    """Virtual machine information."""

    vmid: int
    name: str
    status: str
    node: str
    type: str  # "qemu" for VM, "lxc" for container
    cpu: float | None = None
    maxcpu: int | None = None
    mem: int | None = None
    maxmem: int | None = None
    uptime: int | None = None
    netin: int | None = None
    diskread: int | None = None
    diskwrite: int | None = None
    disk: int | None = None
    template: int | None = None
    memhost: int | None = None
    maxdisk: int | None = None


class VNCInfoSchema(SQLModel):
    """VNC console connection information."""

    vmid: int
    ws_url: str
    ticket: str | None = None
    message: str


class TerminalInfoSchema(SQLModel):
    """Terminal console connection information for LXC containers."""

    vmid: int
    ws_url: str
    ticket: str | None = None
    message: str


class TemplateSchema(SQLModel):
    """OS template information."""

    volid: str
    format: str
    size: int


class VMTemplateSchema(SQLModel):
    """VM template information."""

    vmid: int
    name: str
    node: str


class NextVMIDSchema(SQLModel):
    """Next available VMID."""

    next_vmid: int


class LXCCreateSchema(SQLModel):
    """Schema for creating a new LXC container."""

    hostname: str
    ostemplate: str
    cores: int = 1
    memory: int = 512
    rootfs_size: int = 8  # in GB
    password: str
    storage: str = "local-lvm"
    environment_type: str
    os_info: str | None = None
    expiry_date: date | None = None
    start: bool = True
    unprivileged: bool = True


class LXCCreateResponse(SQLModel):
    """Response after creating LXC container."""

    vmid: int
    upid: str
    message: str


class Resource(SQLModel, table=True):
    """資源額外信息表，儲存VM/Container的環境類型、到期日等資訊."""

    __tablename__ = "resources"

    vmid: int = Field(primary_key=True, description="VM/Container ID")
    user_id: uuid.UUID = Field(foreign_key="user.id", description="擁有者ID")
    environment_type: str = Field(
        description="環境類型，例如：Web開發標準版、LLM微調環境等"
    )
    os_info: str | None = Field(default=None, description="作業系統資訊")
    expiry_date: date | None = Field(default=None, description="到期日，None表示無期限")
    template_id: int | None = Field(
        default=None, description="使用的模板ID（如果是從模板創建）"
    )
    created_at: datetime = Field(
        sa_column=Column(DateTime(timezone=True), nullable=False),
        description="創建時間",
    )

    # Relationship
    user: Optional["User"] = Relationship(back_populates="resources")


class ResourcePublic(SQLModel):
    """公開的資源資訊，合併Proxmox資料和資料庫額外資訊."""

    vmid: int
    name: str
    status: str
    node: str
    type: str
    environment_type: str | None = None
    os_info: str | None = None
    expiry_date: date | None = None
    ip_address: str | None = None
    cpu: float | None = None
    maxcpu: int | None = None
    mem: int | None = None
    maxmem: int | None = None
    uptime: int | None = None


class VMCreateSchema(SQLModel):
    """Schema for creating a new VM from cloud-init template."""

    hostname: str
    template_id: int
    username: str
    password: str
    cores: int = 2
    memory: int = 2048
    disk_size: int = 20  # in GB
    storage: str = "local-lvm"
    environment_type: str
    os_info: str | None = None
    expiry_date: date | None = None
    start: bool = True


class VMCreateResponse(SQLModel):
    """Response after creating VM."""

    vmid: int
    upid: str
    message: str


__all__ = [
    "NodeSchema",
    "VMSchema",
    "VNCInfoSchema",
    "TerminalInfoSchema",
    "TemplateSchema",
    "VMTemplateSchema",
    "NextVMIDSchema",
    "LXCCreateSchema",
    "LXCCreateResponse",
    "Resource",
    "ResourcePublic",
    "VMCreateSchema",
    "VMCreateResponse",
]
