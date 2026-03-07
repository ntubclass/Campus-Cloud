import logging

from fastapi import APIRouter

from app.api.deps import CurrentUser, SessionDep, VmInfoDep
from app.core.proxmox import get_proxmox_api
from app.exceptions import BadRequestError, ProxmoxError
from app.schemas import VMCreateRequest, VMCreateResponse, VMTemplateSchema, VNCInfoSchema
from app.services import provisioning_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/vm", tags=["vm"])


@router.get("/{vmid}/console", response_model=VNCInfoSchema)
def get_vm_console(vmid: int, vm_info: VmInfoDep):
    """Get VNC console access for a VM (requires ownership or admin)."""
    try:
        proxmox = get_proxmox_api()
        if vm_info["type"] != "qemu":
            raise BadRequestError(f"Resource {vmid} is not a QEMU VM")

        node = vm_info["node"]
        console_data = proxmox.nodes(node).qemu(vmid).vncproxy.post(websocket=1)

        return {
            "vmid": vmid,
            "ws_url": f"/ws/vnc/{vmid}/",
            "ticket": console_data["ticket"],
            "message": "Connect to this WebSocket URL to access the VM console",
        }
    except (BadRequestError, ProxmoxError):
        raise
    except Exception as e:
        logger.error(f"Failed to get console for VM {vmid}: {e}")
        raise ProxmoxError("Failed to get VM console")


@router.post("/create", response_model=VMCreateResponse)
def create_vm(
    vm_data: VMCreateRequest, session: SessionDep, current_user: CurrentUser
):
    return provisioning_service.create_vm(
        session=session, vm_data=vm_data, user_id=current_user.id
    )


@router.get("/templates", response_model=list[VMTemplateSchema])
def get_vm_templates(current_user: CurrentUser):
    return provisioning_service.get_vm_templates()
