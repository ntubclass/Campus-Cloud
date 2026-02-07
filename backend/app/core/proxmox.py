import logging
from functools import lru_cache

from proxmoxer import ProxmoxAPI

from app.core.config import settings

logger = logging.getLogger(__name__)


@lru_cache
def get_proxmox_api() -> ProxmoxAPI:
    return ProxmoxAPI(
        settings.PROXMOX_HOST,
        user=settings.PROXMOX_USER,
        password=settings.PROXMOX_PASSWORD,
        verify_ssl=settings.PROXMOX_VERIFY_SSL,
    )
