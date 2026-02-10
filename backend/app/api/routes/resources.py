import logging

from fastapi import APIRouter, HTTPException

from app.api.deps import ResourceInfoDep, SessionDep
from app.core.proxmox import get_proxmox_api
from app.crud import resource as resource_crud
from app.models import NodeSchema, ResourcePublic, VMSchema

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/resources", tags=["resources"])

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


def _get_vm_ip_address(proxmox, node: str, vmid: int, vm_type: str) -> str | None:
    """從Proxmox獲取VM/Container的IP地址."""
    try:
        if vm_type == "lxc":
            # 對於LXC容器，從網路介面獲取IP
            interfaces = proxmox.nodes(node).lxc(vmid).interfaces.get()
            for iface in interfaces:
                if iface.get("name") in ["eth0", "net0"]:
                    # 解析IP地址
                    inet = iface.get("inet")
                    if inet:
                        # inet格式通常是 "10.0.0.15/24"
                        return inet.split("/")[0]
        else:
            # 對於QEMU VM，嘗試從agent獲取
            try:
                network_info = (
                    proxmox.nodes(node).qemu(vmid)("agent")("network-get-interfaces").get()
                )
                if network_info and "result" in network_info:
                    for iface in network_info["result"]:
                        if iface.get("name") in ["eth0", "ens18"]:
                            ip_addresses = iface.get("ip-addresses", [])
                            for ip in ip_addresses:
                                if ip.get("ip-address-type") == "ipv4" and not ip.get(
                                    "ip-address", ""
                                ).startswith("127."):
                                    return ip.get("ip-address")
            except Exception:
                # Agent可能未運行，嘗試從配置獲取
                pass
    except Exception as e:
        logger.debug(f"Failed to get IP for VMID {vmid}: {e}")
    return None


@router.get("/", response_model=list[ResourcePublic])
def list_resources(
    session: SessionDep,
    node: str | None = None,
):
    try:
        proxmox = get_proxmox_api()
        result = []
        resources = proxmox.cluster.resources.get(type="vm")

        for resource in resources:
            if node and resource.get("node") != node:
                continue

            vmid = resource.get("vmid")
            vm_type = resource.get("type")
            vm_node = resource.get("node")

            # 從數據庫獲取資源額外信息
            db_resource = resource_crud.get_resource_by_vmid(
                session=session, vmid=vmid
            )

            # 獲取IP地址
            ip_address = _get_vm_ip_address(proxmox, vm_node, vmid, vm_type)

            # 組合數據
            resource_public = ResourcePublic(
                vmid=vmid,
                name=resource.get("name", ""),
                status=resource.get("status", ""),
                node=vm_node,
                type=vm_type,
                environment_type=db_resource.environment_type if db_resource else None,
                os_info=db_resource.os_info if db_resource else None,
                expiry_date=db_resource.expiry_date if db_resource else None,
                ip_address=ip_address,
                cpu=resource.get("cpu"),
                maxcpu=resource.get("maxcpu"),
                mem=resource.get("mem"),
                maxmem=resource.get("maxmem"),
                uptime=resource.get("uptime"),
            )
            result.append(resource_public)

        logger.debug(f"Retrieved {len(result)} resources from Proxmox")
        return result
    except Exception as e:
        logger.error(f"Failed to get resources: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{vmid}", response_model=VMSchema)
def get_resource(resource_info: ResourceInfoDep):
    return resource_info

@router.get("/{vmid}/config")
def get_resource_config(vmid: int, resource_info: ResourceInfoDep):
    try:
        proxmox = get_proxmox_api()
        resource_config = proxmox.nodes(resource_info["node"]).qemu(vmid).config.get()
        return resource_config
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get resource {vmid}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/{vmid}/start")
def start_resource(vmid: int, resource_info: ResourceInfoDep):
    try:
        proxmox = get_proxmox_api()
        node = resource_info["node"]
        resource_type = resource_info["type"]

        if resource_type == "qemu":
            proxmox.nodes(node).qemu(vmid).status.start.post()
        else:
            proxmox.nodes(node).lxc(vmid).status.start.post()

        logger.info(f"Resource {vmid} started")
        return {"message": f"Resource {vmid} started"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to start resource {vmid}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{vmid}/stop")
def stop_resource(vmid: int, resource_info: ResourceInfoDep):
    try:
        proxmox = get_proxmox_api()
        node = resource_info["node"]
        resource_type = resource_info["type"]

        if resource_type == "qemu":
            proxmox.nodes(node).qemu(vmid).status.stop.post()
        else:
            proxmox.nodes(node).lxc(vmid).status.stop.post()

        logger.info(f"Resource {vmid} stopped")
        return {"message": f"Resource {vmid} stopped"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to stop resource {vmid}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{vmid}/reboot")
def reboot_resource(vmid: int, resource_info: ResourceInfoDep):
    try:
        proxmox = get_proxmox_api()
        node = resource_info["node"]
        resource_type = resource_info["type"]

        if resource_type == "qemu":
            proxmox.nodes(node).qemu(vmid).status.reboot.post()
        else:
            proxmox.nodes(node).lxc(vmid).status.reboot.post()

        logger.info(f"Resource {vmid} rebooted")
        return {"message": f"Resource {vmid} rebooted"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to reboot resource {vmid}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{vmid}/shutdown")
def shutdown_resource(vmid: int, resource_info: ResourceInfoDep):
    try:
        proxmox = get_proxmox_api()
        node = resource_info["node"]
        resource_type = resource_info["type"]

        if resource_type == "qemu":
            proxmox.nodes(node).qemu(vmid).status.shutdown.post()
        else:
            proxmox.nodes(node).lxc(vmid).status.shutdown.post()

        logger.info(f"Resource {vmid} shutdown")
        return {"message": f"Resource {vmid} shutdown"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to shutdown resource {vmid}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{vmid}/reset")
def reset_resource(vmid: int, resource_info: ResourceInfoDep):
    try:
        proxmox = get_proxmox_api()
        node = resource_info["node"]
        resource_type = resource_info["type"]

        if resource_type == "qemu":
            proxmox.nodes(node).qemu(vmid).status.reset.post()
        else:
            proxmox.nodes(node).lxc(vmid).status.reset.post()

        logger.info(f"Resource {vmid} reset")
        return {"message": f"Resource {vmid} reset"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to reset resource {vmid}: {e}")
        raise HTTPException(status_code=500, detail=str(e))
