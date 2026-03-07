import logging
import time
import uuid

from sqlmodel import Session

from app.core.proxmox import basic_blocking_task_status, get_proxmox_api
from app.exceptions import BadRequestError, ProxmoxError
from app.schemas import ResourcePublic
from app.repositories import resource as resource_repo
from app.services import audit_service

logger = logging.getLogger(__name__)


def _get_ip_address(proxmox, node: str, vmid: int, vm_type: str) -> str | None:
    try:
        if vm_type == "lxc":
            interfaces = proxmox.nodes(node).lxc(vmid).interfaces.get()
            for iface in interfaces:
                if iface.get("name") in ["eth0", "net0"]:
                    inet = iface.get("inet")
                    if inet:
                        return inet.split("/")[0]
        else:
            try:
                network_info = (
                    proxmox.nodes(node)
                    .qemu(vmid)("agent")("network-get-interfaces")
                    .get()
                )
                if network_info and "result" in network_info:
                    for iface in network_info["result"]:
                        if iface.get("name") in ["eth0", "ens18"]:
                            for ip in iface.get("ip-addresses", []):
                                if (
                                    ip.get("ip-address-type") == "ipv4"
                                    and not ip.get("ip-address", "").startswith("127.")
                                ):
                                    return ip.get("ip-address")
            except Exception:
                pass
    except Exception as e:
        logger.debug(f"Failed to get IP for VMID {vmid}: {e}")
    return None


