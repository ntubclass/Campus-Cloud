import logging
from typing import Annotated

from fastapi import Depends, HTTPException

from app.core.proxmox import get_proxmox_api

logger = logging.getLogger(__name__)


def get_vm_info(vmid: int) -> dict:
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

    return vm_info


VmInfoDep = Annotated[dict, Depends(get_vm_info)]


def get_lxc_info(vmid: int) -> dict:
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

    return container_info


LxcInfoDep = Annotated[dict, Depends(get_lxc_info)]


def get_resource_info(vmid: int) -> dict:
    try:
        proxmox = get_proxmox_api()
        resources = proxmox.cluster.resources.get(type="vm")

        resource_info = None
        for resource in resources:
            if resource["vmid"] == vmid:
                resource_info = resource
                break

        if not resource_info:
            logger.warning(f"Resource {vmid} not found")
            raise HTTPException(status_code=404, detail=f"Resource {vmid} not found")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get resource {vmid}: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    return resource_info

ResourceInfoDep = Annotated[dict, Depends(get_resource_info)]
