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
    max_wait_seconds: int | None = None,
    check_interval: int | None = None
) -> dict:
    """
    Wait for a Proxmox task to complete with timeout and retry logic.

    Args:
        node_name: Proxmox node name
        task_id: Task UPID
        max_wait_seconds: Maximum time to wait (default: from settings)
        check_interval: Seconds between status checks (default: from settings)

    Returns:
        Task status data

    Raises:
        TimeoutError: If task doesn't complete within max_wait_seconds
        Exception: If task fails or API error occurs
    """
    # Use settings defaults if not provided
    if max_wait_seconds is None:
        max_wait_seconds = settings.PROXMOX_TASK_TIMEOUT
    if check_interval is None:
        check_interval = settings.PROXMOX_TASK_CHECK_INTERVAL

    proxmox = get_proxmox_api()
    start_time = time.time()
    retry_count = 0
    max_retries = 3

    logger.info(f"Waiting for task {task_id} on node {node_name}")

    while True:
        try:
            # Check if we've exceeded max wait time
            elapsed = time.time() - start_time
            if elapsed > max_wait_seconds:
                raise TimeoutError(
                    f"Task {task_id} did not complete within {max_wait_seconds} seconds"
                )

            # Get task status
            data = proxmox.nodes(node_name).tasks(task_id).status.get()

            # Reset retry count on successful request
            retry_count = 0

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

        except TimeoutError:
            raise
        except Exception as e:
            retry_count += 1
            if retry_count >= max_retries:
                logger.error(f"Failed to check task status after {max_retries} retries: {e}")
                raise

            logger.warning(
                f"Error checking task status (attempt {retry_count}/{max_retries}): {e}. "
                f"Retrying in {check_interval}s..."
            )
            time.sleep(check_interval)
