"""Standing exercise swaps ("always X instead of Y").

Revision ID: 0009
Revises: 0008
Create Date: 2026-11-06
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0009"
down_revision: str | Sequence[str] | None = "0008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "exercise_preferences",
        sa.Column("athlete_id", sa.String(length=36), nullable=False),
        sa.Column("exercise_id", sa.String(length=64), nullable=False),
        sa.Column("replacement_id", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["athlete_id"], ["athletes.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("athlete_id", "exercise_id"),
    )


def downgrade() -> None:
    op.drop_table("exercise_preferences")
