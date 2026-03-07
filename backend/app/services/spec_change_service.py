import logging
import uuid

from sqlmodel import Session

from app.core.proxmox import get_proxmox_api
from app.exceptions import (
    BadRequestError,
    NotFoundError,
    PermissionDeniedError,
    ProxmoxError,
)
from app.models import SpecChangeRequestStatus, SpecChangeType
from app.schemas import (
    SpecChangeRequestCreate,
    SpecChangeRequestPublic,
    SpecChangeRequestReview,
    SpecChangeRequestsPublic,
)
from app.repositories import resource as resource_repo
from app.repositories import spec_change_request as spec_request_repo
from app.services import audit_service

logger = logging.getLogger(__name__)


def _to_public(request) -> SpecChangeRequestPublic:
    return SpecChangeRequestPublic(
        id=request.id,
        vmid=request.vmid,
        user_id=request.user_id,
        user_email=request.user.email if request.user else None,
        user_full_name=request.user.full_name if request.user else None,
        change_type=request.change_type,
        reason=request.reason,
        current_cpu=request.current_cpu,
        current_memory=request.current_memory,
        current_disk=request.current_disk,
        requested_cpu=request.requested_cpu,
        requested_memory=request.requested_memory,
        requested_disk=request.requested_disk,
        status=request.status,
        reviewer_id=request.reviewer_id,
        review_comment=request.review_comment,
        reviewed_at=request.reviewed_at,
        applied_at=request.applied_at,
        created_at=request.created_at,
    )


def _check_ownership_and_get_info(
    *, session: Session, user, vmid: int
) -> dict:
    """Check resource ownership and return Proxmox resource info.

    Fixes the bug where check_resource_ownership returned None
    but callers expected a dict.
    """
    if not user.is_superuser:
        db_resource = resource_repo.get_resource_by_vmid(
            session=session, vmid=vmid
        )
        if not db_resource or db_resource.user_id != user.id:
            raise PermissionDeniedError(
                "You don't have permission to access this resource"
            )

    proxmox = get_proxmox_api()
    resources = proxmox.cluster.resources.get(type="vm")
    for r in resources:
        if r["vmid"] == vmid:
            return r
    raise NotFoundError(f"Resource {vmid} not found")


def _get_current_specs(
    proxmox, node: str, vmid: int, resource_type: str
) -> dict:
    if resource_type == "qemu":
        config = proxmox.nodes(node).qemu(vmid).config.get()
    else:
        config = proxmox.nodes(node).lxc(vmid).config.get()

    current_cpu = config.get("cores") or config.get("cpus")
    current_memory = config.get("memory")
    current_disk = None

    if resource_type == "qemu":
        scsi0 = config.get("scsi0", "")
        if "size=" in scsi0:
            size_str = scsi0.split("size=")[1].split(",")[0].split(")")[0]
            if size_str.endswith("G"):
                current_disk = int(size_str[:-1])
    else:
        rootfs = config.get("rootfs", "")
        if "size=" in rootfs:
            size_str = rootfs.split("size=")[1].split(",")[0]
            if size_str.endswith("G"):
                current_disk = int(size_str[:-1])

    return {"cpu": current_cpu, "memory": current_memory, "disk": current_disk}


def create(
    *, session: Session, request_in: SpecChangeRequestCreate, user
) -> SpecChangeRequestPublic:
    vmid = request_in.vmid
    resource_info = _check_ownership_and_get_info(
        session=session, user=user, vmid=vmid
    )

    proxmox = get_proxmox_api()
    node = resource_info["node"]
    resource_type = resource_info["type"]
    specs = _get_current_specs(proxmox, node, vmid, resource_type)

    # Validate requested changes
    if (
        request_in.change_type == SpecChangeType.cpu
        and request_in.requested_cpu is None
    ):
        raise BadRequestError("requested_cpu is required for CPU change")
    if (
        request_in.change_type == SpecChangeType.memory
        and request_in.requested_memory is None
    ):
        raise BadRequestError("requested_memory is required for memory change")
    if request_in.change_type == SpecChangeType.disk:
        if request_in.requested_disk is None:
            raise BadRequestError(
                "requested_disk is required for disk change"
            )
        if specs["disk"] and request_in.requested_disk <= specs["disk"]:
            raise BadRequestError(
                f"Disk size can only be increased. Current: {specs['disk']}GB"
            )
    if request_in.change_type == SpecChangeType.combined:
        if not any(
            [
                request_in.requested_cpu,
                request_in.requested_memory,
                request_in.requested_disk,
            ]
        ):
            raise BadRequestError(
                "At least one specification must be requested for combined change"
            )

    db_request = spec_request_repo.create_spec_change_request(
        session=session,
        user_id=user.id,
        vmid=vmid,
        change_type=request_in.change_type,
        reason=request_in.reason,
        current_cpu=specs["cpu"],
        current_memory=specs["memory"],
        current_disk=specs["disk"],
        requested_cpu=request_in.requested_cpu,
        requested_memory=request_in.requested_memory,
        requested_disk=request_in.requested_disk,
    )

    audit_service.log_action(
        session=session,
        user_id=user.id,
        vmid=vmid,
        action="spec_change_request",
        details=(
            f"Requested {request_in.change_type.value} change: "
            f"CPU={request_in.requested_cpu}, "
            f"Memory={request_in.requested_memory}MB, "
            f"Disk={request_in.requested_disk}GB. "
            f"Reason: {request_in.reason}"
        ),
    )

    logger.info(
        f"User {user.email} created spec change request for VMID {vmid}"
    )
    return _to_public(db_request)


