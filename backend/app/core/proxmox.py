import logging
import time
from functools import lru_cache

from proxmoxer import ProxmoxAPI

from app.core.config import settings

logger = logging.getLogger(__name__)


@lru_cache
def get_proxmox_api() -> ProxmoxAPI:
    """Get Proxmox API client with configurable timeout for long-running operations."""
    return ProxmoxAPI(
        settings.PROXMOX_HOST,
        user=settings.PROXMOX_USER,
        password=settings.PROXMOX_PASSWORD,
        verify_ssl=settings.PROXMOX_VERIFY_SSL,
        timeout=settings.PROXMOX_API_TIMEOUT,
    )


def basic_blocking_task_status(
    node_name: str,
    task_id: str,
    check_interval: int | None = None
) -> dict:
    """
    Wait for a Proxmox task to complete with polling interval.

    Args:
        node_name: Proxmox node name
        task_id: Task UPID
        check_interval: Seconds between status checks (default: from settings)

    Returns:
        Task status data

    Raises:
        Exception: If task fails or API error occurs
    """
    # Use settings default if not provided
    if check_interval is None:
        check_interval = settings.PROXMOX_TASK_CHECK_INTERVAL

    proxmox = get_proxmox_api()
    logger.info(f"Waiting for task {task_id} on node {node_name}")

    while True:
        # Get task status
        data = proxmox.nodes(node_name).tasks(task_id).status.get()

        status = data.get("status", "")
        exitstatus = data.get("exitstatus")

        logger.debug(f"Task {task_id} status: {status}, exitstatus: {exitstatus}")

        # Check if task is complete
        if status == "stopped":
            if exitstatus == "OK":
                logger.info(f"Task {task_id} completed successfully")
                return data
            else:
                error_msg = f"Task {task_id} failed with exitstatus: {exitstatus}"
                logger.error(error_msg)
                raise Exception(error_msg)

        # Wait before next check to avoid overwhelming the API
        time.sleep(check_interval)
