from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime

from sqlmodel import Session, select

from app.core.db import engine
from app.exceptions import NotFoundError
from app.models import VMRequest, VMRequestStatus
from app.services import audit_service, proxmox_service

logger = logging.getLogger(__name__)

SCHEDULER_POLL_SECONDS = 60


def _utc_now() -> datetime:
    return datetime.now(UTC)


def process_due_request_starts() -> int:
    started_count = 0
    now = _utc_now()

    with Session(engine) as session:
        due_requests = list(
            session.exec(
                select(VMRequest).where(
                    VMRequest.status == VMRequestStatus.approved,
                    VMRequest.vmid.is_not(None),
                    VMRequest.start_at.is_not(None),
                    VMRequest.start_at <= now,
                )
            ).all()
        )

        for request in due_requests:
            if request.end_at:
                end_at = request.end_at
                if end_at.tzinfo is None:
                    end_at = end_at.replace(tzinfo=UTC)
                if end_at <= now:
                    continue

            vmid = request.vmid
            if vmid is None:
                continue

            resource_type = "lxc" if request.resource_type == "lxc" else "qemu"

            try:
                resource = proxmox_service.find_resource(vmid)
                node = resource["node"]
                status = proxmox_service.get_status(node, vmid, resource_type)
                if status.get("status") == "running":
                    continue

                proxmox_service.control(node, vmid, resource_type, "start")
                audit_service.log_action(
                    session=session,
                    user_id=None,
                    vmid=vmid,
                    action="resource_start",
                    details=(
                        "Scheduled auto-start for approved "
                        f"{request.resource_type} request {request.id}"
                    ),
                    commit=False,
                )
                started_count += 1
                logger.info(
                    "Auto-started approved request %s on node %s with VMID %s",
                    request.id,
                    node,
                    vmid,
                )
            except NotFoundError:
                logger.warning(
                    "Scheduled start skipped because resource %s was not found for request %s",
                    vmid,
                    request.id,
                )
            except Exception:
                logger.exception(
                    "Failed to auto-start approved request %s with VMID %s",
                    request.id,
                    vmid,
                )

        if started_count > 0:
            session.commit()

    return started_count


def process_due_request_stops() -> int:
    stopped_count = 0
    now = _utc_now()

    with Session(engine) as session:
        due_requests = list(
            session.exec(
                select(VMRequest).where(
                    VMRequest.status == VMRequestStatus.approved,
                    VMRequest.vmid.is_not(None),
                    VMRequest.end_at.is_not(None),
                    VMRequest.end_at <= now,
                )
            ).all()
        )

        for request in due_requests:
            vmid = request.vmid
            if vmid is None:
                continue

            resource_type = "lxc" if request.resource_type == "lxc" else "qemu"

            try:
                resource = proxmox_service.find_resource(vmid)
                node = resource["node"]
                status = proxmox_service.get_status(node, vmid, resource_type)
                current_status = str(status.get("status") or "").lower()
                if current_status in {"stopped", "paused"}:
                    continue

                proxmox_service.control(node, vmid, resource_type, "shutdown")
                audit_service.log_action(
                    session=session,
                    user_id=None,
                    vmid=vmid,
                    action="resource_shutdown",
                    details=(
                        "Scheduled auto-shutdown for approved "
                        f"{request.resource_type} request {request.id}"
                    ),
                    commit=False,
                )
                stopped_count += 1
                logger.info(
                    "Auto-shutdown triggered for approved request %s on node %s with VMID %s",
                    request.id,
                    node,
                    vmid,
                )
            except NotFoundError:
                logger.warning(
                    "Scheduled shutdown skipped because resource %s was not found for request %s",
                    vmid,
                    request.id,
                )
            except Exception:
                logger.exception(
                    "Failed to auto-shutdown approved request %s with VMID %s",
                    request.id,
                    vmid,
                )

        if stopped_count > 0:
            session.commit()

    return stopped_count


async def run_scheduler(stop_event: asyncio.Event) -> None:
    logger.info("VM request start scheduler is running")
    while not stop_event.is_set():
        try:
            process_due_request_starts()
            process_due_request_stops()
        except Exception:
            logger.exception("VM request start scheduler iteration failed")

        try:
            await asyncio.wait_for(stop_event.wait(), timeout=SCHEDULER_POLL_SECONDS)
        except TimeoutError:
            continue

    logger.info("VM request start scheduler stopped")
