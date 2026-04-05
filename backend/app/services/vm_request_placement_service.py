from __future__ import annotations

from dataclasses import dataclass

from sqlmodel import Session

from app.ai.pve_advisor import recommendation_service as advisor_service
from app.ai.pve_advisor.schemas import (
    NodeCapacity,
    PlacementDecision,
    PlacementPlan,
    PlacementRequest,
    ResourceType,
)
from app.models import VMRequest
from app.repositories import proxmox_config as proxmox_config_repo
from app.repositories import proxmox_node as proxmox_node_repo

GIB = 1024**3


@dataclass
class CurrentPlacementSelection:
    node: str | None
    strategy: str
    plan: PlacementPlan


def build_plan(
    *,
    session: Session,
    request: PlacementRequest,
    node_capacities: list[NodeCapacity],
    effective_resource_type: ResourceType,
    resource_type_reason: str,
    placement_strategy: str | None = None,
    node_priorities: dict[str, int] | None = None,
) -> PlacementPlan:
    strategy = placement_strategy or get_placement_strategy(session)
    priorities = node_priorities or get_node_priorities(session)
    working_nodes = [item.model_copy(deep=True) for item in node_capacities]
    required_cpu = advisor_service._effective_cpu_cores(request, effective_resource_type)
    required_memory = advisor_service._effective_memory_bytes(request, effective_resource_type)
    required_disk = request.disk_gb * GIB
    placements: dict[str, int] = {item.node: 0 for item in working_nodes}
    remaining = request.instance_count

    while remaining > 0:
        candidates = [
            item
            for item in working_nodes
            if item.candidate
            and advisor_service._can_fit(
                item,
                cores=required_cpu,
                memory_bytes=required_memory,
                disk_bytes=required_disk,
                gpu_required=request.gpu_required,
            )
        ]
        if not candidates:
            break

        chosen = min(
            candidates,
            key=lambda item: _placement_sort_key(
                item,
                placements=placements,
                priorities=priorities,
                strategy=strategy,
                cores=required_cpu,
                memory_bytes=required_memory,
                disk_bytes=required_disk,
            ),
        )
        placements[chosen.node] += 1
        chosen.allocatable_cpu_cores = max(
            chosen.allocatable_cpu_cores - required_cpu,
            0.0,
        )
        chosen.allocatable_memory_bytes = max(
            chosen.allocatable_memory_bytes - required_memory,
            0,
        )
        chosen.allocatable_disk_bytes = max(
            chosen.allocatable_disk_bytes - required_disk,
            0,
        )
        chosen.running_resources += 1
        chosen.guest_pressure_ratio = advisor_service._guest_pressure_ratio(
            chosen.running_resources,
            int(chosen.total_cpu_cores),
        )
        chosen.guest_overloaded = (
            chosen.guest_pressure_ratio
            >= advisor_service.settings.guest_pressure_threshold
        )
        chosen.candidate = (
            chosen.status == "online"
            and chosen.allocatable_cpu_cores > 0
            and chosen.allocatable_memory_bytes > 0
            and chosen.allocatable_disk_bytes > 0
            and not chosen.guest_overloaded
        )
        remaining -= 1

    assigned = request.instance_count - remaining
    placement_decisions = [
        PlacementDecision(
            node=item.node,
            instance_count=placements[item.node],
            cpu_cores_reserved=round(placements[item.node] * required_cpu, 2),
            memory_bytes_reserved=placements[item.node] * required_memory,
            disk_bytes_reserved=placements[item.node] * required_disk,
            remaining_cpu_cores=round(item.allocatable_cpu_cores, 2),
            remaining_memory_bytes=item.allocatable_memory_bytes,
            remaining_disk_bytes=item.allocatable_disk_bytes,
        )
        for item in working_nodes
        if placements[item.node] > 0
    ]
    placement_decisions.sort(key=lambda item: (-item.instance_count, item.node))

    return PlacementPlan(
        feasible=remaining == 0,
        requested_resource_type=request.resource_type,
        effective_resource_type=effective_resource_type,
        resource_type_reason=resource_type_reason,
        assigned_instances=assigned,
        unassigned_instances=remaining,
        recommended_node=placement_decisions[0].node if placement_decisions else None,
        summary=advisor_service._build_summary_text(
            request=request,
            placement_decisions=placement_decisions,
            effective_resource_type=effective_resource_type,
            assigned=assigned,
            remaining=remaining,
        ),
        rationale=advisor_service._build_rationale(
            request=request,
            placement_decisions=placement_decisions,
            effective_resource_type=effective_resource_type,
            node_capacities=node_capacities,
        ),
        warnings=advisor_service._build_warnings(
            node_capacities=node_capacities,
            request=request,
            effective_resource_type=effective_resource_type,
            remaining=remaining,
        ),
        placements=placement_decisions,
        candidate_nodes=node_capacities,
    )