def list_by_user(
    *, session: Session, user_id: uuid.UUID, skip: int = 0, limit: int = 100
) -> SpecChangeRequestsPublic:
    requests, count = spec_request_repo.get_spec_change_requests_by_user(
        session=session, user_id=user_id, skip=skip, limit=limit
    )
    return SpecChangeRequestsPublic(
        data=[_to_public(r) for r in requests], count=count
    )


def list_all(
    *,
    session: Session,
    skip: int = 0,
    limit: int = 100,
    status: SpecChangeRequestStatus | None = None,
    vmid: int | None = None,
) -> SpecChangeRequestsPublic:
    requests, count = spec_request_repo.get_all_spec_change_requests(
        session=session, skip=skip, limit=limit, status=status, vmid=vmid
    )
    return SpecChangeRequestsPublic(
        data=[_to_public(r) for r in requests], count=count
    )


def review(
    *,
    session: Session,
    request_id: uuid.UUID,
    review_data: SpecChangeRequestReview,
    reviewer,
) -> SpecChangeRequestPublic:
    db_request = spec_request_repo.get_spec_change_request_by_id(
        session=session, request_id=request_id
    )
    if not db_request:
        raise NotFoundError("Request not found")
    if db_request.status != SpecChangeRequestStatus.pending:
        raise BadRequestError(
            f"Request already {db_request.status.value}"
        )

    db_request = spec_request_repo.update_spec_change_request_status(
        session=session,
        request_id=request_id,
        status=review_data.status,
        reviewer_id=reviewer.id,
        review_comment=review_data.review_comment,
    )

    if review_data.status == SpecChangeRequestStatus.approved:
        _apply_spec_changes(
            session=session, db_request=db_request, reviewer=reviewer
        )
    else:
        audit_service.log_action(
            session=session,
            user_id=reviewer.id,
            vmid=db_request.vmid,
            action="spec_change_request",
            details=(
                f"Rejected spec change request {request_id}: "
                f"{review_data.review_comment or 'No comment'}"
            ),
        )
        logger.info(
            f"Admin {reviewer.email} rejected spec change request {request_id}"
        )

    return _to_public(db_request)


def _apply_spec_changes(*, session: Session, db_request, reviewer) -> None:
    """Apply approved spec changes to the Proxmox resource."""
    try:
        proxmox = get_proxmox_api()
        resources = proxmox.cluster.resources.get(type="vm")
        resource_info = None
        for r in resources:
            if r["vmid"] == db_request.vmid:
                resource_info = r
                break

        if not resource_info:
            raise ProxmoxError(
                f"Resource {db_request.vmid} not found in Proxmox"
            )

        node = resource_info["node"]
        resource_type = resource_info["type"]

        config_params = {}
        changes = []

        if db_request.requested_cpu is not None:
            config_params["cores"] = db_request.requested_cpu
            changes.append(
                f"CPU: {db_request.current_cpu} -> {db_request.requested_cpu} cores"
            )
        if db_request.requested_memory is not None:
            config_params["memory"] = db_request.requested_memory
            changes.append(
                f"Memory: {db_request.current_memory} -> {db_request.requested_memory}MB"
            )

        if config_params:
            if resource_type == "qemu":
                proxmox.nodes(node).qemu(db_request.vmid).config.put(
                    **config_params
                )
            else:
                proxmox.nodes(node).lxc(db_request.vmid).config.put(
                    **config_params
                )

        if db_request.requested_disk is not None:
            disk_increase = db_request.requested_disk - (
                db_request.current_disk or 0
            )
            size_param = f"+{disk_increase}G"
            disk_name = "scsi0" if resource_type == "qemu" else "rootfs"
            if resource_type == "qemu":
                proxmox.nodes(node).qemu(db_request.vmid).resize.put(
                    disk=disk_name, size=size_param
                )
            else:
                proxmox.nodes(node).lxc(db_request.vmid).resize.put(
                    disk=disk_name, size=size_param
                )
            changes.append(
                f"Disk: {db_request.current_disk} -> {db_request.requested_disk}GB"
            )

        spec_request_repo.mark_spec_change_applied(
            session=session, request_id=db_request.id
        )

        audit_service.log_action(
            session=session,
            user_id=reviewer.id,
            vmid=db_request.vmid,
            action="spec_change_apply",
            details=f"Applied approved spec changes: {', '.join(changes)}",
        )

        logger.info(
            f"Admin {reviewer.email} approved and applied spec change request {db_request.id}"
        )
    except (ProxmoxError, NotFoundError):
        raise
    except Exception as e:
        logger.error(f"Failed to apply spec changes: {e}")
        raise ProxmoxError(
            f"Request approved but failed to apply changes: {e}"
        )
