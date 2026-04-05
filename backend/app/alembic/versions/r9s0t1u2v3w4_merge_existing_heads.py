"""merge existing alembic heads

Revision ID: r9s0t1u2v3w4
Revises: p7q8r9s0t1u2, f6b3542f1194
Create Date: 2026-04-05 00:05:00.000000
"""

# This revision restores a missing merge point that already exists in the
# target database's alembic_version table. It intentionally performs no schema
# changes and only reconnects the migration graph.

from alembic import op


# revision identifiers, used by Alembic.
revision = "r9s0t1u2v3w4"
down_revision = ("p7q8r9s0t1u2", "f6b3542f1194")
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