def select_current_target_node(
    *,
    session: Session,
    db_request: VMRequest,
) -> CurrentPlacementSelection:
    request = _to_placement_request(db_request)
    nodes, resources = advisor_service._load_cluster_state()
    cpu_overcommit_ratio, disk_overcommit_ratio = get_overcommit_ratios(session)
    node_capacities = advisor_service._build_node_capacities(
        nodes=nodes,
        resources=resources,
        cpu_overcommit_ratio=cpu_overcommit_ratio,
        disk_overcommit_ratio=disk_overcommit_ratio,
    )
    effective_resource_type, resource_type_reason = advisor_service._decide_resource_type(
        request
    )
    plan = build_plan(
        session=session,
        request=request,
        node_capacities=node_capacities,
        effective_resource_type=effective_resource_type,
        resource_type_reason=resource_type_reason,
    )
    return CurrentPlacementSelection(
        node=plan.recommended_node,
        strategy=get_placement_strategy(session),
        plan=plan,
    )


def get_placement_strategy(session: Session) -> str:
    config = proxmox_config_repo.get_proxmox_config(session)
    return config.placement_strategy if config else "dominant_share_min"


def get_overcommit_ratios(session: Session) -> tuple[float, float]:
    config = proxmox_config_repo.get_proxmox_config(session)
    if not config:
        return 1.0, 1.0

    return (
        max(float(config.cpu_overcommit_ratio or 1.0), 1.0),
        max(float(config.disk_overcommit_ratio or 1.0), 1.0),
    )


def get_node_priorities(session: Session) -> dict[str, int]:
    return {item.name: int(item.priority) for item in proxmox_node_repo.get_all_nodes(session)}


def _placement_sort_key(
    node: NodeCapacity,
    *,
    placements: dict[str, int],
    priorities: dict[str, int],
    strategy: str,
    cores: float,
    memory_bytes: int,
    disk_bytes: int,
) -> tuple:
    projected_cpu_share = _projected_share(
        used=max(node.total_cpu_cores - node.allocatable_cpu_cores, 0.0) + cores,
        total=max(node.total_cpu_cores, 1.0),
    )
    projected_memory_share = _projected_share(
        used=max(node.total_memory_bytes - node.allocatable_memory_bytes, 0) + memory_bytes,
        total=max(node.total_memory_bytes, 1),
    )
    projected_disk_share = _projected_share(
        used=max(node.total_disk_bytes - node.allocatable_disk_bytes, 0) + disk_bytes,
        total=max(node.total_disk_bytes, 1),
    )
    dominant_share = max(projected_cpu_share, projected_memory_share, projected_disk_share)
    average_share = (
        projected_cpu_share + projected_memory_share + projected_disk_share
    ) / 3.0
    placement_count = placements.get(node.node, 0)

    if strategy == "priority_dominant_share":
        return (
            priorities.get(node.node, 5),
            placement_count,
            dominant_share,
            average_share,
            projected_cpu_share,
            node.node,
        )

    return (
        placement_count,
        dominant_share,
        average_share,
        projected_cpu_share,
        node.node,
    )


def _projected_share(*, used: float | int, total: float | int) -> float:
    denominator = float(total or 1.0)
    return float(used) / denominator if denominator > 0 else 1.0


def _to_placement_request(db_request: VMRequest) -> PlacementRequest:
    disk_gb = (
        int(db_request.disk_size or 0)
        if db_request.resource_type == "vm"
        else int(db_request.rootfs_size or 0)
    )
    if disk_gb <= 0:
        disk_gb = 20 if db_request.resource_type == "vm" else 8

    return PlacementRequest(
        resource_type=db_request.resource_type,
        cpu_cores=int(db_request.cores or 1),
        memory_mb=int(db_request.memory or 512),
        disk_gb=disk_gb,
        instance_count=1,
        gpu_required=0,
    )
