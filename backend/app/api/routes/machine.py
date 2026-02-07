import logging

from fastapi import APIRouter, HTTPException

from app.core.proxmox import get_proxmox_api
from app.models import NodeSchema, VMSchema, VNCInfoSchema, TerminalInfoSchema

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/machine", tags=["machine"])


@router.get("/nodes", response_model=list[NodeSchema])
def list_nodes():
    try:
        proxmox = get_proxmox_api()
        nodes = proxmox.nodes.get()
        logger.debug(f"Retrieved {len(nodes)} nodes from Proxmox")
        return nodes
    except Exception as e:
        logger.error(f"Failed to get nodes: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/vms", response_model=list[VMSchema])
def list_vms(node: str | None = None):
    try:
        proxmox = get_proxmox_api()
        vms = []

        # Use cluster resources API for more efficient retrieval
        resources = proxmox.cluster.resources.get(type="vm")

        for vm in resources:
            # Filter by node if specified
            if node and vm.get("node") != node:
                continue

            vms.append(
                {
                    "vmid": vm["vmid"],
                    "name": vm.get("name", f"VM-{vm['vmid']}"),
                    "status": vm.get("status", "unknown"),
                    "node": vm.get("node", ""),
                    "type": vm.get("type", "qemu"),  # "qemu" for VM, "lxc" for container
                    "cpu": vm.get("cpu"),
                    "maxcpu": vm.get("maxcpu"),
                    "mem": vm.get("mem"),
                    "maxmem": vm.get("maxmem"),
                    "uptime": vm.get("uptime"),
                }
            )

        logger.debug(f"Retrieved {len(vms)} VMs/Containers from Proxmox")
        return vms
    except Exception as e:
        logger.error(f"Failed to get VMs: {e}")
        return {"error": str(e)}, 500


@router.get("/{vmid}", response_model=VMSchema)
def get_vm_info(vmid: int):
    try:
        proxmox = get_proxmox_api()

        # Find VM in cluster resources
        resources = proxmox.cluster.resources.get(type="vm")
        for vm in resources:
            if vm["vmid"] == vmid:
                return {
                    "vmid": vm["vmid"],
                    "name": vm.get("name", f"VM-{vm['vmid']}"),
                    "status": vm.get("status", "unknown"),
                    "node": vm.get("node", ""),
                    "type": vm.get("type", "qemu"),  # "qemu" for VM, "lxc" for container
                    "cpu": vm.get("cpu"),
                    "maxcpu": vm.get("maxcpu"),
                    "mem": vm.get("mem"),
                    "maxmem": vm.get("maxmem"),
                    "uptime": vm.get("uptime"),
                }

        logger.warning(f"VM {vmid} not found")
        return {"error": f"VM {vmid} not found"}, 404
    except Exception as e:
        logger.error(f"Failed to get VM {vmid}: {e}")
        return {"error": str(e)}, 500


@router.get("/{vmid}/console", response_model=VNCInfoSchema)
def get_vm_console(vmid: int):
    """
    Get VNC console connection information for a VM.

    This endpoint returns the WebSocket URL that the frontend should connect to.
    The actual VNC connection is proxied through WebSocket at /ws/vnc/{vmid}/

    Args:
        vmid: Virtual machine ID

    Returns:
        WebSocket URL for connecting to the VM console
    """
    try:
        proxmox = get_proxmox_api()
        resources = proxmox.cluster.resources.get(type="vm")

        vm_info = None
        for vm in resources:
            if vm["vmid"] == vmid:
                vm_info = vm
                break

        if not vm_info:
            logger.warning(f"VM {vmid} not found for console request")
            raise HTTPException(status_code=404, detail=f"VM {vmid} not found")

        node = vm_info["node"]
        console_data = proxmox.nodes(node).qemu(vmid).vncproxy.post(websocket=1)
        vnc_ticket = console_data["ticket"]

        ws_url = f"/ws/vnc/{vmid}/"

        logger.info(f"Console URL and ticket generated for VM {vmid}")

        return {
            "vmid": vmid,
            "ws_url": ws_url,
            "ticket": vnc_ticket,
            "message": "Connect to this WebSocket URL to access the VM console",
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get console for VM {vmid}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{vmid}/terminal", response_model=TerminalInfoSchema)
def get_lxc_terminal(vmid: int):
    """
    Get terminal console connection information for an LXC container.

    This endpoint returns the WebSocket URL that the frontend should connect to.
    The actual terminal connection is proxied through WebSocket at /ws/terminal/{vmid}/

    Args:
        vmid: LXC container ID

    Returns:
        WebSocket URL for connecting to the container terminal
    """
    try:
        proxmox = get_proxmox_api()
        resources = proxmox.cluster.resources.get(type="vm")

        container_info = None
        for resource in resources:
            if resource["vmid"] == vmid and resource["type"] == "lxc":
                container_info = resource
                break

        if not container_info:
            logger.warning(f"LXC container {vmid} not found for terminal request")
            raise HTTPException(status_code=404, detail=f"LXC container {vmid} not found")

        node = container_info["node"]
        console_data = proxmox.nodes(node).lxc(vmid).termproxy.post()
        terminal_ticket = console_data["ticket"]

        ws_url = f"/ws/terminal/{vmid}/"

        logger.info(f"Terminal URL and ticket generated for LXC {vmid}")

        return {
            "vmid": vmid,
            "ws_url": ws_url,
            "ticket": terminal_ticket,
            "message": "Connect to this WebSocket URL to access the LXC terminal",
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get terminal for LXC {vmid}: {e}")
        raise HTTPException(status_code=500, detail=str(e))
