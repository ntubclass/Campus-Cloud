"""Resource CRUD operations."""

from datetime import date, datetime, timezone
from typing import Any
import uuid

from sqlmodel import Session, select

from app.models import Resource


def create_resource(
    *,
    session: Session,
    vmid: int,
    user_id: uuid.UUID,
    environment_type: str,
    os_info: str | None = None,
    expiry_date: date | None = None,
    template_id: int | None = None,
) -> Resource:
    """Create a new resource record."""
    db_resource = Resource(
        vmid=vmid,
        user_id=user_id,
        environment_type=environment_type,
        os_info=os_info,
        expiry_date=expiry_date,
        template_id=template_id,
        created_at=datetime.now(timezone.utc),
    )
    session.add(db_resource)
    session.commit()
    session.refresh(db_resource)
    return db_resource


def get_resource_by_vmid(*, session: Session, vmid: int) -> Resource | None:
    """Get resource by VMID."""
    statement = select(Resource).where(Resource.vmid == vmid)
    return session.exec(statement).first()


def get_resources_by_user(
    *, session: Session, user_id: uuid.UUID
) -> list[Resource]:
    """Get all resources owned by a user."""
    statement = select(Resource).where(Resource.user_id == user_id)
    return list(session.exec(statement).all())


def update_resource(
    *,
    session: Session,
    db_resource: Resource,
    resource_update: dict[str, Any],
) -> Resource:
    """Update a resource."""
    for key, value in resource_update.items():
        setattr(db_resource, key, value)
    session.add(db_resource)
    session.commit()
    session.refresh(db_resource)
    return db_resource


def delete_resource(*, session: Session, vmid: int) -> None:
    """Delete a resource."""
    resource = get_resource_by_vmid(session=session, vmid=vmid)
    if resource:
        session.delete(resource)
        session.commit()
