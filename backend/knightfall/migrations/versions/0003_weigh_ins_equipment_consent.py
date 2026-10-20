"""Weigh-ins, set timestamps, equipment profile and health-data consent.

Revision ID: 0003
Revises: 0002
Create Date: 2026-10-16
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0003"
down_revision: str | Sequence[str] | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "weigh_ins",
        sa.Column("athlete_id", sa.String(length=36), nullable=False),
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("weight_kg", sa.Float(), nullable=False),
        sa.Column("source", sa.String(length=16), nullable=False),
        sa.ForeignKeyConstraint(["athlete_id"], ["athletes.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("athlete_id", "day"),
    )
    with op.batch_alter_table("set_logs") as batch_op:
        batch_op.add_column(sa.Column("performed_at", sa.DateTime(timezone=True), nullable=True))
    with op.batch_alter_table("athletes") as batch_op:
        batch_op.add_column(sa.Column("equipment", sa.String(length=255), nullable=True))
        batch_op.add_column(sa.Column("health_consent_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("athletes") as batch_op:
        batch_op.drop_column("health_consent_at")
        batch_op.drop_column("equipment")
    with op.batch_alter_table("set_logs") as batch_op:
        batch_op.drop_column("performed_at")
    op.drop_table("weigh_ins")
