from fastapi import APIRouter

from app.api.routes import login, lxc, private, resources, users, utils, vm, vm_requests
from app.core.config import settings

api_router = APIRouter()
api_router.include_router(login.router)
api_router.include_router(users.router)
api_router.include_router(utils.router)
api_router.include_router(resources.router)
api_router.include_router(vm.router)
api_router.include_router(lxc.router)
api_router.include_router(vm_requests.router)


if settings.ENVIRONMENT == "local":
    api_router.include_router(private.router)