def _build_resource_public(
    resource: dict, db_resource, proxmox, node: str, vm_type: str
) -> ResourcePublic:
    ip_address = _get_ip_address(proxmox, node, resource.get("vmid"), vm_type)
    return ResourcePublic(
        vmid=resource.get("vmid"),
        name=resource.get("name", ""),
        status=resource.get("status", ""),
        node=node,
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


def list_all(
    *, session: Session, node: str | None = None
) -> list[ResourcePublic]:
    try:
        proxmox = get_proxmox_api()
        resources = proxmox.cluster.resources.get(type="vm")
        result = []
        for r in resources:
            if (node and r.get("node") != node) or r.get("template") == 1:
                continue
            vmid = r.get("vmid")
            vm_type = r.get("type")
            vm_node = r.get("node")
            db_resource = resource_repo.get_resource_by_vmid(
                session=session, vmid=vmid
            )
            result.append(
                _build_resource_public(r, db_resource, proxmox, vm_node, vm_type)
            )
        return result
    except Exception as e:
        logger.error(f"Failed to get resources: {e}")
        raise ProxmoxError(f"Failed to get resources: {e}")


def list_by_user(
    *, session: Session, user_id: uuid.UUID
) -> list[ResourcePublic]:
    try:
        user_resources = resource_repo.get_resources_by_user(
            session=session, user_id=user_id
        )
        if not user_resources:
            return []

        owned_vmids = {r.vmid: r for r in user_resources}
        proxmox = get_proxmox_api()
        resources = proxmox.cluster.resources.get(type="vm")
        result = []
        for r in resources:
            if r.get("template") == 1:
                continue
            vmid = r.get("vmid")
            if vmid not in owned_vmids:
                continue
            vm_type = r.get("type")
            vm_node = r.get("node")
            result.append(
                _build_resource_public(
                    r, owned_vmids[vmid], proxmox, vm_node, vm_type
                )
            )
        return result
    except Exception as e:
        logger.error(f"Failed to get user resources: {e}")
        raise ProxmoxError(f"Failed to get user resources: {e}")


def get_config(*, vmid: int, resource_info: dict) -> dict:
    try:
        proxmox = get_proxmox_api()
        node = resource_info["node"]
        resource_type = resource_info["type"]
        if resource_type == "qemu":
            return proxmox.nodes(node).qemu(vmid).config.get()
        return proxmox.nodes(node).lxc(vmid).config.get()
    except Exception as e:
        logger.error(f"Failed to get config for {vmid}: {e}")
        raise ProxmoxError(f"Failed to get config for resource {vmid}: {e}")


def control(
    *,
    session: Session,
    vmid: int,
    action: str,
    resource_info: dict,
    user_id: uuid.UUID,
) -> dict:
    """Control a resource: start, stop, reboot, shutdown, reset."""
    valid_actions = {"start", "stop", "reboot", "shutdown", "reset"}
    if action not in valid_actions:
        raise BadRequestError(f"Invalid action: {action}")

    try:
        proxmox = get_proxmox_api()
        node = resource_info["node"]
        resource_type = resource_info["type"]

        if resource_type == "qemu":
            getattr(proxmox.nodes(node).qemu(vmid).status, action).post()
        else:
            getattr(proxmox.nodes(node).lxc(vmid).status, action).post()

        action_map = {
            "start": "resource_start",
            "stop": "resource_stop",
            "reboot": "resource_reboot",
            "shutdown": "resource_shutdown",
            "reset": "resource_reset",
        }
        audit_service.log_action(
            session=session,
            user_id=user_id,
            vmid=vmid,
            action=action_map[action],
            details=f"{action.capitalize()} {resource_type} {resource_info.get('name', vmid)}",
        )

        logger.info(f"Resource {vmid} {action}")
        return {"message": f"Resource {vmid} {action}"}
    except BadRequestError:
        raise
    except Exception as e:
        logger.error(f"Failed to {action} resource {vmid}: {e}")
        raise ProxmoxError(f"Failed to {action} resource {vmid}: {e}")


def delete(
    *,
    session: Session,
    vmid: int,
    resource_info: dict,
    user_id: uuid.UUID,
    purge: bool = True,
    force: bool = False,
) -> dict:
    try:
        proxmox = get_proxmox_api()
        node = resource_info["node"]
        resource_type = resource_info["type"]

        # Force stop if running
        current_status = resource_info.get("status", "")
        if current_status == "running":
            if not force:
                raise BadRequestError(
                    f"Resource {vmid} is running. Use force=true to stop and delete."
                )
            if resource_type == "qemu":
                proxmox.nodes(node).qemu(vmid).status.stop.post()
            else:
                proxmox.nodes(node).lxc(vmid).status.stop.post()

            # Wait for stop
            for _ in range(30):
                time.sleep(1)
                try:
                    if resource_type == "qemu":
                        status = (
                            proxmox.nodes(node).qemu(vmid).status.current.get()
                        )
                    else:
                        status = (
                            proxmox.nodes(node).lxc(vmid).status.current.get()
                        )
                    if status.get("status") == "stopped":
                        break
                except Exception:
                    break

        # Delete the resource
        delete_params = {}
        if purge:
            delete_params["purge"] = 1
            if resource_type == "qemu":
                delete_params["destroy-unreferenced-disks"] = 1

        if resource_type == "qemu":
            task = proxmox.nodes(node).qemu(vmid).delete(**delete_params)
        else:
            task = proxmox.nodes(node).lxc(vmid).delete(**delete_params)

        basic_blocking_task_status(node, task)

        # Remove from database
        resource_repo.delete_resource(session=session, vmid=vmid)

        audit_service.log_action(
            session=session,
            user_id=user_id,
            vmid=vmid,
            action="resource_delete",
            details=(
                f"Deleted {resource_type} {resource_info.get('name', vmid)} "
                f"(purge={purge}, force={force})"
            ),
        )

        logger.info(f"Resource {vmid} deleted")
        return {"message": f"Resource {vmid} deleted successfully"}
    except (BadRequestError, ProxmoxError):
        raise
    except Exception as e:
        logger.error(f"Failed to delete resource {vmid}: {e}")
        raise ProxmoxError(f"Failed to delete resource {vmid}: {e}")


def get_current_stats(*, vmid: int, resource_info: dict) -> dict:
    try:
        proxmox = get_proxmox_api()
        node = resource_info["node"]
        resource_type = resource_info["type"]
        if resource_type == "qemu":
            s = proxmox.nodes(node).qemu(vmid).status.current.get()
        else:
            s = proxmox.nodes(node).lxc(vmid).status.current.get()
        return {
            "cpu": s.get("cpu"),
            "maxcpu": s.get("cpus") or s.get("maxcpu"),
            "mem": s.get("mem"),
            "maxmem": s.get("maxmem"),
            "disk": s.get("disk"),
            "maxdisk": s.get("maxdisk"),
            "netin": s.get("netin"),
            "netout": s.get("netout"),
            "uptime": s.get("uptime"),
            "status": s.get("status", "unknown"),
        }
    except Exception as e:
        logger.error(f"Failed to get current stats for {vmid}: {e}")
        raise ProxmoxError(f"Failed to get stats for resource {vmid}: {e}")


def get_rrd_stats(
    *, vmid: int, resource_info: dict, timeframe: str
) -> list[dict]:
    valid_timeframes = ["hour", "day", "week", "month", "year"]
    if timeframe not in valid_timeframes:
        raise BadRequestError(
            f"Invalid timeframe. Must be one of: {valid_timeframes}"
        )
    try:
        proxmox = get_proxmox_api()
        node = resource_info["node"]
        resource_type = resource_info["type"]
        if resource_type == "qemu":
            return proxmox.nodes(node).qemu(vmid).rrddata.get(timeframe=timeframe)
        return proxmox.nodes(node).lxc(vmid).rrddata.get(timeframe=timeframe)
    except BadRequestError:
        raise
    except Exception as e:
        logger.error(f"Failed to get RRD stats for {vmid}: {e}")
        raise ProxmoxError(f"Failed to get RRD stats for resource {vmid}: {e}")


def direct_update_spec(
    *,
    session: Session,
    vmid: int,
    resource_info: dict,
    user_id: uuid.UUID,
    cores: int | None = None,
    memory: int | None = None,
    disk_size: str | None = None,
) -> dict:
    """Admin direct spec update (no approval needed)."""
    try:
        proxmox = get_proxmox_api()
        node = resource_info["node"]
        resource_type = resource_info["type"]

        changes = []
        config_params = {}

        if cores is not None:
            config_params["cores"] = cores
            changes.append(f"CPU: {cores} cores")
        if memory is not None:
            config_params["memory"] = memory
            changes.append(f"Memory: {memory}MB")

        if not config_params and not disk_size:
            raise BadRequestError(
                "At least one specification must be provided"
            )

        if config_params:
            if resource_type == "qemu":
                proxmox.nodes(node).qemu(vmid).config.put(**config_params)
            else:
                proxmox.nodes(node).lxc(vmid).config.put(**config_params)

        if disk_size:
            disk_name = "scsi0" if resource_type == "qemu" else "rootfs"
            if resource_type == "qemu":
                proxmox.nodes(node).qemu(vmid).resize.put(
                    disk=disk_name, size=disk_size
                )
            else:
                proxmox.nodes(node).lxc(vmid).resize.put(
                    disk=disk_name, size=disk_size
                )
            changes.append(f"Disk: {disk_size}")

        audit_service.log_action(
            session=session,
            user_id=user_id,
            vmid=vmid,
            action="config_update",
            details=f"Direct spec update: {', '.join(changes)}",
        )

        return {"message": f"Spec updated: {', '.join(changes)}"}
    except (BadRequestError, ProxmoxError):
        raise
    except Exception as e:
        logger.error(f"Failed to update spec for {vmid}: {e}")
        raise ProxmoxError(f"Failed to update spec for resource {vmid}: {e}")
