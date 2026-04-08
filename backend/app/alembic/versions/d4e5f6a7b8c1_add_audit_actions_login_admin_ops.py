"""add audit actions for login and admin operations

Revision ID: d4e5f6a7b8c1
Revises: c3d4e5f6a7b0
Create Date: 2026-04-07 12:00:00.000000

"""

from alembic import op

revision = "d4e5f6a7b8c1"
down_revision = "c3d4e5f6a7b0"
branch_labels = None
depends_on = None


NEW_VALUES = [
    # Login / auth
    "login_success",
    "login_failed",
    "login_google_success",
    "login_google_failed",
    "password_change",
    "password_recovery_request",
    "password_reset",
    # Firewall
    "firewall_layout_update",
    "firewall_connection_create",
    "firewall_connection_delete",
    "firewall_rule_create",
    "firewall_rule_update",
    "firewall_rule_delete",
    "nat_rule_delete",
    "nat_rule_sync",
    "reverse_proxy_rule_delete",
    "reverse_proxy_rule_sync",
    # Gateway
    "gateway_config_update",
    "gateway_keypair_generate",
    "gateway_config_write",
    "gateway_service_control",
    # Proxmox
    "proxmox_config_update",
    "proxmox_node_update",
    "proxmox_storage_update",
    "proxmox_sync_nodes",
    "proxmox_sync_now",
    # Migration
    "migration_job_retry",
    "migration_job_cancel",
    # Spec direct
    "spec_direct_update",
    # AI API credentials
    "ai_api_credential_rotate",
    "ai_api_credential_delete",
    "ai_api_credential_update",
]


def upgrade() -> None:
    for value in NEW_VALUES:
        op.execute(
            f"ALTER TYPE auditaction ADD VALUE IF NOT EXISTS '{value}'"
        )


def downgrade() -> None:
    # PostgreSQL does not support removing enum values; downgrade is a no-op
    pass
