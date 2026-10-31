"""Batfleck routine (manual ticks, sleep target, enabled items); wider equipment column for machine stations.

Revision ID: 0007
Revises: 0006
Create Date: 2026-10-30
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0007"
down_revision: str | Sequence[str] | None = "0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "routine_checks",
        sa.Column("athlete_id", sa.String(length=36), nullable=False),
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("item_id", sa.String(length=32), nullable=False),
        sa.Column("done", sa.Boolean(), nullable=False),
        sa.Column("value", sa.Float(), nullable=True),
        sa.ForeignKeyConstraint(["athlete_id"], ["athletes.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("athlete_id", "day", "item_id"),
    )
    with op.batch_alter_table("athletes") as batch_op:
        batch_op.alter_column("equipment", existing_type=sa.String(length=255), type_=sa.String(length=512),
                              existing_nullable=True)
        batch_op.add_column(sa.Column("sleep_target_hours", sa.Float(), nullable=False, server_default="8.0"))
        batch_op.add_column(sa.Column("routine_items", sa.String(length=255), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("athletes") as batch_op:
        batch_op.drop_column("routine_items")
        batch_op.drop_column("sleep_target_hours")
        batch_op.alter_column("equipment", existing_type=sa.String(length=512), type_=sa.String(length=255),
                              existing_nullable=True)
    op.drop_table("routine_checks")
